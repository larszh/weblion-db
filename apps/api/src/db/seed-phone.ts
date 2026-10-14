import type { Database } from './client';

/**
 * Demo data for telephony: two of the demo connection's phone systems (Zürich and Bern) go to
 * Muster AG with the "phone" module, the lab system stays unassigned. Needs the demo connection
 * synced first; without phone system rows it does nothing. Idempotent. Called from seedDemo
 * after the websites demo. Placeholder until the seed is implemented.
 */
export async function seedPhoneDemo(_db: Database, _log: string[]): Promise<void> {}
