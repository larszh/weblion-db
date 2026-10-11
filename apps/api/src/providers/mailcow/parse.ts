import {
  MAIL_MAX_ALIAS_TARGETS,
  MAIL_MIB,
  MAIL_RATE_LIMIT_FRAMES,
  mailDomainAscii,
  mailLimitsIssue,
  type MailAliasDto,
  type MailAliasSpecial,
  type MailPasswordPolicy,
  type MailRateLimit,
  type MailRateLimitFrame,
  type MailboxDto,
  type MailboxState,
} from '@weblion/shared';
import { AppError, ProviderError, badRequest } from '../../lib/errors';
import { isRecord, num, str } from '../http';
import type { DkimKey, MailDomainLimitsInput, RemoteMailDomain } from '../types';

export { num };

export const PROVIDER = 'Mailcow';

/** Largest size the panel sends for a domain or mailbox, MiB (about 9.5 TiB). */
const MAX_MIB = 10_000_000;
const MAX_MAILBOXES = 100_000;
const MAX_ALIASES = 100_000;
const MAX_RATE_LIMIT = 1_000_000;

// ---------------------------------------------------------------------------
// Answers of writes

/** One entry of Mailcow's answer to add, edit and delete (json_api.php process_*_return). */
export interface MailcowEntry {
  type: string;
  /** A key of lang.en-gb.json, a sentence, or [key, ...printf arguments]. */
  msg: string | unknown[];
  /** Echo of the request (passwords replaced by "*"). Never shown. */
  log?: unknown;
}

export interface MailcowMessagePart {
  key: string;
  args: string[];
}

export interface MailcowWriteParse {
  ok: boolean;
  errors: MailcowMessagePart[];
  warnings: string[];
  successes: MailcowMessagePart[];
}

function toEntry(value: unknown): MailcowEntry | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const msg = Array.isArray(value.msg) ? value.msg : typeof value.msg === 'string' ? value.msg : '';
  return value.log === undefined ? { type: value.type, msg } : { type: value.type, msg, log: value.log };
}

/**
 * The entries of a write answer: an array of entries, or a single object such as
 * {"type":"success","msg":"Task completed"} when the function pushed none. Anything else: [].
 */
export function entriesOf(body: unknown): MailcowEntry[] {
  if (Array.isArray(body)) return body.map(toEntry).filter((e): e is MailcowEntry => e !== null);
  const single = toEntry(body);
  return single ? [single] : [];
}

function argText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function messagePart(msg: string | unknown[]): MailcowMessagePart {
  if (typeof msg === 'string') return { key: msg, args: [] };
  const [key, ...args] = msg;
  return { key: argText(key), args: args.map(argText) };
}

/**
 * Splits a write answer. Business failures come with HTTP 200, so `ok` needs a 2xx status and
 * no entry of type danger or error. Warnings (e.g. a failed SOGo restart) are not failures.
 */
export function parseWriteResult(body: unknown, status: number): MailcowWriteParse {
  const errors: MailcowMessagePart[] = [];
  const warnings: string[] = [];
  const successes: MailcowMessagePart[] = [];
  for (const entry of entriesOf(body)) {
    const part = messagePart(entry.msg);
    const type = entry.type.toLowerCase();
    if (type === 'danger' || type === 'error') errors.push(part);
    else if (type === 'warning') warnings.push(mailcowMessage(part.key, part.args));
    else if (type === 'success') successes.push(part);
  }
  return { ok: status >= 200 && status < 300 && errors.length === 0, errors, warnings, successes };
}

