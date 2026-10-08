import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_MODULES,
  MODULES,
  normalizeModules,
  type ModuleKey,
  type Permission,
  type ResellerCustomerDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, requireSession } from '../../auth/access';
import type { Tx } from '../../db/client';
import {
  creditTransactions,
  domains,
  invoices,
  organizations,
  projects,
  servers,
  webspaces,
  type Organization,
} from '../../db/schema';
import { conflict, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { sendInvitationMail } from '../../mail/invitation';
import { billingCurrency } from '../billing/ledger';
import { loadOrg, orgCounts } from '../orgs/routes';
import {
  RESOURCE_MODULES,
  assertDeletable,
  assertModulesWithin,
  assertNoLinkedService,
  createInvitation,
  defaultProject,
  uniqueSlug,
} from './service';

const orgParams = z.object({ orgId: z.uuid() });
const customerParams = orgParams.extend({ customerId: z.uuid() });
const modulesSchema = z.array(z.enum(MODULES)).max(MODULES.length);
const resourceType = z.enum(['server', 'domain', 'webspace']);
type ResourceType = z.infer<typeof resourceType>;

const createBody = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().max(48).optional(),
  ownerEmail: z.email().max(200).optional(),
  modules: modulesSchema.optional(),
  notes: z.string().max(2000).optional(),
});

const updateBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  modules: modulesSchema.optional(),
  notes: z.string().max(2000).nullish(),
});

const moveBody = z.object({ type: resourceType, id: z.uuid(), projectId: z.uuid().optional() });
const releaseBody = z.object({ type: resourceType, id: z.uuid() });

interface Holdings {
  servers: { id: string; name: string; projectId: string }[];
  domains: { id: string; name: string }[];
  webspaces: { id: string; name: string }[];
}

