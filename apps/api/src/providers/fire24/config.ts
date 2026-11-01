/**
 * 24fire Customer REST API v1: base URL and token format. Shared by the adapter, the env
 * bootstrap and the admin API, so it imports nothing but the constants of the shared package
 * (the provider form checks the same token pattern).
 *
 * The API lives at https://api.24fire.de/v1 and takes a Personal Access Token "{id}|cra_..."
 * as `Authorization: Bearer`. The old REST API v2 (manage.24fire.de, `X-Fire-Apikey`) used
 * keys without "|"; those are recognised so the console can say what to replace.
 */

import { FIRE24_DEFAULT_BASE_URL, FIRE24_TOKEN } from '@weblion/shared';

export { FIRE24_DEFAULT_BASE_URL, FIRE24_TOKEN };

/** Host of the old REST API v2. */
const LEGACY_HOST = 'manage.24fire.de';

/** The documented format; other accepted tokens only cause a warning. */
export const FIRE24_TOKEN_DOCUMENTED = /^\d+\|cra_\S+$/;

/**
 * "pat": the documented format. "pat-unusual": "<id>|<secret>" without the "cra_" prefix, sent
 * anyway (24fire may change the prefix). "legacy": anything else, above all v2 keys (no "|");
 * the adapter refuses it before any request and the admin form asks for a new token.
 * Surrounding white space is ignored, as it is when the header is sent.
 */
export function fire24TokenKind(token: string): 'pat' | 'pat-unusual' | 'legacy' {
  const value = token.trim();
  if (!FIRE24_TOKEN.test(value)) return 'legacy';
  return FIRE24_TOKEN_DOCUMENTED.test(value) ? 'pat' : 'pat-unusual';
}

/** "42|cra_••••••" for a PAT, "legacy v2 key, replace it" otherwise. Never more of the secret. */
export function fire24TokenSummary(token: string): string {
  const kind = fire24TokenKind(token);
  if (kind === 'legacy') return 'legacy v2 key, replace it';
  // The id before "|" names the token in the 24fire account settings and is not secret; so is
  // the fixed "cra_" prefix. An unusual prefix could be part of the secret and is not shown.
  const id = token.trim().split('|', 1)[0];
  return kind === 'pat' ? `${id}|cra_••••••` : `${id}|••••••`;
}

/** Trailing slashes and a trailing "/v1" removed; host manage.24fire.de becomes api.24fire.de. */
export function fire24BaseUrl(url: string): string {
  // v2 paths ("/api/...") meant nothing under v1, so the old host maps to the plain default.
  if (isLegacyFire24Host(url)) return FIRE24_DEFAULT_BASE_URL;
  // The adapter adds "/v1/..." itself; a pasted ".../v1" would double it.
  return url.trim().replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/+$/, '');
}

export function isLegacyFire24Host(url: string): boolean {
  let host: string;
  try {
    host = new URL(url.trim()).hostname;
  } catch {
    return false;
  }
  return host.toLowerCase().replace(/\.$/, '') === LEGACY_HOST;
}
