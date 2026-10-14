import { eq } from 'drizzle-orm';
import {
  MEDIA_ACCOUNT_ISSUES,
  normalizeModules,
  type MediaAccess,
  type MediaAccountIssue,
  type MediaLibraryRef,
} from '@weblion/shared';
import { DEMO_MEDIA_ACCESS, DEMO_MEDIA_IDS, DEMO_MEDIA_LIBRARIES } from '../providers/demo/media';
import { createAdapter } from '../providers/registry';
import type { RemoteMediaUser } from '../providers/types';
import type { Database } from './client';
import { mediaAccounts, mediaAllowances, organizations, providerConnections } from './schema';

interface AllowanceSeed {
  slug: keyof typeof DEMO_MEDIA_ACCESS;
  /** Login names of the organization's accounts end with "-<code>". */
  code: string;
  maxAccounts: number;
  access: MediaAccess;
  /** Users the demo instance has already (see providers/demo/media.ts). */
  accounts: (keyof typeof DEMO_MEDIA_IDS)[];
  /** Activate the "media" module along with the allowance. */
  enableModule: boolean;
}

/**
 * Resellers first: a customer's allowance comes out of its reseller's. Alpen Hosting and
 * Bäckerei Huber keep the modules the reseller seed gave them: activating "media" for them is
 * left as a step to show in the admin area. ben-kemaro, gast and altkunde stay unmanaged, for
 * the admin import.
 */
const ALLOWANCES: AllowanceSeed[] = [
  {
    slug: 'alpen-hosting',
    code: 'alpen',
    maxAccounts: 20,
    access: DEMO_MEDIA_ACCESS['alpen-hosting'],
    accounts: [],
    enableModule: false,
  },
  {
    slug: 'muster-ag',
    code: 'kemaro',
    maxAccounts: 5,
    access: DEMO_MEDIA_ACCESS['muster-ag'],
    accounts: ['anna-kemaro', 'wohnzimmer-kemaro'],
    enableModule: true,
  },
  {
    slug: 'baeckerei-huber',
    code: 'bivane',
    maxAccounts: 3,
    access: DEMO_MEDIA_ACCESS['baeckerei-huber'],
    accounts: ['huber-bivane'],
    enableModule: false,
  },
];

/** Library snapshots as an allowance keeps them: id, name and type as the instance reports them. */
function snapshot(ids: readonly string[]): MediaLibraryRef[] {
  return ids.flatMap((id) => {
    const found = DEMO_MEDIA_LIBRARIES.find((l) => l.id === id);
    return found ? [{ id: found.id, name: found.name, type: found.type }] : [];
  });
}

/**
 * Issues the demo user has on its own. Policy drift (huber-bivane) is left to the first sync,
 * which compares the policy with the allowance.
 */
function issuesOf(user: RemoteMediaUser): MediaAccountIssue[] {
  const found = new Set<MediaAccountIssue>();
  if (user.administrator) found.add('administrator');
  if (user.blockedFolders) found.add('blocked_folders');
  if (!user.hasPassword) found.add('no_password');
  if (user.lockedOut) found.add('locked_out');
  return MEDIA_ACCOUNT_ISSUES.filter((issue) => found.has(issue));
}

/**
 * Demo data for streaming: allowances on the demo connection's simulated Jellyfin for Alpen
 * Hosting (code "alpen"), Muster AG ("kemaro", with the "media" module and two accounts) and
 * Bäckerei Huber ("bivane", one account); the other demo users stay unmanaged for the import.
 * Idempotent. Called from seedDemo after the telephony demo, once the reseller data exist. An
 * organization is only seeded while it has no allowance, so later changes (a deleted account,
 * other libraries) are left alone. Accounts are taken from the demo instance as they are there.
 */
export async function seedMediaDemo(db: Database, log: string[]): Promise<void> {
  const demo = await db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo'),
  });
  if (!demo) return;
  // The demo keeps its state per connection in memory, the configuration does not matter here.
  const adapter = createAdapter(demo.type, demo.id, {});
  if (!adapter.getMediaUser) return;

  for (const seed of ALLOWANCES) {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, seed.slug) });
    if (!org) continue;
    const existing = await db.query.mediaAllowances.findFirst({ where: eq(mediaAllowances.orgId, org.id) });
    if (existing) continue;
    // Codes are unique on the platform: staff may have given this one to someone else.
    const taken = await db.query.mediaAllowances.findFirst({
      where: eq(mediaAllowances.accountCode, seed.code),
    });
    if (taken) continue;

    const remote: RemoteMediaUser[] = [];
    for (const name of seed.accounts) {
      const user = await adapter.getMediaUser(DEMO_MEDIA_IDS[name]).catch(() => null);
      if (user) remote.push(user);
    }
    const now = new Date();
    const seeded = await db.transaction(async (tx) => {
      await tx.insert(mediaAllowances).values({
        orgId: org.id,
        providerConnectionId: demo.id,
        accountCode: seed.code,
        maxAccounts: seed.maxAccounts,
        libraries: snapshot(seed.access.libraryIds),
        maxStreams: seed.access.maxStreams,
        downloads: seed.access.downloads,
        remoteBitrateMbit: seed.access.remoteBitrateMbit,
      });
      if (seed.enableModule) {
        const current = await tx.query.organizations.findFirst({ where: eq(organizations.id, org.id) });
        if (current && !current.modules.includes('media')) {
          await tx
            .update(organizations)
            .set({ modules: normalizeModules([...current.modules, 'media']) })
            .where(eq(organizations.id, org.id));
        }
      }
      const names: string[] = [];
      for (const user of remote) {
        // A user staff imported already stays where it is.
        const [row] = await tx
          .insert(mediaAccounts)
          .values({
            providerConnectionId: demo.id,
            externalId: user.externalId,
            username: user.username,
            orgId: org.id,
            enabled: user.enabled,
            hasPassword: user.hasPassword,
            lastActivityAt: user.lastActivityAt ? new Date(user.lastActivityAt) : null,
            issues: issuesOf(user),
            lastSyncedAt: now,
          })
          .onConflictDoNothing({ target: [mediaAccounts.providerConnectionId, mediaAccounts.externalId] })
          .returning({ username: mediaAccounts.username });
        if (row) names.push(row.username);
      }
      return names;
    });
    log.push(
      `streaming allowance of ${org.name} (code ${seed.code})${seeded.length ? ` with ${seeded.join(', ')}` : ''}`,
    );
  }
}
