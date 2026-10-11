import { createHash } from 'node:crypto';
import { domainToUnicode } from 'node:url';
import {
  MAIL_DKIM_KEY_SIZES,
  MAIL_DKIM_SELECTOR,
  MAIL_MAX_ALIAS_TARGETS,
  MAIL_MIB,
  MAIL_RATE_LIMIT_FRAMES,
  MAILBOX_STATES,
  isMailLocalPart,
  mailClientSettings,
  mailDomainAscii,
  mailLimitsIssue,
  mailPasswordIssues,
  type MailAliasDto,
  type MailAliasSpecial,
  type MailClientSettings,
  type MailPasswordPolicy,
  type MailRateLimit,
  type MailboxDto,
  type MailboxState,
} from '@weblion/shared';
import { type AppError, badRequest, conflict, notFound } from '../../lib/errors';
import type {
  DkimKey,
  MailAliasInput,
  MailAliasPatch,
  MailDomainInput,
  MailDomainLimitsInput,
  MailDomainPatch,
  MailboxInput,
  MailboxPatch,
  RemoteMailDomain,
} from '../types';

/**
 * Simulated Mailcow for the demo provider: mail domains, mailboxes, aliases and DKIM keys,
 * kept in memory per connection like the other demo data, so changes survive adapter
 * re-creation. Refuses what Mailcow refuses (limits, non-empty domains, names that cannot be
 * cleared) with the status the Mailcow adapter answers for the same Mailcow message, so the dev
 * stack and the route tests see the same behaviour as with a real instance.
 */

export const DEMO_MAIL_HOST = 'mail.demo.weblion.one';
/** Like Mailcow's example values: 8 characters, letters, upper and lower case. */
export const DEMO_MAIL_POLICY: MailPasswordPolicy = {
  minLength: 8,
  letters: true,
  mixedCase: true,
  digits: false,
  specialChars: false,
};

export interface DemoMailbox {
  localPart: string;
  name: string | null;
  /** MiB, 0 = unlimited (only seeded, the panel never creates one). */
  quotaMb: number;
  usedBytes: number;
  messages: number;
  /** Mailcow's values: 1 active, 2 login disabled (still receives), 0 inactive. */
  active: 0 | 1 | 2;
  lastLoginAt: string | null;
  createdAt: string;
  modifiedAt: string | null;
  /** Kept only to mimic Mailcow (and for tests); never returned. */
  password: string;
}

export interface DemoAlias {
  id: number;
  /** "team@muster-ag.ch", or "@muster-ag.ch" for the catch-all. */
  address: string;
  /** Lower-case targets, or exactly one of null@localhost, spam@localhost, ham@localhost. */
  goto: string[];
  active: boolean;
  createdAt: string;
  modifiedAt: string | null;
}

export interface DemoMailDomain {
  /** ASCII name, the map key. */
  name: string;
  displayName: string;
  description: string | null;
  active: boolean;
  relay: boolean;
  maxMailboxes: number;
  maxAliases: number;
  quotaMb: number;
  defaultMailboxQuotaMb: number;
  maxMailboxQuotaMb: number;
  rateLimit: MailRateLimit | null;
  /** Key: local part. */
  mailboxes: Map<string, DemoMailbox>;
  /** Key: alias id. Mailbox self aliases are not kept (Mailcow does not list them either). */
  aliases: Map<number, DemoAlias>;
  createdAt: string;
  modifiedAt: string | null;
}

export interface DemoMailState {
  /** Key: ASCII name. */
  domains: Map<string, DemoMailDomain>;
  /** Key: ASCII name. Outlives a deleted domain, like Mailcow's Redis keys. */
  dkim: Map<string, DkimKey>;
  nextAliasId: number;
  policy: MailPasswordPolicy;
}

const STATE = new Map<string, DemoMailState>();

const GiB = 1024 ** 3;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Simulated size of one message: 150 KiB. */
const MESSAGE_BYTES = 153_600;
const SEEDED_AT = '2024-03-01T10:00:00.000Z';
const SEED_PASSWORD = 'Demo-Passwort-2024';
/** Goto values Mailcow uses instead of addresses: discard, learn as spam, learn as ham. */
const SPECIAL_TARGETS: Record<string, MailAliasSpecial> = {
  'null@localhost': 'discard',
  'spam@localhost': 'spam',
  'ham@localhost': 'ham',
};
/** The limits the Mailcow adapter accepts (assertLimits), so the demo refuses the same values. */
const MAX_COUNT = 100_000;
const MAX_MIB = 10_000_000;
const MAX_RATE = 1_000_000;
const MAX_NAME_LENGTH = 255;
const DKIM_SELECTOR = /^[a-z0-9][a-z0-9._-]{0,62}$/;
/** Start of every RSA public key Mailcow shows (DER header of a 2048 bit SubjectPublicKeyInfo). */
const DKIM_KEY_PREFIX = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA';

