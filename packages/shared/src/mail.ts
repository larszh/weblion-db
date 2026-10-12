import type { DnsRecordType } from './hosting';
import type { Location, ProviderType } from './providers';
import type { Permission } from './permissions';

/**
 * E-mail (module "mail"): mail domains on Mailcow servers, sold with limits.
 *
 * Platform staff create a mail domain at a Mailcow server (or pick one up from the sync) and
 * assign it to an organization. Mailcow enforces the limits (mailboxes, aliases, storage,
 * mailbox sizes, rate limit). Inside them the organization manages mailboxes and aliases,
 * which are read live from Mailcow and never stored. Sizes travel as MiB in requests (Mailcow's
 * unit, nothing is rounded) and as bytes in answers.
 */

export const MAIL_MIB = 1024 ** 2;
/** Panel minimum for chosen mailbox passwords; Mailcow's policy may ask for more. */
export const MAIL_PASSWORD_MIN = 10;
export const MAIL_PASSWORD_MAX = 128;
export const MAIL_MAX_ALIAS_TARGETS = 50;
export const MAIL_DKIM_SELECTOR = 'dkim';
export const MAIL_DKIM_KEY_SIZES = [2048, 3072, 4096] as const;
export type MailDkimKeySize = (typeof MAIL_DKIM_KEY_SIZES)[number];
/** TTL of the records "add missing records" creates. */
export const MAIL_DNS_TTL = 3600;

/** Mailcow's stock domain template, as defaults for the create dialog (MiB). */
export const MAIL_DEFAULT_LIMITS = {
  maxMailboxes: 10,
  maxAliases: 400,
  quotaMb: 10_240,
  defaultMailboxQuotaMb: 3_072,
  maxMailboxQuotaMb: 10_240,
} as const;

export const MAIL_RATE_LIMIT_FRAMES = ['s', 'm', 'h', 'd'] as const;
export type MailRateLimitFrame = (typeof MAIL_RATE_LIMIT_FRAMES)[number];

/** Messages the whole domain may send per frame. */
export interface MailRateLimit {
  value: number;
  frame: MailRateLimitFrame;
}

export interface MailDomainLimits {
  maxMailboxes: number;
  maxAliases: number;
  /** Storage all mailboxes together may be given, bytes (whole MiB). */
  quotaBytes: number;
  /** Size a new mailbox gets by default, bytes. */
  defaultMailboxQuotaBytes: number;
  /** Largest size of one mailbox, bytes. */
  maxMailboxQuotaBytes: number;
  rateLimit: MailRateLimit | null;
}

export interface MailDomainUsage {
  mailboxes: number;
  /** Aliases, without the address of every mailbox itself. */
  aliases: number;
  /** Sum of the mailbox sizes, bytes. */
  allocatedBytes: number;
  /** What the mailboxes store, bytes. */
  usedBytes: number;
  messages: number;
}

/** What Mailcow reports about a mail domain (stored in mail_domains.info). */
export interface MailDomainInfo {
  /** ASCII name, e.g. "xn--mller-kva.ch". */
  name: string;
  /** Unicode name, e.g. "müller.ch". */
  displayName: string;
  description: string | null;
  active: boolean;
  /** Relay (backup MX) domain: mail is passed on, the panel creates no mailboxes there. */
  relay: boolean;
  limits: MailDomainLimits;
  usage: MailDomainUsage;
  createdAt: string | null;
  modifiedAt: string | null;
}

export const MAILBOX_STATES = ['active', 'login_disabled', 'inactive'] as const;
/** Mailcow active = 1, 2 ("disallow login, still receives mail"), 0. */
export type MailboxState = (typeof MAILBOX_STATES)[number];

/** A mailbox as Mailcow reports it. Never carries a password. */
export interface MailboxDto {
  /** Login name and address, e.g. "anna@kunde.ch" (ASCII domain). */
  address: string;
  localPart: string;
  name: string | null;
  state: MailboxState;
  /** Bytes, 0 = unlimited (only for mailboxes created outside the panel). */
  quotaBytes: number;
  usedBytes: number;
  messages: number;
  /** Latest login over IMAP, SMTP, POP3 and SSO, null = never or not shown by Mailcow. */
  lastLoginAt: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
}

export type MailAliasSpecial = 'discard' | 'spam' | 'ham';

export interface MailAliasDto {
  /** Mailcow's numeric alias id, as a string. */
  id: string;
  /** "info@kunde.ch", or "@kunde.ch" for the catch-all. */
  address: string;
  catchAll: boolean;
  /** Addresses mail goes to. Empty when `special` is set. */
  targets: string[];
  /** Mailcow's special targets null@localhost, spam@localhost, ham@localhost. Shown, not editable. */
  special: MailAliasSpecial | null;
  active: boolean;
  createdAt: string | null;
  modifiedAt: string | null;
}

