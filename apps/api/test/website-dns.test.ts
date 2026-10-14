import { createSocket, type Socket } from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebsiteServerOptions } from '@weblion/shared';
import {
  DNS_CHECK_CACHE_MS,
  checkWebsiteDns,
  dnsCheckServers,
  dnsNameStatus,
  forgetWebsiteDnsCheck,
  normalizeIp,
  publicDnsLookup,
  websiteDnsCheck,
  websiteDnsLookup,
  type DnsAnswer,
  type DnsLookup,
} from '../src/modules/hosting/website-dns';
import type { ProviderAdapter } from '../src/providers/types';

const SERVER = { ipv4: ['203.0.113.10'], ipv6: ['2001:db8::10'] };
const ELSEWHERE = '198.51.100.7';
const expected = new Set(['203.0.113.10', '2001:db8::10']);

const answer = (a: string[], aaaa: string[] = [], error: string | null = null): DnsAnswer => ({
  a,
  aaaa,
  error,
});

/** A lookup from a fixed table; unknown names have no records. Counts the questions. */
function tableLookup(table: Record<string, DnsAnswer>) {
  const asked: string[] = [];
  const lookup: DnsLookup = async (name) => {
    asked.push(name);
    return table[name] ?? answer([]);
  };
  return { lookup, asked };
}

describe('status of a name', () => {
  it('is ok when every address is the server and at least one exists', () => {
    expect(dnsNameStatus(answer(['203.0.113.10']), expected)).toBe('ok');
    expect(dnsNameStatus(answer(['203.0.113.10'], ['2001:db8::10']), expected)).toBe('ok');
  });

  it('is ok for IPv6 only', () => {
    expect(dnsNameStatus(answer([], ['2001:db8::10']), expected)).toBe('ok');
  });

  it('is elsewhere as soon as one address is not the server', () => {
    expect(dnsNameStatus(answer([ELSEWHERE]), expected)).toBe('elsewhere');
    expect(dnsNameStatus(answer(['203.0.113.10', ELSEWHERE]), expected)).toBe('elsewhere');
    expect(dnsNameStatus(answer(['203.0.113.10'], ['2001:db8::99']), expected)).toBe('elsewhere');
    // An address that is certainly wrong outweighs a failed lookup of the other family.
    expect(dnsNameStatus(answer([ELSEWHERE], [], 'ESERVFAIL'), expected)).toBe('elsewhere');
  });

  it('is missing without addresses and error when the lookup failed', () => {
    expect(dnsNameStatus(answer([]), expected)).toBe('missing');
    expect(dnsNameStatus(answer([], [], 'ETIMEOUT'), expected)).toBe('error');
    expect(dnsNameStatus(answer(['203.0.113.10'], [], 'ESERVFAIL'), expected)).toBe('error');
  });

  it('compares IPv6 addresses in any notation', () => {
    expect(normalizeIp('2001:DB8:0:0::10')).toBe('2001:db8::10');
    expect(normalizeIp(' 203.0.113.10 ')).toBe('203.0.113.10');
    expect(dnsNameStatus(answer([], ['2001:0db8:0000::0010']), expected)).toBe('ok');
  });
});

describe('check of a website', () => {
  it('asks for the domain and its www counterpart and is ready only when both are ok', async () => {
    const { lookup, asked } = tableLookup({
      'shop.example': answer(['203.0.113.10'], ['2001:db8::10']),
      'www.shop.example': answer(['203.0.113.10']),
    });
    const result = await checkWebsiteDns('shop.example', SERVER, lookup, new Date('2026-10-12T10:00:00Z'));
    expect(asked.sort()).toEqual(['shop.example', 'www.shop.example']);
    expect(result).toEqual({
      expected: SERVER,
      names: [
        { name: 'shop.example', a: ['203.0.113.10'], aaaa: ['2001:db8::10'], status: 'ok' },
        { name: 'www.shop.example', a: ['203.0.113.10'], aaaa: [], status: 'ok' },
      ],
      ready: true,
      checkedAt: '2026-10-12T10:00:00.000Z',
    });

    const www = await checkWebsiteDns('www.shop.example', SERVER, lookup);
    expect(www.names.map((n) => n.name)).toEqual(['www.shop.example', 'shop.example']);
  });

  it('is not ready when one name is missing, elsewhere or failed', async () => {
    const cases: [DnsAnswer, string][] = [
      [answer([]), 'missing'],
      [answer([ELSEWHERE]), 'elsewhere'],
      [answer([], [], 'ESERVFAIL'), 'error'],
    ];
    for (const [www, status] of cases) {
      const { lookup } = tableLookup({ 'a.example': answer(['203.0.113.10']), 'www.a.example': www });
      const result = await checkWebsiteDns('a.example', SERVER, lookup);
      expect(result.ready).toBe(false);
      expect(result.names.map((n) => n.status)).toEqual(['ok', status]);
    }
  });
});