/** English texts of lang.en-gb.json for the keys the panel can run into. */
const MESSAGES: Record<string, string> = {
  access_denied: 'Access denied or invalid form data',
  domain_exists: 'Domain %s already exists',
  domain_invalid: 'Domain name is empty or invalid',
  domain_not_found: 'Domain %s not found',
  domain_not_empty: 'Cannot remove non-empty domain %s',
  domain_cannot_match_hostname: 'Domain cannot match hostname',
  mailbox_invalid: 'Mailbox name is invalid',
  object_exists: 'Object %s already exists',
  is_alias: '%s is already known as an alias address',
  is_alias_or_mailbox:
    '%s is already known as an alias, a mailbox or an alias address expanded from an alias domain.',
  is_spam_alias: '%s is already known as a temporary alias address (spam alias address)',
  max_mailbox_exceeded: 'Max. mailboxes exceeded (%d of %d)',
  mailbox_quota_exceeded: 'Quota exceeds the domain limit (max. %d MiB)',
  mailbox_quota_left_exceeded: 'Not enough space left (space left: %d MiB)',
  mailbox_quota_exceeds_domain_quota: 'Max. quota exceeds domain quota limit',
  mailbox_defquota_exceeds_mailbox_maxquota: 'Default quota exceeds max quota limit',
  defquota_empty: 'Default quota per mailbox must not be 0.',
  maxquota_empty: 'Max. quota per mailbox must not be 0.',
  max_quota_in_use: 'Mailbox quota must be greater or equal to %d MiB',
  domain_quota_m_in_use: 'Domain quota must be greater or equal to %s MiB',
  mailboxes_in_use: 'Max. mailboxes must be greater or equal to %d',
  aliases_in_use: 'Max. aliases must be greater or equal to %d',
  max_alias_exceeded: 'Max. aliases exceeded',
  alias_empty: 'Alias address must not be empty',
  goto_empty: 'An alias address must contain at least one valid goto address',
  goto_invalid: 'Goto address %s is invalid',
  alias_invalid: 'Alias address %s is invalid',
  alias_goto_identical: 'Alias and goto address must not be identical',
  external_goto_denied: 'External goto address %s is not allowed',
  password_complexity: 'Password does not meet the policy',
  password_mismatch: 'Confirmation password does not match',
  unlimited_quota_acl: 'Unlimited quota prohibited by ACL',
  rl_timeframe: 'Rate limit time frame is incorrect',
  dkim_domain_or_sel_invalid: 'DKIM domain or selector invalid: %s',
  username_invalid: 'Username %s cannot be used',
  comment_too_long: 'Comment too long, max 160 chars allowed',
  redis_error: 'Redis error: %s',
  object_is_not_numeric: 'Value %s is not numeric',
  domain_added_sogo_failed: 'Added domain but failed to restart SOGo, please check your server logs.',
  domain_add_dkim_available: 'A DKIM key did already exist',
  alias_added: 'Alias address %s (%d) has been added',
  dovecot_restart_failed: 'Dovecot failed to restart, please check the logs',
  is_not_primary_alias: 'Skipped non-primary alias %s',
};

/** Failures caused by the state at Mailcow (exists, limits, usage): 409. */
const CONFLICT_KEYS = new Set([
  'domain_exists',
  'domain_not_empty',
  'object_exists',
  'is_alias',
  'is_alias_or_mailbox',
  'is_spam_alias',
  'max_mailbox_exceeded',
  'mailbox_quota_exceeded',
  'mailbox_quota_left_exceeded',
  'max_quota_in_use',
  'domain_quota_m_in_use',
  'mailboxes_in_use',
  'aliases_in_use',
  'max_alias_exceeded',
]);

/** Failures caused by the values sent: 400. */
const BAD_REQUEST_KEYS = new Set([
  'domain_invalid',
  'domain_cannot_match_hostname',
  'mailbox_invalid',
  'mailbox_quota_exceeds_domain_quota',
  'mailbox_defquota_exceeds_mailbox_maxquota',
  'defquota_empty',
  'maxquota_empty',
  'alias_empty',
  'goto_empty',
  'goto_invalid',
  'alias_invalid',
  'alias_goto_identical',
  'external_goto_denied',
  'password_complexity',
  'password_mismatch',
  'unlimited_quota_acl',
  'rl_timeframe',
  'dkim_domain_or_sel_invalid',
  'username_invalid',
  'comment_too_long',
  'object_is_not_numeric',
]);