interface MailboxSeed {
  localPart: string;
  name: string;
  quotaMb: number;
  /** GiB the mailbox stores. */
  usedGb: number;
  active: 0 | 1 | 2;
  /** How long ago the last login was; null = never. */
  lastLoginAgoMs: number | null;
}

interface AliasSeed {
  id: number;
  address: string;
  goto: string[];
  active: boolean;
}

interface MailDomainSeed {
  /** ASCII name. */
  name: string;
  description: string | null;
  maxMailboxes: number;
  maxAliases: number;
  quotaMb: number;
  defaultMailboxQuotaMb: number;
  maxMailboxQuotaMb: number;
  rateLimit: MailRateLimit | null;
  relay: boolean;
  /** Size of the DKIM key the domain has; null = none. */
  dkimKeySize: number | null;
  mailboxes: MailboxSeed[];
  aliases: AliasSeed[];
}

/**
 * Mail domains already at the instance. Muster AG has two (every kind of alias on one, no DKIM
 * key on the shop domain, whose DNS zone in demo/hosting.ts lacks the mail records), Bäckerei
 * Huber one below its reseller Alpen Hosting, which keeps one in its pool. müller.ch (IDN) and
 * the relay domain stay unassigned for the admin inventory (see db/seed-mail.ts).
 */
export const DEMO_MAIL_DOMAINS: readonly MailDomainSeed[] = [
  {
    name: 'muster-ag.ch',
    description: 'Muster AG',
    maxMailboxes: 25,
    maxAliases: 100,
    quotaMb: 51_200,
    defaultMailboxQuotaMb: 2048,
    maxMailboxQuotaMb: 10_240,
    rateLimit: { value: 500, frame: 'h' },
    relay: false,
    dkimKeySize: 2048,
    mailboxes: [
      {
        localPart: 'anna',
        name: 'Anna Muster',
        quotaMb: 10_240,
        usedGb: 3.4,
        active: 1,
        lastLoginAgoMs: 2 * HOUR,
      },
      {
        localPart: 'ben',
        name: 'Ben Beispiel',
        quotaMb: 5120,
        usedGb: 1.1,
        active: 1,
        lastLoginAgoMs: 3 * DAY,
      },
      {
        localPart: 'info',
        name: 'Info Muster AG',
        quotaMb: 2048,
        usedGb: 0.6,
        active: 2,
        lastLoginAgoMs: null,
      },
      {
        localPart: 'buchhaltung',
        name: 'Buchhaltung',
        quotaMb: 10_240,
        usedGb: 7.9,
        active: 0,
        lastLoginAgoMs: 60 * DAY,
      },
    ],
    aliases: [
      { id: 1, address: 'team@muster-ag.ch', goto: ['anna@muster-ag.ch', 'ben@muster-ag.ch'], active: true },
      { id: 2, address: 'kontakt@muster-ag.ch', goto: ['info@muster-ag.ch'], active: true },
      { id: 3, address: '@muster-ag.ch', goto: ['info@muster-ag.ch'], active: false },
      { id: 4, address: 'noreply@muster-ag.ch', goto: ['null@localhost'], active: true },
    ],
  },
  {
    name: 'muster-shop.ch',
    description: 'Muster AG Shop',
    maxMailboxes: 5,
    maxAliases: 20,
    quotaMb: 10_240,
    defaultMailboxQuotaMb: 1024,
    maxMailboxQuotaMb: 5120,
    rateLimit: null,
    relay: false,
    dkimKeySize: null,
    mailboxes: [
      { localPart: 'shop', name: 'Webshop', quotaMb: 2048, usedGb: 0.2, active: 1, lastLoginAgoMs: DAY },
    ],
    aliases: [
      {
        id: 5,
        address: 'bestellungen@muster-shop.ch',
        goto: ['shop@muster-shop.ch', 'anna@muster-ag.ch'],
        active: true,
      },
    ],
  },
  {
    name: 'baeckerei-huber.ch',
    description: 'Bäckerei Huber',
    maxMailboxes: 5,
    maxAliases: 20,
    quotaMb: 5120,
    defaultMailboxQuotaMb: 1024,
    maxMailboxQuotaMb: 2048,
    rateLimit: { value: 100, frame: 'h' },
    relay: false,
    dkimKeySize: 2048,
    mailboxes: [
      {
        localPart: 'hanna',
        name: 'Hanna Huber',
        quotaMb: 2048,
        usedGb: 0.9,
        active: 1,
        lastLoginAgoMs: 5 * HOUR,
      },
      {
        localPart: 'info',
        name: 'Bäckerei Huber',
        quotaMb: 1024,
        usedGb: 0.3,
        active: 1,
        lastLoginAgoMs: 2 * DAY,
      },
    ],
    aliases: [
      { id: 6, address: 'bestellung@baeckerei-huber.ch', goto: ['hanna@baeckerei-huber.ch'], active: true },
    ],
  },
  {
    name: 'alpen-hosting.ch',
    description: 'Alpen Hosting',
    maxMailboxes: 50,
    maxAliases: 200,
    quotaMb: 102_400,
    defaultMailboxQuotaMb: 2048,
    maxMailboxQuotaMb: 10_240,
    rateLimit: null,
    relay: false,
    dkimKeySize: 2048,
    mailboxes: [
      { localPart: 'reto', name: 'Reto Alpen', quotaMb: 4096, usedGb: 1.2, active: 1, lastLoginAgoMs: HOUR },
    ],
    aliases: [],
  },
  {
    name: 'xn--mller-kva.ch',
    description: null,
    maxMailboxes: 10,
    maxAliases: 400,
    quotaMb: 10_240,
    defaultMailboxQuotaMb: 3072,
    maxMailboxQuotaMb: 10_240,
    rateLimit: null,
    relay: false,
    dkimKeySize: null,
    mailboxes: [],
    aliases: [],
  },
  {
    name: 'alpenblick-hotel.ch',
    description: 'Hotel Alpenblick AG',
    maxMailboxes: 10,
    maxAliases: 50,
    quotaMb: 20_480,
    defaultMailboxQuotaMb: 2048,
    maxMailboxQuotaMb: 10_240,
    rateLimit: null,
    relay: true,
    dkimKeySize: null,
    mailboxes: [],
    aliases: [],
  },
];

