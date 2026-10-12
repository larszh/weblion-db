import type { Database } from './client';

/**
 * Demo data for websites: the demo CloudPanel connection's sites (ENABLE_DEMO_CLOUDPANEL) and
 * who gets them, plus website allowances. Idempotent. Called from seedDemo after the mail demo.
 * Placeholder until the seed is implemented.
 */
export async function seedWebsitesDemo(_db: Database, _log: string[]): Promise<void> {}
