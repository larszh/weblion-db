import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ProviderError } from '../src/lib/errors';
import { JokerAdapter } from '../src/providers/joker/adapter';
import { DmapiClient } from '../src/providers/joker/client';
import {
  buildZoneLine,
  headerValue,
  headerValues,
  jokerDate,
  parseAuthcodeResult,
  parseDomainList,
  parseProfile,
  parseReply,
  parseWhois,
  parseZone,
  redactAuthcodes,
  serializeZone,
  tokenizeZoneLine,
  zoneRecords,
} from '../src/providers/joker/parse';
import type { JokerConfig } from '../src/providers/types';

const API_KEY = 'jk-ApiKey-7f3c9b21e0';
const USERNAME = 'reseller@weblion.example';
const PASSWORD = 'Pa55-w0rd!Joker';
const AUTHCODE = 'Xy7+Secret#Code';
const ref = { externalId: 'x', kind: 'vm' as const, node: null, meta: {} };

// --- A tiny DMAPI ------------------------------------------------------------------

interface SimCall {
  request: string;
  form: URLSearchParams;
  contentType: string | undefined;
}

interface Answer {
  status?: number;
  text: string;
}

function reply(headers: Record<string, string>, body = ''): string {
  return `${Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n\n${body}`;
}

const ok = (body = '', headers: Record<string, string> = {}): Answer => ({
  text: reply({ 'Status-Code': '0', 'Status-Text': 'Command completed successfully', ...headers }, body),
});

const ZONE_LINES = [
  '# weblion test zone',
  '$dyndns=yes:dyn-user:dyn-Pass-123',
  '@ A 0 192.0.2.10 3600',
  'www\tA\t0\t192.0.2.10\t86400',
  '@ AAAA 0 2001:db8::10 3600',
  'blog CNAME 0 example.net. 3600',
  '@ MX 10 mail.example.com. 86400',
  '@ MX 20 ASPMX.L.GOOGLE.COM 300',
  '@ TXT 0 "v=spf1 include:_spf.example.com ~all" 3600',
  'quote TXT 0 "say \\"hello\\" to the world" 3600',
  '_sip._tcp SRV 10/100 sip.example.com:5060 3600',
  '_jabber._tcp SRV 20/0 xmpp-server1.l.google.com:5269 300',
  'caa CAA 0 issue "letsencrypt.org" 86400',
  '@ CAA 0 iodef "mailto:security@example.com" 86400',
  'naptr NAPTR 10/100 . 86400 0 0 "u" "E2U+sip" "!^.*$!sip:info@example.com!"',
  'redirect URL 0 http://joker.com 86400',
  'frame FRAME 0 http://joker.com 86400 0 0 "Header: Frame-Forward" "head" "title" "body"',
  'info MAILFW 0 owner@example.net 86400 0 0 1',
  'home DYNA 0 198.51.100.7 300',
  'home6 DYNAAAA 0 2001:db8::7 300',
  'weird FOO 0 bar 3600',
  'sub NS 0 ns1.other.example. 3600',
  'broken A 0 "unterminated 3600',
  '',
];
const ZONE = ZONE_LINES.join('\n');

const DOMAIN_LIST = [
  'example.com 2027-01-01 lock,autorenew 1',
  'example.net 20261231120000 production 0',
  'expired.org 2025-05-01 deleted 0',
  '',
].join('\n');

const WHOIS_COM = [
  'domain.fqdn: example.com',
  'domain.status: lock',
  'domain.name: Lars Example',
  'domain.organization: Weblion GmbH',
  'domain.email: owner@example.com',
  'domain.owner-c: CODE-OWNER',
  'domain.created.date: 20140813080304',
  'domain.expires: 20270101000000',
  'domain.autorenew: 1',
  'domain.privacy: basic',
  'domain.nservers.nserver.no: 1',
  'domain.nservers.nserver.handle: A.NS.JOKER.COM',
  'domain.nservers.nserver.no: 2',
  'domain.nservers.nserver.handle: b.ns.joker.com.',
  '',
].join('\n');

/** Mutable state of the simulated Joker account. */
const sim = {
  sessions: new Set<string>(),
  nextSid: 1,
  /** How an invalid session is answered. */
  authFailure: 'http401' as 'http401' | 'status2200',
  /** Every session is treated as expired. */
  rejectSessions: false,
  zones: new Map<string, string>(),
  authcode: 'ready' as 'ready' | 'pending' | 'nack',
  nextProc: 5000,
  delayMs: 0,
  override: undefined as ((call: SimCall) => Answer | undefined) | undefined,
};

function resetSim() {
  sim.sessions.clear();
  sim.nextSid = 1;
  sim.authFailure = 'http401';
  sim.rejectSessions = false;
  sim.zones = new Map([
    ['example.com', ZONE],
    ['other-zone.net', '@ A 0 192.0.2.99 3600\n'],
  ]);
  sim.authcode = 'ready';
  sim.nextProc = 5000;
  sim.delayMs = 0;
  sim.override = undefined;
}

