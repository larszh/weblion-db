import { badRequest, conflict } from '../../lib/errors';

/** Name in errors of the adapter and the demo. */
export const JELLYFIN = 'Jellyfin';

/**
 * Jellyfin 10.11 UserManager.ValidUsernameRegex: .NET \w (letters, non-spacing marks, decimal
 * digits, connector punctuation), space and ' . _ @ + -, no space at either end. 10.10 has no "+"
 * but allows spaces at the ends; names the console creates fit both.
 */
export const JELLYFIN_USERNAME_PATTERN = /^(?!\s)[\p{L}\p{Mn}\p{Nd}\p{Pc} '._@+-]+(?<!\s)$/u;
/** User.Username is [MaxLength(255)]. */
export const JELLYFIN_USERNAME_MAX = 255;

export const JELLYFIN_ADMIN_REFUSED = 'Jellyfin administrators cannot be managed in the console';

export function isJellyfinUsername(name: string): boolean {
  return name.length > 0 && name.length <= JELLYFIN_USERNAME_MAX && JELLYFIN_USERNAME_PATTERN.test(name);
}

/** Refuses names Jellyfin would refuse, before anything is sent (its own answer has no reason). */
export function assertJellyfinUsername(name: string): string {
  if (!isJellyfinUsername(name)) {
    throw badRequest(
      `Invalid Jellyfin user name "${String(name).slice(0, 80)}": letters, digits, space and ' . _ @ + - only, no space at either end`,
    );
  }
  return name;
}

/** Jellyfin compares user names case-insensitively (NormalizedUsername = ToUpperInvariant). */
export function sameJellyfinUsername(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

/** An empty password would let anyone sign in with the name alone. */
export function assertJellyfinPassword(password: string): string {
  if (!password) throw badRequest('The password must not be empty');
  return password;
}

export const jellyfinAdminRefused = () => conflict(JELLYFIN_ADMIN_REFUSED);