/** Reseller area: customers of a reseller organization and the resources it hands out to them. */
export async function resellerRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  /** The reseller organization, if the caller sees it and it is a reseller (404 otherwise). */
  async function loadReseller(req: FastifyRequest, orgId: string, permission: Permission) {
    const org = await loadOrg(ctx, req, orgId);
    if (org.kind !== 'reseller') throw notFound('Reseller');
    await access.assert(req, permission, orgScope(orgId));
    return org;
  }

  /** A customer of this reseller. Anything else (other resellers' customers too) is 404. */
  async function loadCustomer(reseller: Organization, customerId: string): Promise<Organization> {
    const customer = await db.query.organizations.findFirst({
      where: and(eq(organizations.id, customerId), eq(organizations.parentOrgId, reseller.id)),
    });
    if (!customer) throw notFound('Customer');
    return customer;
  }

  /**
   * Credit balance and open invoice total per customer. Only for people who handle the
   * reseller's billing; everyone else gets zeros.
   */
  async function money(req: FastifyRequest, resellerId: string, customerIds: string[]) {
    const result = new Map<string, { balance: number; openTotal: number }>();
    if (customerIds.length === 0) return result;
    if (!(await access.can(req, 'reseller:billing', orgScope(resellerId)))) return result;
    const [balances, open] = await Promise.all([
      db
        .select({ orgId: creditTransactions.orgId, sum: sql<string>`sum(${creditTransactions.amount})` })
        .from(creditTransactions)
        .where(inArray(creditTransactions.orgId, customerIds))
        .groupBy(creditTransactions.orgId),
      db
        .select({
          orgId: invoices.orgId,
          sum: sql<string>`sum(${invoices.total} - ${invoices.amountPaid})`,
        })
        .from(invoices)
        .where(
          and(
            inArray(invoices.orgId, customerIds),
            eq(invoices.issuerOrgId, resellerId),
            eq(invoices.status, 'open'),
          ),
        )
        .groupBy(invoices.orgId),
    ]);
    for (const id of customerIds) {
      result.set(id, {
        balance: Number(balances.find((b) => b.orgId === id)?.sum ?? 0),
        openTotal: Number(open.find((o) => o.orgId === id)?.sum ?? 0),
      });
    }
    return result;
  }

  async function toCustomerDtos(
    req: FastifyRequest,
    reseller: Organization,
    customers: Organization[],
  ): Promise<ResellerCustomerDto[]> {
    const amounts = await money(
      req,
      reseller.id,
      customers.map((c) => c.id),
    );
    return Promise.all(
      customers.map(async (c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        status: c.status,
        suspendedBy: c.status === 'suspended' ? c.suspendedBy : null,
        modules: c.modules,
        notes: c.notes,
        counts: await orgCounts(ctx, c.id),
        currency: await billingCurrency(db, c.id),
        balance: amounts.get(c.id)?.balance ?? 0,
        openTotal: amounts.get(c.id)?.openTotal ?? 0,
        createdAt: c.createdAt.toISOString(),
      })),
    );
  }

  const toCustomerDto = async (req: FastifyRequest, reseller: Organization, customer: Organization) =>
    (await toCustomerDtos(req, reseller, [customer]))[0]!;

  // --- Customers ------------------------------------------------------------------

  app.get('/orgs/:orgId/customers', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const reseller = await loadReseller(req, orgId, 'reseller:customer:read');
    const rows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.parentOrgId, reseller.id))
      .orderBy(organizations.name);
    return toCustomerDtos(req, reseller, rows);
  });

  app.post('/orgs/:orgId/customers', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireSession(req);
    const reseller = await loadReseller(req, orgId, 'reseller:customer:write');
    const body = parse(createBody, req.body);
    const modules = body.modules
      ? normalizeModules(body.modules)
      : DEFAULT_MODULES.filter((m) => reseller.modules.includes(m));
    assertModulesWithin(reseller, modules);

    const slug = await uniqueSlug(db, body.slug || body.name);
    const result = await db.transaction(async (tx) => {
      const [customer] = await tx
        .insert(organizations)
        .values({
          name: body.name,
          slug,
          kind: 'customer',
          boundary: DEFAULT_CUSTOMER_BOUNDARY,
          parentOrgId: reseller.id,
          modules,
          notes: body.notes ?? null,
        })
        .returning();
      await tx.insert(projects).values({ orgId: customer!.id, name: 'Default' });
      // Always an invitation, even if the address has an account: the reseller must not
      // learn whether someone is registered, and nobody is added to an org unasked.
      const invitation = body.ownerEmail
        ? await createInvitation(ctx, tx, {
            orgId: customer!.id,
            email: body.ownerEmail,
            role: 'owner',
            invitedBy: auth.user.id,
            days: 14,
          })
        : null;
      return { customer: customer!, invitation };
    });
    const { customer, invitation } = result;
    await audit.record(req, {
      action: 'reseller.customer_create',
      orgId: reseller.id,
      resourceType: 'org',
      resourceId: customer.id,
      details: { name: customer.name, slug: customer.slug, modules, ownerEmail: body.ownerEmail ?? null },
    });
    const mail = invitation
      ? await sendInvitationMail(ctx.mail, {
          email: body.ownerEmail!,
          orgId: customer.id,
          orgName: customer.name,
          role: 'owner',
          link: invitation.link,
          expiresAt: invitation.expiresAt,
          inviter: auth.user,
        })
      : null;
    return {
      customer: await toCustomerDto(req, reseller, customer),
      inviteLink: invitation?.link ?? null,
      mail,
    };
  });

  app.get('/orgs/:orgId/customers/:customerId', async (req) => {
    const { orgId, customerId } = parse(customerParams, req.params);
    const reseller = await loadReseller(req, orgId, 'reseller:customer:read');
    return toCustomerDto(req, reseller, await loadCustomer(reseller, customerId));
  });

  app.patch('/orgs/:orgId/customers/:customerId', async (req) => {
    const { orgId, customerId } = parse(customerParams, req.params);
    const reseller = await loadReseller(req, orgId, 'reseller:customer:write');
    const customer = await loadCustomer(reseller, customerId);
    const body = parse(updateBody, req.body);
    const modules = body.modules ? normalizeModules(body.modules) : undefined;
    if (modules) assertModulesWithin(reseller, modules);
    const platformSuspended = conflict(
      'weblion.one suspended this customer. Only weblion.one can lift or change this suspension.',
    );
    if (body.status && customer.suspendedBy === 'platform') throw platformSuspended;
    const [updated] = await db
      .update(organizations)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.status
          ? { status: body.status, suspendedBy: body.status === 'suspended' ? ('reseller' as const) : null }
          : {}),
        ...(modules ? { modules } : {}),
        ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
      })
      .where(
        and(
          eq(organizations.id, customer.id),
          // The platform may have suspended it since it was loaded.
          body.status
            ? or(isNull(organizations.suspendedBy), ne(organizations.suspendedBy, 'platform'))
            : undefined,
        ),
      )
      .returning();
    if (!updated) throw body.status ? platformSuspended : notFound('Customer');
    await audit.record(req, {
      action: 'reseller.customer_update',
      orgId: reseller.id,
      resourceType: 'org',
      resourceId: customer.id,
      details: {
        ...body,
        ...(modules ? { modules, previousModules: customer.modules } : {}),
        ...(body.status ? { previousStatus: customer.status } : {}),
      },
    });
    return toCustomerDto(req, reseller, updated!);
  });

  app.delete('/orgs/:orgId/customers/:customerId', async (req) => {
    const { orgId, customerId } = parse(customerParams, req.params);
    requireSession(req);
    const reseller = await loadReseller(req, orgId, 'reseller:customer:write');
    const customer = await loadCustomer(reseller, customerId);
    await assertDeletable(db, customer.id);
    await db.delete(organizations).where(eq(organizations.id, customer.id));
    await audit.record(req, {
      action: 'reseller.customer_delete',
      orgId: reseller.id,
      resourceType: 'org',
      resourceId: customer.id,
      details: { name: customer.name, slug: customer.slug },
    });
    return { ok: true };
  });

  // --- Resources ------------------------------------------------------------------

  async function holdings(orgId: string): Promise<Holdings> {
    const [serverRows, domainRows, webspaceRows] = await Promise.all([
      db
        .select({ id: servers.id, name: servers.name, projectId: projects.id })
        .from(servers)
        .innerJoin(projects, eq(projects.id, servers.projectId))
        .where(eq(projects.orgId, orgId))
        .orderBy(asc(servers.name)),
      db
        .select({ id: domains.id, name: domains.name })
        .from(domains)
        .where(eq(domains.orgId, orgId))
        .orderBy(asc(domains.name)),
      db
        .select({ id: webspaces.id, name: webspaces.name })
        .from(webspaces)
        .where(eq(webspaces.orgId, orgId))
        .orderBy(asc(webspaces.name)),
    ]);
    return { servers: serverRows, domains: domainRows, webspaces: webspaceRows };
  }

  app.get('/orgs/:orgId/customers/:customerId/resources', async (req) => {
    const { orgId, customerId } = parse(customerParams, req.params);
    const reseller = await loadReseller(req, orgId, 'reseller:customer:read');
    const customer = await loadCustomer(reseller, customerId);
    const [own, pool] = await Promise.all([holdings(customer.id), holdings(reseller.id)]);
    return { ...own, pool };
  });

  interface Owner {
    name: string;
    orgId: string | null;
    projectId: string | null;
  }

  /** Current owner organization and display name of a resource, or null if it doesn't exist. */
  async function resourceOwner(type: ResourceType, id: string): Promise<Owner | null> {
    if (type === 'server') {
      const [row] = await db
        .select({ name: servers.name, orgId: projects.orgId, projectId: servers.projectId })
        .from(servers)
        .leftJoin(projects, eq(projects.id, servers.projectId))
        .where(eq(servers.id, id));
      return row ?? null;
    }
    const table = type === 'domain' ? domains : webspaces;
    const [row] = await db
      .select({ name: table.name, orgId: table.orgId })
      .from(table)
      .where(eq(table.id, id));
    return row ? { ...row, projectId: null } : null;
  }

  const notFoundFor = (type: ResourceType) =>
    notFound(type === 'server' ? 'Server' : type === 'domain' ? 'Domain' : 'Web space');

  /**
   * Hands a resource to `orgId` (servers into `projectId`). Only if it still belongs to whom
   * it belonged when the request checked it, so a parallel admin assignment can't be undone.
   */
  async function moveResource(
    tx: Tx,
    type: ResourceType,
    id: string,
    from: Owner,
    to: { orgId: string; projectId: string | null },
  ): Promise<void> {
    let moved: { id: string }[];
    if (type === 'server') {
      moved = await tx
        .update(servers)
        .set({ projectId: to.projectId })
        .where(and(eq(servers.id, id), eq(servers.projectId, from.projectId!)))
        .returning({ id: servers.id });
    } else {
      const table = type === 'domain' ? domains : webspaces;
      moved = await tx
        .update(table)
        .set({ orgId: to.orgId })
        .where(and(eq(table.id, id), eq(table.orgId, from.orgId!)))
        .returning({ id: table.id });
    }
    if (moved.length === 0) throw conflict('This resource was changed meanwhile. Reload and try again.');
  }

  /** Moves a resource into a customer, from the reseller's pool or from a sibling customer. */
  app.post('/orgs/:orgId/customers/:customerId/resources', async (req) => {
    const { orgId, customerId } = parse(customerParams, req.params);
    const reseller = await loadReseller(req, orgId, 'reseller:customer:write');
    const customer = await loadCustomer(reseller, customerId);
    const body = parse(moveBody, req.body);

    const siblings = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.parentOrgId, reseller.id));
    const holders = new Set([reseller.id, ...siblings.map((s) => s.id)]);
    const current = await resourceOwner(body.type, body.id);
    // Resources outside the reseller's reach don't exist for it.
    if (!current?.orgId || !holders.has(current.orgId)) throw notFoundFor(body.type);

    const module: ModuleKey = RESOURCE_MODULES[body.type];
    if (!reseller.modules.includes(module)) {
      throw conflict(`Your organization does not have the module "${module}"`);
    }

    let projectId: string | null = null;
    if (body.type === 'server' && body.projectId) {
      const project = await db.query.projects.findFirst({
        where: and(eq(projects.id, body.projectId), eq(projects.orgId, customer.id)),
      });
      if (!project) throw notFound('Project');
      projectId = project.id;
    }

    const moduleEnabled = await db.transaction(async (tx) => {
      // Like an admin assignment: the customer gets the module the resource belongs to.
      const [target] = await tx
        .select({ modules: organizations.modules })
        .from(organizations)
        .where(eq(organizations.id, customer.id))
        .for('update');
      const enable = !target!.modules.includes(module);
      if (enable) {
        await tx
          .update(organizations)
          .set({ modules: normalizeModules([...target!.modules, module]) })
          .where(eq(organizations.id, customer.id));
      }
      if (current.orgId !== customer.id) await assertNoLinkedService(tx, body.type, body.id, customer.id);
      if (body.type === 'server') projectId ??= (await defaultProject(tx, customer.id)).id;
      await moveResource(tx, body.type, body.id, current, { orgId: customer.id, projectId });
      return enable;
    });
    await audit.record(req, {
      action: 'reseller.resource_assign',
      orgId: reseller.id,
      resourceType: body.type,
      resourceId: body.id,
      details: {
        name: current.name,
        customerId: customer.id,
        customer: customer.name,
        previousOrgId: current.orgId,
        projectId,
        moduleEnabled: moduleEnabled ? module : null,
      },
    });
    return { ok: true };
  });

  /** Moves a resource of a customer back into the reseller's own organization. */
  app.post('/orgs/:orgId/customers/:customerId/resources/release', async (req) => {
    const { orgId, customerId } = parse(customerParams, req.params);
    const reseller = await loadReseller(req, orgId, 'reseller:customer:write');
    const customer = await loadCustomer(reseller, customerId);
    const body = parse(releaseBody, req.body);
    const current = await resourceOwner(body.type, body.id);
    if (!current || current.orgId !== customer.id) throw notFoundFor(body.type);

    const projectId = await db.transaction(async (tx) => {
      await assertNoLinkedService(tx, body.type, body.id, reseller.id);
      const target = body.type === 'server' ? (await defaultProject(tx, reseller.id)).id : null;
      await moveResource(tx, body.type, body.id, current, { orgId: reseller.id, projectId: target });
      return target;
    });
    await audit.record(req, {
      action: 'reseller.resource_release',
      orgId: reseller.id,
      resourceType: body.type,
      resourceId: body.id,
      details: { name: current.name, customerId: customer.id, customer: customer.name, projectId },
    });
    return { ok: true };
  });
}