function route(call: SimCall): Answer {
  const override = sim.override?.(call);
  if (override) return override;
  const f = call.form;
  if (call.request === 'login') {
    const valid =
      f.get('api-key') === API_KEY || (f.get('username') === USERNAME && f.get('password') === PASSWORD);
    if (!valid) return { text: reply({ 'Status-Code': '2400', 'Status-Text': 'Command failed' }) };
    const sid = `sid-${sim.nextSid++}-a1b2c3d4`;
    sim.sessions.add(sid);
    return {
      text: reply(
        {
          'Status-Code': '0',
          'Status-Text': 'OK',
          'Auth-Sid': sid,
          UID: '4711',
          'Account-Balance': '123.45',
        },
        'com\nnet\nde\n',
      ),
    };
  }
  const sid = f.get('auth-sid');
  if (sim.rejectSessions || !sid || !sim.sessions.has(sid)) {
    const text = reply({ 'Status-Code': '2200', 'Status-Text': 'Authentication error' });
    return sim.authFailure === 'http401' ? { status: 401, text } : { text };
  }
  const domain = f.get('domain') ?? '';
  const proc = () => ({ 'Proc-ID': String(sim.nextProc++), 'Tracking-Id': 'TR-W' });
  switch (call.request) {
    case 'query-profile':
      return ok('customer-id: C-4711\nusername: reseller@weblion.example\nbalance: 123.45\ncurrency: EUR\n');
    case 'query-domain-list':
      return ok(DOMAIN_LIST);
    case 'query-whois':
      if (domain === 'example.com') return ok(WHOIS_COM);
      return {
        text: reply({
          'Status-Code': '2303',
          'Status-Text': 'Object does not exist',
          Error: 'Domain not found',
          'Tracking-Id': 'TR-404',
        }),
      };
    case 'dns-zone-list':
      return ok([...sim.zones.keys()].join('\n') + '\n');
    case 'dns-zone-get': {
      const zone = sim.zones.get(domain);
      return zone !== undefined
        ? ok(zone)
        : { text: reply({ 'Status-Code': '2303', 'Status-Text': 'Object does not exist' }) };
    }
    case 'dns-zone-put':
      sim.zones.set(domain, f.get('zone') ?? '');
      return ok('', proc());
    case 'domain-modify':
    case 'domain-lock':
    case 'domain-unlock':
    case 'domain-set-property':
    case 'domain-renew':
    case 'domain-transfer-get-auth-id':
      return ok('', proc());
    case 'result-retrieve':
      if (sim.authcode === 'pending') {
        return {
          text: reply({
            'Status-Code': '2303',
            'Status-Text': 'Object does not exist',
            Error: 'No result for this Proc-ID yet',
          }),
        };
      }
      if (sim.authcode === 'nack') {
        return ok(`Proc-ID: ${f.get('proc-id')}\nCompletion-Status: nack\nError: Domain is in transfer\n`);
      }
      return ok(
        `Proc-ID: ${f.get('proc-id')}\nRequest-Type: domain-transfer-get-auth-id\nCompletion-Status: ack\nDomain: example.com\nAuth-ID: ${AUTHCODE}\n`,
      );
    default:
      return { status: 404, text: reply({ 'Status-Code': '2400', 'Status-Text': 'Unknown request' }) };
  }
}