/**
 * The English text of a Mailcow message key with its printf arguments filled in order.
 * A sentence (Mailcow sometimes sends one instead of a key) is returned as it is, an unknown
 * key as "key (a, b)".
 */
export function mailcowMessage(key: string, args: string[]): string {
  const text = MESSAGES[key];
  if (text !== undefined) {
    let next = 0;
    return text.replace(/%[sd]/g, () => args[next++] ?? '');
  }
  if (/\s/.test(key)) return key;
  return args.length > 0 ? `${key} (${args.join(', ')})` : key;
}

/**
 * The error for a failed write. 409 when every failure is about the state at Mailcow, 400 when
 * every failure is about the values sent, 404 for an unknown domain, else 502. When Mailcow
 * also reported a success, it saved part of the change, and the message says so.
 */
export function mailcowError(
  action: string,
  errors: MailcowMessagePart[],
  successes: MailcowMessagePart[],
): AppError {
  const texts = errors.map((e) => mailcowMessage(e.key, e.args));
  let message = `${action} failed: ${texts.join('; ') || 'refused without a message'}`;
  if (successes.length > 0) message += '. Mailcow saved the rest of the change';
  const keys = errors.map((e) => e.key);
  const details = { keys };
  if (keys.length > 0 && keys.every((k) => CONFLICT_KEYS.has(k))) {
    return new AppError(409, 'conflict', message, details);
  }
  if (keys.length > 0 && keys.every((k) => BAD_REQUEST_KEYS.has(k))) return badRequest(message, details);
  if (keys.includes('domain_not_found')) return new ProviderError(PROVIDER, message, 404, details);
  return new ProviderError(PROVIDER, message, undefined, details);
}

// ---------------------------------------------------------------------------
// Values

/** Mailcow's list answers: an array, or {} for an empty list. */
export function asList(body: unknown): Record<string, unknown>[] {
  return Array.isArray(body) ? body.filter(isRecord) : [];
}

/** {} is Mailcow's answer for an object that does not exist. */
export function isEmptyObject(body: unknown): boolean {
  return isRecord(body) && Object.keys(body).length === 0;
}

/** 1, "1" and true; everything else (0, "0", "", null, 2) is false. */
export function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export function bytesFromMib(mib: number): number {
  return mib * MAIL_MIB;
}

export function mibFromBytes(bytes: number): number {
  return Math.floor(bytes / MAIL_MIB);
}

/** Whole non-negative number, or 0 for anything unreadable (Mailcow sends numbers or numeric strings). */
function count(value: unknown): number {
  const n = num(value);
  return n !== null && n > 0 ? Math.round(n) : 0;
}

/**
 * MySQL DATETIME "YYYY-MM-DD HH:MM:SS" as ISO string. Mailcow stores the server's local time;
 * which zone is not known here, so it is read as UTC (the console shows the date only).
 */
export function parseMailcowDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0', m[6] ?? '0'].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (y === 0 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC rolls 31 February over into March: refuse what does not round-trip.
  return date.getUTCDate() === d ? date.toISOString() : null;
}

/** Unix seconds as ISO string; 0 (never, or hidden by SHOW_LAST_LOGIN) is null. */
export function unixToIso(seconds: unknown): string | null {
  const n = num(seconds);
  return n !== null && n > 0 ? new Date(n * 1000).toISOString() : null;
}

function parseRateLimit(value: unknown): MailRateLimit | null {
  if (!isRecord(value)) return null;
  const amount = num(value.value);
  const frame = str(value.frame);
  if (amount === null || amount <= 0 || !Number.isInteger(amount)) return null;
  if (!frame || !(MAIL_RATE_LIMIT_FRAMES as readonly string[]).includes(frame)) return null;
  return { value: amount, frame: frame as MailRateLimitFrame };
}

