import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mailClientSettings, mailDomainAscii } from '@weblion/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ProviderError } from '../src/lib/errors';
import { MailcowAdapter } from '../src/providers/mailcow/adapter';
import { MailcowClient } from '../src/providers/mailcow/client';
import {
  asList,
  assertAddress,
  assertAliasId,
  assertLimits,
  assertTargets,
  bool,
  bytesFromMib,
  entriesOf,
  isEmptyObject,
  mailcowError,
  mailcowMessage,
  mibFromBytes,
  parseAlias,
  parseDkim,
  parseDomain,
  parseMailbox,
  parseMailcowDate,
  parsePasswordPolicy,
  parseVmail,
  parseWriteResult,
  redactMailcow,
  unixToIso,
} from '../src/providers/mailcow/parse';
import type { MailDomainInput, MailcowConfig } from '../src/providers/types';

// ---------------------------------------------------------------------------
// A small Mailcow: json_api.php routing, X-API-Key with a read-write and a read-only key,
// answers shaped like mailcow-dockerized master (entries with HTTP 200 for business failures,
// {type: "error"} with 4xx for transport failures, {} for missing objects and empty lists).

interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  /** Parsed JSON, or the raw text when it was not JSON. */
  body: unknown;
}

interface Answer {
  status?: number;
  body?: unknown;
  /** Sent as it is (HTML error pages, plain text). */
  text?: string;
  headers?: Record<string, string>;
}

async function startMock(handler: (req: Recorded) => Answer) {
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let body: unknown = raw || undefined;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        // Keep the text.
      }
      const recorded: Recorded = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
      };
      requests.push(recorded);
      const answer = handler(recorded);
      res.statusCode = answer.status ?? 200;
      for (const [key, value] of Object.entries(answer.headers ?? {})) res.setHeader(key, value);
      if (answer.text !== undefined) {
        res.setHeader('content-type', 'text/html');
        res.end(answer.text);
      } else if (answer.body === undefined) {
        res.end();
      } else {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(answer.body));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const MiB = 1024 ** 2;
const KEY = 'MC-test-key-0123456789abcdef';
const RO_KEY = 'MC-readonly-key-0123456789ab';
const PW = 'Sommer-Regen-2026!x';

const DOMAIN = {
  max_new_mailbox_quota: 10737418240,
  def_new_mailbox_quota: 2147483648,
  quota_used_in_domain: '9663676416',
  bytes_total: '4415226675',
  msgs_total: '20113',
  mboxes_in_domain: 3,
  mboxes_left: 7,
  domain_name: 'muster-ag.ch',
  domain_h_name: 'muster-ag.ch',
  description: 'Muster AG',
  max_num_aliases_for_domain: 50,
  max_num_mboxes_for_domain: 10,
  def_quota_for_mbox: 2147483648,
  max_quota_for_mbox: 10737418240,
  max_quota_for_domain: 21474836480,
  relayhost: 0,
  backupmx: 0,
  backupmx_int: 0,
  gal: 1,
  gal_int: 1,
  rl: { value: '500', frame: 'h' },
  active: 1,
  active_int: 1,
  relay_all_recipients: 0,
  relay_all_recipients_int: 0,
  relay_unknown_only: 0,
  relay_unknown_only_int: 0,
  created: '2024-03-01 10:15:00',
  modified: '2026-09-30 08:00:00',
  aliases_in_domain: 3,
  aliases_left: 47,
  domain_admins: '-',
};
/** Old style: everything a string, rl false, IDN. */
const DOMAIN_STRINGS = {
  ...DOMAIN,
  domain_name: 'xn--mller-kva.ch',
  domain_h_name: 'müller.ch',
  active: '1',
  mboxes_in_domain: '0',
  max_num_mboxes_for_domain: '5',
  max_quota_for_domain: '5368709120',
  rl: false,
  bytes_total: 0,
  msgs_total: 0,
  quota_used_in_domain: '0',
};
const MAILBOX = {
  username: 'anna@muster-ag.ch',
  active: 1,
  active_int: 1,
  domain: 'muster-ag.ch',
  name: 'Anna Muster',
  local_part: 'anna',
  quota: 5368709120,
  messages: 12840,
  attributes: {
    force_pw_update: '0',
    sogo_access: '1',
    imap_access: '1',
    pop3_access: '1',
    smtp_access: '1',
  },
  quota_used: 1932735283,
  percent_in_use: 36,
  created: '2024-03-01 10:20:00',
  modified: null,
  authsource: 'mailcow',
  last_imap_login: 1791530000,
  last_smtp_login: 1791520000,
  last_pop3_login: 0,
  last_sso_login: 0,
  max_new_quota: 10737418240,
  rl: { value: '500', frame: 'h' },
  rl_scope: 'domain',
  sender_acl: [],
  tags: [],
};
const ALIAS = {
  in_primary_domain: '',
  id: 12,
  domain: 'muster-ag.ch',
  public_comment: null,
  private_comment: null,
  goto: 'anna@muster-ag.ch,info@muster-ag.ch',
  address: 'team@muster-ag.ch',
  is_catch_all: 0,
  internal: 0,
  active: 1,
  active_int: 1,
  sogo_visible: 1,
  sogo_visible_int: 1,
  sender_allowed: 1,
  created: '2024-03-02 08:00:00',
  modified: null,
};
const DKIM = {
  pubkey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...',
  length: '2048',
  dkim_txt: '"v=DKIM1;k=rsa;t=s;s=email;p=MIIB..." "..."',
  dkim_selector: 'dkim',
  privkey: 'c2VjcmV0',
};
const ok = (key: string, ...args: unknown[]) => ({
  type: 'success',
  log: ['mailbox', 'x'],
  msg: [key, ...args],
});
const danger = (key: string, ...args: unknown[]) => ({
  type: 'danger',
  log: ['mailbox', 'x', { password: '*' }],
  msg: args.length ? [key, ...args] : key,
});
const done = { type: 'success', msg: 'Task completed' };
const routeNotFound: Answer = { status: 404, body: { type: 'error', msg: 'route not found' } };

type Raw = Record<string, unknown>;

/** Mailcow answers an empty list as {}. */
const list = (items: Raw[]): unknown => (items.length > 0 ? items : {});
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The simulated instance. Domains, mailboxes, aliases and DKIM keys as Mailcow returns them. */
class MailcowMock {
  domains = new Map<string, Raw>();
  mailboxes = new Map<string, Raw>();
  aliases = new Map<number, Raw>();
  dkim = new Map<string, Raw>();
  /** Last password set per mailbox (Mailcow hashes it; the test only checks it arrived). */
  passwords = new Map<string, string>();
  policy: unknown = { length: '8', chars: '1', special_chars: '0', lowerupper: '1', numbers: '0' };
  vmail: Answer = {
    body: { type: 'info', disk: '/dev/sda1', used: '11G', total: '41G', used_percent: '28%' },
  };
  nextAliasId = 100;
  /** The SOGo restart of a domain creation fails (warning domain_added_sogo_failed). */
  sogoFails = false;
  /** Answers instead of the simulation when it returns something. */
  override?: (req: Recorded) => Answer | undefined;

  constructor() {
    this.domains.set('muster-ag.ch', structuredClone(DOMAIN));
    this.mailboxes.set('anna@muster-ag.ch', structuredClone(MAILBOX));
    this.aliases.set(12, structuredClone(ALIAS));
    this.dkim.set('muster-ag.ch', structuredClone(DKIM));
  }

  /** An empty domain as add/domain would create it. */
  addDomain(name: string, extra: Raw = {}) {
    this.domains.set(name, {
      ...structuredClone(DOMAIN),
      domain_name: name,
      domain_h_name: name,
      description: name,
      mboxes_in_domain: 0,
      aliases_in_domain: 0,
      quota_used_in_domain: '0',
      bytes_total: 0,
      msgs_total: 0,
      rl: false,
      ...extra,
    });
  }

