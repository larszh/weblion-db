import type { Database } from './client';

/**
 * Demo data for streaming: allowances on the demo connection's simulated Jellyfin for Alpen
 * Hosting (code "alpen"), Muster AG ("kemaro", with the "media" module and two accounts) and
 * Bäckerei Huber ("bivane", one account); the other demo users stay unmanaged for the import.
 * Skips organizations that have an allowance already. Idempotent. Called from seedDemo after the
 * telephony demo. Placeholder until the seed is implemented.
 */
export async function seedMediaDemo(_db: Database, _log: string[]): Promise<void> {}