/** One domain of GET /api/v1/get/domain/..., or null for {} and anything without domain_name. */
export function parseDomain(raw: unknown): RemoteMailDomain | null {
  if (!isRecord(raw)) return null;
  const name = str(raw.domain_name)?.toLowerCase();
  if (!name) return null;
  return {
    externalId: name,
    info: {
      name,
      displayName: str(raw.domain_h_name) ?? name,
      // Mailcow fills an empty description with the domain name; that is kept.
      description: str(raw.description),
      active: bool(raw.active),
      relay: bool(raw.backupmx) || bool(raw.relay_all_recipients),
      limits: {
        maxMailboxes: count(raw.max_num_mboxes_for_domain),
        maxAliases: count(raw.max_num_aliases_for_domain),
        quotaBytes: count(raw.max_quota_for_domain),
        defaultMailboxQuotaBytes: count(raw.def_quota_for_mbox),
        maxMailboxQuotaBytes: count(raw.max_quota_for_mbox),
        rateLimit: parseRateLimit(raw.rl),
      },
      usage: {
        mailboxes: count(raw.mboxes_in_domain),
        aliases: count(raw.aliases_in_domain),
        allocatedBytes: count(raw.quota_used_in_domain),
        usedBytes: count(raw.bytes_total),
        messages: count(raw.msgs_total),
      },
      createdAt: parseMailcowDate(raw.created),
      modifiedAt: parseMailcowDate(raw.modified),
    },
  };
}

function mailboxState(value: unknown): MailboxState {
  const n = num(value);
  if (n === 1) return 'active';
  if (n === 2) return 'login_disabled';
  return 'inactive';
}

/** One mailbox of GET /api/v1/get/mailbox/..., or null for {}. Never carries a password. */
export function parseMailbox(raw: unknown): MailboxDto | null {
  if (!isRecord(raw)) return null;
  const address = str(raw.username)?.toLowerCase();
  if (!address) return null;
  const logins = [raw.last_imap_login, raw.last_smtp_login, raw.last_pop3_login, raw.last_sso_login]
    .map((v) => num(v) ?? 0)
    .filter((v) => v > 0);
  const at = address.lastIndexOf('@');
  return {
    address,
    localPart: str(raw.local_part)?.toLowerCase() ?? (at > 0 ? address.slice(0, at) : address),
    name: str(raw.name),
    state: mailboxState(raw.active),
    quotaBytes: count(raw.quota),
    usedBytes: count(raw.quota_used),
    messages: count(raw.messages),
    lastLoginAt: logins.length > 0 ? unixToIso(Math.max(...logins)) : null,
    createdAt: parseMailcowDate(raw.created),
    modifiedAt: parseMailcowDate(raw.modified),
  };
}

const SPECIAL_TARGETS: Record<string, MailAliasSpecial> = {
  'null@localhost': 'discard',
  'spam@localhost': 'spam',
  'ham@localhost': 'ham',
};

/** One alias of GET /api/v1/get/alias/..., or null for {}. */
export function parseAlias(raw: unknown): MailAliasDto | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'number' ? String(raw.id) : str(raw.id);
  const address = str(raw.address)?.toLowerCase();
  if (!id || !address) return null;
  const targets = (typeof raw.goto === 'string' ? raw.goto : '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t !== '');
  const special = targets.length === 1 ? (SPECIAL_TARGETS[targets[0]!] ?? null) : null;
  return {
    id,
    address,
    catchAll: address.startsWith('@') || bool(raw.is_catch_all),
    targets: special ? [] : targets,
    special,
    active: bool(raw.active),
    createdAt: parseMailcowDate(raw.created),
    modifiedAt: parseMailcowDate(raw.modified),
  };
}