  handle(req: Recorded): Answer {
    const custom = this.override?.(req);
    if (custom) return custom;
    const key = req.headers['x-api-key'];
    if (key !== KEY && key !== RO_KEY)
      return { status: 401, body: { type: 'error', msg: 'authentication failed' } };
    const m = /^\/api\/v1\/(get|add|edit|delete)\/(.+)$/.exec(req.path);
    if (!m) return routeNotFound;
    const [, action, rest] = m as unknown as [string, string, string];
    const segments = rest.split('/');
    if (action === 'get') {
      if (req.method !== 'GET')
        return { status: 405, body: { type: 'error', msg: 'only GET method is allowed' } };
      return this.get(segments);
    }
    if (req.method !== 'POST')
      return { status: 405, body: { type: 'error', msg: 'only POST method is allowed' } };
    if (key === RO_KEY) return { status: 403, body: { type: 'error', msg: 'API read/write access denied' } };
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
      return { body: { type: 'error', msg: 'Cannot find attributes in post data' } };
    }
    if (typeof req.body === 'string' || req.body === undefined) {
      return { status: 400, body: { type: 'error', msg: "Request body doesn't contain valid json!" } };
    }
    if (segments.length !== 1) return routeNotFound;
    const category = segments[0]!;
    if (action === 'add') return this.add(category, req.body as Raw);
    if (action === 'edit') return this.edit(category, req.body as Raw);
    return this.remove(category, req.body);
  }

  private get([category, a, b]: string[]): Answer {
    if (category === 'status' && a === 'version') return { body: { version: '2026-09' } };
    if (category === 'status' && a === 'vmail') return this.vmail;
    if (category === 'passwordpolicy') return { body: this.policy };
    if (category === 'domain' && a === 'all') return { body: list([...this.domains.values()]) };
    if (category === 'domain' && a) return { body: this.domains.get(a) ?? {} };
    if (category === 'mailbox' && a === 'all' && b) {
      const domains = b.split(',');
      return { body: list([...this.mailboxes.values()].filter((x) => domains.includes(String(x.domain)))) };
    }
    if (category === 'mailbox' && a) return { body: this.mailboxes.get(a) ?? {} };
    if (category === 'alias' && a === 'all' && b) {
      return { body: list([...this.aliases.values()].filter((x) => x.domain === b)) };
    }
    if (category === 'alias' && a) {
      const alias = this.aliases.get(Number(a)) ?? [...this.aliases.values()].find((x) => x.address === a);
      return { body: alias ?? {} };
    }
    if (category === 'dkim' && a) return { body: this.dkim.get(a) ?? {} };
    return routeNotFound;
  }

  private add(category: string, b: Raw): Answer {
    if (category === 'domain') {
      const d = String(b.domain);
      if (this.domains.has(d)) return { body: [danger('domain_exists', d)] };
      this.addDomain(d, {
        description: b.description,
        active: Number(b.active),
        max_num_mboxes_for_domain: Number(b.mailboxes),
        max_num_aliases_for_domain: Number(b.aliases),
        max_quota_for_domain: Number(b.quota) * MiB,
        def_quota_for_mbox: Number(b.defquota) * MiB,
        max_quota_for_mbox: Number(b.maxquota) * MiB,
        rl: Number(b.rl_value) > 0 ? { value: String(b.rl_value), frame: b.rl_frame } : false,
        created: '2026-10-10 12:00:00',
        modified: null,
      });
      const entries: unknown[] = [ok('rl_saved', d)];
      if (this.dkim.has(d)) entries.push(ok('domain_add_dkim_available'));
      else {
        this.dkim.set(d, { ...DKIM, pubkey: `PUB-${d}`, length: b.key_size, dkim_selector: b.dkim_selector });
        entries.push(ok('dkim_added', d));
      }
      if (b.restart_sogo === '1' && this.sogoFails) {
        entries.push({ type: 'warning', log: [], msg: 'domain_added_sogo_failed' });
      }
      entries.push(ok('domain_added', d));
      return { body: entries };
    }
    if (category === 'mailbox') {
      const d = String(b.domain);
      const address = `${String(b.local_part)}@${d}`;
      const domain = this.domains.get(d);
      if (this.mailboxes.has(address)) return { body: [danger('object_exists', address)] };
      if (!domain) return { body: [danger('domain_not_found', d)] };
      if (b.password !== b.password2) return { body: [danger('password_mismatch')] };
      const count = Number(domain.mboxes_in_domain);
      const max = Number(domain.max_num_mboxes_for_domain);
      if (count >= max) return { body: [danger('max_mailbox_exceeded', count, max)] };
      this.mailboxes.set(address, {
        ...structuredClone(MAILBOX),
        username: address,
        local_part: b.local_part,
        domain: d,
        name: b.name,
        quota: Number(b.quota) * MiB,
        quota_used: 0,
        messages: 0,
        last_imap_login: 0,
        last_smtp_login: 0,
        created: '2026-10-10 12:00:00',
      });
      this.passwords.set(address, String(b.password));
      domain.mboxes_in_domain = count + 1;
      return { body: [ok('mailbox_added', address)] };
    }
    if (category === 'alias') {
      const address = String(b.address);
      const goto = String(b.goto ?? '');
      // Mailcow skips an alias whose address is one of its targets and says nothing.
      if (goto.split(',').includes(address)) return { body: done };
      const d = address.slice(address.indexOf('@') + 1);
      if (!this.domains.has(d)) return { body: [danger('domain_not_found', d)] };
      const id = this.nextAliasId++;
      this.aliases.set(id, {
        ...structuredClone(ALIAS),
        id,
        domain: d,
        address,
        goto,
        active: Number(b.active),
        is_catch_all: address.startsWith('@') ? 1 : 0,
        created: '2026-10-10 12:00:00',
      });
      return { body: [ok('alias_added', address, String(id))] };
    }
    if (category === 'dkim') {
      const d = String(b.domains);
      if (this.dkim.has(d)) return { body: [danger('dkim_domain_or_sel_invalid', d)] };
      this.dkim.set(d, { ...DKIM, pubkey: `PUB-${d}`, length: b.key_size, dkim_selector: b.dkim_selector });
      return { body: [ok('dkim_added', d)] };
    }
    return routeNotFound;
  }

  private edit(category: string, b: Raw): Answer {
    const items = Array.isArray(b.items) ? b.items.map(String) : [];
    const attr = isObject(b.attr) ? b.attr : {};
    if (category === 'rl-domain') {
      if (!['s', 'm', 'h', 'd'].includes(String(attr.rl_frame))) return { body: [danger('rl_timeframe')] };
      if (items.length === 0) return { body: done };
      const entries: unknown[] = [];
      for (const d of items) {
        const domain = this.domains.get(d);
        if (!domain) return { body: [danger('access_denied')] };
        domain.rl =
          Number(attr.rl_value) > 0 ? { value: String(attr.rl_value), frame: attr.rl_frame } : false;
        entries.push(ok('rl_saved', d));
      }
      return { body: entries };
    }
    if (category === 'domain') {
      const fields: Record<string, [string, number]> = {
        mailboxes: ['max_num_mboxes_for_domain', 1],
        aliases: ['max_num_aliases_for_domain', 1],
        quota: ['max_quota_for_domain', MiB],
        defquota: ['def_quota_for_mbox', MiB],
        maxquota: ['max_quota_for_mbox', MiB],
        active: ['active', 1],
      };
      for (const d of items) {
        const domain = this.domains.get(d);
        if (!domain) return { body: [danger('domain_invalid')] };
        for (const [field, value] of Object.entries(attr)) {
          const target = fields[field];
          if (target) domain[target[0]] = Number(value) * target[1];
        }
      }
      return { body: items.map((d) => ok('domain_modified', d)) };
    }
    if (category === 'mailbox') {
      for (const address of items) {
        const mailbox = this.mailboxes.get(address);
        if (!mailbox) return { body: [danger('access_denied')] };
        // As Mailcow: only mailboxes of its own authsource get the password, yet all report success.
        if (attr.password !== undefined && mailbox.authsource === 'mailcow') {
          this.passwords.set(address, String(attr.password));
        }
        if (attr.name) mailbox.name = attr.name;
        if (attr.quota !== undefined) mailbox.quota = Number(attr.quota) * MiB;
        if (attr.active !== undefined) mailbox.active = Number(attr.active);
      }
      return { body: items.map((a) => ok('mailbox_modified', a)) };
    }
    if (category === 'alias') {
      const entries: unknown[] = [];
      for (const id of items) {
        const alias = this.aliases.get(Number(id));
        if (!alias) return { body: [danger('alias_invalid', id)] };
        // As Mailcow: without goto the stored one is checked again. A special target survives
        // only with its flag (FILTER_VALIDATE_EMAIL refuses null@localhost), and without a
        // valid target nothing is saved, though Mailcow still reports alias_modified.
        let goto: string;
        if (String(attr.goto_null) === '1') goto = 'null@localhost';
        else if (String(attr.goto_spam) === '1') goto = 'spam@localhost';
        else if (String(attr.goto_ham) === '1') goto = 'ham@localhost';
        else {
          const valid: string[] = [];
          for (const target of String(attr.goto || alias.goto).split(/[ ,;\n]/)) {
            if (!target.trim()) continue;
            if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(target.trim())) valid.push(target.trim());
            else entries.push(danger('goto_invalid', target.trim()));
          }
          goto = [...new Set(valid)].join(',');
        }
        if (goto) {
          alias.goto = goto;
          if (attr.active !== undefined) alias.active = Number(attr.active);
        }
        entries.push(ok('alias_modified', id));
      }
      return { body: entries };
    }
    return routeNotFound;
  }

  private remove(category: string, body: unknown): Answer {
    // Mailcow reads the whole body as the item list; an object makes it iterate the values.
    if (!Array.isArray(body)) return { body: [danger('access_denied')] };
    const items = body.map(String);
    const entries: unknown[] = [];
    for (const item of items) {
      if (category === 'domain') {
        const domain = this.domains.get(item);
        if (domain && Number(domain.mboxes_in_domain) > 0)
          return { body: [danger('domain_not_empty', item)] };
        this.domains.delete(item);
        for (const [id, alias] of this.aliases) if (alias.domain === item) this.aliases.delete(id);
        entries.push(ok('domain_removed', item));
      } else if (category === 'mailbox') {
        const mailbox = this.mailboxes.get(item);
        if (!mailbox) return { body: [danger('access_denied')] };
        this.mailboxes.delete(item);
        const domain = this.domains.get(String(mailbox.domain));
        if (domain) domain.mboxes_in_domain = Number(domain.mboxes_in_domain) - 1;
        entries.push(ok('mailbox_removed', item));
      } else if (category === 'alias') {
        if (!this.aliases.delete(Number(item))) return { body: [danger('access_denied')] };
        entries.push(ok('alias_removed', item));
      } else if (category === 'dkim') {
        this.dkim.delete(item);
        entries.push(ok('dkim_removed', item));
      } else return routeNotFound;
    }
    return { body: entries };
  }
}

let mc: MailcowMock;
let server: Awaited<ReturnType<typeof startMock>>;