/**
 * A deterministic stand-in for a DKIM key of that size: the usual RSA key start followed by
 * base64 of a SHA-256 chain over "domain:keySize", as long as a real key (392 characters for
 * 2048 bit, 564 for 3072, 736 for 4096: base64 of the modulus plus 38 bytes of DER). The 2048
 * bit TXT value is 420 characters long, more than one 255 byte DNS string.
 */
export function demoDkimKey(domain: string, keySize: number): DkimKey {
  const length = Math.ceil((keySize / 8 + 38) / 3) * 4;
  const needed = Math.ceil(((length - DKIM_KEY_PREFIX.length) * 3) / 4) + 3;
  const chunks: Buffer[] = [];
  let digest = createHash('sha256').update(`${domain}:${keySize}`).digest();
  for (let bytes = 0; bytes < needed; bytes += digest.length) {
    chunks.push(digest);
    digest = createHash('sha256').update(digest).digest();
  }
  const publicKey = (DKIM_KEY_PREFIX + Buffer.concat(chunks).toString('base64')).slice(0, length);
  return {
    selector: MAIL_DKIM_SELECTOR,
    publicKey,
    keyLength: String(keySize),
    txt: `v=DKIM1;k=rsa;t=s;s=email;p=${publicKey}`,
  };
}

function generate(now = Date.now()): DemoMailState {
  const state: DemoMailState = {
    domains: new Map(),
    dkim: new Map(),
    nextAliasId: 100,
    policy: { ...DEMO_MAIL_POLICY },
  };
  for (const seed of DEMO_MAIL_DOMAINS) {
    const domain: DemoMailDomain = {
      name: seed.name,
      displayName: domainToUnicode(seed.name) || seed.name,
      description: seed.description,
      active: true,
      relay: seed.relay,
      maxMailboxes: seed.maxMailboxes,
      maxAliases: seed.maxAliases,
      quotaMb: seed.quotaMb,
      defaultMailboxQuotaMb: seed.defaultMailboxQuotaMb,
      maxMailboxQuotaMb: seed.maxMailboxQuotaMb,
      rateLimit: seed.rateLimit ? { ...seed.rateLimit } : null,
      mailboxes: new Map(),
      aliases: new Map(),
      createdAt: SEEDED_AT,
      modifiedAt: null,
    };
    for (const m of seed.mailboxes) {
      const usedBytes = Math.round(m.usedGb * GiB);
      domain.mailboxes.set(m.localPart, {
        localPart: m.localPart,
        name: m.name,
        quotaMb: m.quotaMb,
        usedBytes,
        messages: Math.round(usedBytes / MESSAGE_BYTES),
        active: m.active,
        lastLoginAt: m.lastLoginAgoMs === null ? null : new Date(now - m.lastLoginAgoMs).toISOString(),
        createdAt: SEEDED_AT,
        modifiedAt: null,
        password: SEED_PASSWORD,
      });
    }
    for (const a of seed.aliases) {
      domain.aliases.set(a.id, {
        id: a.id,
        address: a.address,
        goto: [...a.goto],
        active: a.active,
        createdAt: SEEDED_AT,
        modifiedAt: null,
      });
    }
    state.domains.set(seed.name, domain);
    if (seed.dkimKeySize !== null) state.dkim.set(seed.name, demoDkimKey(seed.name, seed.dkimKeySize));
  }
  return state;
}