export interface MailPasswordPolicy {
  minLength: number;
  letters: boolean;
  mixedCase: boolean;
  digits: boolean;
  specialChars: boolean;
}

export interface MailServerEndpoint {
  host: string;
  port: number;
  security: 'ssl' | 'starttls';
}

/** How mail programs connect. The login is always the full address. */
export interface MailClientSettings {
  /** Public host name of the mail server (MX target, IMAP, SMTP, webmail). */
  mailHost: string;
  /** SOGo, e.g. https://mail.weblion.one/SOGo/ */
  webmailUrl: string;
  /** Preferred first: 993 ssl, 143 starttls. */
  imap: MailServerEndpoint[];
  /** 465 ssl, 587 starttls. */
  smtp: MailServerEndpoint[];
  /** 995 ssl, 110 starttls. */
  pop3: MailServerEndpoint[];
}

export interface MailDomainDto {
  id: string;
  /** Unicode name for display. */
  name: string;
  /** ASCII name as Mailcow knows it; mailbox addresses use it. */
  asciiName: string;
  active: boolean;
  relay: boolean;
  provider: { id: string; type: ProviderType; name: string };
  location: Location;
  org: { id: string; name: string; slug: string } | null;
  limits: MailDomainLimits | null;
  usage: MailDomainUsage | null;
  /** Actions the current user may perform on this mail domain. */
  permissions: Permission[];
  lastSyncedAt: string | null;
  missingSince: string | null;
  createdAt: string;
}

/** GET /mail/domains/:id, refreshed live from Mailcow. */
export interface MailDomainDetailDto extends MailDomainDto {
  info: MailDomainInfo | null;
  /** Set when Mailcow could not be read; the stored values are shown then. */
  liveError: string | null;
  clientSettings: MailClientSettings | null;
  /** Mailcow's password policy, null when it could not be read. */
  passwordPolicy: MailPasswordPolicy | null;
}

/** Answer of creating a mailbox: a generated password is shown once. (Setting a password answers `{ password: string | null }`.) */
export interface MailboxSecretDto {
  mailbox: MailboxDto;
  /** null when the caller chose the password. */
  password: string | null;
}

/** Answer of creating or changing a mail domain (admin). warnings: non-fatal notes from Mailcow. */
export interface MailDomainChangeResult {
  domain: MailDomainDto;
  warnings: string[];
}

// --- DNS setup ------------------------------------------------------------------------

export const MAIL_DNS_RECORD_KEYS = [
  'mx',
  'spf',
  'dkim',
  'dmarc',
  'autodiscover',
  'autoconfig',
  'autodiscover_srv',
] as const;
export type MailDnsRecordKey = (typeof MAIL_DNS_RECORD_KEYS)[number];

/** ok: a fitting record exists. missing: nothing under that name. conflict: something else is there. unknown: no zone to compare with. */
export type MailDnsStatus = 'ok' | 'missing' | 'conflict' | 'unknown';

export type MailDnsHint =
  | 'other_mx'
  | 'other_spf'
  | 'several_spf'
  | 'other_target'
  | 'name_in_use'
  | 'other_dkim_key'
  | 'no_dkim_key'
  | 'several_dmarc'
  | 'type_not_supported';

export interface MailDnsRecordDto {
  key: MailDnsRecordKey;
  type: Extract<DnsRecordType, 'MX' | 'TXT' | 'CNAME' | 'SRV'>;
  /** Relative to the zone: "@", "dkim._domainkey", "_dmarc", "autodiscover", "_autodiscover._tcp". */
  name: string;
  /** Fully qualified (ASCII), for other DNS panels. */
  fqdn: string;
  /** Value in the panel's generic format (see DnsRecord). Empty for DKIM while no key exists. */
  data: string;
  /** Needed to receive and send reliably (MX, SPF, DKIM); the others are recommended. */
  required: boolean;
  status: MailDnsStatus;
  hint: MailDnsHint | null;
  /** Values found under this name that decided the status. */
  found: string[];
  /** "Add missing records" can add it for this caller right now. */
  addable: boolean;
}

/** The panel domain (module "dns") with the same name, if the caller may read it. */
export interface MailDnsZoneDto {
  domainId: string;
  name: string;
  provider: { id: string; type: ProviderType; name: string };
  /** DNS changes possible at the provider now (24fire: only with 24fire+). */
  writable: boolean;
  /** The caller has domain:dns:write on it. */
  canEdit: boolean;
  /** The provider's name servers serve the zone (DomainInfo.providerDns), null = unknown. */
  live: boolean | null;
  /** Records could not be read. */
  error: string | null;
}

export interface MailDnsSetupDto {
  /** ASCII name. */
  domain: string;
  mailHost: string;
  /** present null: the key could not be read at Mailcow, so whether there is one is unknown. */
  dkim: { selector: string; present: boolean | null; keyLength: string | null };
  zone: MailDnsZoneDto | null;
  records: MailDnsRecordDto[];
}