beforeAll(async () => {
  server = await startMock((req) => mc.handle(req));
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  mc = new MailcowMock();
  server.requests.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const config = (extra: Partial<MailcowConfig> = {}): MailcowConfig => ({
  baseUrl: server.url,
  apiKey: KEY,
  ...extra,
});
const adapter = (extra: Partial<MailcowConfig> = {}) => new MailcowAdapter(config(extra));

const sent = (method: string, path?: string) =>
  server.requests.filter((r) => r.method === method && (path === undefined || r.path === path));
const posts = () => sent('POST');

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected an error');
}

const LIMITS = {
  maxMailboxes: 10,
  maxAliases: 400,
  quotaMb: 20_480,
  defaultMailboxQuotaMb: 3072,
  maxMailboxQuotaMb: 10_240,
  rateLimit: null,
};
const newDomain = (extra: Partial<MailDomainInput> = {}): MailDomainInput => ({
  domain: 'kunde.ch',
  description: null,
  limits: { ...LIMITS },
  dkim: { selector: 'dkim', keySize: 2048 },
  restartSogo: false,
  ...extra,
});

// ---------------------------------------------------------------------------

describe('Mailcow parsing', () => {
  it('reads domains with numbers and numeric strings alike', () => {
    const domain = parseDomain(DOMAIN)!;
    expect(domain).toEqual({
      externalId: 'muster-ag.ch',
      info: {
        name: 'muster-ag.ch',
        displayName: 'muster-ag.ch',
        description: 'Muster AG',
        active: true,
        relay: false,
        limits: {
          maxMailboxes: 10,
          maxAliases: 50,
          quotaBytes: 21474836480,
          defaultMailboxQuotaBytes: 2147483648,
          maxMailboxQuotaBytes: 10737418240,
          rateLimit: { value: 500, frame: 'h' },
        },
        usage: {
          mailboxes: 3,
          aliases: 3,
          allocatedBytes: 9663676416,
          usedBytes: 4415226675,
          messages: 20113,
        },
        createdAt: '2024-03-01T10:15:00.000Z',
        modifiedAt: '2026-09-30T08:00:00.000Z',
      },
    });

    const idn = parseDomain(DOMAIN_STRINGS)!;
    expect(idn.externalId).toBe('xn--mller-kva.ch');
    expect(idn.info.displayName).toBe('müller.ch');
    expect(idn.info.active).toBe(true);
    expect(idn.info.limits.maxMailboxes).toBe(5);
    expect(idn.info.limits.quotaBytes).toBe(5368709120);
    expect(idn.info.limits.rateLimit).toBeNull();
    expect(idn.info.usage).toEqual({
      mailboxes: 0,
      aliases: 3,
      allocatedBytes: 0,
      usedBytes: 0,
      messages: 0,
    });

    expect(parseDomain({ ...DOMAIN, backupmx: '1' })!.info.relay).toBe(true);
    expect(parseDomain({ ...DOMAIN, relay_all_recipients: 1 })!.info.relay).toBe(true);
    expect(parseDomain({ ...DOMAIN, active: '0' })!.info.active).toBe(false);
    expect(parseDomain({ ...DOMAIN, rl: { value: '0', frame: 'h' } })!.info.limits.rateLimit).toBeNull();
    expect(parseDomain({ ...DOMAIN, rl: { value: '10', frame: 'y' } })!.info.limits.rateLimit).toBeNull();
    const { msgs_total: _m, bytes_total: _b, ...withoutUsage } = DOMAIN;
    expect(parseDomain(withoutUsage)!.info.usage.messages).toBe(0);
    expect(parseDomain({ ...DOMAIN, modified: null })!.info.modifiedAt).toBeNull();
    expect(parseDomain({})).toBeNull();
    expect(parseDomain([])).toBeNull();
  });

  it('treats {} as an empty list and as "not found"', () => {
    expect(asList({})).toEqual([]);
    expect(asList('<html>')).toEqual([]);
    expect(asList([DOMAIN, 'x', null, 3, [1], { a: 1 }])).toEqual([DOMAIN, { a: 1 }]);
    expect(isEmptyObject({})).toBe(true);
    expect(isEmptyObject([])).toBe(false);
    expect(isEmptyObject({ a: 1 })).toBe(false);
    expect(isEmptyObject(null)).toBe(false);
  });

  it('reads mailboxes: tri-state, unlimited quota, latest login', () => {
    const anna = parseMailbox(MAILBOX)!;
    expect(anna).toEqual({
      address: 'anna@muster-ag.ch',
      localPart: 'anna',
      name: 'Anna Muster',
      state: 'active',
      quotaBytes: 5368709120,
      usedBytes: 1932735283,
      messages: 12840,
      lastLoginAt: new Date(1791530000 * 1000).toISOString(),
      createdAt: '2024-03-01T10:20:00.000Z',
      modifiedAt: null,
    });
    for (const [active, state] of [
      [1, 'active'],
      ['1', 'active'],
      [2, 'login_disabled'],
      ['2', 'login_disabled'],
      [0, 'inactive'],
      ['0', 'inactive'],
    ] as const) {
      expect(parseMailbox({ ...MAILBOX, active })!.state).toBe(state);
    }
    const unlimited = parseMailbox({ ...MAILBOX, quota: 0, percent_in_use: '- ' })!;
    expect(unlimited.quotaBytes).toBe(0);
    const sso = parseMailbox({ ...MAILBOX, last_sso_login: '1791540000' })!;
    expect(sso.lastLoginAt).toBe(new Date(1791540000 * 1000).toISOString());
    const never = parseMailbox({
      ...MAILBOX,
      last_imap_login: 0,
      last_smtp_login: '0',
      last_pop3_login: 0,
      last_sso_login: 0,
    })!;
    expect(never.lastLoginAt).toBeNull();
    const { local_part: _l, ...noLocalPart } = MAILBOX;
    expect(parseMailbox({ ...noLocalPart, name: '' })).toMatchObject({ localPart: 'anna', name: null });
    expect(parseMailbox({})).toBeNull();
  });

  it('reads aliases: targets, special targets, catch-all', () => {
    expect(parseAlias({ ...ALIAS, goto: ' Anna@Muster-AG.ch , info@muster-ag.ch,, ' })).toEqual({
      id: '12',
      address: 'team@muster-ag.ch',
      catchAll: false,
      targets: ['anna@muster-ag.ch', 'info@muster-ag.ch'],
      special: null,
      active: true,
      createdAt: '2024-03-02T08:00:00.000Z',
      modifiedAt: null,
    });
    const discard = parseAlias({ ...ALIAS, address: 'noreply@muster-ag.ch', goto: 'null@localhost' })!;
    expect(discard.special).toBe('discard');
    expect(discard.targets).toEqual([]);
    expect(parseAlias({ ...ALIAS, goto: 'spam@localhost' })!.special).toBe('spam');
    expect(parseAlias({ ...ALIAS, goto: 'ham@localhost' })!.special).toBe('ham');
    const catchAll = parseAlias({ ...ALIAS, address: '@kunde.ch', is_catch_all: 0 })!;
    expect(catchAll.catchAll).toBe(true);
    expect(parseAlias({ ...ALIAS, is_catch_all: '1' })!.catchAll).toBe(true);
    expect(parseAlias({ ...ALIAS, active: '0' })!.active).toBe(false);
    expect(parseAlias({ ...ALIAS, id: '7' })!.id).toBe('7');
    expect(parseAlias({})).toBeNull();
    expect(parseAlias({ ...ALIAS, address: '' })).toBeNull();
  });

  it('builds the DKIM record from the public key, never from the private key', () => {
    const key = parseDkim(DKIM)!;
    expect(key).toEqual({
      selector: 'dkim',
      publicKey: DKIM.pubkey,
      keyLength: '2048',
      txt: `v=DKIM1;k=rsa;t=s;s=email;p=${DKIM.pubkey}`,
    });
    expect(key.txt).not.toContain('"');
    expect(JSON.stringify(key)).not.toContain(DKIM.privkey);
    expect(parseDkim({})).toBeNull();
    expect(parseDkim({ ...DKIM, dkim_selector: '' })).toBeNull();
  });

  it('splits write answers and maps failures to status codes', () => {
    const success = parseWriteResult([ok('rl_saved', 'kunde.ch'), ok('domain_added', 'kunde.ch')], 200);
    expect(success).toEqual({
      ok: true,
      errors: [],
      warnings: [],
      successes: [
        { key: 'rl_saved', args: ['kunde.ch'] },
        { key: 'domain_added', args: ['kunde.ch'] },
      ],
    });
    expect(parseWriteResult(done, 200).ok).toBe(true);
    expect(parseWriteResult([ok('domain_added', 'kunde.ch')], 500).ok).toBe(false);

    const fail = (body: unknown, action = 'create mail domain kunde.ch') => {
      const result = parseWriteResult(body, 200);
      expect(result.ok).toBe(false);
      return mailcowError(action, result.errors, result.successes);
    };
    const exists = fail([danger('domain_exists', 'kunde.ch')]);
    expect(exists.statusCode).toBe(409);
    expect(exists.message).toBe('create mail domain kunde.ch failed: Domain kunde.ch already exists');
    expect(exists.details).toEqual({ keys: ['domain_exists'] });
    const policy = fail([danger('password_complexity')], 'create mailbox anna@kunde.ch');
    expect(policy.statusCode).toBe(400);
    expect(policy.message).toBe('create mailbox anna@kunde.ch failed: Password does not meet the policy');
    const missing = fail([danger('domain_not_found', 'kunde.ch')], 'create mailbox anna@kunde.ch');
    expect(missing).toBeInstanceOf(ProviderError);
    expect(missing.statusCode).toBe(404);
    expect(missing.message).toBe('Mailcow: create mailbox anna@kunde.ch failed: Domain kunde.ch not found');
    const denied = fail([danger('access_denied')], 'change mailbox x@kunde.ch');
    expect(denied).toBeInstanceOf(ProviderError);
    expect(denied.statusCode).toBe(502);
    expect(denied.message).toBe(
      'Mailcow: change mailbox x@kunde.ch failed: Access denied or invalid form data',
    );
    const unknown = fail([danger('some_key', 'a', 'b')]);
    expect(unknown.statusCode).toBe(502);
    expect(unknown.message).toContain('failed: some_key (a, b)');
    // A 409 and a 400 together are neither: Mailcow's answer is passed on as 502.
    expect(fail([danger('domain_exists', 'kunde.ch'), danger('domain_invalid')]).statusCode).toBe(502);

    const noAttributes = fail({ type: 'error', msg: 'Cannot find attributes in post data' });
    expect(noAttributes.statusCode).toBe(502);
    expect(noAttributes.message).toBe(
      'Mailcow: create mail domain kunde.ch failed: Cannot find attributes in post data',
    );

    const sogo = parseWriteResult(
      [ok('rl_saved', 'kunde.ch'), { type: 'warning', msg: 'domain_added_sogo_failed' }, ok('domain_added')],
      200,
    );
    expect(sogo.ok).toBe(true);
    expect(sogo.warnings).toEqual([
      'Added domain but failed to restart SOGo, please check your server logs.',
    ]);
    const garbage = parseWriteResult(
      [{ type: 'warning', msg: 'Could not move mail storage to garbage collector: rename failed' }, ok('x')],
      200,
    );
    expect(garbage.warnings).toEqual(['Could not move mail storage to garbage collector: rename failed']);

    const mixed = fail(
      [danger('goto_invalid', 'bad@'), ok('alias_added', 'team@kunde.ch', '14')],
      'create alias team@kunde.ch',
    );
    expect(mixed.statusCode).toBe(400);
    expect(mixed.message).toBe(
      'create alias team@kunde.ch failed: Goto address bad@ is invalid. Mailcow saved the rest of the change',
    );
    const sentence = fail([{ type: 'danger', msg: 'SQLSTATE[23000]: Integrity constraint violation' }]);
    expect(sentence.message).toContain('failed: SQLSTATE[23000]: Integrity constraint violation');
    expect(fail([danger('max_mailbox_exceeded', 10, 10)]).message).toContain(
      'Max. mailboxes exceeded (10 of 10)',
    );

    expect(entriesOf('<html>')).toEqual([]);
    expect(entriesOf([{ msg: 'no type' }, ok('x')])).toHaveLength(1);
  });

  it('knows the text of every documented message key', () => {
    const table: [string, string[], string][] = [
      ['access_denied', [], 'Access denied or invalid form data'],
      ['domain_exists', ['kunde.ch'], 'Domain kunde.ch already exists'],
      ['domain_invalid', [], 'Domain name is empty or invalid'],
      ['domain_not_found', ['kunde.ch'], 'Domain kunde.ch not found'],
      ['domain_not_empty', ['kunde.ch'], 'Cannot remove non-empty domain kunde.ch'],
      ['domain_cannot_match_hostname', [], 'Domain cannot match hostname'],
      ['mailbox_invalid', [], 'Mailbox name is invalid'],
      ['object_exists', ['anna@kunde.ch'], 'Object anna@kunde.ch already exists'],
      ['is_alias', ['anna@kunde.ch'], 'anna@kunde.ch is already known as an alias address'],
      [
        'is_alias_or_mailbox',
        ['team@kunde.ch'],
        'team@kunde.ch is already known as an alias, a mailbox or an alias address expanded from an alias domain.',
      ],
      [
        'is_spam_alias',
        ['x@kunde.ch'],
        'x@kunde.ch is already known as a temporary alias address (spam alias address)',
      ],
      ['max_mailbox_exceeded', ['10', '10'], 'Max. mailboxes exceeded (10 of 10)'],
      ['mailbox_quota_exceeded', ['10240'], 'Quota exceeds the domain limit (max. 10240 MiB)'],
      ['mailbox_quota_left_exceeded', ['512'], 'Not enough space left (space left: 512 MiB)'],
      ['mailbox_quota_exceeds_domain_quota', [], 'Max. quota exceeds domain quota limit'],
      ['mailbox_defquota_exceeds_mailbox_maxquota', [], 'Default quota exceeds max quota limit'],
      ['defquota_empty', [], 'Default quota per mailbox must not be 0.'],
      ['maxquota_empty', [], 'Max. quota per mailbox must not be 0.'],
      ['max_quota_in_use', ['4096'], 'Mailbox quota must be greater or equal to 4096 MiB'],
      ['domain_quota_m_in_use', ['9216'], 'Domain quota must be greater or equal to 9216 MiB'],
      ['mailboxes_in_use', ['3'], 'Max. mailboxes must be greater or equal to 3'],
      ['aliases_in_use', ['3'], 'Max. aliases must be greater or equal to 3'],
      ['max_alias_exceeded', [], 'Max. aliases exceeded'],
      ['alias_empty', [], 'Alias address must not be empty'],
      ['goto_empty', [], 'An alias address must contain at least one valid goto address'],
      ['goto_invalid', ['bad@'], 'Goto address bad@ is invalid'],
      ['alias_invalid', ['12'], 'Alias address 12 is invalid'],
      ['alias_goto_identical', [], 'Alias and goto address must not be identical'],
      ['external_goto_denied', ['a@example.org'], 'External goto address a@example.org is not allowed'],
      ['password_complexity', [], 'Password does not meet the policy'],
      ['password_mismatch', [], 'Confirmation password does not match'],
      ['unlimited_quota_acl', [], 'Unlimited quota prohibited by ACL'],
      ['rl_timeframe', [], 'Rate limit time frame is incorrect'],
      ['dkim_domain_or_sel_invalid', ['kunde.ch'], 'DKIM domain or selector invalid: kunde.ch'],
      ['username_invalid', ['root'], 'Username root cannot be used'],
      ['comment_too_long', [], 'Comment too long, max 160 chars allowed'],
      ['redis_error', ['timeout'], 'Redis error: timeout'],
      ['object_is_not_numeric', ['abc'], 'Value abc is not numeric'],
      [
        'domain_added_sogo_failed',
        [],
        'Added domain but failed to restart SOGo, please check your server logs.',
      ],
      ['domain_add_dkim_available', [], 'A DKIM key did already exist'],
      ['alias_added', ['team@kunde.ch', '14'], 'Alias address team@kunde.ch (14) has been added'],
    ];
    for (const [key, args, text] of table) expect(mailcowMessage(key, args)).toBe(text);
    expect(mailcowMessage('some_key', ['a', 'b'])).toBe('some_key (a, b)');
    expect(mailcowMessage('some_key', [])).toBe('some_key');
    expect(mailcowMessage('Could not move maildir to garbage collector: x', [])).toBe(
      'Could not move maildir to garbage collector: x',
    );
    // Missing arguments leave nothing behind instead of "%s".
    expect(mailcowMessage('domain_exists', [])).toBe('Domain  already exists');
  });

  it('blanks secrets in answers at any depth and keeps the public key', () => {
    const redacted = redactMailcow({
      password: 'a',
      password2: 'b',
      privkey: 'c2VjcmV0',
      pubkey: 'MIIB',
      client_secret: 's',
      api_key: 'k',
      empty_password: '',
      nested: [{ attr: { password: 'x', name: 'Anna' }, private_key: 'p', 'api-key': 'q' }],
    });
    expect(redacted).toEqual({
      password: '••••••',
      password2: '••••••',
      privkey: '••••••',
      pubkey: 'MIIB',
      client_secret: '••••••',
      api_key: '••••••',
      empty_password: '',
      nested: [{ attr: { password: '••••••', name: 'Anna' }, private_key: '••••••', 'api-key': 'q' }],
    });
    expect(redactMailcow([{ apikey: 'z' }, 'text', 3])).toEqual([{ apikey: '••••••' }, 'text', 3]);
  });

  it('reads values and checks input defensively', () => {
    expect([true, 1, '1'].map(bool)).toEqual([true, true, true]);
    expect([false, 0, '0', '', null, undefined, 2, 'true'].map(bool)).toEqual(Array(8).fill(false));
    expect(bytesFromMib(20_480)).toBe(21474836480);
    expect(mibFromBytes(21474836480)).toBe(20_480);
    expect(mibFromBytes(MiB + 5)).toBe(1);
    expect(parseMailcowDate('2024-03-01 10:15:00')).toBe('2024-03-01T10:15:00.000Z');
    expect(parseMailcowDate('0000-00-00 00:00:00')).toBeNull();
    expect(parseMailcowDate('2024-02-31 00:00:00')).toBeNull();
    expect(parseMailcowDate('')).toBeNull();
    expect(parseMailcowDate(null)).toBeNull();
    expect(unixToIso(1791530000)).toBe(new Date(1791530000 * 1000).toISOString());
    expect(unixToIso('0')).toBeNull();
    expect(unixToIso(null)).toBeNull();
    expect(
      parsePasswordPolicy({ length: '8', chars: '1', special_chars: '0', lowerupper: '1', numbers: '0' }),
    ).toEqual({ minLength: 8, letters: true, mixedCase: true, digits: false, specialChars: false });
    expect(parseVmail(mc.vmail.body)).toEqual({ used: '11G', total: '41G', percent: '28%' });
    expect(parseVmail(null)).toEqual({ used: null, total: null, percent: null });

    expect(assertAddress('Team@Müller.CH')).toEqual({ localPart: 'team', domain: 'xn--mller-kva.ch' });
    expect(assertAddress('@kunde.ch')).toEqual({ localPart: '', domain: 'kunde.ch' });
    for (const bad of [
      'anna',
      'a+b@kunde.ch',
      'a/b@kunde.ch',
      'a?b@kunde.ch',
      'a%2f@kunde.ch',
      'a@localhost',
    ]) {
      expect(() => assertAddress(bad)).toThrow(AppError);
    }
    expect(assertTargets(['Anna@Kunde.ch', 'anna@kunde.ch', 'x+tag@example.org'], 'team@kunde.ch')).toEqual([
      'anna@kunde.ch',
      'x+tag@example.org',
    ]);
    expect(() => assertTargets([], 'team@kunde.ch')).toThrow('1 to 50 target addresses');
    expect(() => assertTargets(['team@kunde.ch'], 'team@kunde.ch')).toThrow('cannot forward to itself');
    expect(() => assertTargets(['no-at-sign'], 'team@kunde.ch')).toThrow('Invalid target address');
    expect(() => assertTargets(['a@localhost'], 'team@kunde.ch')).toThrow('Invalid target address');
    expect(() => assertTargets(Array(51).fill('a@kunde.ch'), 'team@kunde.ch')).toThrow(AppError);
    expect(() => assertLimits({ ...LIMITS, maxAliases: 0 })).toThrow('Max. aliases');
    expect(() => assertLimits({ ...LIMITS, quotaMb: 1.5 })).toThrow('whole number of MiB');
    expect(() => assertLimits({ ...LIMITS, defaultMailboxQuotaMb: 20_000 })).toThrow('default mailbox size');
    expect(() => assertLimits({ ...LIMITS, maxMailboxQuotaMb: 30_000 })).toThrow('storage of the domain');
    expect(() => assertLimits({ ...LIMITS, rateLimit: { value: 0, frame: 'h' } })).toThrow('rate limit');
    expect(() => assertLimits({ rateLimit: { value: 5, frame: 'w' as 'h' } })).toThrow('frame');
    expect(() => assertLimits({ ...LIMITS, rateLimit: { value: 500, frame: 'd' } })).not.toThrow();
    const err = (() => {
      try {
        assertAliasId('12a');
      } catch (e) {
        return e as ProviderError;
      }
    })();
    expect(err).toBeInstanceOf(ProviderError);
    expect(err!.statusCode).toBe(404);
  });
});

describe('Mailcow client', () => {
  it('sends the API key, JSON headers and the JSON body, nothing else', async () => {
    const client = new MailcowClient(config());
    await client.get('/api/v1/get/domain/all', 'list mail domains');
    await client.write(
      '/api/v1/edit/domain',
      { items: ['muster-ag.ch'], attr: { mailboxes: '20' } },
      { action: 'change mail domain muster-ag.ch' },
    );
    const [get, post] = server.requests;
    expect(get!.headers['x-api-key']).toBe(KEY);
    expect(get!.headers.accept).toBe('application/json');
    expect(get!.headers['content-type']).toBeUndefined();
    expect(post!.method).toBe('POST');
    expect(post!.headers['x-api-key']).toBe(KEY);
    expect(post!.headers['content-type']).toBe('application/json');
    expect(post!.body).toEqual({ items: ['muster-ag.ch'], attr: { mailboxes: '20' } });
    for (const req of server.requests) {
      expect(req.headers['sec-fetch-dest']).toBeUndefined();
      expect(req.headers.cookie).toBeUndefined();
    }
    expect(mc.domains.get('muster-ag.ch')!.max_num_mboxes_for_domain).toBe(20);
  });

  it('never follows a redirect', async () => {
    const other = await startMock(() => ({ body: [] }));
    try {
      mc.override = () => ({ status: 302, headers: { location: `${other.url}/api/v1/get/domain/all` } });
      const err = await caught(adapter().listMailDomains());
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.statusCode).toBe(502);
      expect(err.message).toBe(
        'Mailcow: list mail domains failed: redirect (HTTP 302). Mailcow redirects, check the base URL (https, no path)',
      );
      expect(other.requests).toHaveLength(0);
      expect(server.requests).toHaveLength(1);
    } finally {
      await other.close();
    }
  });

  it('explains HTTP failures and never shows the API key', async () => {
    const wrongKey = await caught(adapter({ apiKey: 'MC-unknown-key-0123456789' }).listMailDomains());
    expect(wrongKey).toBeInstanceOf(ProviderError);
    expect(wrongKey.statusCode).toBe(502);
    expect(wrongKey.message).toBe(
      "Mailcow: list mail domains failed: authentication failed (HTTP 401). Mailcow does not know this API key (MAILCOW_API_KEY or the provider's key). Repeated failures make Mailcow's netfilter ban the console's IP",
    );
    // Never retried: every 401 counts as a failed login for Mailcow's netfilter.
    expect(server.requests).toHaveLength(1);

    mc.override = () => ({
      status: 401,
      body: { type: 'error', msg: 'api access denied for ip 203.0.113.9' },
    });
    const ip = await caught(adapter().listMailDomains());
    expect(ip.message).toContain(
      "api access denied for ip 203.0.113.9 (HTTP 401). Add 203.0.113.9 to the API key's allow list in Mailcow",
    );
    mc.override = undefined;

    const readOnly = await caught(adapter({ apiKey: RO_KEY }).deleteDkim('muster-ag.ch'));
    expect(readOnly.message).toBe(
      'Mailcow: delete the DKIM key of muster-ag.ch failed: API read/write access denied (HTTP 403). The API key is read-only; the console needs the read-write key',
    );
    expect(mc.dkim.has('muster-ag.ch')).toBe(true);

    mc.override = (req) => (req.path === '/api/v1/get/domain/all' ? routeNotFound : undefined);
    const route = await caught(adapter().listMailDomains());
    expect(route.statusCode).toBe(404);
    expect(route.message).toBe(
      'Mailcow: list mail domains failed: route not found (HTTP 404). This Mailcow version does not know the endpoint; update Mailcow',
    );
    mc.override = undefined;

    const client = new MailcowClient(config());
    const method = await caught(client.write('/api/v1/get/domain/all', {}, { action: 'probe' }));
    expect(method.message).toBe(
      'Mailcow: probe failed: only GET method is allowed (HTTP 405). Wrong HTTP method for this endpoint',
    );

    mc.override = () => ({ status: 502, text: '<html><body><h1>502 Bad Gateway</h1></body></html>' });
    const html = await caught(adapter().listMailDomains());
    expect(html.message).toBe('Mailcow: list mail domains failed: no Mailcow answer (HTTP 502)');

    mc.override = () => ({ status: 500, text: `PHP Fatal error: x-api-key ${KEY} rejected` });
    const fatal = await caught(adapter().listMailDomains());
    expect(fatal.message).toBe(
      'Mailcow: list mail domains failed: PHP Fatal error: x-api-key [redacted] rejected (HTTP 500)',
    );

    mc.override = () => ({ status: 401, body: { type: 'error', msg: `authentication failed for ${KEY}` } });
    const echoed = await caught(adapter().listMailDomains());
    expect(echoed.message).not.toContain(KEY);
    mc.override = () => ({ body: [danger('some_key', KEY)] });
    const echoedWrite = await caught(adapter().deleteDkim('muster-ag.ch'));
    expect(echoedWrite.message).not.toContain(KEY);
    expect(JSON.stringify(echoedWrite.details)).not.toContain(KEY);

    mc.override = () => ({ body: { unexpected: true } });
    const odd = await caught(
      new MailcowClient(config()).write('/api/v1/delete/dkim', ['x.ch'], { action: 'probe' }),
    );
    expect(odd.message).toBe('Mailcow: probe failed: no Mailcow answer, check the base URL (HTTP 200)');
    mc.override = undefined;

    const closed = new MailcowAdapter({ baseUrl: 'http://127.0.0.1:1', apiKey: KEY });
    const network = await caught(closed.listMailDomains());
    expect(network).toBeInstanceOf(ProviderError);
    expect(network.message).toMatch(/^Mailcow: list mail domains failed: /);
    expect(network.message).not.toContain(KEY);
  });

  it('keeps at most 4 requests in flight', async () => {
    let active = 0;
    let peak = 0;
    const slow: Server = createServer((_req, res) => {
      active++;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ version: '2026-09' }));
      }, 40);
    });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = slow.address() as AddressInfo;
      const client = new MailcowClient({ baseUrl: `http://127.0.0.1:${port}`, apiKey: KEY });
      await Promise.all(Array.from({ length: 10 }, () => client.get('/api/v1/get/status/version', 'read')));
      expect(peak).toBe(4);
    } finally {
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });
});

