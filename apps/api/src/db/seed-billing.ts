import type { Database } from './client';

/** Demo data for the billing area. Idempotent. Called from seedDemo after the base data exists. */
export async function seedBillingDemo(_db: Database, _log: string[]): Promise<void> {}