export interface MailDnsApplyResult {
  added: MailDnsRecordKey[];
  skipped: { key: MailDnsRecordKey; reason: 'not_missing' | 'not_supported' | 'no_dkim_key' }[];
  failed: { key: MailDnsRecordKey; error: string }[];
  setup: MailDnsSetupDto;
}

/** `details` of a 409 answer with code "mail_limit" (the panel's pre-check of a domain limit). */
export type MailLimitKind = 'mailboxes' | 'aliases' | 'storage' | 'mailboxSize';
export interface MailLimitDetails {
  limit: MailLimitKind;
  /** The limit, in bytes for storage and mailboxSize. */
  max: number;
  /** What is in use, in bytes for storage (allocated) and mailboxSize (the requested size). */
  used: number;
}

export const MAIL_DEFAULT_DKIM_KEY_SIZE: MailDkimKeySize = 2048;

// --- Rules shared by API, demo and console ---------------------------------------------

/** Local parts the panel creates: a-z, 0-9, ".", "_", "-", letter or digit at both ends, no "..", at most 64. */
export function isMailLocalPart(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 64 &&
    /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(value) &&
    !value.includes('..')
  );
}

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** WHATWG URL, present in browsers and Node; this package compiles without DOM or Node types. */
const WhatwgUrl = (globalThis as unknown as { URL: new (input: string) => { hostname: string } }).URL;

/**
 * ASCII (punycode) form of a mail domain the user typed, or null. WHATWG URL does the IDNA
 * mapping in browsers and Node alike ("Müller.CH" -> "xn--mller-kva.ch").
 */
export function mailDomainAscii(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/\.$/, '');
  if (!raw || raw.length > 253 || /[\s/@:?#[\]\\%]/.test(raw)) return null;
  let host: string;
  try {
    host = new WhatwgUrl(`http://${raw}`).hostname;
  } catch {
    return null;
  }
  const labels = host.split('.');
  if (labels.length < 2 || host.length > 253 || !labels.every((l) => HOST_LABEL.test(l))) return null;
  return /^(xn--[a-z0-9-]+|[a-z]{2,63})$/.test(labels[labels.length - 1]!) ? host : null;
}

/** Client settings of a Mailcow server (ports of mailcow-dockerized, see docs prerequisite-system). */
export function mailClientSettings(mailHost: string): MailClientSettings {
  return {
    mailHost,
    webmailUrl: `https://${mailHost}/SOGo/`,
    imap: [
      { host: mailHost, port: 993, security: 'ssl' },
      { host: mailHost, port: 143, security: 'starttls' },
    ],
    smtp: [
      { host: mailHost, port: 465, security: 'ssl' },
      { host: mailHost, port: 587, security: 'starttls' },
    ],
    pop3: [
      { host: mailHost, port: 995, security: 'ssl' },
      { host: mailHost, port: 110, security: 'starttls' },
    ],
  };
}

/** Mailcow's own ordering rule: default <= maximum mailbox size <= domain storage. */
export function mailLimitsIssue(limits: {
  quotaMb: number;
  defaultMailboxQuotaMb: number;
  maxMailboxQuotaMb: number;
}): string | null {
  if (limits.defaultMailboxQuotaMb > limits.maxMailboxQuotaMb) {
    return 'The default mailbox size must not exceed the maximum mailbox size';
  }
  if (limits.maxMailboxQuotaMb > limits.quotaMb) {
    return 'The maximum mailbox size must not exceed the storage of the domain';
  }
  return null;
}

export type MailPasswordIssue =
  'length' | 'tooLong' | 'characters' | 'letters' | 'mixedCase' | 'digits' | 'specialChars';

/** The panel's checks plus Mailcow's policy (password_check in functions.inc.php). */
export function mailPasswordIssues(password: string, policy: MailPasswordPolicy | null): MailPasswordIssue[] {
  const p = policy ?? { minLength: 0, letters: true, mixedCase: true, digits: true, specialChars: false };
  const issues: MailPasswordIssue[] = [];
  if (password.length < Math.max(MAIL_PASSWORD_MIN, p.minLength)) issues.push('length');
  if (password.length > MAIL_PASSWORD_MAX) issues.push('tooLong');
  // Printable ASCII only: mail programs disagree on other encodings.
  if (!/^[\x21-\x7e]*$/.test(password)) issues.push('characters');
  if (p.letters && !/[a-zA-Z]/.test(password)) issues.push('letters');
  if (p.mixedCase && !(/[a-z]/.test(password) && /[A-Z]/.test(password))) issues.push('mixedCase');
  if (p.digits && !/\d/.test(password)) issues.push('digits');
  if (p.specialChars && !/[^a-zA-Z\d]/.test(password)) issues.push('specialChars');
  return issues;
}
