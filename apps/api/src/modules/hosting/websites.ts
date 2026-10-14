import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CREATABLE_WEBSITE_TYPES,
  NODEJS_VERSIONS,
  PHP_VERSION_PATTERN,
  SITE_USER_PATTERN,
  WEBSITE_DB_SUFFIX_PATTERN,
  WEBSITE_PASSWORD_PATTERN,
  WEBSITE_TEMPLATE_PATTERN,
  isReservedSiteUser,
  suggestSiteUser,
  websiteDatabaseName,
  websiteDatabasePrefix,
  websiteDomainAscii,
  type CreatableWebsiteType,
  type Permission,
  type UnmanagedWebsitesDto,
  type WebsiteAllowanceDto,
  type WebsiteCreatedDto,
  type WebsiteCredentialsDto,
  type WebsiteDatabaseSecretDto,
  type WebsiteDnsCheckDto,
  type WebsiteOptionsDto,
  type WebsiteServerOptions,
  type WebspaceDetailDto,
  type WebspaceDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, platformScope, requireAuth, requireSession } from '../../auth/access';
import type { DbOrTx } from '../../db/client';
import {
  organizations,
  providerConnections,
  webspaceDatabases,
  webspaces,
  websiteAllowances,
  type Organization,
  type ProviderConnection,
  type WebsiteAllowance,
  type Webspace,
  type WebspaceDatabase,
} from '../../db/schema';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import type { ProviderAdapter, RemoteWebsite } from '../../providers/types';
import { allowanceExceeded, noAllowance } from '../cloud/service';
import { loadOrg } from '../orgs/routes';
import {
  WEBSITE_MODULE,
  assignmentTarget,
  requireSupport,
  toWebspaceDto,
  webspaceRowsQuery,
  type LoadedWebspace,
} from './service';
import {
  assertWebsiteAllowanceCovers,
  committedDatabases,
  committedSites,
  loadWebsiteAllowance,
  lockWebsiteOrg,
  normalizeSiteTypes,
  removeWebsiteAllowance,
  toWebsiteAllowanceDto,
  typeNotAllowed,
  upsertWebsiteAllowance,
  websiteAllowanceDto,
  websiteCommitments,
} from './website-allowance';
import { forgetWebsiteDnsCheck, panelDomainFor, websiteDnsCheck } from './website-dns';
import {
  WEBSITE_SSH_PORT,
  applyRemoteWebsite,
  assertDomainFree,
  assertNoActiveService,
  changeRefused,
  enableWebsiteModule,
  generateWebsitePassword,
  loadWebsite,
  outcomeUnknown,
  requireActive,
  requireWebsiteSupport,
  siteGone,
  syncWebsiteDatabases,
  toDatabaseDto,
  toWebspaceInfo,
  websiteAccess,
  websiteDetail,
  websiteDisplayName,
} from './website-service';

const idParams = z.object({ id: z.uuid() });
const orgParams = z.object({ orgId: z.uuid() });
const databaseParams = idParams.extend({ databaseId: z.uuid() });

const password = z
  .string()
  .regex(WEBSITE_PASSWORD_PATTERN, '12 to 128 characters, no quotes, $, :, \\, (, ), & or spaces');
const domainInput = z.string().trim().min(3).max(253);

const createBody = z.object({
  domain: domainInput,
  type: z.enum(CREATABLE_WEBSITE_TYPES),
  phpVersion: z.string().regex(PHP_VERSION_PATTERN).optional(),
  template: z.string().trim().regex(WEBSITE_TEMPLATE_PATTERN).optional(),
  nodejsVersion: z.enum(NODEJS_VERSIONS).optional(),
  siteUser: z
    .string()
    .trim()
    .regex(SITE_USER_PATTERN, '3 to 32 lower-case letters, digits and "-", starting with a letter')
    .optional(),
  password: password.optional(),
  database: z
    .object({ suffix: z.string().regex(WEBSITE_DB_SUFFIX_PATTERN), password: password.optional() })
    .nullable()
    .optional(),
});
type CreateBody = z.infer<typeof createBody>;
const adminCreateBody = createBody.extend({ providerId: z.uuid(), orgId: z.uuid().nullable() });
const passwordBody = z.object({ password: password.optional() }).default({});
const databaseBody = z.object({
  suffix: z.string().regex(WEBSITE_DB_SUFFIX_PATTERN),
  password: password.optional(),
});
const confirmBody = z.object({ confirm: z.string().trim().min(1).max(253) });
const certificateBody = z.object({ force: z.boolean().default(false) }).default({ force: false });
const adoptBody = z.object({ domain: domainInput });
const allowanceBody = z.object({
  providerId: z.uuid(),
  maxSites: z.number().int().min(0).max(1000),
  maxDatabases: z.number().int().min(0).max(5000),
  siteTypes: z.array(z.enum(CREATABLE_WEBSITE_TYPES)).min(1),
  enableModule: z.boolean().default(true),
});
const resellerAllowanceBody = allowanceBody.omit({ providerId: true, enableModule: true });

/** New PHP websites get this vhost template unless one is chosen. */
const DEFAULT_TEMPLATE = 'Generic';
/** CloudPanel's templates of the other site types: never a PHP application. */
const TYPE_TEMPLATES = ['Static', 'Nodejs', 'Python', 'ReverseProxy'];
const TYPE_LABELS: Record<CreatableWebsiteType, string> = { php: 'PHP', static: 'static', nodejs: 'Node.js' };

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Passwords must not end up in browser or proxy caches. */
function noStore(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
}

/** 400 for one field, in the shape parse() produces. */
const invalid = (path: string, message: string) => badRequest('Validation failed', [{ path, message }]);
const exists = (field: string, message: string) => new AppError(409, 'exists', message, { field });

/** The Linux user of a website (SFTP/SSH login). */
function siteUserOf(row: Webspace): string {
  const user = row.info?.site?.siteUser ?? row.info?.username;
  if (!user) throw conflict('The site user of this website is not known yet; the next sync reads it');
  return user;
}

/** Audit entry of a website change; `details.domain` is the Unicode name. */
interface WebsiteEntry {
  action: string;
  orgId: string | null;
  resourceId: string | null;
  details: Record<string, unknown>;
}