describe('Mailcow connection', () => {
  it('tests reads and write access without changing anything', async () => {
    mc.addDomain('kunde.ch');
    expect(await adapter().testConnection()).toEqual({
      version: '2026-09',
      domains: 2,
      mailHost: '127.0.0.1',
      readWrite: true,
    });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.path).toBe('/api/v1/edit/rl-domain');
    expect(posts()[0]!.body).toEqual({ items: [], attr: { rl_value: '0', rl_frame: 'h' } });
    expect(sent('POST', '/api/v1/edit/domain')).toHaveLength(0);
    expect(mc.domains.get('muster-ag.ch')!.rl).toEqual({ value: '500', frame: 'h' });

    const host = await adapter({ mailHost: ' Mail.Weblion.One ' }).testConnection();
    expect(host.mailHost).toBe('mail.weblion.one');

    const err = await caught(adapter({ apiKey: RO_KEY }).testConnection());
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Mailcow: the API key is read-only; the console needs the read-write key');
  });

  it('describes the instance and ignores a failing disk usage', async () => {
    const overview = await adapter({ mailHost: 'mail.weblion.one' }).overview();
    expect(overview.version).toBe('2026-09');
    expect(overview.nodes).toEqual([]);
    expect(overview.storages).toEqual([]);
    expect(overview.facts).toEqual([
      { label: 'Version', value: '2026-09' },
      { label: 'Mail domains', value: '1' },
      { label: 'Mailboxes', value: '3' },
      { label: 'Storage', value: '11G / 41G (28%)' },
      { label: 'Mail server', value: 'mail.weblion.one' },
      { label: 'Webmail', value: 'https://mail.weblion.one/SOGo/' },
    ]);

    mc.vmail = { status: 500, text: '' };
    const without = await adapter().overview();
    expect(without.facts.map((f) => f.label)).toEqual([
      'Version',
      'Mail domains',
      'Mailboxes',
      'Mail server',
      'Webmail',
    ]);
  });

  it('has no servers and gives the client settings of its mail host', async () => {
    const a = adapter({ mailHost: 'mail.weblion.one' });
    expect(a.type).toBe('mailcow');
    expect(a.capabilities()).toEqual([]);
    expect(a.powerActions()).toEqual([]);
    expect(await a.listServers()).toEqual([]);
    const err = await caught(a.getServer({ externalId: 'x', kind: 'vm', node: null, meta: {} }));
    expect(err.statusCode).toBe(404);
    expect(a.mailClientSettings()).toEqual(mailClientSettings('mail.weblion.one'));
    expect(adapter().mailClientSettings().mailHost).toBe('127.0.0.1');
    expect(server.requests).toHaveLength(0);
  });
});