/**
 * The DKIM key of GET /api/v1/get/dkim/<domain>, or null for {}. The TXT value is built from
 * the public key (dkim_txt may be split into quoted 255 character chunks), and the private key
 * (privkey, only with SHOW_DKIM_PRIV_KEYS) is never read.
 */
export function parseDkim(raw: unknown): DkimKey | null {
  if (!isRecord(raw)) return null;
  const publicKey = str(raw.pubkey);
  const selector = str(raw.dkim_selector);
  if (!publicKey || !selector) return null;
  return {
    selector,
    publicKey,
    keyLength: str(raw.length),
    txt: `v=DKIM1;k=rsa;t=s;s=email;p=${publicKey}`,
  };
}

/** GET /api/v1/get/passwordpolicy: Redis values as strings. */
export function parsePasswordPolicy(raw: unknown): MailPasswordPolicy {
  const data = isRecord(raw) ? raw : {};
  return {
    minLength: num(data.length) ?? 0,
    letters: bool(data.chars),
    mixedCase: bool(data.lowerupper),
    digits: bool(data.numbers),
    specialChars: bool(data.special_chars),
  };
}

/** GET /api/v1/get/status/vmail: df output as strings with units ("11G", "28%"). */
export function parseVmail(raw: unknown): {
  used: string | null;
  total: string | null;
  percent: string | null;
} {
  const data = isRecord(raw) ? raw : {};
  return { used: str(data.used), total: str(data.total), percent: str(data.used_percent) };
}

// ---------------------------------------------------------------------------
// Checks before anything is sent

/** The ASCII (punycode) form of a domain name, or 400. */
export function assertDomain(name: string): string {
  const ascii = typeof name === 'string' ? mailDomainAscii(name) : null;
  if (!ascii) throw badRequest(`Invalid domain name "${String(name).slice(0, 80)}"`);
  return ascii;
}

/**
 * RFC 5322 atext without "/", "?", "#", "&", "%" and "+": Mailcow splits the API path on "/",
 * and the others break the path or the query nginx hands to json_api.php.
 */
const PATH_SAFE_LOCAL = /^[a-z0-9!$'*=^_`{|}~-]+(\.[a-z0-9!$'*=^_`{|}~-]+)*$/;
/** RFC 5322 dot-atom local part, for targets (they travel in the body). */
const RFC_LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

/**
 * An alias or mailbox address, lower-cased, with an ASCII domain. The local part is empty for a
 * catch-all alias ("@kunde.ch").
 */
export function assertAddress(address: string): { localPart: string; domain: string } {
  const value = typeof address === 'string' ? address.trim().toLowerCase() : '';
  const at = value.lastIndexOf('@');
  if (at < 0) throw badRequest(`Invalid address "${value.slice(0, 80)}"`);
  const localPart = value.slice(0, at);
  if (localPart !== '' && (localPart.length > 64 || !PATH_SAFE_LOCAL.test(localPart))) {
    throw badRequest(`Invalid address "${value.slice(0, 80)}"`);
  }
  return { localPart, domain: assertDomain(value.slice(at + 1)) };
}

/** A whole number of MiB as Mailcow takes it, at least 1 (Mailcow ignores or refuses 0). */
export function assertMib(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_MIB) {
    throw badRequest(`${what} must be a whole number of MiB from 1 to ${MAX_MIB}`);
  }
  return value;
}

function assertWhole(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${what} must be a whole number from ${min} to ${max}`);
  }
}

/**
 * Limits of a mail domain. Fields left out are not checked (an update checks what it changes,
 * and the ordering rule on the merged values). Max. aliases must be at least 1 because
 * Mailcow's domain edit keeps the old value for 0.
 */