function entryFor(row: Webspace, action: string, details: Record<string, unknown> = {}): WebsiteEntry {
  return { action, orgId: row.orgId, resourceId: row.id, details: { domain: row.name, ...details } };
}

interface CreateTarget {
  /** Owner of the new website; null: unassigned (staff only). */
  org: Organization | null;
  connection: ProviderConnection;
  /** Customers create inside this allowance. Staff create without one (null). */
  allowance: WebsiteAllowance | null;
  /** Staff: activate the module of the owner. */
  enableModule: boolean;
}

/**
 * Websites (module "webhosting", CloudPanel): options and creation inside the allowance,
 * passwords (shown once, never stored), databases, Let's Encrypt with a DNS check, deletion,
 * allowances (admin and reseller), and the admin routes to create, adopt and forget websites.
 * Lists and the detail are the web space routes (kind "website").
 */
export async function websiteRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit, providers } = ctx;

  async function website(req: FastifyRequest, permission?: Permission): Promise<LoadedWebspace> {
    const { id } = parse(idParams, req.params);
    return loadWebsite(ctx, req, id, permission);
  }

  /** Inside a transaction pass `tx`: a second pool connection must never be awaited there. */
  async function connectionById(id: string, from: DbOrTx = db): Promise<ProviderConnection> {
    const connection = await from.query.providerConnections.findFirst({
      where: eq(providerConnections.id, id),
    });
    if (!connection) throw notFound('Provider');
    return connection;
  }

  async function orgById(id: string): Promise<Organization> {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org) throw notFound('Organization');
    return org;
  }

  async function websiteDto(req: FastifyRequest, id: string): Promise<WebspaceDto> {
    const [row] = await webspaceRowsQuery(ctx).where(eq(webspaces.id, id)).limit(1);
    if (!row) throw notFound('Website');
    return toWebspaceDto(ctx, req, row);
  }

  async function websiteDatabase(loaded: LoadedWebspace, databaseId: string): Promise<WebspaceDatabase> {
    const row = await db.query.webspaceDatabases.findFirst({
      where: and(eq(webspaceDatabases.id, databaseId), eq(webspaceDatabases.webspaceId, loaded.webspace.id)),
    });
    if (!row) throw notFound('Database');
    return row;
  }

  /** Platform staff act without allowance checks (they can create on any instance anyway). */
  function isStaff(req: FastifyRequest): Promise<boolean> {
    return access.can(req, 'platform:website:write', platformScope);
  }

  async function succeeded(req: FastifyRequest, entry: WebsiteEntry, extra: Record<string, unknown> = {}) {
    await audit.record(req, {
      action: entry.action,
      orgId: entry.orgId,
      resourceType: 'webspace',
      resourceId: entry.resourceId,
      details: { ...entry.details, ...extra },
    });
  }

  /** Audits a failed change. Never inside a transaction (the audit needs its own connection). */
  async function failed(req: FastifyRequest, entry: WebsiteEntry, err: unknown) {
    await audit.record(req, {
      action: entry.action,
      orgId: entry.orgId,
      resourceType: 'webspace',
      resourceId: entry.resourceId,
      status: 'failure',
      details: { ...entry.details, error: errorMessage(err) },
    });
  }

  /** Audits a refused allowance change; nothing was changed. Never inside a transaction. */
  async function allowanceRefused(
    req: FastifyRequest,
    entry: { action: string; orgId: string; resourceId: string; details: Record<string, unknown> },
    err: unknown,
  ) {
    await audit.record(req, {
      action: entry.action,
      orgId: entry.orgId,
      resourceType: 'website_allowance',
      resourceId: entry.resourceId,
      status: 'failure',
      details: { ...entry.details, error: errorMessage(err) },
    });
  }

  /** Runs a step of a change (its checks, or the call to the server); a failure is audited and rethrown. */
  async function atServer<T>(req: FastifyRequest, entry: WebsiteEntry, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      await failed(req, entry, err);
      throw err;
    }
  }

  /** What the server offers for new websites (502 when it cannot be asked). */
  async function serverOptions(adapter: ProviderAdapter): Promise<WebsiteServerOptions> {
    try {
      return await adapter.websiteServerOptions!();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(502, 'provider_error', `The server could not be asked: ${errorMessage(err)}`);
    }
  }

  /**
   * What staff may create on an instance: every type and PHP application the server has, not
   * only what the connection offers customers (Node.js when the server allows it at all). PHP
   * and Node.js versions follow the connection's offer like for customers.
   */
  async function staffOptions(
    adapter: ProviderAdapter,
    options: WebsiteServerOptions,
  ): Promise<WebsiteServerOptions> {
    const info = adapter.websiteServerInfo ? await adapter.websiteServerInfo() : null;
    const nodejs = info ? info.nodejsEnabled : options.types.includes('nodejs');
    return {
      ...options,
      types: ['php', 'static', ...(nodejs ? (['nodejs'] as const) : [])],
      templates: (info?.templates ?? options.templates).filter(
        (t) => WEBSITE_TEMPLATE_PATTERN.test(t.name) && !TYPE_TEMPLATES.includes(t.name),
      ),
    };
  }

  /**
   * The checks of a new website before anything is reserved: the allowance's types, what the
   * server offers (staff: everything it has), versions, template, site user, database name.
   */
  async function planSite(body: CreateBody, ascii: string, target: CreateTarget) {
    const { connection, allowance } = target;
    const label = TYPE_LABELS[body.type];
    if (allowance && !allowance.siteTypes.includes(body.type)) {
      throw typeNotAllowed(`The website allowance does not include ${label} websites`, { type: body.type });
    }
    const adapter = providers.forConnection(connection);
    requireWebsiteSupport(adapter);
    const options = await serverOptions(adapter);
    const staff = allowance ? null : await staffOptions(adapter, options);
    if (!(staff?.types ?? options.types).includes(body.type)) {
      throw typeNotAllowed(`${label} websites are not offered on ${connection.name}`, { type: body.type });
    }

    let phpVersion: string | null = null;
    let template: string | null = null;
    let nodejsVersion: string | null = null;
    if (body.type === 'php') {
      phpVersion = body.phpVersion ?? options.defaultPhpVersion;
      if (!phpVersion || !options.phpVersions.includes(phpVersion)) {
        throw invalid(
          'phpVersion',
          `PHP ${phpVersion ?? ''} is not offered on this server (offered: ${options.phpVersions.join(', ') || 'none'})`,
        );
      }
      template = body.template ?? DEFAULT_TEMPLATE;
      const templates = (staff ?? options).templates.map((t) => t.name);
      if (!templates.includes(template)) {
        throw invalid('template', `The application ${template} is not offered on this server`);
      }
    }
    if (body.type === 'nodejs') {
      if (!body.nodejsVersion) throw invalid('nodejsVersion', 'Choose a Node.js version');
      if (!options.nodejsVersions.includes(body.nodejsVersion)) {
        throw invalid(
          'nodejsVersion',
          `Node.js ${body.nodejsVersion} is not offered on this server (offered: ${options.nodejsVersions.join(', ') || 'none'})`,
        );
      }
      nodejsVersion = body.nodejsVersion;
    }
    const siteUser = body.siteUser ?? suggestSiteUser(ascii);
    if (!SITE_USER_PATTERN.test(siteUser) || isReservedSiteUser(siteUser)) {
      throw invalid('siteUser', `${siteUser} cannot be used as site user. Choose another one.`);
    }
    let databaseName: string | null = null;
    if (body.database) {
      databaseName = websiteDatabaseName(siteUser, body.database.suffix);
      if (!databaseName) {
        throw invalid(
          'database.suffix',
          `${websiteDatabasePrefix(siteUser)}_${body.database.suffix} is not a valid database name (at most 32 characters)`,
        );
      }
    }
    return { options, phpVersion, template, nodejsVersion, siteUser, databaseName };
  }

  /** POST /orgs/:orgId/websites (customers) and POST /admin/websites (staff). */
  async function createSite(
    req: FastifyRequest,
    reply: FastifyReply,
    body: CreateBody,
    target: CreateTarget,
  ): Promise<WebsiteCreatedDto> {
    const auth = requireAuth(req);
    const ascii = websiteDomainAscii(body.domain);
    if (!ascii) throw invalid('domain', 'not a valid domain name');
    // A generated password is shown once to a person. Scripts send the ones they set.
    if (auth.token && (!body.password || (body.database && !body.database.password))) {
      throw badRequest('API tokens cannot receive passwords. Send one.');
    }
    const { org, connection, allowance } = target;
    const entry: WebsiteEntry = {
      action: 'website.create',
      orgId: org?.id ?? null,
      resourceId: null,
      details: {
        domain: websiteDisplayName(ascii),
        type: body.type,
        providerId: connection.id,
        instance: connection.name,
      },
    };
    // Refusals of the allowance and of the server's offer are audited like the later ones.
    const plan = await atServer(req, entry, () => planSite(body, ascii, target));
    const { options, phpVersion, template, nodejsVersion, siteUser, databaseName } = plan;
    const adapter = providers.forConnection(connection);
    const sitePassword = body.password ?? generateWebsitePassword();
    const databasePassword = body.database ? (body.database.password ?? generateWebsitePassword()) : null;
    Object.assign(entry.details, {
      phpVersion,
      template,
      nodejsVersion,
      siteUser,
      database: databaseName,
      // Who chose them is recorded, the passwords themselves never are.
      password: body.password ? 'chosen' : 'generated',
      ...(body.database ? { databasePassword: body.database.password ? 'chosen' : 'generated' } : {}),
    });

    // Reserve the website (and its database) under the organization's lock. The rows count
    // against the allowance from here on, so the slow call to the server runs without the lock.
    let reserved: { row: Webspace; database: WebspaceDatabase | null; moduleEnabled: boolean };
    try {
      reserved = await db.transaction(async (tx) => {
        const moduleEnabled = org && target.enableModule ? await enableWebsiteModule(tx, org.id) : false;
        if (org) await lockWebsiteOrg(tx, org);
        // One website per domain and its www counterpart, on all instances and for all
        // organizations: checked under a lock of the name, so parallel creations cannot both pass.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`website-domain:${ascii.replace(/^www\./, '')}`}, 0))`,
        );
        await assertDomainFree(tx, ascii, connection.id, org);
        if (org && allowance) {
          const current = await tx.query.websiteAllowances.findFirst({
            where: eq(websiteAllowances.orgId, org.id),
          });
          if (!current) throw noAllowance('This organization has no website allowance');
          if (current.providerConnectionId !== connection.id || !current.siteTypes.includes(body.type)) {
            throw conflict('The website allowance changed meanwhile. Try again.');
          }
          const usage = await websiteCommitments(tx, org, current.providerConnectionId);
          const sitesLeft = current.maxSites - committedSites(usage);
          if (sitesLeft < 1) {
            throw allowanceExceeded(`Your allowance has room for ${Math.max(sitesLeft, 0)} more websites`, {
              maxSites: current.maxSites,
              sites: committedSites(usage),
            });
          }
          const databasesLeft = current.maxDatabases - committedDatabases(usage);
          if (databaseName && databasesLeft < 1) {
            throw allowanceExceeded(
              `Your allowance has room for ${Math.max(databasesLeft, 0)} more databases`,
              { maxDatabases: current.maxDatabases, databases: committedDatabases(usage) },
            );
          }
        }
        const [row] = await tx
          .insert(webspaces)
          .values({
            providerConnectionId: connection.id,
            externalId: ascii,
            name: websiteDisplayName(ascii),
            kind: 'website',
            status: 'creating',
            orgId: org?.id ?? null,
            info: null,
            meta: { createdBy: auth.user.id },
          })
          .onConflictDoNothing()
          .returning();
        if (!row) throw exists('domain', 'This website already exists on the server');
        let database: WebspaceDatabase | null = null;
        if (databaseName) {
          [database = null] = await tx
            .insert(webspaceDatabases)
            .values({
              webspaceId: row.id,
              providerConnectionId: connection.id,
              name: databaseName,
              userName: databaseName,
              status: 'creating',
            })
            .onConflictDoNothing()
            .returning();
          if (!database)
            throw exists('database', `The database ${databaseName} already exists on this server`);
        }
        return { row, database, moduleEnabled };
      });
    } catch (err) {
      await failed(req, entry, err);
      throw err;
    }
    const { row } = reserved;
    entry.resourceId = row.id;
    if (reserved.moduleEnabled) entry.details.moduleEnabled = WEBSITE_MODULE;

    const started = new Date();
    let created: { website: RemoteWebsite; warnings: string[] };
    try {
      created = await adapter.createWebsite!({
        domain: ascii,
        type: body.type,
        phpVersion,
        template,
        nodejsVersion,
        siteUser,
        password: sitePassword,
        database: databaseName
          ? { name: databaseName, userName: databaseName, password: databasePassword! }
          : null,
      });
    } catch (err) {
      await failed(req, entry, err);
      if (changeRefused(err)) {
        // Nothing is left on the server: give the slot back (the database row cascades).
        await db.delete(webspaces).where(eq(webspaces.id, row.id));
        throw err;
      }
      // Timeout, dropped connection, failed rollback: the sync settles the row by what the
      // server has. Nobody saw a password, so access needs a new one.
      const meta = { lastError: errorMessage(err).slice(0, 1000), credentialsDelivered: false };
      await db
        .update(webspaces)
        .set({ status: 'error', meta: sql`${webspaces.meta} || ${JSON.stringify(meta)}::jsonb` })
        .where(eq(webspaces.id, row.id));
      if (reserved.database) {
        await db
          .update(webspaceDatabases)
          .set({ status: 'error' })
          .where(eq(webspaceDatabases.id, reserved.database.id));
      }
      throw outcomeUnknown(
        'The website may have been created; the next sync shows it. Set a new password to get access.',
        err,
      );
    }

    const { website: remote, warnings } = created;
    await applyRemoteWebsite(db, row, remote, {
      since: started,
      ipAddress: options.ipv4[0] ?? null,
      status: 'active',
    });
    let database: WebspaceDatabase | null = null;
    if (reserved.database) {
      const id = reserved.database.id;
      if (remote.databases.some((d) => d.name === reserved.database!.name)) {
        [database = null] = await db
          .update(webspaceDatabases)
          .set({ status: 'active', lastSyncedAt: new Date() })
          .where(eq(webspaceDatabases.id, id))
          .returning();
      } else {
        // The site exists, its database could not be created (see warnings): the slot is free.
        await db.delete(webspaceDatabases).where(eq(webspaceDatabases.id, id));
      }
    }
    await succeeded(req, entry, { warnings });
    const credentials: WebsiteCredentialsDto = {
      host: adapter.websiteAccessHost?.() ?? options.accessHost,
      port: WEBSITE_SSH_PORT,
      username: remote.facts.siteUser,
      password: auth.token ? null : sitePassword,
    };
    noStore(reply);
    reply.code(201);
    return {
      website: await websiteDto(req, row.id),
      access: credentials,
      database: database
        ? { database: toDatabaseDto(database), password: auth.token ? null : databasePassword }
        : null,
      warnings,
    };
  }

  // --- Customer: options and creation ----------------------------------------------------

  app.get('/orgs/:orgId/websites/options', async (req): Promise<WebsiteOptionsDto> => {
    const { orgId } = parse(orgParams, req.params);
    const org = await loadOrg(ctx, req, orgId);
    await access.assert(req, 'webspace:read', orgScope(orgId));
    const loaded = await loadWebsiteAllowance(db, orgId);
    if (!loaded) return { allowance: null, options: null, optionsError: null };
    const allowance = await toWebsiteAllowanceDto(ctx, org, loaded.allowance, loaded.connection);
    try {
      const adapter = providers.forConnection(loaded.connection);
      requireWebsiteSupport(adapter);
      const server = await adapter.websiteServerOptions!();
      return {
        allowance,
        options: { ...server, types: server.types.filter((t) => allowance.siteTypes.includes(t)) },
        optionsError: null,
      };
    } catch (err) {
      req.log.warn({ err, orgId }, 'website options failed');
      return { allowance, options: null, optionsError: errorMessage(err) };
    }
  });

  app.post('/orgs/:orgId/websites', async (req, reply): Promise<WebsiteCreatedDto> => {
    const { orgId } = parse(orgParams, req.params);
    const org = await loadOrg(ctx, req, orgId);
    await access.assert(req, 'webspace:write', orgScope(orgId));
    const body = parse(createBody, req.body);
    const loaded = await loadWebsiteAllowance(db, orgId);
    if (!loaded) throw noAllowance('This organization has no website allowance');
    return createSite(req, reply, body, {
      org,
      connection: loaded.connection,
      allowance: loaded.allowance,
      enableModule: false,
    });
  });

  // --- Website: passwords ----------------------------------------------------------------

  app.post('/webspaces/:id/password', async (req, reply): Promise<WebsiteCredentialsDto> => {
    const loaded = await website(req);
    requireSession(req);
    await access.assert(req, 'webspace:credentials', loaded.scope);
    const { webspace: row, adapter } = loaded;
    requireActive(row);
    requireSupport(adapter, 'setWebsitePassword', 'website passwords');
    const body = parse(passwordBody, req.body ?? {});
    const username = siteUserOf(row);
    const newPassword = body.password ?? generateWebsitePassword();
    const entry = entryFor(row, 'website.password_reset', {
      siteUser: username,
      password: body.password ? 'chosen' : 'generated',
    });
    await atServer(req, entry, () => adapter.setWebsitePassword!(row.externalId, newPassword));
    // Access works again: the website no longer waits for a password.
    await db
      .update(webspaces)
      .set({ meta: sql`${webspaces.meta} - 'credentialsDelivered'` })
      .where(eq(webspaces.id, row.id));
    // Who set a new password is recorded, the password itself never is.
    await succeeded(req, entry);
    noStore(reply);
    return {
      host: websiteAccess(row, adapter)?.host ?? row.info?.resources.ipAddress ?? '',
      port: WEBSITE_SSH_PORT,
      username,
      password: newPassword,
    };
  });

  // --- Website: databases ----------------------------------------------------------------

  app.post('/webspaces/:id/databases', async (req, reply): Promise<WebsiteDatabaseSecretDto> => {
    const auth = requireAuth(req);
    const loaded = await website(req, 'webspace:write');
    const { webspace: row, adapter } = loaded;
    requireActive(row);
    requireSupport(adapter, 'createWebsiteDatabase', 'website databases');
    const body = parse(databaseBody, req.body);
    if (auth.token && !body.password) {
      throw badRequest('API tokens cannot receive passwords. Send one.');
    }
    const siteUser = siteUserOf(row);
    const name = websiteDatabaseName(siteUser, body.suffix);
    if (!name) {
      throw invalid(
        'suffix',
        `${websiteDatabasePrefix(siteUser)}_${body.suffix} is not a valid database name (at most 32 characters)`,
      );
    }
    const staff = await isStaff(req);
    const newPassword = body.password ?? generateWebsitePassword();
    const entry = entryFor(row, 'website.db_create', {
      database: name,
      password: body.password ? 'chosen' : 'generated',
    });

    let placeholder: WebspaceDatabase;
    try {
      placeholder = await db.transaction(async (tx) => {
        const owner = loaded.org;
        if (owner) await lockWebsiteOrg(tx, owner);
        if (owner && !staff) {
          const allowance = await tx.query.websiteAllowances.findFirst({
            where: eq(websiteAllowances.orgId, owner.id),
          });
          if (!allowance) throw noAllowance('This organization has no website allowance');
          const usage = await websiteCommitments(tx, owner, allowance.providerConnectionId);
          const left = allowance.maxDatabases - committedDatabases(usage);
          if (left < 1) {
            throw allowanceExceeded(`Your allowance has room for ${Math.max(left, 0)} more databases`, {
              maxDatabases: allowance.maxDatabases,
              databases: committedDatabases(usage),
            });
          }
        }
        const [inserted] = await tx
          .insert(webspaceDatabases)
          .values({
            webspaceId: row.id,
            providerConnectionId: row.providerConnectionId,
            name,
            userName: name,
            status: 'creating',
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted) throw exists('database', `The database ${name} already exists on this server`);
        return inserted;
      });
    } catch (err) {
      await failed(req, entry, err);
      throw err;
    }

    const started = new Date();
    let remote: RemoteWebsite;
    try {
      remote = await adapter.createWebsiteDatabase!(row.externalId, {
        name,
        userName: name,
        password: newPassword,
      });
    } catch (err) {
      await failed(req, entry, err);
      if (changeRefused(err)) {
        await db.delete(webspaceDatabases).where(eq(webspaceDatabases.id, placeholder.id));
        throw err;
      }
      await db
        .update(webspaceDatabases)
        .set({ status: 'error' })
        .where(eq(webspaceDatabases.id, placeholder.id));
      throw outcomeUnknown(
        'The database may have been created; the next sync shows it. Set a new password for it to get access.',
        err,
      );
    }
    await applyRemoteWebsite(db, row, remote, { since: started });
    // The server confirmed it, whatever its list said.
    const [database] = await db
      .update(webspaceDatabases)
      .set({ status: 'active', missingSince: null })
      .where(eq(webspaceDatabases.id, placeholder.id))
      .returning();
    await succeeded(req, entry);
    noStore(reply);
    reply.code(201);
    return {
      database: toDatabaseDto(database ?? placeholder),
      password: auth.token ? null : newPassword,
    };
  });

  app.post(
    '/webspaces/:id/databases/:databaseId/password',
    async (req, reply): Promise<WebsiteDatabaseSecretDto> => {
      const loaded = await website(req);
      requireSession(req);
      await access.assert(req, 'webspace:credentials', loaded.scope);
      const { webspace: row, adapter } = loaded;
      const { databaseId } = parse(databaseParams, req.params);
      const database = await websiteDatabase(loaded, databaseId);
      requireActive(row);
      requireActive(database, { what: 'database' });
      requireSupport(adapter, 'setWebsiteDatabasePassword', 'database passwords');
      const body = parse(passwordBody, req.body ?? {});
      const newPassword = body.password ?? generateWebsitePassword();
      const userName = database.userName ?? database.name;
      const entry = entryFor(row, 'website.db_password_reset', {
        database: database.name,
        userName,
        password: body.password ? 'chosen' : 'generated',
      });
      await atServer(req, entry, () =>
        adapter.setWebsiteDatabasePassword!(row.externalId, database.name, userName, newPassword),
      );
      await succeeded(req, entry);
      noStore(reply);
      return { database: toDatabaseDto(database), password: newPassword };
    },
  );

  app.delete('/webspaces/:id/databases/:databaseId', async (req) => {
    const loaded = await website(req, 'webspace:write');
    const { webspace: row, adapter } = loaded;
    const { databaseId } = parse(databaseParams, req.params);
    const database = await websiteDatabase(loaded, databaseId);
    const { confirm } = parse(confirmBody, req.body ?? {});
    if (confirm !== database.name) {
      throw invalid('confirm', `Type the database name ${database.name} to confirm`);
    }
    requireActive(row);
    // A database gone on the server can still be removed here.
    requireActive(database, { what: 'database', allowMissing: true });
    requireSupport(adapter, 'deleteWebsiteDatabase', 'website databases');
    const entry = entryFor(row, 'website.db_delete', {
      database: database.name,
      sizeBytes: database.sizeBytes,
    });
    const [marked] = await db
      .update(webspaceDatabases)
      .set({ status: 'deleting' })
      .where(and(eq(webspaceDatabases.id, database.id), eq(webspaceDatabases.status, 'active')))
      .returning({ id: webspaceDatabases.id });
    if (!marked) throw new AppError(409, 'website_busy', 'This database is being created or deleted');

    const started = new Date();
    let remote: RemoteWebsite | null = null;
    const warnings: string[] = [];
    try {
      remote = await adapter.deleteWebsiteDatabase!(row.externalId, database.name);
    } catch (err) {
      if (!(err instanceof AppError && err.statusCode === 404)) {
        await db
          .update(webspaceDatabases)
          .set({ status: 'active' })
          .where(eq(webspaceDatabases.id, database.id));
        await failed(req, entry, err);
        throw err;
      }
      // Not on the server (any more): only the row is left to remove.
      warnings.push(errorMessage(err));
    }
    await db.delete(webspaceDatabases).where(eq(webspaceDatabases.id, database.id));
    if (remote) await applyRemoteWebsite(db, row, remote, { since: started });
    await succeeded(req, entry, warnings.length > 0 ? { warnings } : {});
    return { ok: true };
  });

  // --- Website: certificate, DNS ---------------------------------------------------------

  app.post('/webspaces/:id/certificate', async (req): Promise<WebspaceDetailDto> => {
    const loaded = await website(req, 'webspace:write');
    const { webspace: row, adapter } = loaded;
    requireActive(row);
    requireSupport(adapter, 'issueWebsiteCertificate', 'certificates');
    const { force } = parse(certificateBody, req.body ?? {});
    const entry = entryFor(row, 'website.certificate', { force });
    if (!force) {
      const check = await websiteDnsCheck(
        ctx.env,
        { id: row.id, domain: row.externalId, adapter },
        { fresh: true },
      );
      entry.details.dnsReady = check.ready;
      if (!check.ready) {
        const pending = check.names.filter((n) => n.status !== 'ok').map((n) => n.name);
        const err = new AppError(
          409,
          'dns_not_ready',
          `${pending.join(' and ')} must point to this server (${[...check.expected.ipv4, ...check.expected.ipv6].join(', ')}) before Let's Encrypt can issue a certificate`,
          { ...check, panelDomain: await panelDomainFor(ctx, req, row.externalId) },
        );
        await failed(req, entry, err);
        throw err;
      }
    }
    const started = new Date();
    const remote = await atServer(req, entry, () => adapter.issueWebsiteCertificate!(row.externalId));
    const stored = await applyRemoteWebsite(db, row, remote, { since: started });
    await succeeded(req, entry, { expiresAt: remote.facts.certificate?.expiresAt ?? null });
    return websiteDetail(ctx, req, { ...loaded, webspace: stored ?? row });
  });

  app.get('/webspaces/:id/dns-check', async (req): Promise<WebsiteDnsCheckDto> => {
    const loaded = await website(req);
    const { webspace: row, adapter } = loaded;
    const check = await websiteDnsCheck(ctx.env, { id: row.id, domain: row.externalId, adapter });
    return { ...check, panelDomain: await panelDomainFor(ctx, req, row.externalId) };
  });

  // --- Website: delete -------------------------------------------------------------------

  app.delete('/webspaces/:id', async (req) => {
    const loaded = await website(req, 'webspace:delete');
    const { webspace: row, adapter } = loaded;
    const { confirm } = parse(confirmBody, req.body ?? {});
    if (confirm !== row.name && confirm.toLowerCase() !== row.externalId) {
      throw invalid('confirm', 'Type the domain to confirm');
    }
    // Staff may clear a website whose last change did not finish.
    requireActive(row, { allowError: await isStaff(req) });
    requireSupport(adapter, 'deleteWebsite', 'deleting websites');
    await assertNoActiveService(db, row.id);
    const entry = entryFor(row, 'website.delete', {
      siteUser: row.info?.site?.siteUser ?? null,
      providerId: row.providerConnectionId,
    });
    const [marked] = await db
      .update(webspaces)
      .set({ status: 'deleting' })
      .where(and(eq(webspaces.id, row.id), eq(webspaces.status, row.status)))
      .returning({ id: webspaces.id });
    if (!marked) throw new AppError(409, 'website_busy', 'This website is being created or deleted');

    let warnings: string[];
    try {
      ({ warnings } = await adapter.deleteWebsite!(row.externalId));
    } catch (err) {
      if (!siteGone(err)) {
        // A timeout may still delete the site: the sync settles an "error" row by what the
        // server has. Every other failure left the site in place.
        const timedOut = err instanceof AppError && err.statusCode === 504;
        await db
          .update(webspaces)
          .set(
            timedOut
              ? {
                  status: 'error',
                  meta: sql`${webspaces.meta} || ${JSON.stringify({ lastError: errorMessage(err).slice(0, 1000) })}::jsonb`,
                }
              : { status: row.status },
          )
          .where(eq(webspaces.id, row.id));
        await failed(req, entry, err);
        throw err;
      }
      // Gone on the server, or no longer managed by the console there: the row goes.
      warnings = [errorMessage(err)];
    }
    await db.delete(webspaces).where(eq(webspaces.id, row.id));
    forgetWebsiteDnsCheck(row.id);
    await succeeded(req, entry, { warnings });
    return { ok: true, warnings };
  });

  // --- Admin: allowances -----------------------------------------------------------------

  app.get('/admin/orgs/:orgId/website-allowance', async (req): Promise<WebsiteAllowanceDto | null> => {
    await access.assert(req, 'platform:org:read', platformScope);
    const { orgId } = parse(orgParams, req.params);
    return websiteAllowanceDto(ctx, await orgById(orgId));
  });

  app.put('/admin/orgs/:orgId/website-allowance', async (req): Promise<WebsiteAllowanceDto> => {
    const auth = requireAuth(req);
    await access.assert(req, 'platform:org:write', platformScope);
    const { orgId } = parse(orgParams, req.params);
    const body = parse(allowanceBody, req.body);
    const org = await orgById(orgId);
    const connection = await connectionById(body.providerId);
    const next = {
      providerId: connection.id,
      maxSites: body.maxSites,
      maxDatabases: body.maxDatabases,
      siteTypes: normalizeSiteTypes(body.siteTypes),
    };
    let changed: { previous: WebsiteAllowance | null; moduleEnabled: boolean };
    try {
      requireWebsiteSupport(providers.forConnection(connection));
      if (body.enableModule && org.parentOrgId && !org.modules.includes(WEBSITE_MODULE)) {
        const parent = await orgById(org.parentOrgId);
        if (!parent.modules.includes(WEBSITE_MODULE)) {
          throw conflict(
            `The reseller "${parent.name}" does not have the module "${WEBSITE_MODULE}". Activate it for the reseller first.`,
          );
        }
      }
      changed = await db.transaction(async (tx) => {
        // The organization's row first, then the allowance locks (like the reseller move).
        const moduleEnabled = body.enableModule ? await enableWebsiteModule(tx, orgId) : false;
        await lockWebsiteOrg(tx, org);
        const current = await tx.query.websiteAllowances.findFirst({
          where: eq(websiteAllowances.orgId, orgId),
        });
        await assertWebsiteAllowanceCovers(tx, org, current, next);
        await upsertWebsiteAllowance(tx, {
          orgId,
          providerConnectionId: next.providerId,
          maxSites: next.maxSites,
          maxDatabases: next.maxDatabases,
          siteTypes: next.siteTypes,
          updatedBy: auth.user.id,
        });
        return { previous: current ?? null, moduleEnabled };
      });
    } catch (err) {
      await allowanceRefused(
        req,
        {
          action: 'website.allowance_set',
          orgId,
          resourceId: orgId,
          details: { ...next, instance: connection.name },
        },
        err,
      );
      throw err;
    }
    const { previous, moduleEnabled } = changed;
    await audit.record(req, {
      action: 'website.allowance_set',
      orgId,
      resourceType: 'website_allowance',
      resourceId: orgId,
      details: {
        providerId: next.providerId,
        instance: connection.name,
        maxSites: next.maxSites,
        maxDatabases: next.maxDatabases,
        siteTypes: next.siteTypes,
        previous: previous
          ? {
              providerId: previous.providerConnectionId,
              maxSites: previous.maxSites,
              maxDatabases: previous.maxDatabases,
              siteTypes: previous.siteTypes,
            }
          : null,
        moduleEnabled: moduleEnabled ? WEBSITE_MODULE : null,
      },
    });
    return (await websiteAllowanceDto(ctx, org))!;
  });

  app.delete('/admin/orgs/:orgId/website-allowance', async (req) => {
    await access.assert(req, 'platform:org:write', platformScope);
    const { orgId } = parse(orgParams, req.params);
    const org = await orgById(orgId);
    let removed: WebsiteAllowance;
    try {
      removed = await removeWebsiteAllowance(db, org);
    } catch (err) {
      await allowanceRefused(
        req,
        { action: 'website.allowance_delete', orgId, resourceId: orgId, details: {} },
        err,
      );
      throw err;
    }
    await audit.record(req, {
      action: 'website.allowance_delete',
      orgId,
      resourceType: 'website_allowance',
      resourceId: orgId,
      details: {
        providerId: removed.providerConnectionId,
        maxSites: removed.maxSites,
        maxDatabases: removed.maxDatabases,
        siteTypes: removed.siteTypes,
      },
    });
    return { ok: true };
  });

  // --- Reseller: allowances of its customers ---------------------------------------------

  /** A customer and its reseller, if the caller may manage the reseller's customers (404 otherwise). */
  async function resellerCustomer(req: FastifyRequest, permission: Permission) {
    requireAuth(req);
    const { orgId } = parse(orgParams, req.params);
    const customer = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    const reseller = customer?.parentOrgId
      ? await db.query.organizations.findFirst({ where: eq(organizations.id, customer.parentOrgId) })
      : undefined;
    if (
      !customer ||
      !reseller ||
      reseller.kind !== 'reseller' ||
      !(await access.canSeeOrg(req, reseller.id))
    ) {
      throw notFound('Customer');
    }
    await access.assert(req, permission, orgScope(reseller.id));
    return { customer, reseller };
  }

  app.get(
    '/reseller/customers/:orgId/website-allowance',
    async (req): Promise<WebsiteAllowanceDto | null> => {
      const { customer } = await resellerCustomer(req, 'reseller:customer:read');
      return websiteAllowanceDto(ctx, customer);
    },
  );

  app.put('/reseller/customers/:orgId/website-allowance', async (req): Promise<WebsiteAllowanceDto> => {
    const auth = requireAuth(req);
    const { customer, reseller } = await resellerCustomer(req, 'reseller:customer:write');
    const body = parse(resellerAllowanceBody, req.body);
    const siteTypes = normalizeSiteTypes(body.siteTypes);
    let changed: { previous: WebsiteAllowance | null; moduleEnabled: boolean; providerId: string };
    try {
      if (!reseller.modules.includes(WEBSITE_MODULE)) {
        throw conflict(`Your organization does not have the module "${WEBSITE_MODULE}"`);
      }
      changed = await db.transaction(async (tx) => {
        const moduleEnabled = await enableWebsiteModule(tx, customer.id);
        await lockWebsiteOrg(tx, customer);
        const own = await loadWebsiteAllowance(tx, reseller.id);
        if (!own) throw noAllowance('Your organization has no website allowance to hand out');
        const providerId = own.allowance.providerConnectionId;
        const current = await tx.query.websiteAllowances.findFirst({
          where: eq(websiteAllowances.orgId, customer.id),
        });
        // Also checks the customer's maxima against what the reseller has left.
        await assertWebsiteAllowanceCovers(tx, customer, current, {
          providerId,
          maxSites: body.maxSites,
          maxDatabases: body.maxDatabases,
          siteTypes,
        });
        await upsertWebsiteAllowance(tx, {
          orgId: customer.id,
          providerConnectionId: providerId,
          maxSites: body.maxSites,
          maxDatabases: body.maxDatabases,
          siteTypes,
          updatedBy: auth.user.id,
        });
        return { previous: current ?? null, moduleEnabled, providerId };
      });
    } catch (err) {
      await allowanceRefused(
        req,
        {
          action: 'reseller.website_allowance_set',
          orgId: reseller.id,
          resourceId: customer.id,
          details: {
            customerId: customer.id,
            customer: customer.name,
            maxSites: body.maxSites,
            maxDatabases: body.maxDatabases,
            siteTypes,
          },
        },
        err,
      );
      throw err;
    }
    const { previous, moduleEnabled, providerId } = changed;
    await audit.record(req, {
      action: 'reseller.website_allowance_set',
      orgId: reseller.id,
      resourceType: 'website_allowance',
      resourceId: customer.id,
      details: {
        customerId: customer.id,
        customer: customer.name,
        providerId,
        maxSites: body.maxSites,
        maxDatabases: body.maxDatabases,
        siteTypes,
        previous: previous
          ? {
              maxSites: previous.maxSites,
              maxDatabases: previous.maxDatabases,
              siteTypes: previous.siteTypes,
            }
          : null,
        moduleEnabled: moduleEnabled ? WEBSITE_MODULE : null,
      },
    });
    return (await websiteAllowanceDto(ctx, customer))!;
  });

  /** Gives the websites back to the reseller's allowance. Only while the customer has none. */
  app.delete('/reseller/customers/:orgId/website-allowance', async (req) => {
    const { customer, reseller } = await resellerCustomer(req, 'reseller:customer:write');
    let removed: WebsiteAllowance;
    try {
      removed = await removeWebsiteAllowance(db, customer);
    } catch (err) {
      await allowanceRefused(
        req,
        {
          action: 'reseller.website_allowance_delete',
          orgId: reseller.id,
          resourceId: customer.id,
          details: { customerId: customer.id, customer: customer.name },
        },
        err,
      );
      throw err;
    }
    await audit.record(req, {
      action: 'reseller.website_allowance_delete',
      orgId: reseller.id,
      resourceType: 'website_allowance',
      resourceId: customer.id,
      details: {
        customerId: customer.id,
        customer: customer.name,
        providerId: removed.providerConnectionId,
        maxSites: removed.maxSites,
        maxDatabases: removed.maxDatabases,
        siteTypes: removed.siteTypes,
      },
    });
    return { ok: true };
  });

  // --- Admin: create, unmanaged sites, adopt, forget -------------------------------------

  app.post('/admin/websites', async (req, reply): Promise<WebsiteCreatedDto> => {
    requireSession(req);
    await access.assert(req, 'platform:website:write', platformScope);
    const body = parse(adminCreateBody, req.body);
    const connection = await connectionById(body.providerId);
    // The reseller of the target needs the module itself.
    const org = body.orgId ? (await assignmentTarget(db, body.orgId, WEBSITE_MODULE, true)).org : null;
    return createSite(req, reply, body, { org, connection, allowance: null, enableModule: true });
  });

  /** What staff can create on an instance (POST /admin/websites checks the same lists). */
  app.get('/admin/providers/:id/websites/options', async (req): Promise<WebsiteServerOptions> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const connection = await connectionById(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    requireWebsiteSupport(adapter);
    return staffOptions(adapter, await serverOptions(adapter));
  });

  app.get('/admin/providers/:id/websites/unmanaged', async (req): Promise<UnmanagedWebsitesDto> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const connection = await connectionById(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    requireSupport(adapter, 'listUnmanagedWebsites', 'websites');
    return adapter.listUnmanagedWebsites!();
  });

  app.post('/admin/providers/:id/websites/adopt', async (req): Promise<WebspaceDto> => {
    requireSession(req);
    await access.assert(req, 'platform:website:write', platformScope);
    const connection = await connectionById(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    requireWebsiteSupport(adapter);
    requireSupport(adapter, 'adoptWebsite', 'adopting websites');
    const body = parse(adoptBody, req.body);
    const ascii = websiteDomainAscii(body.domain);
    if (!ascii) throw invalid('domain', 'not a valid domain name');
    const entry: WebsiteEntry = {
      action: 'website.adopt',
      orgId: null,
      resourceId: null,
      details: { domain: websiteDisplayName(ascii), providerId: connection.id, instance: connection.name },
    };
    const started = new Date();
    const remote = await atServer(req, entry, () => adapter.adoptWebsite!(ascii));
    const ipAddress = (await adapter.websiteServerOptions!().catch(() => null))?.ipv4[0] ?? null;
    const existing = await db.query.webspaces.findFirst({
      where: and(eq(webspaces.providerConnectionId, connection.id), eq(webspaces.externalId, remote.domain)),
    });
    let id: string;
    if (existing) {
      // A row the sync created meanwhile, or one left missing: it is managed again.
      if (existing.kind !== 'website') throw conflict(`${remote.domain} is a web space of this provider`);
      await applyRemoteWebsite(db, existing, remote, { since: started, ipAddress, status: 'active' });
      id = existing.id;
    } else {
      const [inserted] = await db
        .insert(webspaces)
        .values({
          providerConnectionId: connection.id,
          externalId: remote.domain,
          name: websiteDisplayName(remote.domain),
          kind: 'website',
          status: 'active',
          info: toWebspaceInfo(remote, ipAddress),
          lastSyncedAt: new Date(),
        })
        .returning();
      await syncWebsiteDatabases(db, inserted!.id, connection.id, remote, started);
      id = inserted!.id;
    }
    entry.resourceId = id;
    await succeeded(req, entry, { siteUser: remote.facts.siteUser });
    return websiteDto(req, id);
  });

  app.post('/admin/webspaces/:id/forget', async (req) => {
    requireSession(req);
    await access.assert(req, 'platform:website:write', platformScope);
    const { id } = parse(idParams, req.params);
    const row = await db.query.webspaces.findFirst({ where: eq(webspaces.id, id) });
    if (!row || row.kind !== 'website') throw notFound('Website');
    if (row.orgId && !row.missingSince) {
      throw conflict('This website belongs to an organization. Unassign it first.');
    }
    if (row.status === 'creating' || row.status === 'deleting') {
      throw new AppError(409, 'website_busy', 'This website is being created or deleted');
    }
    const connection = await connectionById(row.providerConnectionId);
    const adapter = providers.forConnection(connection);
    requireSupport(adapter, 'forgetWebsite', 'websites');
    const entry = entryFor(row, 'website.forget', {
      providerId: connection.id,
      instance: connection.name,
      previousOrgId: row.orgId,
    });
    await atServer(req, entry, async () => {
      try {
        await adapter.forgetWebsite!(row.externalId);
      } catch (err) {
        // Gone on the server already: only the row is left to remove.
        if (!(err instanceof AppError && err.statusCode === 404)) throw err;
      }
    });
    await db.delete(webspaces).where(eq(webspaces.id, row.id));
    forgetWebsiteDnsCheck(row.id);
    await succeeded(req, entry);
    return { ok: true };
  });
}
