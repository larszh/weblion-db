import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CDN_SSL_MODES,
  type CdnSettingPatch,
  type CdnSettings,
  type DnsMovePreview,
  type DnsMoveResult,
  type DnsRecord,
  type DomainInfo,
  type Permission,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { platformScope, requireSession } from '../../auth/access';
import { domains, type ProviderConnection } from '../../db/schema';
import { AppError, conflict, unsupported } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { mapLimit } from '../../providers/http';
import type { ProviderAdapter, RemoteDomain } from '../../providers/types';
import { DNS_MOVE_MAX_RECORDS, planRecordImport, zoneTargets, type ZoneTarget } from './dns-move';
import { NAMESERVERS_MIN } from './dns';
import {
  actionResponse,
  canCreateZones,
  counterparts,
  dnsRecordTypes,
  domainCapabilities,
  domainChange,
  domainKind,
  domainRowsQuery,
  domainScope,
  loadAdminDomain,
  loadDomain,
  mergeDomainInfo,
  refreshDomainInfo,
  requireDomainCapability,
  requireSupport,
  toLinkedDomain,
  type DomainRow,
  type LoadedDomain,
} from './service';

const idParams = z.object({ id: z.uuid() });

/** Exactly one setting per change. */
const cdnPatchBody = z.union([
  z.strictObject({ sslMode: z.enum(CDN_SSL_MODES) }),
  z.strictObject({ alwaysUseHttps: z.boolean() }),
  z.strictObject({ developmentMode: z.boolean() }),
]);
/** Only the whole cache for now; the field leaves room for purging single URLs later. */
const purgeBody = z.strictObject({ everything: z.literal(true) });
const moveQuery = z.object({ targetProviderId: z.uuid().optional() });
const moveBody = z.object({
  targetProviderId: z.uuid(),
  importRecords: z.boolean().default(true),
  setNameservers: z.boolean().default(false),
});

type CdnSetting = 'sslMode' | 'alwaysUseHttps' | 'developmentMode';
type ImportResult = DnsMoveResult['import'];
type NameserverResult = DnsMoveResult['nameservers'];

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A setting as a change names it: "auto" while Automatic SSL/TLS is on. */
function cdnValue(settings: CdnSettings, setting: CdnSetting): string | boolean {
  if (setting === 'sslMode') return settings.sslAutomatic ? 'auto' : settings.sslMode;
  return settings[setting];
}

/** What a zone provider takes when records are copied into it. */
function importTarget(adapter: ProviderAdapter) {
  return { types: dnsRecordTypes(adapter), capabilities: domainCapabilities(adapter) };
}

function canSetNameservers(adapter: ProviderAdapter): boolean {
  return domainCapabilities(adapter).includes('nameservers') && typeof adapter.setNameservers === 'function';
}

/**
 * DNS zones (Cloudflare): CDN settings and the activation check for customers with the zone,
 * and the platform-only "Move DNS to Cloudflare" for registered domains.
 */