let server: Server;
let baseUrl: string;
const calls: SimCall[] = [];
let inFlight = 0;
let maxInFlight = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const url = new URL(req.url ?? '/', 'http://localhost');
      const call: SimCall = {
        request: url.pathname.replace(/^\/request\//, ''),
        form: new URLSearchParams(raw),
        contentType: req.headers['content-type'],
      };
      calls.push(call);
      const answer = route(call);
      setTimeout(() => {
        inFlight--;
        res.statusCode = answer.status ?? 200;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(answer.text);
      }, sim.delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/request`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetSim();
  calls.length = 0;
  maxInFlight = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const keyConfig = (): JokerConfig => ({ apiKey: API_KEY, baseUrl });
const adapter = (options = {}) =>
  new JokerAdapter(keyConfig(), { authcodeWaitMs: 60, authcodePollMs: 10, ...options });
const requestsOf = (name: string) => calls.filter((c) => c.request === name);

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected the promise to reject');
}

// --- Client --------------------------------------------------------------------------

describe('DMAPI client', () => {
  it('logs in with the API key and reuses the session', async () => {
    const client = new DmapiClient(keyConfig());
    await client.call('query-profile');
    await client.call('query-domain-list');
    expect(calls.map((c) => c.request)).toEqual(['login', 'query-profile', 'query-domain-list']);
    const [login, profile, list] = calls;
    expect(login!.contentType).toBe('application/x-www-form-urlencoded');
    expect(login!.form.get('api-key')).toBe(API_KEY);
    expect(login!.form.has('auth-sid')).toBe(false);
    expect(profile!.form.get('auth-sid')).toBe('sid-1-a1b2c3d4');
    expect(list!.form.get('auth-sid')).toBe('sid-1-a1b2c3d4');
    expect(profile!.form.has('api-key')).toBe(false);
  });

  it('logs in with username and password and strips a trailing slash from the base URL', async () => {
    const client = new DmapiClient({ username: USERNAME, password: PASSWORD, baseUrl: `${baseUrl}/` });
    await client.call('query-profile');
    expect(calls.map((c) => c.request)).toEqual(['login', 'query-profile']);
    expect(calls[0]!.form.get('username')).toBe(USERNAME);
    expect(calls[0]!.form.get('password')).toBe(PASSWORD);
    expect(calls[0]!.form.has('api-key')).toBe(false);
  });

  it('shares one login between concurrent requests', async () => {
    const client = new DmapiClient(keyConfig());
    await Promise.all(Array.from({ length: 5 }, () => client.call('query-profile')));
    expect(requestsOf('login')).toHaveLength(1);
    expect(requestsOf('query-profile')).toHaveLength(5);
  });

  it.each(['http401', 'status2200'] as const)(
    'logs in again once when the session expired (%s)',
    async (mode) => {
      sim.authFailure = mode;
      const client = new DmapiClient(keyConfig());
      await client.call('query-profile');
      sim.sessions.clear();
      // Three callers hit the expired session at once and share the new login.
      await Promise.all([
        client.call('query-profile'),
        client.call('query-profile'),
        client.call('query-profile'),
      ]);
      expect(requestsOf('login')).toHaveLength(2);
      const sids = requestsOf('query-profile').map((c) => c.form.get('auth-sid'));
      expect(sids.filter((s) => s === 'sid-2-a1b2c3d4')).toHaveLength(3);
    },
  );

  it('gives up after one new login', async () => {
    const client = new DmapiClient(keyConfig());
    sim.rejectSessions = true;
    const err = await caught(client.call('query-profile'));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Joker: query-profile failed: Authentication error (status 2200, HTTP 401)');
    expect(requestsOf('login')).toHaveLength(2);
    expect(requestsOf('query-profile')).toHaveLength(2);
  });

  it('reports Status-Text, Error lines and Tracking-Id without secrets', async () => {
    const client = new DmapiClient(keyConfig());
    sim.override = (call) =>
      call.request === 'domain-lock'
        ? {
            text: reply({
              'Status-Code': '2306',
              'Status-Text': 'Parameter value policy error',
              Error: `invalid domain (api-key ${API_KEY}, session ${call.form.get('auth-sid')})`,
              'Tracking-Id': 'TR-77',
            }).replace('\n\n', '\nError: second problem\n\n'),
          }
        : undefined;
    const err = await caught(client.call('domain-lock', { domain: 'example.com' }));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(502);
    expect(err.message).toBe(
      'Joker: domain-lock failed: Parameter value policy error: invalid domain (api-key [redacted], session [redacted]); second problem (status 2306, Tracking-Id TR-77)',
    );
    expect(err.details).toEqual({ statusCode: 2306, trackingId: 'TR-77' });
  });

  it('treats Result: NACK and HTTP errors as failures', async () => {
    const client = new DmapiClient(keyConfig());
    sim.override = (call) =>
      call.request === 'wa-email-validate'
        ? { text: reply({ 'Status-Code': '0', Result: 'NACK' }) }
        : call.request === 'query-ns-list'
          ? { status: 500, text: 'Internal Server Error' }
          : undefined;
    expect((await caught(client.call('wa-email-validate'))).message).toBe(
      'Joker: wa-email-validate failed: request refused (NACK)',
    );
    expect((await caught(client.call('query-ns-list'))).message).toBe(
      'Joker: query-ns-list failed: HTTP 500',
    );
  });

  it('explains a rejected login without echoing the credentials', async () => {
    const client = new DmapiClient({ apiKey: 'wrong-key-123456', baseUrl });
    const err = await caught(client.call('query-profile'));
    expect(err.message).toBe(
      'Joker: login failed: Command failed (status 2400). Check the API key of the Joker.com reseller account.',
    );
    expect(requestsOf('query-profile')).toHaveLength(0);
    const none = await caught(new DmapiClient({ baseUrl }).call('query-profile'));
    expect(none.message).toBe('Joker: no API key or username and password configured');
  });

  it('keeps at most 3 requests in flight', async () => {
    const client = new DmapiClient(keyConfig());
    sim.delayMs = 25;
    await Promise.all(Array.from({ length: 9 }, () => client.call('query-profile')));
    expect(requestsOf('query-profile')).toHaveLength(9);
    expect(maxInFlight).toBe(3);
  });
});

// --- Parsers -------------------------------------------------------------------------

describe('Joker parsers', () => {
  it('parses replies with CRLF, repeated and case-insensitive headers', () => {
    const r = parseReply(
      'Status-Code: 0\r\nWarning: one\r\nwarning: two\r\nAuth-SID: abc\r\n\r\nline 1\r\nline 2\r\n',
    );
    expect(headerValue(r, 'auth-sid')).toBe('abc');
    expect(headerValues(r, 'WARNING')).toEqual(['one', 'two']);
    expect(r.body).toBe('line 1\nline 2\n');
    expect(parseReply('Status-Code: 2202\nStatus-Text: Authorization error')).toEqual({
      headers: [
        { name: 'Status-Code', value: '2202' },
        { name: 'Status-Text', value: 'Authorization error' },
      ],
      body: '',
    });
    expect(parseReply('<html>proxy error</html>')).toEqual({ headers: [], body: '<html>proxy error</html>' });
  });

  it('parses the domain list by position', () => {
    expect(parseDomainList(parseReply(`Status-Code: 0\n\n${DOMAIN_LIST}`))).toEqual([
      {
        name: 'example.com',
        expiresAt: '2027-01-01T00:00:00.000Z',
        flags: ['lock', 'autorenew'],
        jokerNs: true,
      },
      { name: 'example.net', expiresAt: '2026-12-31T12:00:00.000Z', flags: ['production'], jokerNs: false },
      { name: 'expired.org', expiresAt: '2025-05-01T00:00:00.000Z', flags: ['deleted'], jokerNs: false },
    ]);
    // An empty status collapses away; without the extra columns flags are unknown.
    expect(parseDomainList(parseReply('\n\nEXAMPLE.CH 2027-01-01 0\nexample.li 2027-02-02\n'))).toEqual([
      { name: 'example.ch', expiresAt: '2027-01-01T00:00:00.000Z', flags: [], jokerNs: false },
      { name: 'example.li', expiresAt: '2027-02-02T00:00:00.000Z', flags: null, jokerNs: null },
    ]);
  });

  it('parses the domain list by its Columns header', () => {
    const text = [
      'Status-Code: 0',
      'Columns: domain,jokerns,expiration_date,domain_status',
      'Separator: TAB',
      '',
      'example.com\t1\t20270101000000\tlock,autorenew',
      'example.org\t0\t2026-03-04\t',
    ].join('\n');
    expect(parseDomainList(parseReply(text))).toEqual([
      {
        name: 'example.com',
        expiresAt: '2027-01-01T00:00:00.000Z',
        flags: ['lock', 'autorenew'],
        jokerNs: true,
      },
      { name: 'example.org', expiresAt: '2026-03-04T00:00:00.000Z', flags: [], jokerNs: false },
    ]);
  });

  it('parses query-whois (sample of the Go DMAPI client)', () => {
    const sample = `Status-Code: 0

domain.fqdn: example.de
domain.registrar-id: JORE-1
domain.registrar: JOKER.COM
domain.status: lock
domain.name: Jane Doe
domain.organization: Doe Inc.
domain.address-1: Main Street 1
domain.city: Example City
domain.postal-code: 12345
domain.country: DE
domain.email: jane@example.de
domain.phone: +49.1234567
domain.created.date: 20140813080304
domain.expires: 20260813080304
domain.modified: 20260718194709
domain.owner-c-email: jane@example.de
domain.billing-c-email: billing@example.de
domain.billing-c: CODE-1
domain.admin-c-email: admin@example.de
domain.admin-c: CODE-2
domain.tech-c-email: tech@example.de
domain.tech-c: CODE-3
domain.dnssec.status: signedDelegation
domain.autorenew: 1
domain.privacy: none
domain.grants: 1
domain.rights: @creator
domain.dnssec.ds-1: :::
domain.nservers.nserver.no: 1
domain.nservers.nserver.handle: ns2.example.net
domain.nservers.nserver.no: 2
domain.nservers.nserver.handle: ns1.example.net
`;
    expect(parseWhois(parseReply(sample).body)).toEqual({
      name: 'example.de',
      status: 'active',
      terminated: false,
      nameservers: ['ns1.example.net', 'ns2.example.net'],
      handle: null,
      createdAt: '2014-08-13T08:03:04.000Z',
      expiresAt: '2026-08-13T08:03:04.000Z',
      autoRenew: true,
      locked: true,
      privacy: 'none',
      dnssec: true,
      registrant: { name: 'Jane Doe', organization: 'Doe Inc.', email: 'jane@example.de' },
    });
    const minimal = parseWhois('domain.status: deleted\ndomain.autorenew: 0\n', 'gone.org');
    expect(minimal).toMatchObject({
      name: 'gone.org',
      status: 'deleted',
      terminated: true,
      locked: false,
      autoRenew: false,
      dnssec: false,
      handle: null,
      registrant: null,
    });
  });

  it('parses the profile and dates', () => {
    expect(
      parseProfile(
        parseReply('Account-Balance: 99.5\n\nusername: reseller@weblion.example\ncurrency: EUR\n'),
      ),
    ).toEqual({ account: 'reseller@weblion.example', balance: 99.5, currency: 'EUR' });
    expect(jokerDate('20260813080304')).toBe('2026-08-13T08:03:04.000Z');
    expect(jokerDate('2027-01-01')).toBe('2027-01-01T00:00:00.000Z');
    expect(jokerDate('1')).toBeNull();
    expect(jokerDate('lock')).toBeNull();
  });

  it('tokenizes zone lines with quotes and escapes', () => {
    const { tokens, complete } = tokenizeZoneLine('txt TXT 0 "a \\"quoted\\" text\\\\" 300 \\x');
    expect(complete).toBe(true);
    expect(tokens.map((t) => [t.value, t.quoted])).toEqual([
      ['txt', false],
      ['TXT', false],
      ['0', false],
      ['a "quoted" text\\', true],
      ['300', false],
      ['\\x', false],
    ]);
    expect(tokenizeZoneLine('x TXT 0 "open 300').complete).toBe(false);
  });

  it('maps every Joker record type and writes unchanged zones back byte for byte', () => {
    const zone = parseZone(ZONE);
    expect(serializeZone(zone)).toBe(ZONE);
    const records = zoneRecords(zone).map(({ id: _id, ...r }) => r);
    expect(records).toEqual([
      { type: 'A', name: '@', data: '192.0.2.10', ttl: 3600 },
      { type: 'A', name: 'www', data: '192.0.2.10', ttl: 86400 },
      { type: 'AAAA', name: '@', data: '2001:db8::10', ttl: 3600 },
      { type: 'CNAME', name: 'blog', data: 'example.net.', ttl: 3600 },
      { type: 'MX', name: '@', data: '10 mail.example.com.', ttl: 86400 },
      { type: 'MX', name: '@', data: '20 ASPMX.L.GOOGLE.COM', ttl: 300 },
      { type: 'TXT', name: '@', data: 'v=spf1 include:_spf.example.com ~all', ttl: 3600 },
      { type: 'TXT', name: 'quote', data: 'say "hello" to the world', ttl: 3600 },
      { type: 'SRV', name: '_sip._tcp', data: '10 100 5060 sip.example.com', ttl: 3600 },
      { type: 'SRV', name: '_jabber._tcp', data: '20 0 5269 xmpp-server1.l.google.com', ttl: 300 },
      { type: 'CAA', name: 'caa', data: '0 issue "letsencrypt.org"', ttl: 86400 },
      { type: 'CAA', name: '@', data: '0 iodef "mailto:security@example.com"', ttl: 86400 },
      {
        type: 'NAPTR',
        name: 'naptr',
        data: '10 100 "u" "E2U+sip" "!^.*$!sip:info@example.com!" .',
        ttl: 86400,
      },
      { type: 'HTTP_REDIRECT', name: 'redirect', data: 'http://joker.com', ttl: 86400 },
      { type: 'HTTP_FRAME', name: 'frame', data: 'http://joker.com', ttl: 86400 },
      { type: 'MAILFW', name: 'info', data: 'owner@example.net', ttl: 86400 },
      { type: 'DYNA', name: 'home', data: '198.51.100.7', ttl: 300, readOnly: true },
      { type: 'DYNAAAA', name: 'home6', data: '2001:db8::7', ttl: 300, readOnly: true },
      { type: 'FOO', name: 'weird', data: 'bar', ttl: 3600, readOnly: true },
      { type: 'NS', name: 'sub', data: 'ns1.other.example.', ttl: 3600, readOnly: true },
      { type: 'A', name: 'broken', data: '0 "unterminated 3600', ttl: null, readOnly: true },
    ]);

    // Writing each record from its generic form gives the same line again (tabs aside).
    for (const line of zone.lines) {
      if (!line.entry || line.entry.readOnly) continue;
      const rebuilt = buildZoneLine({ ...line.entry, ttl: line.entry.ttl ?? 0 }, line.entry.tail);
      expect(rebuilt).toBe(line.raw.replace(/\t/g, ' '));
      const again = parseZone(rebuilt).lines[0]!.entry!;
      expect(again.id).toBe(line.entry.id);
    }
  });

  it('derives record ids from the content', () => {
    const a = parseZone('www A 0 192.0.2.1 3600\nwww   A 0 192.0.2.1 3600\nmail A 0 192.0.2.2 3600\n');
    const b = parseZone('mail A 0 192.0.2.2 3600\n');
    const [first, second, mail] = zoneRecords(a);
    expect(first!.id).toMatch(/^[0-9a-f]{16}$/);
    expect(second!.id).toBe(`${first!.id}-2`);
    expect(zoneRecords(b)[0]!.id).toBe(mail!.id);
  });

  it('validates records before they reach the zone', () => {
    const line =
      (type: string, data: string, ttl = 3600, name = 'x') =>
      () =>
        buildZoneLine({ type, name, data, ttl });
    expect(line('NS', 'ns1.example.com')).toThrow('Joker does not support NS records');
    expect(line('TXT', 'a\n@ A 0 192.0.2.66 300')).toThrow('line breaks');
    expect(line('A', '192.0.2.1', 3600, 'bad name')).toThrow('Invalid record name');
    expect(line('A', '::1')).toThrow('IPv4');
    expect(line('CAA', '128 issue "ca.example"')).toThrow('flags 0');
    expect(line('HTTP_REDIRECT', 'ftp://example.com')).toThrow('http(s) URL');
    expect(line('MAILFW', 'not-an-address')).toThrow('e-mail address');
    expect(line('NAPTR', '10 100 "u" "E2U+sip" "!^.*$!x!" host.example.com')).toThrow('either a regexp');
    expect(buildZoneLine({ type: 'SRV', name: '_sip._udp', data: '1 2 5060 sip.example.com.', ttl: 0 })).toBe(
      '_sip._udp SRV 1/2 sip.example.com:5060 0',
    );
    expect(buildZoneLine({ type: 'TXT', name: '', data: 'x', ttl: 300 })).toBe('@ TXT 0 "x" 300');
  });

  it('finds the auth code in result-retrieve replies', () => {
    const r = (text: string) => parseAuthcodeResult(parseReply(text));
    expect(r(`Status-Code: 0\n\nCompletion-Status: ack\nAuth-ID: ${AUTHCODE}\n`)).toEqual({
      status: 'ack',
      authcode: AUTHCODE,
      message: null,
    });
    expect(r(`Status-Code: 0\nAuthID: "abc-123"\n\n`).authcode).toBe('abc-123');
    expect(r(`Status-Code: 0\n\nTransfer-Auth-Id: t-1\n`).authcode).toBe('t-1');
    expect(r(`Status-Code: 0\n\nAuth-Info: i-1\n`).authcode).toBe('i-1');
    expect(r(`Status-Code: 0\nResult: ACK\n\nStatus: ?\n`)).toEqual({
      status: 'pending',
      authcode: null,
      message: null,
    });
    expect(r(`Status-Code: 0\n\nResult: NACK\nError: Domain is locked\n`)).toEqual({
      status: 'nack',
      authcode: null,
      message: 'Domain is locked',
    });
    const redacted = redactAuthcodes(
      parseReply(`Status-Code: 0\nAuth-ID: ${AUTHCODE}\n\nNote: ${AUTHCODE}\n`),
    );
    expect(JSON.stringify(redacted)).not.toContain(AUTHCODE);
  });
});

// --- Adapter -------------------------------------------------------------------------

describe('JokerAdapter', () => {
  it('has no servers', async () => {
    const a = adapter();
    expect(a.type).toBe('joker');
    expect(a.capabilities()).toEqual([]);
    expect(a.powerActions()).toEqual([]);
    expect(await a.listServers()).toEqual([]);
    expect((await caught(a.getServer(ref))).statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('tests the connection and summarizes the account', async () => {
    const a = adapter();
    expect(await a.testConnection()).toEqual({
      account: 'reseller@weblion.example',
      balance: 123.45,
      currency: 'EUR',
      domains: 3,
    });
    expect((await a.overview()).facts).toEqual([
      { label: 'Account', value: 'reseller@weblion.example' },
      { label: 'Balance', value: '123.45 EUR' },
      { label: 'Domains', value: '3' },
      { label: 'DNS zones at Joker', value: '2' },
    ]);
  });

  it('lists domains with one query-domain-list call', async () => {
    const domains = await adapter().listDomains();
    expect(calls.map((c) => c.request)).toEqual(['login', 'query-domain-list']);
    expect(calls[1]!.form.get('showstatus')).toBe('1');
    expect(calls[1]!.form.get('showjokerns')).toBe('1');
    expect(domains[0]).toEqual({
      externalId: 'example.com',
      name: 'example.com',
      status: 'active',
      info: {
        name: 'example.com',
        status: 'active',
        terminated: false,
        expiresAt: '2027-01-01T00:00:00.000Z',
        autoRenew: true,
        locked: true,
        providerDns: true,
      },
      meta: { flags: ['lock', 'autorenew'] },
    });
    expect(domains[1]!.info).toMatchObject({
      status: 'active',
      autoRenew: false,
      locked: false,
      providerDns: false,
    });
    expect(domains[2]!.info).toMatchObject({ status: 'deleted', terminated: true });
  });

  it('loads domain details from the whois and caches the zone list', async () => {
    const a = adapter();
    const info = await a.getDomain('Example.COM');
    expect(info).toEqual({
      name: 'example.com',
      status: 'active',
      terminated: false,
      nameservers: ['a.ns.joker.com', 'b.ns.joker.com'],
      handle: 'CODE-OWNER',
      createdAt: '2014-08-13T08:03:04.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      autoRenew: true,
      locked: true,
      privacy: 'basic',
      dnssec: false,
      providerDns: true,
      registrant: { name: 'Lars Example', organization: 'Weblion GmbH', email: 'owner@example.com' },
    });
    await a.getDomain('example.com');
    expect(requestsOf('dns-zone-list')).toHaveLength(1);
    expect(requestsOf('query-whois')).toHaveLength(2);
    const missing = await caught(a.getDomain('unknown.org'));
    expect(missing.message).toBe(
      'Joker: query-whois failed: Object does not exist: Domain not found (status 2303, Tracking-Id TR-404)',
    );
  });

  it('declares the Joker capabilities and record types', () => {
    const a = adapter();
    expect(a.domainCapabilities()).toEqual([
      'dns',
      'dnsTtl',
      'nameservers',
      'lock',
      'autoRenew',
      'renew',
      'authcode',
    ]);
    expect(a.dnsRecordTypes()).toEqual([
      'A',
      'AAAA',
      'CNAME',
      'MX',
      'TXT',
      'SRV',
      'CAA',
      'NAPTR',
      'HTTP_REDIRECT',
      'HTTP_FRAME',
      'MAILFW',
    ]);
  });

  describe('DNS', () => {
    it('lists the records of a Joker zone and nothing for other name servers', async () => {
      const a = adapter();
      expect(await a.dnsWritable()).toBe(true);
      const records = await a.listDnsRecords('example.com');
      expect(records).toHaveLength(21);
      expect(records.filter((r) => r.readOnly).map((r) => r.type)).toEqual([
        'DYNA',
        'DYNAAAA',
        'FOO',
        'NS',
        'A',
      ]);
      expect(await a.listDnsRecords('example.net')).toEqual([]);
      expect(requestsOf('dns-zone-get').map((c) => c.form.get('domain'))).toEqual(['example.com']);
      expect(requestsOf('dns-zone-list')).toHaveLength(1);
    });

    it('adds a record and leaves every other line as it was', async () => {
      const a = adapter();
      const record = await a.addDnsRecord('example.com', {
        type: 'TXT',
        name: '_dmarc',
        data: 'v=DMARC1; p=none',
      });
      const put = requestsOf('dns-zone-put');
      expect(put).toHaveLength(1);
      expect(put[0]!.form.get('domain')).toBe('example.com');
      const lines = put[0]!.form.get('zone')!.split('\n');
      expect(lines).toEqual([...ZONE_LINES.slice(0, -1), '_dmarc TXT 0 "v=DMARC1; p=none" 3600', '']);
      expect(record).toMatchObject({ type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none', ttl: 3600 });
      const listed = await a.listDnsRecords('example.com');
      expect(listed.find((r) => r.id === record!.id)).toEqual(record);
    });

    it('updates a record in place, keeping its TTL and FRAME parameters', async () => {
      const a = adapter();
      const records = await a.listDnsRecords('example.com');
      const www = records.find((r) => r.name === 'www')!;
      const changed = await a.updateDnsRecord('example.com', www.id, { data: '192.0.2.20' });
      expect(changed).toMatchObject({ type: 'A', name: 'www', data: '192.0.2.20', ttl: 86400 });
      let lines = sim.zones.get('example.com')!.split('\n');
      expect(lines).toEqual(ZONE_LINES.map((l, i) => (i === 3 ? 'www A 0 192.0.2.20 86400' : l)));

      const frame = records.find((r) => r.type === 'HTTP_FRAME')!;
      await a.updateDnsRecord('example.com', frame.id, { data: 'https://www.weblion.example/', ttl: 600 });
      lines = sim.zones.get('example.com')!.split('\n');
      expect(lines[16]).toBe(
        'frame FRAME 0 https://www.weblion.example/ 600 0 0 "Header: Frame-Forward" "head" "title" "body"',
      );
      expect(lines.filter((_, i) => i !== 3 && i !== 16)).toEqual(
        ZONE_LINES.filter((_, i) => i !== 3 && i !== 16),
      );
    });

    it('deletes records, read-only ones included', async () => {
      const a = adapter();
      const dyna = (await a.listDnsRecords('example.com')).find((r) => r.type === 'DYNA')!;
      await a.deleteDnsRecord('example.com', dyna.id);
      expect(sim.zones.get('example.com')).toBe(
        ZONE_LINES.filter((l) => !l.startsWith('home DYNA')).join('\n'),
      );
    });

    it('refuses stale ids and read-only records', async () => {
      const a = adapter();
      const records = await a.listDnsRecords('example.com');
      const www = records.find((r) => r.name === 'www')!;
      await a.updateDnsRecord('example.com', www.id, { data: '192.0.2.21' });
      expect(
        (await caught(a.updateDnsRecord('example.com', www.id, { data: '192.0.2.22' }))).statusCode,
      ).toBe(404);
      expect((await caught(a.deleteDnsRecord('example.com', www.id))).statusCode).toBe(404);
      const dyna = records.find((r) => r.type === 'DYNA')!;
      const readOnly = await caught(a.updateDnsRecord('example.com', dyna.id, { data: '198.51.100.8' }));
      expect(readOnly.statusCode).toBe(400);
      expect(requestsOf('dns-zone-put')).toHaveLength(1);
    });

    it('checks TTLs: at least 300 s, 0 for SRV and NAPTR, 3600 by default', async () => {
      const a = adapter();
      const low = await caught(
        a.addDnsRecord('example.com', { type: 'A', name: 'x', data: '192.0.2.1', ttl: 60 }),
      );
      expect(low.statusCode).toBe(400);
      expect(low.message).toContain('at least 300 seconds');
      expect(requestsOf('dns-zone-get')).toHaveLength(0);
      const srv = await a.addDnsRecord('example.com', {
        type: 'SRV',
        name: '_xmpp._tcp',
        data: '5 0 5222 xmpp.example.com',
        ttl: 0,
      });
      expect(srv).toMatchObject({ data: '5 0 5222 xmpp.example.com', ttl: 0 });
      const mx = (await a.listDnsRecords('example.com')).find((r) => r.data === '20 ASPMX.L.GOOGLE.COM')!;
      expect((await caught(a.updateDnsRecord('example.com', mx.id, { ttl: 299 }))).statusCode).toBe(400);
      const unsupported = await caught(
        a.addDnsRecord('example.com', { type: 'NS', name: 'sub', data: 'ns.example.com' }),
      );
      expect(unsupported.statusCode).toBe(400);
    });

    it('serializes concurrent changes of one zone', async () => {
      const a = adapter();
      await Promise.all([
        a.addDnsRecord('example.com', { type: 'A', name: 'one', data: '192.0.2.1' }),
        a.addDnsRecord('example.com', { type: 'A', name: 'two', data: '192.0.2.2' }),
        a.addDnsRecord('example.com', { type: 'A', name: 'three', data: '192.0.2.3' }),
      ]);
      const names = zoneRecords(parseZone(sim.zones.get('example.com')!)).map((r) => r.name);
      expect(names.slice(-3).sort()).toEqual(['one', 'three', 'two']);
    });

    it('refuses changes for domains without a Joker zone', async () => {
      const err = await caught(
        adapter().addDnsRecord('example.net', { type: 'A', name: 'x', data: '192.0.2.1' }),
      );
      expect(err.statusCode).toBe(422);
      expect(requestsOf('dns-zone-list')).toHaveLength(2);
      expect(requestsOf('dns-zone-get')).toHaveLength(0);
    });
  });

  describe('registry actions', () => {
    it('sets name servers', async () => {
      const a = adapter();
      const result = await a.setNameservers('example.com', ['NS1.Example.NET.', 'ns2.example.net']);
      expect(result).toEqual({ providerRef: '5000', message: 'Name server change submitted' });
      const [modify] = requestsOf('domain-modify');
      expect(modify!.form.get('domain')).toBe('example.com');
      expect(modify!.form.get('ns-list')).toBe('ns1.example.net:ns2.example.net');
      expect((await caught(a.setNameservers('example.com', ['ns1.example.net']))).statusCode).toBe(400);
      const many = Array.from({ length: 14 }, (_, i) => `ns${i}.example.net`);
      expect((await caught(a.setNameservers('example.com', many))).statusCode).toBe(400);
      const twice = await caught(a.setNameservers('example.com', ['ns1.example.net', 'NS1.example.net.']));
      expect(twice.message).toContain('listed twice');
      expect(requestsOf('domain-modify')).toHaveLength(1);
    });

    it('switches the transfer lock and auto-renew', async () => {
      const a = adapter();
      expect(await a.setDomainLock('example.com', true)).toEqual({
        providerRef: '5000',
        message: 'Transfer lock requested',
      });
      expect((await a.setDomainLock('example.com', false)).providerRef).toBe('5001');
      expect(calls.filter((c) => c.request.startsWith('domain-')).map((c) => c.request)).toEqual([
        'domain-lock',
        'domain-unlock',
      ]);
      await a.setDomainAutoRenew('example.com', true);
      await a.setDomainAutoRenew('example.com', false);
      expect(
        requestsOf('domain-set-property').map((c) => [
          c.form.get('domain'),
          c.form.get('pname'),
          c.form.get('pvalue'),
        ]),
      ).toEqual([
        ['example.com', 'autorenew', '1'],
        ['example.com', 'autorenew', '0'],
      ]);
      // domain-set-property takes patterns: never let one through.
      expect((await caught(a.setDomainAutoRenew('*.com', true))).statusCode).toBe(400);
      expect(requestsOf('domain-set-property')).toHaveLength(2);
    });

    it('renews up to a target year so a repeated request cannot renew twice', async () => {
      const a = adapter();
      const seen = '2027-01-01T00:00:00.000Z';
      const result = await a.renewDomain('example.com', 2, seen);
      expect(result).toEqual({ providerRef: '5000', message: 'Renewal until 2029 submitted' });
      const [renew] = requestsOf('domain-renew');
      expect(renew!.form.get('domain')).toBe('example.com');
      expect(renew!.form.get('expyear')).toBe('2029');
      expect(renew!.form.has('period')).toBe(false);
      // Not applied yet: a repeat sends the same target year, which Joker skips.
      await a.renewDomain('example.com', 2, seen);
      expect(requestsOf('domain-renew').map((c) => c.form.get('expyear'))).toEqual(['2029', '2029']);

      // Applied meanwhile, but the answer got lost and the dialog still shows 2027: counting
      // from the new expiry would renew a second time, so nothing is sent.
      const renewed = WHOIS_COM.replace('domain.expires: 20270101000000', 'domain.expires: 20290101000000');
      sim.override = (call) => (call.request === 'query-whois' ? ok(renewed) : undefined);
      const repeated = await caught(a.renewDomain('example.com', 2, seen));
      expect(repeated.statusCode).toBe(409);
      expect(repeated.message).toContain('expires on 2029-01-01 by now');
      expect(requestsOf('domain-renew')).toHaveLength(2);
      // From the expiry the operator sees now it goes through.
      expect((await a.renewDomain('example.com', 1, '2029-01-01T00:00:00.000Z')).message).toBe(
        'Renewal until 2030 submitted',
      );
      // Without the seen expiry (unknown to the operator) it counts from the whois.
      expect((await a.renewDomain('example.com', 1)).message).toBe('Renewal until 2030 submitted');

      expect((await caught(a.renewDomain('example.com', 0))).statusCode).toBe(400);
      expect((await caught(a.renewDomain('example.com', 11))).statusCode).toBe(400);
      expect((await caught(a.renewDomain('example.com', 1, 'soon'))).statusCode).toBe(400);
      expect(requestsOf('domain-renew')).toHaveLength(4);
    });
  });

  describe('auth codes', () => {
    it('returns the code once Joker has it', async () => {
      const a = adapter();
      expect(await a.getDomainAuthcode('example.com')).toBe(AUTHCODE);
      expect(requestsOf('domain-transfer-get-auth-id').map((c) => c.form.get('domain'))).toEqual([
        'example.com',
      ]);
      expect(requestsOf('result-retrieve').map((c) => c.form.get('proc-id'))).toEqual(['5000']);
    });

    it('answers 409 while Joker is busy and polls the same request next time', async () => {
      const a = adapter();
      sim.authcode = 'pending';
      const pending = await caught(a.getDomainAuthcode('example.com'));
      expect(pending.statusCode).toBe(409);
      expect(pending.code).toBe('authcode_pending');
      expect(requestsOf('result-retrieve').length).toBeGreaterThan(1);
      sim.authcode = 'ready';
      expect(await a.getDomainAuthcode('example.com')).toBe(AUTHCODE);
      expect(requestsOf('domain-transfer-get-auth-id')).toHaveLength(1);
      expect(new Set(requestsOf('result-retrieve').map((c) => c.form.get('proc-id')))).toEqual(
        new Set(['5000']),
      );
      // Done: the next reveal asks for a fresh code.
      await a.getDomainAuthcode('example.com');
      expect(requestsOf('domain-transfer-get-auth-id')).toHaveLength(2);
    });

    it('asks again after 30 minutes', async () => {
      const a = adapter();
      sim.authcode = 'pending';
      await caught(a.getDomainAuthcode('example.com'));
      const now = Date.now.bind(Date);
      vi.spyOn(Date, 'now').mockImplementation(() => now() + 31 * 60_000);
      await caught(a.getDomainAuthcode('example.com'));
      expect(requestsOf('domain-transfer-get-auth-id')).toHaveLength(2);
    });

    it('does not mistake HTTP failures for a pending request', async () => {
      const a = adapter();
      sim.override = (call) =>
        call.request === 'result-retrieve' ? { status: 503, text: 'Service Unavailable' } : undefined;
      const err = await caught(a.getDomainAuthcode('example.com'));
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.message).toBe('Joker: result-retrieve failed: HTTP 503');
      expect(requestsOf('result-retrieve')).toHaveLength(1);
    });

    it('reports a failed new login and other DMAPI errors instead of a pending request', async () => {
      const a = adapter();
      sim.authcode = 'pending';
      expect((await caught(a.getDomainAuthcode('example.com'))).statusCode).toBe(409);
      // The session expired and the API key no longer works: the new login fails at HTTP 200.
      sim.sessions.clear();
      sim.override = (call) =>
        call.request === 'login'
          ? { text: reply({ 'Status-Code': '2400', 'Status-Text': 'Command failed' }) }
          : undefined;
      const login = await caught(a.getDomainAuthcode('example.com'));
      expect(login).toBeInstanceOf(ProviderError);
      expect(login.statusCode).toBe(502);
      expect(login.message).toMatch(/login failed: Command failed .*Check the API key/);
      expect(requestsOf('login')).toHaveLength(2);

      sim.override = (call) =>
        call.request === 'result-retrieve'
          ? { text: reply({ 'Status-Code': '2202', 'Status-Text': 'Authorization error' }) }
          : undefined;
      const before = requestsOf('result-retrieve').length;
      const refused = await caught(a.getDomainAuthcode('example.com'));
      expect(refused.statusCode).toBe(502);
      expect(refused.message).toBe('Joker: result-retrieve failed: Authorization error (status 2202)');
      expect(requestsOf('result-retrieve')).toHaveLength(before + 1);
      // Still the same request: once Joker answers again, the next try polls it.
      sim.override = undefined;
      sim.authcode = 'ready';
      expect(await a.getDomainAuthcode('example.com')).toBe(AUTHCODE);
      expect(requestsOf('domain-transfer-get-auth-id')).toHaveLength(1);
    });

    it('reports a refused request and starts over next time', async () => {
      const a = adapter();
      sim.authcode = 'nack';
      const err = await caught(a.getDomainAuthcode('example.com'));
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.message).toBe(
        'Joker: the auth code request was refused: Domain is in transfer (Proc-ID 5000)',
      );
      sim.authcode = 'ready';
      expect(await a.getDomainAuthcode('example.com')).toBe(AUTHCODE);
      expect(requestsOf('domain-transfer-get-auth-id')).toHaveLength(2);
    });
  });

  describe('API explorer', () => {
    it('sends DMAPI requests with query and body parameters', async () => {
      const res = await adapter().rawRequest('GET', '/query-whois?domain=example.com', { extra: 1 });
      expect(res.status).toBe(200);
      const data = res.data as { headers: Record<string, string>; body: string };
      expect(data.headers['Status-Code']).toBe('0');
      expect(data.body).toBe(WHOIS_COM);
      const [whois] = requestsOf('query-whois');
      expect(whois!.form.get('domain')).toBe('example.com');
      expect(whois!.form.get('extra')).toBe('1');
      expect(whois!.form.get('auth-sid')).toBe('sid-1-a1b2c3d4');
    });

    it('returns failures as they are and keeps its own session', async () => {
      const a = adapter();
      const res = await a.rawRequest('POST', 'query-whois', { domain: 'unknown.org', 'auth-sid': 'forged' });
      expect(res.status).toBe(200);
      expect((res.data as { headers: Record<string, string> }).headers.Error).toBe('Domain not found');
      expect(requestsOf('query-whois')[0]!.form.get('auth-sid')).toBe('sid-1-a1b2c3d4');
    });

    it('redacts auth codes and DynDNS passwords', async () => {
      const a = adapter();
      const res = await a.rawRequest('POST', '/result-retrieve?proc-id=5000');
      expect(JSON.stringify(res.data)).not.toContain(AUTHCODE);
      expect((res.data as { body: string }).body).toContain('Auth-ID: [redacted]');
      sim.override = (call) =>
        call.request === 'domain-transfer-get-auth-id'
          ? ok('', { 'Auth-ID': AUTHCODE, 'Proc-ID': '1' })
          : undefined;
      const direct = await a.rawRequest('POST', '/domain-transfer-get-auth-id', { domain: 'example.com' });
      expect(JSON.stringify(direct.data)).not.toContain(AUTHCODE);
      const zone = await a.rawRequest('POST', '/dns-zone-get?domain=example.com');
      expect((zone.data as { body: string }).body).toContain('$dyndns=yes:dyn-user:[redacted]');
      expect(JSON.stringify(zone.data)).not.toContain('dyn-Pass-123');
    });

    it('refuses login, logout and malformed paths', async () => {
      const a = adapter();
      expect((await caught(a.rawRequest('POST', '/login', { 'api-key': 'x' }))).statusCode).toBe(422);
      expect((await caught(a.rawRequest('GET', 'logout'))).statusCode).toBe(422);
      expect((await caught(a.rawRequest('GET', '/../etc/passwd'))).statusCode).toBe(400);
      expect(calls).toHaveLength(0);
    });

    it('takes GET only for read requests, since the explorer audits everything else', async () => {
      const a = adapter();
      const refused = await caught(
        a.rawRequest('GET', '/domain-modify?domain=example.com&ns-list=a.ns:b.ns'),
      );
      expect(refused.statusCode).toBe(400);
      expect(await caught(a.rawRequest('get', '/dns-zone-put', { domain: 'example.com' }))).toMatchObject({
        statusCode: 400,
      });
      expect(calls).toHaveLength(0);
      expect((await a.rawRequest('GET', '/dns-zone-list')).status).toBe(200);
      await a.rawRequest('GET', '/request/result-list');
      expect(requestsOf('result-list')).toHaveLength(1);
    });
  });
});