describe('cached check', () => {
  const adapter = {
    websiteServerOptions: async () => ({ ...SERVER }) as unknown as WebsiteServerOptions,
  } as unknown as ProviderAdapter;
  const env = { DNS_CHECK_RESOLVERS: '127.0.0.1' };

  it('keeps a result per website for a minute unless asked fresh', async () => {
    forgetWebsiteDnsCheck();
    const { lookup, asked } = tableLookup({ 'c.example': answer(['203.0.113.10']) });
    const website = { id: 'w1', domain: 'c.example', adapter };
    const now = Date.parse('2026-10-12T10:00:00Z');
    const first = await websiteDnsCheck(env, website, { lookup, now });
    expect(first.names[0]!.status).toBe('ok');
    expect(asked).toHaveLength(2);

    await websiteDnsCheck(env, website, { lookup, now: now + DNS_CHECK_CACHE_MS - 1 });
    expect(asked).toHaveLength(2);
    // Another website with the same domain has its own entry.
    await websiteDnsCheck(env, { ...website, id: 'w2' }, { lookup, now });
    expect(asked).toHaveLength(4);

    await websiteDnsCheck(env, website, { lookup, now, fresh: true });
    expect(asked).toHaveLength(6);
    await websiteDnsCheck(env, website, { lookup, now: now + DNS_CHECK_CACHE_MS + 1 });
    expect(asked).toHaveLength(8);

    forgetWebsiteDnsCheck('w1');
    await websiteDnsCheck(env, website, { lookup, now: now + DNS_CHECK_CACHE_MS + 2 });
    expect(asked).toHaveLength(10);
  });

  it('needs a provider with website options', async () => {
    const plain = {} as ProviderAdapter;
    await expect(
      websiteDnsCheck(env, { id: 'w3', domain: 'c.example', adapter: plain }),
    ).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('uses the simulated DNS of the demo and public DNS for names it does not know', async () => {
    const demo = {
      websiteDnsOverride: (name: string) =>
        name === 'known.example' ? { a: ['203.0.113.10'], aaaa: [] } : null,
    } as unknown as ProviderAdapter;
    const lookup = websiteDnsLookup({ DNS_CHECK_RESOLVERS: 'not-an-address' }, demo);
    expect(await lookup('known.example')).toEqual(answer(['203.0.113.10']));
    // Falls back to the configured resolvers, which are invalid here: a failed lookup.
    expect(await lookup('other.example')).toEqual(answer([], [], 'EBADRESOLVERS'));
  });

  it('reads the resolver list from the environment', () => {
    expect(dnsCheckServers('1.1.1.1, 9.9.9.9,,')).toEqual(['1.1.1.1', '9.9.9.9']);
    expect(dnsCheckServers('')).toEqual([]);
  });
});

// --- Public DNS against a local DNS server ----------------------------------------------------

interface Zone {
  a?: string[];
  aaaa?: string[];
  rcode?: number;
}

const NXDOMAIN = 3;
const SERVFAIL = 2;
const TYPE_A = 1;
const TYPE_AAAA = 28;

/** The records of the local server: what public resolvers would answer. */
const ZONE: Record<string, Zone> = {
  'ok.test': { a: ['203.0.113.10'], aaaa: ['2001:db8::10'] },
  'www.ok.test': { a: ['203.0.113.10'] },
  'v6.test': { aaaa: ['2001:db8::10'] },
  'www.v6.test': { aaaa: ['2001:db8::10'] },
  'cdn.test': { a: [ELSEWHERE] },
  'www.cdn.test': { a: [ELSEWHERE] },
  'broken.test': { rcode: SERVFAIL },
  'www.broken.test': { rcode: SERVFAIL },
};

function ipv6Bytes(ip: string): Buffer {
  const [head = '', tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  const bytes = Buffer.alloc(16);
  groups.forEach((g, i) => bytes.writeUInt16BE(parseInt(g, 16), i * 2));
  return bytes;
}

/** Answers one DNS question (RFC 1035 wire format) from ZONE. */
function respond(query: Buffer): Buffer {
  let offset = 12;
  const labels: string[] = [];
  while (query[offset]! > 0) {
    const length = query[offset]!;
    labels.push(query.subarray(offset + 1, offset + 1 + length).toString('ascii'));
    offset += length + 1;
  }
  offset += 1;
  const type = query.readUInt16BE(offset);
  const question = query.subarray(12, offset + 4);
  const zone = ZONE[labels.join('.').toLowerCase()];
  const rcode = zone ? (zone.rcode ?? 0) : NXDOMAIN;
  const records =
    rcode !== 0
      ? []
      : type === TYPE_A
        ? (zone?.a ?? []).map((ip) => Buffer.from(ip.split('.').map(Number)))
        : type === TYPE_AAAA
          ? (zone?.aaaa ?? []).map(ipv6Bytes)
          : [];
  const header = Buffer.alloc(12);
  header.writeUInt16BE(query.readUInt16BE(0), 0);
  header.writeUInt16BE(0x8180 | rcode, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(records.length, 6);
  const answers = records.map((rdata) => {
    const record = Buffer.alloc(12);
    record.writeUInt16BE(0xc00c, 0);
    record.writeUInt16BE(type, 2);
    record.writeUInt16BE(1, 4);
    record.writeUInt32BE(300, 6);
    record.writeUInt16BE(rdata.length, 10);
    return Buffer.concat([record, rdata]);
  });
  return Buffer.concat([header, question, ...answers]);
}

describe('public DNS', () => {
  let socket: Socket;
  let lookup: DnsLookup;

  beforeAll(async () => {
    socket = createSocket('udp4');
    socket.on('message', (msg, rinfo) => socket.send(respond(msg), rinfo.port, rinfo.address));
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    const { port } = socket.address() as AddressInfo;
    lookup = publicDnsLookup([`127.0.0.1:${port}`], { timeout: 1000, tries: 1 });
  });

  afterAll(() => {
    socket?.close();
  });

  it('reads A and AAAA records', async () => {
    expect(await lookup('ok.test')).toEqual(answer(['203.0.113.10'], ['2001:db8::10']));
    expect(await lookup('www.ok.test')).toEqual(answer(['203.0.113.10']));
  });

  it('takes no records and unknown names as empty answers, not failures', async () => {
    expect(await lookup('v6.test')).toEqual(answer([], ['2001:db8::10']));
    expect(await lookup('missing.test')).toEqual(answer([]));
  });

  it('reports a failing server as error', async () => {
    const result = await lookup('broken.test');
    expect(result.a).toEqual([]);
    expect(result.error).toBe('ESERVFAIL');
  });

  it('checks websites end to end', async () => {
    expect((await checkWebsiteDns('ok.test', SERVER, lookup)).ready).toBe(true);
    const v6 = await checkWebsiteDns('v6.test', SERVER, lookup);
    expect(v6.ready).toBe(true);
    expect(v6.names.map((n) => n.status)).toEqual(['ok', 'ok']);
    expect((await checkWebsiteDns('cdn.test', SERVER, lookup)).names.map((n) => n.status)).toEqual([
      'elsewhere',
      'elsewhere',
    ]);
    expect((await checkWebsiteDns('missing.test', SERVER, lookup)).names.map((n) => n.status)).toEqual([
      'missing',
      'missing',
    ]);
    expect((await checkWebsiteDns('broken.test', SERVER, lookup)).names.map((n) => n.status)).toEqual([
      'error',
      'error',
    ]);
  });
});
