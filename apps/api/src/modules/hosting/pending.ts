import type { DomainInfo } from '@weblion/shared';

/**
 * Registrar changes the console stores right away (transfer lock, auto-renew), while the
 * registrar may apply them later: Joker runs them as jobs, and until then its whois and
 * domain list still report the old state. So that a detail view or sync in between does not
 * undo the stored value, the change is kept in domains.meta.pending as
 * { field: { value, at } } until live data reports it or it is older than PENDING_TTL_MS
 * (then the registrar's state counts again, e.g. after a job that failed).
 */
export const PENDING_TTL_MS = 30 * 60_000;

export type PendingField = 'locked' | 'autoRenew';
export type PendingChanges = Partial<Record<PendingField, { value: boolean; at: string }>>;

const FIELDS: PendingField[] = ['locked', 'autoRenew'];

/** The pending entries for a change that was just sent to the registrar. */
export function pendingChanges(
  patch: Partial<Record<PendingField, boolean>>,
  now = new Date(),
): PendingChanges {
  const out: PendingChanges = {};
  for (const field of FIELDS) {
    const value = patch[field];
    if (typeof value === 'boolean') out[field] = { value, at: now.toISOString() };
  }
  return out;
}

/** The changes of a domain that are still pending. Expired or malformed entries are left out. */
export function pendingOf(
  meta: Record<string, unknown> | null | undefined,
  now = Date.now(),
): PendingChanges {
  const raw = meta?.pending;
  if (!raw || typeof raw !== 'object') return {};
  const out: PendingChanges = {};
  for (const field of FIELDS) {
    const entry = (raw as Record<string, unknown>)[field] as { value?: unknown; at?: unknown } | undefined;
    if (typeof entry?.value !== 'boolean' || typeof entry.at !== 'string') continue;
    const at = Date.parse(entry.at);
    if (Number.isNaN(at) || now - at >= PENDING_TTL_MS) continue;
    out[field] = { value: entry.value, at: entry.at };
  }
  return out;
}

/**
 * Live domain info with the pending changes of `meta` laid over it. A field the registrar
 * reports with the expected value is settled; the others keep the expected value. Returns
 * the info to store and the meta to store with it.
 */
export function settlePending(
  live: Partial<DomainInfo>,
  meta: Record<string, unknown>,
  now = Date.now(),
): { info: Partial<DomainInfo>; meta: Record<string, unknown> } {
  if (!('pending' in meta)) return { info: live, meta };
  const pending = pendingOf(meta, now);
  const info = { ...live };
  for (const field of FIELDS) {
    const change = pending[field];
    if (!change) continue;
    if (live[field] === change.value) delete pending[field];
    else info[field] = change.value;
  }
  const { pending: _settled, ...rest } = meta;
  return { info, meta: Object.keys(pending).length > 0 ? { ...rest, pending } : rest };
}
