import { asc, eq } from 'drizzle-orm';
import {
  DNS_TTL_AUTO,
  type DnsMoveRecord,
  type DnsMoveSkipped,
  type DnsRecord,
  type DnsRecordType,
  type DomainCapability,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { providerConnections, type ProviderConnection } from '../../db/schema';
import { CLOUDFLARE_TTL_MAX, CLOUDFLARE_TTL_MIN } from '../../providers/cloudflare/constants';
import type { ProviderAdapter } from '../../providers/types';
import { canCreateZones } from './service';

/**
 * "Move DNS to Cloudflare" (platform only): the pure parts. The registrar's records are
 * copied into the new zone before the name servers switch, so nothing changes for visitors.
 */

/** More planned records than this are not copied: about one request each, see the rate limit. */
export const DNS_MOVE_MAX_RECORDS = 500;

export interface ZoneTarget {
  connection: ProviderConnection;
  adapter: ProviderAdapter;
}

/**
 * Which of the registrar's records the target zone takes, and how. Read-only records, NS at
 * the apex (the zone provider runs those itself) and types the target does not take are
 * skipped; ALIAS becomes a CNAME where the target flattens CNAMEs at the apex; TTLs move into
 * 60 to 86400 s (shorter ones become automatic). Imported records are never proxied, so the
 * traffic does not change when the name servers switch.
 */
export function planRecordImport(
  records: DnsRecord[],
  target: { types: DnsRecordType[]; capabilities: DomainCapability[] },
): { records: DnsMoveRecord[]; skipped: DnsMoveSkipped[] } {
  const accepted: string[] = target.types;
  const planned: DnsMoveRecord[] = [];
  const skipped: DnsMoveSkipped[] = [];
  for (const record of records) {
    const original = record.type.toUpperCase();
    const skip = (reason: DnsMoveSkipped['reason']) =>
      skipped.push({ type: record.type, name: record.name, data: record.data, reason });
    if (record.readOnly) {
      skip('readOnly');
      continue;
    }
    if (original === 'NS' && (record.name === '@' || record.name === '')) {
      skip('apexNs');
      continue;
    }
    const converted =
      original === 'ALIAS' && target.capabilities.includes('cnameFlattening') ? 'CNAME' : original;
    if (!accepted.includes(converted)) {
      skip('type');
      continue;
    }
    const entry: DnsMoveRecord = {
      type: converted as DnsRecordType,
      name: record.name,
      data: record.data,
      ttl: record.ttl,
    };
    if (converted !== original) entry.convertedFrom = original;
    if (record.ttl !== null && record.ttl < CLOUDFLARE_TTL_MIN) {
      entry.ttl = DNS_TTL_AUTO;
      entry.ttlFrom = record.ttl;
    } else if (record.ttl !== null && record.ttl > CLOUDFLARE_TTL_MAX) {
      entry.ttl = CLOUDFLARE_TTL_MAX;
      entry.ttlFrom = record.ttl;
    }
    planned.push(entry);
  }
  return { records: planned, skipped };
}

/** Enabled connections that can create zones (Cloudflare with an account id), by name. */
export async function zoneTargets(ctx: AppContext): Promise<ZoneTarget[]> {
  const connections = await ctx.db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.enabled, true))
    .orderBy(asc(providerConnections.name));
  const targets: ZoneTarget[] = [];
  for (const connection of connections) {
    const adapter = ctx.providers.forConnection(connection);
    if (canCreateZones(adapter)) targets.push({ connection, adapter });
  }
  return targets;
}
