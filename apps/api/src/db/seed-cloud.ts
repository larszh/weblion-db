import { eq } from 'drizzle-orm';
import { normalizeModules } from '@weblion/shared';
import { createAdapter } from '../providers/registry';
import type { RemoteCloudAccount } from '../providers/types';
import type { Database } from './client';
import { cloudAccounts, cloudAllowances, organizations, providerConnections } from './schema';

const GIB = 1024 ** 3;

interface AllowanceSeed {
  slug: string;
  quotaGb: number;
  maxAccounts: number | null;
  /** Users the demo instance has already (see providers/demo/cloud.ts). */
  accounts: string[];
  /** Activate the "storage" module along with the allowance. */
  enableModule: boolean;
}

/**
 * Resellers first: a customer's allowance comes out of its reseller's. Alpen Hosting and
 * Bäckerei Huber keep the modules the reseller seed gave them: activating "storage" for
 * them is left as a step to show in the admin area. ben@muster-ag and dev@beispiel-gmbh
 * stay unmanaged, for the admin import.
 */
const ALLOWANCES: AllowanceSeed[] = [
  { slug: 'alpen-hosting', quotaGb: 1000, maxAccounts: 50, accounts: [], enableModule: false },
  {
    slug: 'muster-ag',
    quotaGb: 500,
    maxAccounts: 10,
    accounts: ['anna@muster-ag', 'buchhaltung@muster-ag'],
    enableModule: true,
  },
  {
    slug: 'baeckerei-huber',
    quotaGb: 100,
    maxAccounts: 5,
    accounts: ['hanna@baeckerei-huber'],
    enableModule: false,
  },
];

/**
 * Demo data for cloud storage. Idempotent. Called from seedDemo after the base and reseller
 * data exist. An organization is only seeded while it has no allowance, so later changes
 * (a deleted account, a changed quota) are left alone. Accounts are taken from the demo
 * instance as they are there.
 */
export async function seedCloudDemo(db: Database, log: string[]): Promise<void> {
  const demo = await db.query.providerConnections.findFirst({ where: eq(providerConnections.type, 'demo') });
  if (!demo) return;
  // The demo keeps its state per connection in memory, the configuration does not matter here.
  const adapter = createAdapter(demo.type, demo.id, {});
  if (!adapter.getCloudAccount) return;

  for (const seed of ALLOWANCES) {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, seed.slug) });
    if (!org) continue;
    const existing = await db.query.cloudAllowances.findFirst({ where: eq(cloudAllowances.orgId, org.id) });
    if (existing) continue;

    const remote: RemoteCloudAccount[] = [];
    for (const username of seed.accounts) {
      const account = await adapter.getCloudAccount(username).catch(() => null);
      if (account) remote.push(account);
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(cloudAllowances).values({
        orgId: org.id,
        providerConnectionId: demo.id,
        quotaBytes: seed.quotaGb * GIB,
        maxAccounts: seed.maxAccounts,
      });
      if (seed.enableModule && !org.modules.includes('storage')) {
        await tx
          .update(organizations)
          .set({ modules: normalizeModules([...org.modules, 'storage']) })
          .where(eq(organizations.id, org.id));
      }
      for (const account of remote) {
        await tx
          .insert(cloudAccounts)
          .values({
            providerConnectionId: demo.id,
            externalId: account.externalId,
            orgId: org.id,
            displayName: account.displayName,
            email: account.email,
            quotaBytes: account.quotaBytes,
            usedBytes: account.usedBytes,
            enabled: account.enabled,
            lastLoginAt: account.lastLoginAt ? new Date(account.lastLoginAt) : null,
            lastSyncedAt: now,
          })
          .onConflictDoNothing();
      }
    });
    log.push(
      `cloud storage ${seed.quotaGb} GB for ${org.name}${remote.length ? ` with ${remote.map((a) => a.externalId).join(', ')}` : ''}`,
    );
  }
}
