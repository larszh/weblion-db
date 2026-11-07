import { createHash } from 'node:crypto';

/**
 * First 16 hex characters of SHA-256 over the NFC-normalized text (i18n 4.1). Hashes German sources and
 * translated values alike: the stamp files, translation_overrides.source_hash and the stale checks all use it,
 * so a text that only differs in its Unicode composition never counts as changed.
 */
export function sourceHash(text: string): string {
  return createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex').slice(0, 16);
}