describe('Mailcow mail domains', () => {
  it('lists domains, {} included, and reads one by its ASCII name', async () => {
    mc.domains.clear();
    expect(await adapter().listMailDomains()).toEqual([]);

    mc.domains.set('xn--mller-kva.ch', structuredClone(DOMAIN_STRINGS));
    mc.domains.set('muster-ag.ch', structuredClone(DOMAIN));
    const domains = await adapter().listMailDomains();
    expect(domains.map((d) => d.externalId)).toEqual(['muster-ag.ch', 'xn--mller-kva.ch']);
    expect(domains[1]!.info.displayName).toBe('müller.ch');

    const idn = await adapter().getMailDomain('Müller.CH');
    expect(idn.externalId).toBe('xn--mller-kva.ch');
    expect(sent('GET').at(-1)!.path).toBe('/api/v1/get/domain/xn--mller-kva.ch');

    const missing = await caught(adapter().getMailDomain('nope.ch'));
    expect(missing).toBeInstanceOf(ProviderError);
    expect(missing.statusCode).toBe(404);
    expect(missing.message).toBe('Mailcow: mail domain nope.ch not found');

    server.requests.length = 0;
    const invalid = await caught(adapter().getMailDomain('a/b.ch'));
    expect(invalid.statusCode).toBe(400);
    expect(server.requests).toHaveLength(0);
  });

  it('creates a domain with every field as a string in MiB, then reads it back', async () => {
    const created = await adapter().createMailDomain(newDomain());
    const [add] = sent('POST', '/api/v1/add/domain');
    expect(add!.body).toEqual({
      domain: 'kunde.ch',
      description: 'kunde.ch',
      active: '1',
      mailboxes: '10',
      aliases: '400',
      quota: '20480',
      defquota: '3072',
      maxquota: '10240',
      backupmx: '0',
      relay_all_recipients: '0',
      relay_unknown_only: '0',
      rl_value: '0',
      rl_frame: 'h',
      key_size: '2048',
      dkim_selector: 'dkim',
      restart_sogo: '0',
    });
    expect(created.warnings).toEqual([]);
    expect(created.domain.externalId).toBe('kunde.ch');
    expect(created.domain.info.limits).toEqual({
      maxMailboxes: 10,
      maxAliases: 400,
      quotaBytes: 20_480 * MiB,
      defaultMailboxQuotaBytes: 3072 * MiB,
      maxMailboxQuotaBytes: 10_240 * MiB,
      rateLimit: null,
    });
    // The read back went to Mailcow after the creation.
    expect(server.requests.at(-1)!.path).toBe('/api/v1/get/domain/kunde.ch');

    await adapter().createMailDomain(
      newDomain({
        domain: 'shop.ch',
        description: ' Muster Shop ',
        restartSogo: true,
        limits: { ...LIMITS, rateLimit: { value: 500, frame: 'h' } },
        dkim: { selector: 'mail2026', keySize: 4096 },
      }),
    );
    const shop = sent('POST', '/api/v1/add/domain').at(-1)!.body as Record<string, unknown>;
    expect(shop).toMatchObject({
      domain: 'shop.ch',
      description: 'Muster Shop',
      rl_value: '500',
      rl_frame: 'h',
      key_size: '4096',
      dkim_selector: 'mail2026',
      restart_sogo: '1',
    });
  });

  it('refuses existing and invalid domains, passes on warnings, sends punycode', async () => {
    const exists = await caught(adapter().createMailDomain(newDomain({ domain: 'muster-ag.ch' })));
    expect(exists.statusCode).toBe(409);
    expect(exists.message).toBe('The mail domain muster-ag.ch exists at Mailcow already');
    expect(posts()).toHaveLength(0);

    // Created by someone else between the read and the add.
    mc.override = (req) =>
      req.path === '/api/v1/add/domain' ? { body: [danger('domain_exists', 'kunde.ch')] } : undefined;
    const race = await caught(adapter().createMailDomain(newDomain()));
    expect(race.statusCode).toBe(409);
    expect(race.message).toBe('create mail domain kunde.ch failed: Domain kunde.ch already exists');
    mc.override = undefined;

    mc.sogoFails = true;
    const sogo = await adapter().createMailDomain(newDomain({ restartSogo: true }));
    expect(sogo.warnings).toEqual([
      'Added domain but failed to restart SOGo, please check your server logs.',
    ]);
    expect(sogo.domain.externalId).toBe('kunde.ch');

    server.requests.length = 0;
    for (const bad of ['a..ch', 'localhost', '1.2.3.4', 'kunde ch']) {
      const err = await caught(adapter().createMailDomain(newDomain({ domain: bad })));
      expect(err.statusCode).toBe(400);
    }
    const order = await caught(
      adapter().createMailDomain(newDomain({ limits: { ...LIMITS, defaultMailboxQuotaMb: 20_000 } })),
    );
    expect(order.statusCode).toBe(400);
    const dkim = await caught(
      adapter().createMailDomain(newDomain({ dkim: { selector: 'dkim', keySize: 1024 } })),
    );
    expect(dkim.statusCode).toBe(400);
    expect(server.requests).toHaveLength(0);

    const ascii = mailDomainAscii('Bäckerei-Müller.ch')!;
    const idn = await adapter().createMailDomain(newDomain({ domain: 'Bäckerei-Müller.ch' }));
    expect(ascii).toMatch(/^xn--/);
    expect((sent('POST', '/api/v1/add/domain').at(-1)!.body as Record<string, unknown>).domain).toBe(ascii);
    expect(sent('GET', `/api/v1/get/domain/${ascii}`)).toHaveLength(2);
    expect(idn.domain.externalId).toBe(ascii);
  });

  it('returns what it asked for when the read back fails after the creation', async () => {
    let added = false;
    mc.override = (req) => {
      if (req.path === '/api/v1/add/domain') added = true;
      else if (added && req.path === '/api/v1/get/domain/xn--mller-kva.ch') return { status: 500, text: '' };
      return undefined;
    };
    const result = await adapter().createMailDomain(
      newDomain({ domain: 'müller.ch', limits: { ...LIMITS, rateLimit: { value: 100, frame: 'm' } } }),
    );
    expect(result.warnings).toEqual([]);
    expect(result.domain).toMatchObject({
      externalId: 'xn--mller-kva.ch',
      info: {
        name: 'xn--mller-kva.ch',
        displayName: 'müller.ch',
        description: 'xn--mller-kva.ch',
        active: true,
        relay: false,
        limits: { quotaBytes: 20_480 * MiB, rateLimit: { value: 100, frame: 'm' } },
        usage: { mailboxes: 0, aliases: 0, allocatedBytes: 0, usedBytes: 0, messages: 0 },
      },
    });
  });

  it('changes only what differs, the rate limit separately', async () => {
    const a = adapter();
    await a.updateMailDomain('muster-ag.ch', { maxMailboxes: 20, maxAliases: 50, quotaMb: 30_720 });
    expect(posts().map((r) => [r.path, r.body])).toEqual([
      ['/api/v1/edit/domain', { items: ['muster-ag.ch'], attr: { mailboxes: '20', quota: '30720' } }],
    ]);

    server.requests.length = 0;
    await a.updateMailDomain('muster-ag.ch', { rateLimit: { value: 100, frame: 'm' } });
    expect(posts().map((r) => [r.path, r.body])).toEqual([
      ['/api/v1/edit/rl-domain', { items: ['muster-ag.ch'], attr: { rl_value: '100', rl_frame: 'm' } }],
    ]);
    expect(mc.domains.get('muster-ag.ch')!.rl).toEqual({ value: '100', frame: 'm' });

    server.requests.length = 0;
    await a.updateMailDomain('muster-ag.ch', { rateLimit: null, active: false, defaultMailboxQuotaMb: 1024 });
    expect(posts().map((r) => [r.path, r.body])).toEqual([
      ['/api/v1/edit/domain', { items: ['muster-ag.ch'], attr: { defquota: '1024', active: '0' } }],
      ['/api/v1/edit/rl-domain', { items: ['muster-ag.ch'], attr: { rl_value: '0', rl_frame: 'h' } }],
    ]);
    expect(mc.domains.get('muster-ag.ch')!.rl).toBe(false);

    server.requests.length = 0;
    await a.updateMailDomain('muster-ag.ch', { maxMailboxes: 20, active: false });
    expect(posts()).toHaveLength(0);
  });

  it('checks merged limits before sending and says what was saved', async () => {
    const order = await caught(adapter().updateMailDomain('muster-ag.ch', { defaultMailboxQuotaMb: 20_000 }));
    expect(order.statusCode).toBe(400);
    expect(order.message).toBe('The default mailbox size must not exceed the maximum mailbox size');
    const storage = await caught(adapter().updateMailDomain('muster-ag.ch', { quotaMb: 5120 }));
    expect(storage.message).toBe('The maximum mailbox size must not exceed the storage of the domain');
    const aliases = await caught(adapter().updateMailDomain('muster-ag.ch', { maxAliases: 0 }));
    expect(aliases.statusCode).toBe(400);
    const missing = await caught(adapter().updateMailDomain('nope.ch', { maxMailboxes: 5 }));
    expect(missing.statusCode).toBe(404);
    expect(posts()).toHaveLength(0);

    mc.override = (req) =>
      req.path === '/api/v1/edit/domain' ? { body: [danger('mailboxes_in_use', 3)] } : undefined;
    const inUse = await caught(adapter().updateMailDomain('muster-ag.ch', { maxMailboxes: 2 }));
    expect(inUse.statusCode).toBe(409);
    expect(inUse.message).toBe(
      'change mail domain muster-ag.ch failed: Max. mailboxes must be greater or equal to 3',
    );

    mc.override = (req) =>
      req.path === '/api/v1/edit/rl-domain' ? { body: [danger('rl_timeframe')] } : undefined;
    const rl = await caught(
      adapter().updateMailDomain('muster-ag.ch', { maxMailboxes: 12, rateLimit: { value: 9, frame: 'h' } }),
    );
    expect(rl.statusCode).toBe(400);
    expect(rl.message).toBe(
      'change the rate limit of muster-ag.ch failed: Rate limit time frame is incorrect. The other limits were saved',
    );
    expect(mc.domains.get('muster-ag.ch')!.max_num_mboxes_for_domain).toBe(12);

    const rlOnly = await caught(
      adapter().updateMailDomain('muster-ag.ch', { rateLimit: { value: 9, frame: 'h' } }),
    );
    expect(rlOnly.message).not.toContain('other limits');
  });

  it('deletes only empty domains, with the bare array as body', async () => {
    const full = await caught(adapter().deleteMailDomain('muster-ag.ch'));
    expect(full.statusCode).toBe(409);
    expect(full.message).toBe('Mailcow only deletes empty domains: 3 mailboxes left');
    expect(posts()).toHaveLength(0);

    mc.addDomain('kunde.ch');
    expect(await adapter().deleteMailDomain('kunde.ch')).toEqual({ warnings: [] });
    expect(sent('POST', '/api/v1/delete/domain')[0]!.body).toEqual(['kunde.ch']);
    expect(mc.domains.has('kunde.ch')).toBe(false);

    mc.addDomain('kunde.ch');
    mc.override = (req) =>
      req.path === '/api/v1/delete/domain'
        ? {
            body: [
              { type: 'warning', msg: 'Could not move mail storage to garbage collector: rename failed' },
              ok('domain_removed', 'kunde.ch'),
            ],
          }
        : undefined;
    expect(await adapter().deleteMailDomain('kunde.ch')).toEqual({
      warnings: ['Could not move mail storage to garbage collector: rename failed'],
    });

    const missing = await caught(adapter().deleteMailDomain('nope.ch'));
    expect(missing.statusCode).toBe(404);
  });
});