export function assertLimits(limits: Partial<MailDomainLimitsInput>): void {
  if (limits.maxMailboxes !== undefined) {
    assertWhole(limits.maxMailboxes, 0, MAX_MAILBOXES, 'Max. mailboxes');
  }
  if (limits.maxAliases !== undefined) assertWhole(limits.maxAliases, 1, MAX_ALIASES, 'Max. aliases');
  if (limits.quotaMb !== undefined) assertMib(limits.quotaMb, 'The storage of the domain');
  if (limits.defaultMailboxQuotaMb !== undefined) {
    assertMib(limits.defaultMailboxQuotaMb, 'The default mailbox size');
  }
  if (limits.maxMailboxQuotaMb !== undefined) assertMib(limits.maxMailboxQuotaMb, 'The maximum mailbox size');
  if (
    limits.quotaMb !== undefined &&
    limits.defaultMailboxQuotaMb !== undefined &&
    limits.maxMailboxQuotaMb !== undefined
  ) {
    const issue = mailLimitsIssue({
      quotaMb: limits.quotaMb,
      defaultMailboxQuotaMb: limits.defaultMailboxQuotaMb,
      maxMailboxQuotaMb: limits.maxMailboxQuotaMb,
    });
    if (issue) throw badRequest(issue);
  }
  if (limits.rateLimit) {
    assertWhole(limits.rateLimit.value, 1, MAX_RATE_LIMIT, 'The rate limit');
    if (!(MAIL_RATE_LIMIT_FRAMES as readonly string[]).includes(limits.rateLimit.frame)) {
      throw badRequest(`The rate limit frame must be one of ${MAIL_RATE_LIMIT_FRAMES.join(', ')}`);
    }
  }
}

/**
 * Targets of an alias: 1 to MAIL_MAX_ALIAS_TARGETS valid addresses, lower-cased with an ASCII
 * domain, without duplicates, none equal to the alias itself (Mailcow skips such an alias
 * silently). Mailcow would drop an invalid target and save the rest, so all are checked here.
 */
export function assertTargets(targets: string[], address: string): string[] {
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > MAIL_MAX_ALIAS_TARGETS) {
    throw badRequest(`An alias needs 1 to ${MAIL_MAX_ALIAS_TARGETS} target addresses`);
  }
  const self = address.trim().toLowerCase();
  const out: string[] = [];
  for (const raw of targets) {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const at = value.lastIndexOf('@');
    const local = at > 0 ? value.slice(0, at) : '';
    const domain = at > 0 ? mailDomainAscii(value.slice(at + 1)) : null;
    if (!domain || local.length > 64 || !RFC_LOCAL.test(local) || value.length > 254) {
      throw badRequest(`Invalid target address "${value.slice(0, 80)}"`);
    }
    const target = `${local}@${domain}`;
    if (target === self) throw badRequest('An alias cannot forward to itself');
    if (!out.includes(target)) out.push(target);
  }
  return out;
}

/** Mailcow's alias ids are numbers; anything else cannot exist. */
export function assertAliasId(id: string): string {
  if (typeof id !== 'string' || !/^\d{1,10}$/.test(id)) {
    throw new ProviderError(PROVIDER, 'invalid alias id', 404);
  }
  return id;
}

/** Keys whose values never leave the console: passwords, secrets, tokens, private and API keys. */
export const MAILCOW_SECRET_KEY = /pass|secret|token|priv(ate)?_?key|api_?key/i;

/** Deep copy with the values of secret keys blanked out (pubkey stays). */
export function redactMailcow<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactMailcow) as T;
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] =
      MAILCOW_SECRET_KEY.test(key) && v !== null && v !== undefined && v !== '' ? '••••••' : redactMailcow(v);
  }
  return out as T;
}

/** String values of secret keys at any depth, e.g. attr.password of an explorer request. */
export function secretValues(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) secretValues(v, out);
  } else if (isRecord(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (MAILCOW_SECRET_KEY.test(key) && (typeof v === 'string' || typeof v === 'number'))
        out.push(String(v));
      else secretValues(v, out);
    }
  }
  return out;
}
