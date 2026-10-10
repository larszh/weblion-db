import type { Database } from './client';

/**
 * Demo data for e-mail: the demo connection's mail domains and who gets them. Idempotent.
 * Called from seedDemo after the cloud demo. Placeholder until the demo simulation exists.
 */
export async function seedMailDemo(_db: Database, _log: string[]): Promise<void> {}