describe('Mailcow mailboxes', () => {
  it('lists the mailboxes of one domain, {} included', async () => {
    mc.addDomain('kunde.ch');
    expect(await adapter().listMailboxes('kunde.ch')).toEqual([]);
    expect(sent('GET').at(-1)!.path).toBe('/api/v1/get/mailbox/all/kunde.ch');

    mc.mailboxes.set('ben@muster-ag.ch', {
      ...structuredClone(MAILBOX),
      username: 'ben@muster-ag.ch',
      local_part: 'ben',
    });
    mc.override = (req) =>
      req.path === '/api/v1/get/mailbox/all/muster-ag.ch'
        ? {
            body: [
              ...mc.mailboxes.values(),
              { ...MAILBOX, username: 'eve@other.ch', domain: 'other.ch' },
              'garbage',
            ],
          }
        : undefined;
    const list = await adapter().listMailboxes('muster-ag.ch');
    expect(list.map((m) => m.address)).toEqual(['anna@muster-ag.ch', 'ben@muster-ag.ch']);
  });

  it('creates a mailbox with the password twice and reads it back', async () => {
    const mailbox = await adapter().createMailbox({
      localPart: 'Ben',
      domain: 'muster-ag.ch',
      name: 'Ben Beispiel',
      quotaMb: 2048,
      password: PW,
    });
    expect(sent('POST', '/api/v1/add/mailbox')[0]!.body).toEqual({
      local_part: 'ben',
      domain: 'muster-ag.ch',
      name: 'Ben Beispiel',
      quota: '2048',
      password: PW,
      password2: PW,
      active: '1',
      force_pw_update: '0',
      authsource: 'mailcow',
    });
    expect(mailbox).toMatchObject({
      address: 'ben@muster-ag.ch',
      localPart: 'ben',
      name: 'Ben Beispiel',
      state: 'active',
      quotaBytes: 2048 * MiB,
      usedBytes: 0,
    });
    expect(JSON.stringify(mailbox)).not.toContain(PW);
    expect(mc.passwords.get('ben@muster-ag.ch')).toBe(PW);

    await adapter().createMailbox({
      localPart: 'info',
      domain: 'muster-ag.ch',
      name: null,
      quotaMb: 1024,
      password: PW,
    });
    expect((sent('POST', '/api/v1/add/mailbox')[1]!.body as Record<string, unknown>).name).toBe('');
  });

  it('maps Mailcow refusals and never shows the password', async () => {
    mc.override = (req) =>
      req.path === '/api/v1/add/mailbox'
        ? {
            body: [
              {
                type: 'danger',
                log: ['mailbox', 'add', 'mailbox', { password: PW, password2: PW }],
                msg: ['password_complexity', PW],
              },
            ],
          }
        : undefined;
    const policy = await caught(
      adapter().createMailbox({
        localPart: 'ben',
        domain: 'muster-ag.ch',
        name: null,
        quotaMb: 1024,
        password: PW,
      }),
    );
    expect(policy.statusCode).toBe(400);
    expect(policy.message).toContain('Password does not meet the policy');
    expect(policy.message).not.toContain(PW);
    expect(JSON.stringify(policy.details)).not.toContain(PW);
    mc.override = undefined;

    mc.domains.get('muster-ag.ch')!.max_num_mboxes_for_domain = 3;
    const full = await caught(
      adapter().createMailbox({
        localPart: 'ben',
        domain: 'muster-ag.ch',
        name: null,
        quotaMb: 1024,
        password: PW,
      }),
    );
    expect(full.statusCode).toBe(409);
    expect(full.message).toBe('create mailbox ben@muster-ag.ch failed: Max. mailboxes exceeded (3 of 3)');

    const exists = await caught(
      adapter().createMailbox({
        localPart: 'anna',
        domain: 'muster-ag.ch',
        name: null,
        quotaMb: 1024,
        password: PW,
      }),
    );
    expect(exists.statusCode).toBe(409);
    const noDomain = await caught(
      adapter().createMailbox({
        localPart: 'anna',
        domain: 'nope.ch',
        name: null,
        quotaMb: 1024,
        password: PW,
      }),
    );
    expect(noDomain.statusCode).toBe(404);

    server.requests.length = 0;
    const input = { localPart: 'ben', domain: 'muster-ag.ch', name: null, quotaMb: 1024, password: PW };
    for (const bad of [
      { ...input, localPart: 'a+b' },
      { ...input, localPart: '.ben' },
      { ...input, quotaMb: 0 },
      { ...input, quotaMb: 10.5 },
      { ...input, password: '' },
      { ...input, name: 'Ben <ben@evil>' },
      { ...input, domain: 'localhost' },
    ]) {
      expect((await caught(adapter().createMailbox(bad))).statusCode).toBe(400);
    }
    expect(server.requests).toHaveLength(0);
  });

  it('changes name, size and state after reading the mailbox', async () => {
    await adapter().updateMailbox('anna@muster-ag.ch', { state: 'login_disabled' });
    expect(sent('POST', '/api/v1/edit/mailbox')[0]!.body).toEqual({
      items: ['anna@muster-ag.ch'],
      attr: { active: '2' },
    });
    await adapter().updateMailbox('Anna@Muster-AG.ch', {
      name: ' Anna M. ',
      quotaMb: 4096,
      state: 'inactive',
    });
    expect(sent('POST', '/api/v1/edit/mailbox')[1]!.body).toEqual({
      items: ['anna@muster-ag.ch'],
      attr: { name: 'Anna M.', quota: '4096', active: '0' },
    });
    expect(mc.mailboxes.get('anna@muster-ag.ch')).toMatchObject({
      name: 'Anna M.',
      quota: 4096 * MiB,
      active: 0,
    });
    await adapter().updateMailbox('anna@muster-ag.ch', { state: 'active' });
    expect((sent('POST', '/api/v1/edit/mailbox')[2]!.body as { attr: unknown }).attr).toEqual({
      active: '1',
    });

    server.requests.length = 0;
    const missing = await caught(adapter().updateMailbox('nobody@muster-ag.ch', { state: 'active' }));
    expect(missing).toBeInstanceOf(ProviderError);
    expect(missing.statusCode).toBe(404);
    expect(missing.message).toBe('Mailcow: mailbox nobody@muster-ag.ch not found');
    expect(posts()).toHaveLength(0);

    for (const name of ['', '   ', 'a<b', 'x'.repeat(256)]) {
      expect((await caught(adapter().updateMailbox('anna@muster-ag.ch', { name }))).statusCode).toBe(400);
    }
    expect(posts()).toHaveLength(0);
  });

  it('sets a password alone in its request and deletes with the address array', async () => {
    await adapter().setMailboxPassword('anna@muster-ag.ch', PW);
    expect(sent('POST', '/api/v1/edit/mailbox')[0]!.body).toEqual({
      items: ['anna@muster-ag.ch'],
      attr: { password: PW, password2: PW },
    });
    expect(mc.passwords.get('anna@muster-ag.ch')).toBe(PW);
    expect((await caught(adapter().setMailboxPassword('anna@muster-ag.ch', ''))).statusCode).toBe(400);
    expect((await caught(adapter().setMailboxPassword('nobody@muster-ag.ch', PW))).statusCode).toBe(404);

    mc.override = (req) =>
      req.path === '/api/v1/edit/mailbox' ? { body: [danger('password_complexity', PW)] } : undefined;
    const weak = await caught(adapter().setMailboxPassword('anna@muster-ag.ch', PW));
    expect(weak.statusCode).toBe(400);
    expect(weak.message).not.toContain(PW);
    mc.override = undefined;

    // A mailbox that signs in through Keycloak (LDAP, OIDC) keeps its password there.
    mc.passwords.clear();
    mc.mailboxes.get('anna@muster-ag.ch')!.authsource = 'keycloak';
    server.requests.length = 0;
    const external = await caught(adapter().setMailboxPassword('anna@muster-ag.ch', PW));
    expect(external.statusCode).toBe(409);
    expect(external.message).toBe(
      'anna@muster-ag.ch signs in through keycloak, its password is managed there, not at Mailcow',
    );
    expect(posts()).toHaveLength(0);
    expect(mc.passwords.size).toBe(0);
    mc.mailboxes.get('anna@muster-ag.ch')!.authsource = 'mailcow';

    await adapter().deleteMailbox('anna@muster-ag.ch');
    expect(sent('POST', '/api/v1/delete/mailbox')[0]!.body).toEqual(['anna@muster-ag.ch']);
    expect(mc.mailboxes.has('anna@muster-ag.ch')).toBe(false);
    expect((await caught(adapter().deleteMailbox('anna@muster-ag.ch'))).statusCode).toBe(404);
    expect(sent('POST', '/api/v1/delete/mailbox')).toHaveLength(1);
  });

  it('looks up local parts that do not fit a path in the domain list', async () => {
    mc.mailboxes.set('anna+news@muster-ag.ch', {
      ...structuredClone(MAILBOX),
      username: 'anna+news@muster-ag.ch',
      local_part: 'anna+news',
    });
    const mailbox = await adapter().getMailbox('anna+news@muster-ag.ch');
    expect(mailbox.address).toBe('anna+news@muster-ag.ch');
    expect(server.requests.map((r) => r.path)).toEqual(['/api/v1/get/mailbox/all/muster-ag.ch']);

    const plain = await adapter().getMailbox('anna@muster-ag.ch');
    expect(plain.address).toBe('anna@muster-ag.ch');
    expect(server.requests.at(-1)!.path).toBe('/api/v1/get/mailbox/anna@muster-ag.ch');

    const missing = await caught(adapter().getMailbox('nobody+x@muster-ag.ch'));
    expect(missing.statusCode).toBe(404);
    expect((await caught(adapter().getMailbox('a/b@muster-ag.ch'))).statusCode).toBe(400);
    expect((await caught(adapter().getMailbox('@muster-ag.ch'))).statusCode).toBe(400);
  });
});