/** The state of one demo connection, created from the seed on first use. */
export function demoMailState(connectionId: string): DemoMailState {
  let state = STATE.get(connectionId);
  if (!state) {
    state = generate();
    STATE.set(connectionId, state);
  }
  return state;
}

/** Test helper: forget all simulated mail state. */
export function resetDemoMail(): void {
  STATE.clear();
}

/** "<action> failed: <Mailcow's text>", like the Mailcow adapter reports a refused write. */
function refused(make: (message: string) => AppError, action: string, text: string): AppError {
  return make(`${action} failed: ${text}`);
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isWhole = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;
const nowIso = () => new Date().toISOString();

/** Splits "local@domain" at the last "@"; null without one. */
function splitAddress(address: string): { localPart: string; domain: string } | null {
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  return { localPart: address.slice(0, at), domain: address.slice(at + 1) };
}

/** A forwarding target Mailcow takes: something before the "@" and a valid ASCII domain. */
function isTarget(target: string): boolean {
  const parts = splitAddress(target);
  return !!parts && parts.localPart.length > 0 && mailDomainAscii(parts.domain) === parts.domain;
}

/** Mailcow's checks of domain limits (MiB), as the Mailcow adapter applies them before sending. */
function limitsIssue(limits: MailDomainLimitsInput): string | null {
  if (!isWhole(limits.maxMailboxes, 0, MAX_COUNT)) {
    return `Max. mailboxes must be a whole number from 0 to ${MAX_COUNT}`;
  }
  // Mailcow keeps the old value for 0 when editing, so the panel never sends it.
  if (!isWhole(limits.maxAliases, 1, MAX_COUNT)) {
    return `Max. aliases must be a whole number from 1 to ${MAX_COUNT}`;
  }
  if (limits.defaultMailboxQuotaMb === 0) return 'Default quota per mailbox must not be 0.';
  if (limits.maxMailboxQuotaMb === 0) return 'Max. quota per mailbox must not be 0.';
  for (const value of [limits.quotaMb, limits.defaultMailboxQuotaMb, limits.maxMailboxQuotaMb]) {
    if (!isWhole(value, 1, MAX_MIB)) return `Sizes must be whole numbers of MiB from 1 to ${MAX_MIB}`;
  }
  const order = mailLimitsIssue(limits);
  if (order) return order;
  return limits.rateLimit ? rateLimitIssue(limits.rateLimit) : null;
}

function rateLimitIssue(rateLimit: MailRateLimit): string | null {
  if (!(MAIL_RATE_LIMIT_FRAMES as readonly string[]).includes(rateLimit.frame)) {
    return 'Rate limit time frame is incorrect';
  }
  if (!isWhole(rateLimit.value, 1, MAX_RATE)) return `The rate limit must be from 1 to ${MAX_RATE} messages`;
  return null;
}

function dkimIssue(options: { selector: string; keySize: number }): string | null {
  if (!DKIM_SELECTOR.test(options.selector)) {
    return `DKIM domain or selector invalid: ${options.selector}`;
  }
  if (!(MAIL_DKIM_KEY_SIZES as readonly number[]).includes(options.keySize)) {
    return `The DKIM key size must be one of ${MAIL_DKIM_KEY_SIZES.join(', ')} bits`;
  }
  return null;
}

const STATE_OF: Record<DemoMailbox['active'], MailboxState> = {
  1: 'active',
  2: 'login_disabled',
  0: 'inactive',
};
const ACTIVE_OF: Record<MailboxState, DemoMailbox['active']> = {
  active: 1,
  login_disabled: 2,
  inactive: 0,
};

/** One method per mail method of the adapter contract, synchronous; DemoAdapter wraps them. */
export class DemoMail {
  constructor(private readonly state: DemoMailState) {}

  // --- Lookups and views ------------------------------------------------------------

  private domain(name: string): DemoMailDomain {
    const domain = this.state.domains.get(name.toLowerCase());
    if (!domain) throw notFound('Mail domain');
    return domain;
  }

  private mailbox(address: string): { domain: DemoMailDomain; mailbox: DemoMailbox; address: string } {
    const parts = splitAddress(address.toLowerCase());
    const domain = parts ? this.state.domains.get(parts.domain) : undefined;
    const mailbox = parts && domain?.mailboxes.get(parts.localPart);
    if (!parts || !domain || !mailbox) throw notFound('Mailbox');
    return { domain, mailbox, address: `${parts.localPart}@${parts.domain}` };
  }

  private alias(id: string): { domain: DemoMailDomain; alias: DemoAlias } {
    if (/^\d{1,10}$/.test(id)) {
      for (const domain of this.state.domains.values()) {
        const alias = domain.aliases.get(Number(id));
        if (alias) return { domain, alias };
      }
    }
    throw notFound('Alias');
  }

  private remote(d: DemoMailDomain): RemoteMailDomain {
    const mailboxes = [...d.mailboxes.values()];
    const sum = (pick: (m: DemoMailbox) => number) => mailboxes.reduce((total, m) => total + pick(m), 0);
    return {
      externalId: d.name,
      info: {
        name: d.name,
        displayName: d.displayName,
        description: d.description,
        active: d.active,
        relay: d.relay,
        limits: {
          maxMailboxes: d.maxMailboxes,
          maxAliases: d.maxAliases,
          quotaBytes: d.quotaMb * MAIL_MIB,
          defaultMailboxQuotaBytes: d.defaultMailboxQuotaMb * MAIL_MIB,
          maxMailboxQuotaBytes: d.maxMailboxQuotaMb * MAIL_MIB,
          rateLimit: d.rateLimit ? { ...d.rateLimit } : null,
        },
        usage: {
          mailboxes: mailboxes.length,
          aliases: d.aliases.size,
          allocatedBytes: sum((m) => m.quotaMb) * MAIL_MIB,
          usedBytes: sum((m) => m.usedBytes),
          messages: sum((m) => m.messages),
        },
        createdAt: d.createdAt,
        modifiedAt: d.modifiedAt,
      },
    };
  }

  private mailboxView(d: DemoMailDomain, m: DemoMailbox): MailboxDto {
    return {
      address: `${m.localPart}@${d.name}`,
      localPart: m.localPart,
      name: m.name,
      state: STATE_OF[m.active],
      quotaBytes: m.quotaMb * MAIL_MIB,
      usedBytes: m.usedBytes,
      messages: m.messages,
      lastLoginAt: m.lastLoginAt,
      createdAt: m.createdAt,
      modifiedAt: m.modifiedAt,
    };
  }

  private aliasView(a: DemoAlias): MailAliasDto {
    const special = a.goto.length === 1 ? (SPECIAL_TARGETS[a.goto[0]!] ?? null) : null;
    return {
      id: String(a.id),
      address: a.address,
      catchAll: a.address.startsWith('@'),
      targets: special ? [] : [...a.goto],
      special,
      active: a.active,
      createdAt: a.createdAt,
      modifiedAt: a.modifiedAt,
    };
  }

  /** Mailcow's target checks on alias create and edit: valid, not the alias itself, 1 to 50. */
  private targets(action: string, address: string, raw: string[]): string[] {
    const targets = [...new Set(raw.map((t) => t.trim().toLowerCase()))];
    for (const target of targets) {
      if (!isTarget(target)) throw refused(badRequest, action, `Goto address ${target} is invalid`);
    }
    if (targets.includes(address)) {
      throw refused(badRequest, action, 'Alias and goto address must not be identical');
    }
    if (targets.length === 0) {
      throw refused(badRequest, action, 'An alias address must contain at least one valid goto address');
    }
    if (targets.length > MAIL_MAX_ALIAS_TARGETS) {
      throw refused(badRequest, action, `An alias may have at most ${MAIL_MAX_ALIAS_TARGETS} targets`);
    }
    return targets;
  }

  // --- Domains ----------------------------------------------------------------------

  listMailDomains(): RemoteMailDomain[] {
    return [...this.state.domains.values()].sort((a, b) => byText(a.name, b.name)).map((d) => this.remote(d));
  }

  getMailDomain(name: string): RemoteMailDomain {
    return this.remote(this.domain(name));
  }

  createMailDomain(input: MailDomainInput): { domain: RemoteMailDomain; warnings: string[] } {
    const name = input.domain;
    const action = `create mail domain ${name}`;
    if (mailDomainAscii(name) !== name) {
      throw refused(badRequest, action, 'Domain name is empty or invalid');
    }
    if (name === DEMO_MAIL_HOST) throw refused(badRequest, action, 'Domain cannot match hostname');
    if (this.state.domains.has(name)) throw refused(conflict, action, `Domain ${name} already exists`);
    const issue = limitsIssue(input.limits) ?? dkimIssue(input.dkim);
    if (issue) throw refused(badRequest, action, issue);

    const { limits } = input;
    const created = nowIso();
    const domain: DemoMailDomain = {
      name,
      displayName: domainToUnicode(name) || name,
      // The adapter sends the name when there is no description, and Mailcow keeps it.
      description: input.description || name,
      active: true,
      relay: false,
      maxMailboxes: limits.maxMailboxes,
      maxAliases: limits.maxAliases,
      quotaMb: limits.quotaMb,
      defaultMailboxQuotaMb: limits.defaultMailboxQuotaMb,
      maxMailboxQuotaMb: limits.maxMailboxQuotaMb,
      rateLimit: limits.rateLimit ? { ...limits.rateLimit } : null,
      mailboxes: new Map(),
      aliases: new Map(),
      createdAt: created,
      modifiedAt: null,
    };
    this.state.domains.set(name, domain);
    // A key left from an earlier domain of that name is kept (Mailcow: domain_add_dkim_available).
    if (!this.state.dkim.has(name)) {
      this.state.dkim.set(name, { ...demoDkimKey(name, input.dkim.keySize), selector: input.dkim.selector });
    }
    // restartSogo does not matter here: there is no webmail to restart.
    return { domain: this.remote(domain), warnings: [] };
  }

  updateMailDomain(name: string, patch: MailDomainPatch): void {
    const domain = this.domain(name);
    const action = `change mail domain ${domain.name}`;
    const merged: MailDomainLimitsInput = {
      maxMailboxes: patch.maxMailboxes ?? domain.maxMailboxes,
      maxAliases: patch.maxAliases ?? domain.maxAliases,
      quotaMb: patch.quotaMb ?? domain.quotaMb,
      defaultMailboxQuotaMb: patch.defaultMailboxQuotaMb ?? domain.defaultMailboxQuotaMb,
      maxMailboxQuotaMb: patch.maxMailboxQuotaMb ?? domain.maxMailboxQuotaMb,
      rateLimit: patch.rateLimit !== undefined ? patch.rateLimit : domain.rateLimit,
    };
    const issue = limitsIssue(merged);
    if (issue) throw refused(badRequest, action, issue);

    // Mailcow's checks against what is in use, in its order.
    const quotas = [...domain.mailboxes.values()].map((m) => m.quotaMb);
    const allocated = quotas.reduce((total, q) => total + q, 0);
    const biggest = Math.max(0, ...quotas);
    if (merged.maxMailboxes < domain.mailboxes.size) {
      throw refused(conflict, action, `Max. mailboxes must be greater or equal to ${domain.mailboxes.size}`);
    }
    if (merged.maxAliases < domain.aliases.size) {
      throw refused(conflict, action, `Max. aliases must be greater or equal to ${domain.aliases.size}`);
    }
    if (merged.quotaMb < allocated) {
      throw refused(conflict, action, `Domain quota must be greater or equal to ${allocated} MiB`);
    }
    if (merged.maxMailboxQuotaMb < biggest) {
      throw refused(conflict, action, `Mailbox quota must be greater or equal to ${biggest} MiB`);
    }

    domain.maxMailboxes = merged.maxMailboxes;
    domain.maxAliases = merged.maxAliases;
    domain.quotaMb = merged.quotaMb;
    domain.defaultMailboxQuotaMb = merged.defaultMailboxQuotaMb;
    domain.maxMailboxQuotaMb = merged.maxMailboxQuotaMb;
    domain.rateLimit = merged.rateLimit ? { ...merged.rateLimit } : null;
    if (patch.active !== undefined) domain.active = patch.active;
    domain.modifiedAt = nowIso();
  }

  deleteMailDomain(name: string): { warnings: string[] } {
    const domain = this.domain(name);
    if (domain.mailboxes.size > 0) {
      throw refused(
        conflict,
        `delete mail domain ${domain.name}`,
        `Cannot remove non-empty domain ${domain.name}`,
      );
    }
    // The aliases go with the domain; the DKIM key stays, like Mailcow's Redis keys.
    this.state.domains.delete(domain.name);
    return { warnings: [] };
  }

  // --- Mailboxes --------------------------------------------------------------------

  listMailboxes(name: string): MailboxDto[] {
    const domain = this.domain(name);
    return [...domain.mailboxes.values()]
      .map((m) => this.mailboxView(domain, m))
      .sort((a, b) => byText(a.address, b.address));
  }

  getMailbox(address: string): MailboxDto {
    const { domain, mailbox } = this.mailbox(address);
    return this.mailboxView(domain, mailbox);
  }

  createMailbox(input: MailboxInput): MailboxDto {
    const localPart = input.localPart;
    const address = `${localPart}@${input.domain}`;
    const action = `create mailbox ${address}`;
    if (!isMailLocalPart(localPart) || mailDomainAscii(input.domain) !== input.domain) {
      throw refused(badRequest, action, 'Mailbox name is invalid');
    }
    const domain = this.state.domains.get(input.domain);
    if (domain?.mailboxes.has(localPart)) throw refused(conflict, action, `Object ${address} already exists`);
    if (domain && [...domain.aliases.values()].some((a) => a.address === address)) {
      throw refused(conflict, action, `${address} is already known as an alias address`);
    }
    if (!domain) throw notFound('Mail domain');
    if (mailPasswordIssues(input.password, this.state.policy).length > 0) {
      throw refused(badRequest, action, 'Password does not meet the policy');
    }
    if (domain.mailboxes.size >= domain.maxMailboxes) {
      throw refused(
        conflict,
        action,
        `Max. mailboxes exceeded (${domain.mailboxes.size} of ${domain.maxMailboxes})`,
      );
    }
    if (!isWhole(input.quotaMb, 1, MAX_MIB)) {
      throw refused(badRequest, action, `The size must be a whole number of MiB from 1 to ${MAX_MIB}`);
    }
    if (input.quotaMb > domain.maxMailboxQuotaMb) {
      throw refused(
        conflict,
        action,
        `Quota exceeds the domain limit (max. ${domain.maxMailboxQuotaMb} MiB)`,
      );
    }
    const left = domain.quotaMb - [...domain.mailboxes.values()].reduce((total, m) => total + m.quotaMb, 0);
    if (input.quotaMb > left) {
      throw refused(conflict, action, `Not enough space left (space left: ${Math.max(0, left)} MiB)`);
    }

    const mailbox: DemoMailbox = {
      localPart,
      name: input.name?.trim() || null,
      quotaMb: input.quotaMb,
      usedBytes: 0,
      messages: 0,
      active: 1,
      lastLoginAt: null,
      createdAt: nowIso(),
      modifiedAt: null,
      password: input.password,
    };
    domain.mailboxes.set(localPart, mailbox);
    return this.mailboxView(domain, mailbox);
  }

  updateMailbox(address: string, patch: MailboxPatch): void {
    const { domain, mailbox, address: full } = this.mailbox(address);
    const action = `change mailbox ${full}`;
    // Check everything before changing anything.
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      // Mailcow keeps the old name for an empty one, so a name cannot be removed.
      if (!name) throw refused(badRequest, action, 'The name of a mailbox cannot be removed, only replaced');
      if (name.length > MAX_NAME_LENGTH || /[<>]/.test(name)) {
        throw refused(
          badRequest,
          action,
          `The name may have at most ${MAX_NAME_LENGTH} characters, without < and >`,
        );
      }
    }
    if (patch.quotaMb !== undefined) {
      if (!isWhole(patch.quotaMb, 1, MAX_MIB)) {
        throw refused(badRequest, action, `The size must be a whole number of MiB from 1 to ${MAX_MIB}`);
      }
      // Like Mailcow's max_new_quota: the domain's storage minus the other mailboxes, at most the
      // largest mailbox size. Less than the usage is allowed: Mailcow then refuses new mail.
      let others = 0;
      for (const m of domain.mailboxes.values()) if (m !== mailbox) others += m.quotaMb;
      const left = Math.max(0, Math.min(domain.maxMailboxQuotaMb, domain.quotaMb - others));
      if (patch.quotaMb > left) {
        throw refused(conflict, action, `Not enough space left (space left: ${left} MiB)`);
      }
    }
    if (patch.state !== undefined && !MAILBOX_STATES.includes(patch.state)) {
      throw refused(badRequest, action, `Unknown mailbox state "${String(patch.state)}"`);
    }

    if (patch.name !== undefined) mailbox.name = patch.name.trim();
    if (patch.quotaMb !== undefined) mailbox.quotaMb = patch.quotaMb;
    if (patch.state !== undefined) mailbox.active = ACTIVE_OF[patch.state];
    mailbox.modifiedAt = nowIso();
  }

  setMailboxPassword(address: string, password: string): void {
    const { mailbox, address: full } = this.mailbox(address);
    if (mailPasswordIssues(password, this.state.policy).length > 0) {
      throw refused(badRequest, `set the password of ${full}`, 'Password does not meet the policy');
    }
    mailbox.password = password;
    mailbox.modifiedAt = nowIso();
  }

  deleteMailbox(address: string): void {
    const { domain, mailbox, address: full } = this.mailbox(address);
    domain.mailboxes.delete(mailbox.localPart);
    // Like Mailcow on the whole instance: aliases that only forwarded here are deleted, the
    // address is removed from the others.
    const now = nowIso();
    for (const d of this.state.domains.values()) {
      for (const [id, alias] of d.aliases) {
        if (!alias.goto.includes(full)) continue;
        if (alias.goto.length === 1) {
          d.aliases.delete(id);
        } else {
          alias.goto = alias.goto.filter((t) => t !== full);
          alias.modifiedAt = now;
        }
      }
    }
  }

  // --- Aliases ----------------------------------------------------------------------

  listMailAliases(name: string): MailAliasDto[] {
    const domain = this.domain(name);
    return [...domain.aliases.values()]
      .map((a) => this.aliasView(a))
      .sort((a, b) => Number(a.catchAll) - Number(b.catchAll) || byText(a.address, b.address));
  }

  getMailAlias(id: string): MailAliasDto {
    return this.aliasView(this.alias(id).alias);
  }

  createMailAlias(input: MailAliasInput): MailAliasDto {
    const address = input.address.trim().toLowerCase();
    const action = `create alias ${address}`;
    const parts = splitAddress(address);
    if (
      !parts ||
      mailDomainAscii(parts.domain) !== parts.domain ||
      (parts.localPart !== '' && !isMailLocalPart(parts.localPart))
    ) {
      throw refused(badRequest, action, `Alias address ${address} is invalid`);
    }
    const domain = this.domain(parts.domain);
    if (domain.aliases.size >= domain.maxAliases) throw refused(conflict, action, 'Max. aliases exceeded');
    if (
      [...domain.aliases.values()].some((a) => a.address === address) ||
      domain.mailboxes.has(parts.localPart)
    ) {
      throw refused(
        conflict,
        action,
        `${address} is already known as an alias, a mailbox or an alias address expanded from an alias domain.`,
      );
    }
    const targets = this.targets(action, address, input.targets);

    const alias: DemoAlias = {
      id: this.state.nextAliasId++,
      address,
      goto: targets,
      active: input.active,
      createdAt: nowIso(),
      modifiedAt: null,
    };
    domain.aliases.set(alias.id, alias);
    return this.aliasView(alias);
  }

  updateMailAlias(id: string, patch: MailAliasPatch): void {
    const { alias } = this.alias(id);
    const targets =
      patch.targets !== undefined
        ? this.targets(`change alias ${alias.address}`, alias.address, patch.targets)
        : undefined;
    if (targets) alias.goto = targets;
    if (patch.active !== undefined) alias.active = patch.active;
    alias.modifiedAt = nowIso();
  }

  deleteMailAlias(id: string): void {
    const { domain, alias } = this.alias(id);
    domain.aliases.delete(alias.id);
  }

  // --- DKIM, policy, client settings ------------------------------------------------

  /** null also for unknown domains, like Mailcow's {}. */
  getDkim(name: string): DkimKey | null {
    const key = this.state.dkim.get(name.toLowerCase());
    return key ? { ...key } : null;
  }

  createDkim(name: string, options: { selector: string; keySize: number }): DkimKey {
    const domain = this.domain(name);
    const action = `create a DKIM key for ${domain.name}`;
    if (this.state.dkim.has(domain.name)) throw refused(conflict, action, 'A DKIM key exists already');
    const issue = dkimIssue(options);
    if (issue) throw refused(badRequest, action, issue);
    const key = { ...demoDkimKey(domain.name, options.keySize), selector: options.selector };
    this.state.dkim.set(domain.name, key);
    return { ...key };
  }

  /** Never fails, like Mailcow for a domain without a key. */
  deleteDkim(name: string): void {
    this.state.dkim.delete(name.toLowerCase());
  }

  mailPasswordPolicy(): MailPasswordPolicy {
    return { ...this.state.policy };
  }

  mailClientSettings(): MailClientSettings {
    return mailClientSettings(DEMO_MAIL_HOST);
  }
}