export async function zoneRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;
  /** Registrar domains whose DNS move runs in this process right now. */
  const moving = new Set<string>();

  async function domain(req: FastifyRequest, permission?: Permission): Promise<LoadedDomain> {
    const { id } = parse(idParams, req.params);
    const loaded = await loadDomain(ctx, req, id);
    if (permission) await access.assert(req, permission, loaded.scope);
    return loaded;
  }

  // --- CDN ------------------------------------------------------------------------

  app.get('/domains/:id/cdn', async (req): Promise<CdnSettings> => {
    const loaded = await domain(req);
    requireDomainCapability(loaded.adapter, 'cdn', 'getCdnSettings', 'CDN settings');
    return loaded.adapter.getCdnSettings!(loaded.domain.externalId);
  });

  app.patch('/domains/:id/cdn', async (req): Promise<CdnSettings> => {
    const loaded = await domain(req, 'domain:manage');
    requireDomainCapability(loaded.adapter, 'cdn', 'updateCdnSetting', 'CDN settings');
    const patch: CdnSettingPatch = parse(cdnPatchBody, req.body);
    const [setting, after] = Object.entries(patch)[0] as [CdnSetting, string | boolean];
    const { externalId } = loaded.domain;
    // For the audit only (cached by the adapter): a failed read does not stop the change.
    const current = loaded.adapter.getCdnSettings
      ? await loaded.adapter.getCdnSettings(externalId).catch((err) => {
          req.log.warn({ err, domainId: loaded.domain.id }, 'CDN settings before the change failed');
          return null;
        })
      : null;
    const before = current ? cdnValue(current, setting) : null;
    return domainChange(ctx, req, loaded, 'cdn_update', { setting, before, after }, () =>
      loaded.adapter.updateCdnSetting!(externalId, patch),
    );
  });

  app.post('/domains/:id/cdn/purge', async (req) => {
    const loaded = await domain(req, 'domain:manage');
    requireDomainCapability(loaded.adapter, 'cdn', 'purgeCache', 'cache purges');
    parse(purgeBody, req.body);
    // Accepted is not done: Cloudflare purges within seconds after answering.
    const result = await domainChange(ctx, req, loaded, 'cache_purge', { everything: true }, () =>
      loaded.adapter.purgeCache!(loaded.domain.externalId),
    );
    return actionResponse(result);
  });

  // --- Pending zones ----------------------------------------------------------------

  app.post('/domains/:id/zone/activation-check', async (req) => {
    const loaded = await domain(req, 'domain:manage');
    requireSupport(loaded.adapter, 'checkZoneActivation', 'activation checks');
    if (domainKind(loaded.adapter) !== 'zone') {
      throw unsupported('This provider does not support activation checks');
    }
    // The stored status; a zone that turned active meanwhile is refused by the provider.
    const status = loaded.domain.info?.status ?? loaded.domain.status;
    if (status !== 'pending') {
      throw conflict(
        `${loaded.domain.name} is not waiting for its name servers (status ${status ?? 'unknown'})`,
      );
    }
    const result = await domainChange(ctx, req, loaded, 'zone_activation_check', { status }, () =>
      loaded.adapter.checkZoneActivation!(loaded.domain.externalId),
    );
    // The check may have activated the zone right away; the detail view shows it then.
    if (loaded.adapter.getDomain) {
      await refreshDomainInfo(ctx, loaded).catch((err) =>
        req.log.warn({ err, domainId: loaded.domain.id }, 'zone info after the activation check failed'),
      );
    }
    return actionResponse(result);
  });

  // --- DNS move (platform only) -----------------------------------------------------

  /** The registered domain to move: platform staff in an interactive session only. */
  async function moveSource(req: FastifyRequest): Promise<LoadedDomain> {
    requireSession(req);
    await access.assert(req, 'platform:domain:move', platformScope);
    const { id } = parse(idParams, req.params);
    const loaded = await loadAdminDomain(ctx, id);
    if (domainKind(loaded.adapter) === 'zone') {
      throw unsupported('This is a DNS zone, move the DNS of its registered domain instead');
    }
    if (loaded.domain.missingSince) {
      throw conflict(`${loaded.domain.name} is no longer reported by its provider`);
    }
    return loaded;
  }

  /** Live registrar facts (does it serve the zone?), the stored ones when it does not answer. */
  async function sourceInfo(req: FastifyRequest, loaded: LoadedDomain): Promise<DomainInfo | null> {
    if (!loaded.adapter.getDomain) return loaded.domain.info;
    try {
      return await refreshDomainInfo(ctx, loaded);
    } catch (err) {
      req.log.warn({ err, domainId: loaded.domain.id }, 'live domain info before the DNS move failed');
      return loaded.domain.info;
    }
  }

  /** 404 for unknown connections, 422 for those that cannot create zones (or are disabled). */
  async function zoneTarget(providerId: string): Promise<ZoneTarget> {
    const { connection, adapter } = await ctx.providers.get(providerId);
    if (!connection.enabled || !canCreateZones(adapter)) {
      throw unsupported(`${connection.name} cannot create DNS zones`);
    }
    return { connection, adapter };
  }

  /** The zone row the move reuses: same name on the target connection, not missing. */
  async function targetZoneRow(connectionId: string, name: string): Promise<DomainRow | undefined> {
    const [row] = await domainRowsQuery(ctx)
      .where(
        and(
          eq(domains.providerConnectionId, connectionId),
          sql`lower(${domains.name}) = lower(${name})`,
          isNull(domains.missingSince),
        ),
      )
      .orderBy(domains.createdAt)
      .limit(1);
    return row;
  }

  /**
   * Stores a zone the provider created or reported back. A new row goes to the registered
   * domain's organization; a row the panel had already keeps its own.
   */
  async function storeZone(
    connection: ProviderConnection,
    zone: RemoteDomain,
    orgId: string | null,
  ): Promise<DomainRow> {
    const info = mergeDomainInfo(zone.name, null, zone.info ?? {});
    const now = new Date();
    const [stored] = await db
      .insert(domains)
      .values({
        providerConnectionId: connection.id,
        externalId: zone.externalId,
        orgId,
        name: zone.name,
        status: zone.status,
        info,
        meta: zone.meta ?? {},
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [domains.providerConnectionId, domains.externalId],
        set: {
          name: zone.name,
          status: zone.status,
          info,
          meta: zone.meta ?? {},
          lastSyncedAt: now,
          missingSince: null,
        },
      })
      .returning({ id: domains.id });
    const [row] = await domainRowsQuery(ctx).where(eq(domains.id, stored!.id)).limit(1);
    return row!;
  }

  app.get('/admin/domains/:id/dns-move', async (req): Promise<DnsMovePreview> => {
    const loaded = await moveSource(req);
    const query = parse(moveQuery, req.query);
    const targets = await zoneTargets(ctx);
    const target = query.targetProviderId ? await zoneTarget(query.targetProviderId) : (targets[0] ?? null);
    const info = await sourceInfo(req, loaded);

    const recordsAvailable =
      info?.providerDns === true && typeof loaded.adapter.listDnsRecords === 'function';
    let records: DnsRecord[] = [];
    let recordsError: string | null = null;
    if (recordsAvailable) {
      try {
        records = await loaded.adapter.listDnsRecords!(loaded.domain.externalId);
      } catch (err) {
        recordsError = errorMessage(err);
      }
    }
    const plan = target
      ? planRecordImport(records, importTarget(target.adapter))
      : { records: [], skipped: [] };
    const zones = await counterparts(ctx, loaded);
    const existing = zones.find((z) => z.connection.id === target?.connection.id) ?? zones[0];
    const { domain: source, org, connection } = loaded;
    return {
      domain: {
        id: source.id,
        name: source.name,
        provider: { id: connection.id, type: connection.type, name: connection.name },
        org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
      },
      targets: targets.map((t) => ({
        providerId: t.connection.id,
        name: t.connection.name,
        type: t.connection.type,
      })),
      targetProviderId: target?.connection.id ?? null,
      existingZone: existing ? toLinkedDomain(ctx, existing) : null,
      recordsAvailable,
      recordsError,
      records: plan.records,
      skipped: plan.skipped,
      canSetNameservers: canSetNameservers(loaded.adapter),
      maxRecords: DNS_MOVE_MAX_RECORDS,
    };
  });

  /**
   * 1. Creates the zone (or reuses it), 2. copies the registrar's records into it, 3. points
   * the registrar to the zone's name servers, but only after a complete copy. Every step is
   * audited and reported; only a failure of step 1 fails the request. Safe to repeat: the zone
   * is reused, a zone with records is never imported into twice.
   */
  app.post('/admin/domains/:id/dns-move', async (req): Promise<DnsMoveResult> => {
    const registrar = await moveSource(req);
    const body = parse(moveBody, req.body);
    const target = await zoneTarget(body.targetProviderId);
    const sourceId = registrar.domain.id;
    if (moving.has(sourceId)) throw conflict('A DNS move of this domain is running');
    moving.add(sourceId);
    try {
      const info = await sourceInfo(req, registrar);
      const { zone, created } = await prepareZone(req, registrar, target);
      const imported = await copyRecords(req, registrar, info, zone, body.importRecords);
      const nameservers = await switchNameservers(req, registrar, zone, body.setNameservers, imported.status);
      const complete =
        (!body.importRecords || imported.status === 'done') &&
        (!body.setNameservers || nameservers.status === 'done');
      await audit.record(req, {
        action: 'domain.dns_move',
        orgId: registrar.domain.orgId,
        resourceType: 'domain',
        resourceId: sourceId,
        status: complete ? 'success' : 'failure',
        details: {
          domain: registrar.domain.name,
          zoneId: zone.domain.id,
          zoneCreated: created,
          providerId: target.connection.id,
          import: imported.status,
          nameservers: nameservers.status,
        },
      });
      return { zone: toLinkedDomain(ctx, zone), zoneCreated: created, import: imported, nameservers };
    } finally {
      moving.delete(sourceId);
    }
  });

  /** Step 1. A failure is audited on the registered domain and ends the move. */
  async function prepareZone(
    req: FastifyRequest,
    registrar: LoadedDomain,
    target: ZoneTarget,
  ): Promise<{ zone: LoadedDomain; created: boolean }> {
    const { name, id: sourceDomainId, orgId } = registrar.domain;
    const details = {
      name,
      providerId: target.connection.id,
      providerName: target.connection.name,
      sourceDomainId,
    };
    let zone: LoadedDomain;
    let created = false;
    try {
      const existing = await targetZoneRow(target.connection.id, name);
      if (existing) {
        zone = { ...existing, scope: domainScope(existing.domain), adapter: target.adapter };
        // Still there? Its name servers are what the registrar gets.
        if (target.adapter.getDomain) await refreshDomainInfo(ctx, zone);
      } else {
        const result = await target.adapter.createZone!(name);
        const row = await storeZone(target.connection, result.zone, orgId);
        zone = { ...row, scope: domainScope(row.domain), adapter: target.adapter };
        created = result.created;
      }
    } catch (err) {
      await audit.record(req, {
        action: 'domain.zone_create',
        orgId,
        resourceType: 'domain',
        resourceId: sourceDomainId,
        status: 'failure',
        details: { ...details, zoneExternalId: null, created: false, error: errorMessage(err) },
      });
      throw err instanceof AppError ? err : new AppError(500, 'action_failed', errorMessage(err));
    }
    await audit.record(req, {
      action: 'domain.zone_create',
      orgId: zone.domain.orgId,
      resourceType: 'domain',
      resourceId: zone.domain.id,
      details: { ...details, zoneExternalId: zone.domain.externalId, created },
    });
    return { zone, created };
  }

  /** Step 2. Audited on the zone whenever records were read or copied. */
  async function copyRecords(
    req: FastifyRequest,
    registrar: LoadedDomain,
    info: DomainInfo | null,
    zone: LoadedDomain,
    requested: boolean,
  ): Promise<ImportResult> {
    const outcome = (
      status: ImportResult['status'],
      reason: ImportResult['reason'],
      extra: Partial<ImportResult> = {},
    ): ImportResult => ({ status, reason, copied: 0, failed: [], skipped: [], ...extra });
    const record = async (result: ImportResult, error?: string) => {
      await audit.record(req, {
        action: 'domain.dns_import',
        orgId: zone.domain.orgId,
        resourceType: 'domain',
        resourceId: zone.domain.id,
        status: result.status === 'done' ? 'success' : 'failure',
        details: {
          domain: zone.domain.name,
          sourceDomainId: registrar.domain.id,
          status: result.status,
          copied: result.copied,
          failed: result.failed,
          skipped: result.skipped.map((s) => ({ type: s.type, name: s.name, reason: s.reason })),
          ...(error ? { error } : {}),
        },
      });
      return result;
    };

    if (!requested) return outcome('skipped', 'notRequested');
    // Records at a registrar that does not serve the zone are not what the world sees.
    if (info?.providerDns !== true || !registrar.adapter.listDnsRecords) {
      return outcome('skipped', 'registrarNotServing');
    }
    let source: DnsRecord[];
    try {
      source = await registrar.adapter.listDnsRecords(registrar.domain.externalId);
    } catch (err) {
      return record(outcome('failed', 'recordsUnreadable'), errorMessage(err));
    }
    const plan = planRecordImport(source, importTarget(zone.adapter));
    if (plan.records.length > DNS_MOVE_MAX_RECORDS) {
      return outcome('skipped', 'tooManyRecords', { skipped: plan.skipped });
    }
    if (!zone.adapter.listDnsRecords || !zone.adapter.addDnsRecord) {
      return record(outcome('failed', 'recordsUnreadable'), 'The zone provider cannot add DNS records');
    }
    let present: DnsRecord[];
    try {
      present = await zone.adapter.listDnsRecords(zone.domain.externalId);
    } catch (err) {
      return record(outcome('failed', 'recordsUnreadable'), errorMessage(err));
    }
    // Copying twice would duplicate records or collide with ones added by hand.
    if (present.length > 0) return outcome('skipped', 'zoneNotEmpty', { skipped: plan.skipped });

    const add = zone.adapter.addDnsRecord.bind(zone.adapter);
    const results = await mapLimit(plan.records, 4, async (r) => {
      try {
        await add(zone.domain.externalId, { type: r.type, name: r.name, data: r.data, ttl: r.ttl });
        return null;
      } catch (err) {
        return { type: r.type, name: r.name, error: errorMessage(err) };
      }
    });
    const failed = results.filter((r) => r !== null);
    const copied = plan.records.length - failed.length;
    const status = failed.length === 0 ? 'done' : copied > 0 ? 'partial' : 'failed';
    return record(outcome(status, null, { copied, failed, skipped: plan.skipped }));
  }

  /** Step 3. Only after a complete copy, so the zone the registrar points to has every record. */
  async function switchNameservers(
    req: FastifyRequest,
    registrar: LoadedDomain,
    zone: LoadedDomain,
    requested: boolean,
    importStatus: ImportResult['status'],
  ): Promise<NameserverResult> {
    const nameservers = zone.domain.info?.nameservers ?? [];
    const outcome = (
      status: NameserverResult['status'],
      reason: NameserverResult['reason'],
      extra: Partial<NameserverResult> = {},
    ): NameserverResult => ({
      status,
      reason,
      nameservers,
      providerRef: null,
      message: null,
      error: null,
      ...extra,
    });

    if (!requested) return outcome('skipped', 'notRequested');
    // The operator sets them at the registrar by hand; the result lists them.
    if (!canSetNameservers(registrar.adapter)) return outcome('manual', 'unsupported');
    if (importStatus !== 'done') return outcome('skipped', 'importIncomplete');
    const details = {
      before: registrar.domain.info?.nameservers ?? [],
      after: nameservers,
      reason: 'dns_move',
      zoneId: zone.domain.id,
    };
    try {
      const result = await domainChange(ctx, req, registrar, 'nameservers_update', details, async () => {
        if (nameservers.length < NAMESERVERS_MIN) {
          throw conflict(`${zone.domain.name} has no name servers assigned by its provider yet`);
        }
        return registrar.adapter.setNameservers!(registrar.domain.externalId, nameservers);
      });
      // Best effort, so the panel shows the new delegation where the registrar applied it already.
      if (registrar.adapter.getDomain) {
        await refreshDomainInfo(ctx, registrar).catch((err) =>
          req.log.warn(
            { err, domainId: registrar.domain.id },
            'domain info after the name server switch failed',
          ),
        );
      }
      return outcome('done', null, {
        providerRef: result.providerRef ?? null,
        message: result.message ?? null,
      });
    } catch (err) {
      return outcome('failed', null, { error: errorMessage(err) });
    }
  }
}