describe('Mailcow aliases', () => {
  it('creates an alias with every flag, reads it back by the new id', async () => {
    const alias = await adapter().createMailAlias({
      address: 'Kontakt@Muster-AG.ch',
      targets: ['Anna@Muster-AG.ch', 'info@example.org'],
      active: true,
    });
    expect(sent('POST', '/api/v1/add/alias')[0]!.body).toEqual({
      address: 'kontakt@muster-ag.ch',
      goto: 'anna@muster-ag.ch,info@example.org',
      active: '1',
      sogo_visible: '1',
      sender_allowed: '1',
    });
    expect(server.requests.at(-1)!.path).toBe('/api/v1/get/alias/100');
    expect(alias).toEqual({
      id: '100',
      address: 'kontakt@muster-ag.ch',
      catchAll: false,
      targets: ['anna@muster-ag.ch', 'info@example.org'],
      special: null,
      active: true,
      createdAt: '2026-10-10T12:00:00.000Z',
      modifiedAt: null,
    });

    const catchAll = await adapter().createMailAlias({
      address: '@muster-ag.ch',
      targets: ['anna@muster-ag.ch'],
      active: false,
    });
    expect(sent('POST', '/api/v1/add/alias')[1]!.body).toMatchObject({
      address: '@muster-ag.ch',
      active: '0',
    });
    expect(catchAll).toMatchObject({ id: '101', catchAll: true, active: false });
  });

  it('refuses aliases Mailcow would skip and answers without an id', async () => {
    const self = await caught(
      adapter().createMailAlias({
        address: 'team2@muster-ag.ch',
        targets: ['Team2@muster-ag.ch'],
        active: true,
      }),
    );
    expect(self.statusCode).toBe(400);
    expect(self.message).toBe('An alias cannot forward to itself');
    for (const bad of [
      { address: 'team2@muster-ag.ch', targets: [], active: true },
      { address: 'team2@muster-ag.ch', targets: ['not-an-address'], active: true },
      { address: 'a+b@muster-ag.ch', targets: ['anna@muster-ag.ch'], active: true },
      { address: 'team2', targets: ['anna@muster-ag.ch'], active: true },
    ]) {
      expect((await caught(adapter().createMailAlias(bad))).statusCode).toBe(400);
    }
    expect(server.requests).toHaveLength(0);

    mc.override = (req) => (req.path === '/api/v1/add/alias' ? { body: done } : undefined);
    const silent = await caught(
      adapter().createMailAlias({
        address: 'team2@muster-ag.ch',
        targets: ['anna@muster-ag.ch'],
        active: true,
      }),
    );
    expect(silent).toBeInstanceOf(ProviderError);
    expect(silent.message).toBe(
      'Mailcow: create alias team2@muster-ag.ch failed: Mailcow did not create the alias',
    );

    mc.override = (req) =>
      req.path === '/api/v1/add/alias'
        ? { body: [danger('is_alias_or_mailbox', 'team@muster-ag.ch')] }
        : undefined;
    const exists = await caught(
      adapter().createMailAlias({
        address: 'team@muster-ag.ch',
        targets: ['anna@muster-ag.ch'],
        active: true,
      }),
    );
    expect(exists.statusCode).toBe(409);
    mc.override = (req) =>
      req.path === '/api/v1/add/alias' ? { body: [danger('max_alias_exceeded')] } : undefined;
    expect(
      (
        await caught(
          adapter().createMailAlias({
            address: 'x@muster-ag.ch',
            targets: ['anna@muster-ag.ch'],
            active: true,
          }),
        )
      ).statusCode,
    ).toBe(409);
  });

  it('changes and deletes by id, refuses partial saves, filters other domains', async () => {
    await adapter().updateMailAlias('12', { targets: ['anna@muster-ag.ch'], active: false });
    expect(sent('POST', '/api/v1/edit/alias')[0]!.body).toEqual({
      items: ['12'],
      attr: { goto: 'anna@muster-ag.ch', active: '0' },
    });
    expect(mc.aliases.get(12)).toMatchObject({ goto: 'anna@muster-ag.ch', active: 0 });
    const self = await caught(adapter().updateMailAlias('12', { targets: ['team@muster-ag.ch'] }));
    expect(self.statusCode).toBe(400);

    // Special targets keep their flag, or Mailcow would refuse its own null@localhost.
    for (const [id, special, flag] of [
      [20, 'null@localhost', 'goto_null'],
      [21, 'spam@localhost', 'goto_spam'],
      [22, 'ham@localhost', 'goto_ham'],
    ] as const) {
      mc.aliases.set(id, {
        ...structuredClone(ALIAS),
        id,
        address: `special${id}@muster-ag.ch`,
        goto: special,
      });
      server.requests.length = 0;
      await adapter().updateMailAlias(String(id), { active: false });
      expect(sent('POST', '/api/v1/edit/alias')[0]!.body).toEqual({
        items: [String(id)],
        attr: { active: '0', [flag]: '1' },
      });
      expect(mc.aliases.get(id)).toMatchObject({ goto: special, active: 0 });
      mc.aliases.delete(id);
    }

    mc.override = (req) =>
      req.path === '/api/v1/edit/alias'
        ? { body: [danger('goto_invalid', 'x@bad'), ok('alias_modified', 'team@muster-ag.ch')] }
        : undefined;
    const partial = await caught(
      adapter().updateMailAlias('12', { targets: ['anna@muster-ag.ch', 'ben@example.org'] }),
    );
    expect(partial.message).toBe(
      'change alias team@muster-ag.ch failed: Goto address x@bad is invalid. Mailcow saved the rest of the change',
    );
    mc.override = undefined;

    server.requests.length = 0;
    const missing = await caught(adapter().updateMailAlias('999', { active: true }));
    expect(missing.statusCode).toBe(404);
    const invalid = await caught(adapter().getMailAlias('12; drop'));
    expect(invalid.statusCode).toBe(404);
    expect(posts()).toHaveLength(0);
    expect(server.requests.map((r) => r.path)).toEqual(['/api/v1/get/alias/999']);

    await adapter().deleteMailAlias('12');
    expect(sent('POST', '/api/v1/delete/alias')[0]!.body).toEqual(['12']);
    expect(mc.aliases.has(12)).toBe(false);
    expect((await caught(adapter().deleteMailAlias('12'))).statusCode).toBe(404);

    mc.aliases.set(12, structuredClone(ALIAS));
    mc.aliases.set(13, { ...structuredClone(ALIAS), id: 13, address: '@muster-ag.ch' });
    mc.aliases.set(14, { ...structuredClone(ALIAS), id: 14, address: 'info@muster-ag.ch' });
    mc.override = (req) =>
      req.path === '/api/v1/get/alias/all/muster-ag.ch'
        ? { body: [...mc.aliases.values(), { ...ALIAS, id: 15, domain: 'other.ch', address: 'x@other.ch' }] }
        : undefined;
    const list = await adapter().listMailAliases('muster-ag.ch');
    expect(list.map((a) => a.address)).toEqual(['info@muster-ag.ch', 'team@muster-ag.ch', '@muster-ag.ch']);

    mc.override = undefined;
    mc.aliases.clear();
    expect(await adapter().listMailAliases('muster-ag.ch')).toEqual([]);
  });
});

describe('Mailcow DKIM, password policy and cache', () => {
  it('reads, creates and deletes DKIM keys', async () => {
    mc.addDomain('kunde.ch');
    expect(await adapter().getDkim('kunde.ch')).toBeNull();
    const muster = await adapter().getDkim('muster-ag.ch');
    expect(muster!.txt).toBe(`v=DKIM1;k=rsa;t=s;s=email;p=${DKIM.pubkey}`);

    server.requests.length = 0;
    const exists = await caught(adapter().createDkim('muster-ag.ch', { selector: 'dkim', keySize: 2048 }));
    expect(exists.statusCode).toBe(409);
    expect(exists.message).toBe('A DKIM key exists already');
    expect(posts()).toHaveLength(0);

    const key = await adapter().createDkim('kunde.ch', { selector: 'dkim', keySize: 3072 });
    expect(sent('POST', '/api/v1/add/dkim')[0]!.body).toEqual({
      domains: 'kunde.ch',
      dkim_selector: 'dkim',
      key_size: '3072',
    });
    expect(key).toEqual({
      selector: 'dkim',
      publicKey: 'PUB-kunde.ch',
      keyLength: '3072',
      txt: 'v=DKIM1;k=rsa;t=s;s=email;p=PUB-kunde.ch',
    });

    server.requests.length = 0;
    expect(
      (await caught(adapter().createDkim('kunde.ch', { selector: 'dkim', keySize: 1024 }))).statusCode,
    ).toBe(400);
    expect(
      (await caught(adapter().createDkim('kunde.ch', { selector: '-x', keySize: 2048 }))).statusCode,
    ).toBe(400);
    expect(server.requests).toHaveLength(0);

    await adapter().deleteDkim('kunde.ch');
    expect(sent('POST', '/api/v1/delete/dkim')[0]!.body).toEqual(['kunde.ch']);
    expect(mc.dkim.has('kunde.ch')).toBe(false);
  });

  it('reads the password policy, and fails clearly where there is none', async () => {
    expect(await adapter().mailPasswordPolicy()).toEqual({
      minLength: 8,
      letters: true,
      mixedCase: true,
      digits: false,
      specialChars: false,
    });
    mc.policy = {};
    const empty = await caught(adapter().mailPasswordPolicy());
    expect(empty.statusCode).toBe(404);
    expect(empty.message).toBe('Mailcow: password policy not available');
    mc.override = (req) => (req.path === '/api/v1/get/passwordpolicy' ? routeNotFound : undefined);
    const old = await caught(adapter().mailPasswordPolicy());
    expect(old.statusCode).toBe(404);
    expect(old.message).toBe('Mailcow: password policy not available');
    mc.override = () => ({ status: 500, text: '' });
    expect((await caught(adapter().mailPasswordPolicy())).statusCode).toBe(502);
  });

  it('keeps reads for seconds and forgets them on writes', async () => {
    const a = adapter();
    const first = await a.getMailDomain('muster-ag.ch');
    first.info.limits.maxMailboxes = 999;
    const second = await a.getMailDomain('muster-ag.ch');
    expect(sent('GET', '/api/v1/get/domain/muster-ag.ch')).toHaveLength(1);
    // Callers get copies: a change by one does not reach the next.
    expect(second.info.limits.maxMailboxes).toBe(10);
    second.info.limits.maxMailboxes = 777;
    expect((await a.getMailDomain('muster-ag.ch')).info.limits.maxMailboxes).toBe(10);

    await a.updateMailDomain('muster-ag.ch', { maxMailboxes: 15 });
    expect((await a.getMailDomain('muster-ag.ch')).info.limits.maxMailboxes).toBe(15);
    expect(sent('GET', '/api/v1/get/domain/muster-ag.ch')).toHaveLength(3);

    await a.listMailboxes('muster-ag.ch');
    await a.listMailboxes('muster-ag.ch');
    expect(sent('GET', '/api/v1/get/mailbox/all/muster-ag.ch')).toHaveLength(1);
    await a.createMailbox({
      localPart: 'ben',
      domain: 'muster-ag.ch',
      name: null,
      quotaMb: 1024,
      password: PW,
    });
    expect((await a.listMailboxes('muster-ag.ch')).map((m) => m.localPart)).toEqual(['anna', 'ben']);
    expect(sent('GET', '/api/v1/get/mailbox/all/muster-ag.ch')).toHaveLength(2);

    // A mailbox delete also changes aliases (Mailcow drops it from targets), so lists are reread.
    await a.listMailAliases('muster-ag.ch');
    await a.deleteMailbox('ben@muster-ag.ch');
    await a.listMailAliases('muster-ag.ch');
    expect(sent('GET', '/api/v1/get/alias/all/muster-ag.ch')).toHaveLength(2);

    // Past the TTL the next read asks Mailcow again.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 16_000);
    await a.getMailDomain('muster-ag.ch');
    expect(sent('GET', '/api/v1/get/domain/muster-ag.ch')).toHaveLength(4);
    vi.restoreAllMocks();

    // Writes decide on what Mailcow has now, not on a read of the last seconds.
    const live = adapter();
    expect((await live.getMailDomain('muster-ag.ch')).info.limits.maxMailboxes).toBe(15);
    mc.domains.get('muster-ag.ch')!.max_num_mboxes_for_domain = 20;
    await live.updateMailDomain('muster-ag.ch', { maxMailboxes: 15 });
    expect(sent('POST', '/api/v1/edit/domain').at(-1)!.body).toEqual({
      items: ['muster-ag.ch'],
      attr: { mailboxes: '15' },
    });
    expect(await live.getDkim('kunde.ch')).toBeNull();
    mc.dkim.set('kunde.ch', { ...DKIM });
    expect((await caught(live.createDkim('kunde.ch', { selector: 'dkim', keySize: 2048 }))).statusCode).toBe(
      409,
    );
    expect(sent('POST', '/api/v1/add/dkim')).toHaveLength(0);
    // Deleting a mailbox can delete aliases of other domains (their only target): counts are reread.
    mc.addDomain('kunde.ch', { mboxes_in_domain: 1 });
    mc.mailboxes.set('carl@kunde.ch', {
      ...structuredClone(MAILBOX),
      username: 'carl@kunde.ch',
      local_part: 'carl',
      domain: 'kunde.ch',
    });
    expect((await live.getMailDomain('muster-ag.ch')).info.usage.aliases).toBe(3);
    mc.domains.get('muster-ag.ch')!.aliases_in_domain = 2;
    expect((await live.getMailDomain('muster-ag.ch')).info.usage.aliases).toBe(3);
    await live.deleteMailbox('carl@kunde.ch');
    expect((await live.getMailDomain('muster-ag.ch')).info.usage.aliases).toBe(2);

    // A failed read is not kept.
    const b = adapter();
    mc.override = (req) =>
      req.path === '/api/v1/get/dkim/muster-ag.ch' ? { status: 500, text: '' } : undefined;
    await caught(b.getDkim('muster-ag.ch'));
    mc.override = undefined;
    expect(await b.getDkim('muster-ag.ch')).not.toBeNull();
    expect(sent('GET', '/api/v1/get/dkim/muster-ag.ch')).toHaveLength(2);
  });
});

describe('Mailcow API explorer', () => {
  it('passes reads and writes on, a delete as the bare array', async () => {
    const a = adapter();
    const all = await a.rawRequest('GET', '/api/v1/get/domain/all');
    expect(all.status).toBe(200);
    expect((all.data as unknown[]).length).toBe(1);
    const prefixed = await a.rawRequest('get', `${server.url}/api/v1/get/domain/muster-ag.ch`, {
      ignored: 1,
    });
    expect((prefixed.data as Record<string, unknown>).domain_name).toBe('muster-ag.ch');
    expect(sent('GET').at(-1)!.body).toBeUndefined();

    const edit = await a.rawRequest('POST', 'api/v1/edit/domain', {
      items: ['muster-ag.ch'],
      attr: { mailboxes: '11' },
    });
    expect(edit.status).toBe(200);
    expect(sent('POST').at(-1)!.body).toEqual({ items: ['muster-ag.ch'], attr: { mailboxes: '11' } });

    const del = await a.rawRequest('POST', '/api/v1/delete/alias', { items: ['12'] });
    expect(del.data).toEqual([ok('alias_removed', '12')]);
    expect(sent('POST').at(-1)!.body).toEqual(['12']);

    const failed = await a.rawRequest('POST', '/api/v1/edit/mailbox', {
      items: ['nobody@muster-ag.ch'],
      attr: { password: PW, password2: PW },
    });
    expect(failed.status).toBe(200);
    expect(JSON.stringify(failed.data)).not.toContain(PW);
  });

  it('refuses other methods, paths and delete bodies', async () => {
    const a = adapter();
    const refuse = async (method: string, path: string, body?: Record<string, unknown>) =>
      (await caught(a.rawRequest(method, path, body))).message;
    expect(await refuse('POST', '/api/v1/delete/alias', { ids: ['12'] })).toContain('{ "items": [...] }');
    expect(await refuse('POST', '/api/v1/delete/alias')).toContain('{ "items": [...] }');
    for (const [method, path] of [
      ['PUT', '/api/v1/edit/domain'],
      ['PATCH', '/api/v1/edit/domain'],
      ['DELETE', '/api/v1/delete/alias'],
      ['POST', '/api/v1/get/domain/all'],
      ['GET', '/api/v1/add/domain'],
    ] as const) {
      expect(await refuse(method, path)).toBe(
        'Mailcow takes GET for /api/v1/get/... and POST for add, edit and delete',
      );
    }
    for (const path of [
      '/api/v2/get/domain/all',
      '/json_api.php?query=get/domain/all',
      '/api/v1/search/domain/x',
      '/api/v1/get/../../admin',
      '/api/v1/get/%2e%2e/admin',
      '/api/v1/get/domain%2fall',
      '/api/v1//get/domain/all',
      '/api/v1/get/domain/all#x',
      'https://evil.example/api/v1/get/domain/all',
      '//evil.example/api/v1/get/domain/all',
    ]) {
      expect((await caught(a.rawRequest('GET', path))).statusCode).toBe(400);
    }
    expect(server.requests).toHaveLength(0);
  });

  it('redacts secrets in answers', async () => {
    mc.override = (req) =>
      req.path === '/api/v1/get/dkim/muster-ag.ch'
        ? { body: { ...DKIM, nested: { password: 'old-secret', api_key: KEY } } }
        : undefined;
    const res = await adapter().rawRequest('GET', '/api/v1/get/dkim/muster-ag.ch');
    expect(res.data).toEqual({
      ...DKIM,
      privkey: '••••••',
      nested: { password: '••••••', api_key: '••••••' },
    });
    mc.override = () => ({ status: 401, body: { type: 'error', msg: `authentication failed for ${KEY}` } });
    const echoed = await adapter().rawRequest('GET', '/api/v1/get/domain/all');
    expect(echoed.status).toBe(401);
    expect(JSON.stringify(echoed.data)).not.toContain(KEY);
  });
});
