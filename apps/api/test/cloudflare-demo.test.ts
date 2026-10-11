import { and, eq } from 'drizzle-orm';
import type { CdnSettingPatch, DnsRecord, DnsRecordInput } from '@weblion/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { domains, organizations, providerConnections } from '../src/db/schema';
import { seedDemo } from '../src/db/seed';
import { AppError } from '../src/lib/errors';
import {
  CLOUDFLARE_DOMAIN_CAPABILITIES,
  CLOUDFLARE_ID,
  CLOUDFLARE_RECORD_TYPES,
} from '../src/providers/cloudflare/constants';
import { DemoAdapter } from '../src/providers/demo/adapter';
import {
  DEMO_CLOUDFLARE_ACCOUNT,
  DemoCloudflareAdapter,
  demoCloudflareState,
  resetDemoCloudflare,
} from '../src/providers/demo/cloudflare';
import { demoDelegation, demoHostingState } from '../src/providers/demo/hosting';
import { createAdapter } from '../src/providers/registry';
import type { DnsRecordPatch } from '../src/providers/types';
import { DEMO_PASSWORD, createTestApp, type TestApp } from './helpers';

const CF = 'demo-cloudflare-test';
/** The demo registrar the zones get their delegation from (demo/hosting.ts). */
const REGISTRAR = 'demo-registrar-test';
const zoneId = (n: number) => `cf${String(n).padStart(30, '0')}`;
const recordId = (n: number) => `d${String(n).padStart(31, '0')}`;
const SHOP = zoneId(1);
const BEISPIEL = zoneId(2);
const ALT = zoneId(3);
/** Registrar domain ids of the demo (demo/hosting.ts). */
const REG = {
  musterAg: 'demo-dom-1',
  musterShop: 'demo-dom-2',
  huber: 'demo-dom-3',
  alpenblick: 'demo-dom-4',
};

const cf = () => new DemoCloudflareAdapter(CF);
const ns = (...names: string[]) => names.map((n) => `${n}.ns.cloudflare.com`);
const add = (zone: string, input: Omit<DnsRecordInput, 'type'> & { type: string }) =>
  cf().addDnsRecord(zone, input as DnsRecordInput);
const update = (zone: string, id: string, patch: Omit<DnsRecordPatch, 'type'> & { type?: string }) =>
  cf().updateDnsRecord(zone, id, patch as DnsRecordPatch);
const find = (records: DnsRecord[], type: string, name: string) => {
  const record = records.find((r) => r.type === type && r.name === name);
  if (!record) throw new Error(`no ${type} record ${name}`);
  return record;
};

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected the promise to reject');
}

const AUTO_CDN = {
  sslMode: 'full',
  sslAutomatic: true,
  alwaysUseHttps: false,
  developmentMode: false,
  developmentModeRemaining: null,
  editable: { sslMode: true, alwaysUseHttps: true, developmentMode: true },
};

describe('Demo Cloudflare', () => {
  beforeEach(() => DemoAdapter.reset());
  afterEach(() => {
    vi.useRealTimers();
    DemoAdapter.reset();
  });

  it('is a zone provider without servers, built for the cloudflare flavor', async () => {
    const adapter = createAdapter('demo', CF, { flavor: 'cloudflare' });
    expect(adapter).toBeInstanceOf(DemoCloudflareAdapter);
    expect(createAdapter('demo', CF, {})).toBeInstanceOf(DemoAdapter);
    expect(adapter.type).toBe('demo');
    expect(adapter.capabilities()).toEqual([]);
    expect(adapter.powerActions()).toEqual([]);
    expect(await adapter.listServers()).toEqual([]);
    const ref = { externalId: 'x', kind: 'vm' as const, node: null, meta: {} };
    expect((await caught(adapter.getServer(ref))).statusCode).toBe(404);
    expect(adapter.domainKind!()).toBe('zone');
    expect(adapter.domainCapabilities!()).toEqual(CLOUDFLARE_DOMAIN_CAPABILITIES);
    expect(adapter.dnsRecordTypes!()).toEqual([...CLOUDFLARE_RECORD_TYPES]);
    expect(await adapter.dnsWritable!()).toBe(true);
    expect(adapter.canCreateZones!()).toBe(true);
    // A zone host, not a registrar: no name server, lock or renewal methods.
    expect(adapter.setNameservers).toBeUndefined();
    expect(adapter.getDomainAuthcode).toBeUndefined();
  });

  it('starts with an active, a pending and a moved zone', async () => {
    const zones = await cf().listDomains();
    expect(zones.map((z) => [z.externalId, z.name, z.status])).toEqual([
      [SHOP, 'muster-shop.ch', 'active'],
      [BEISPIEL, 'beispiel-gmbh.de', 'pending'],
      [ALT, 'alt-muster.ch', 'moved'],
    ]);
    for (const zone of zones) expect(zone.externalId).toMatch(CLOUDFLARE_ID);
    expect(DEMO_CLOUDFLARE_ACCOUNT.id).toMatch(CLOUDFLARE_ID);

    const [shop, beispiel, alt] = zones;
    expect(shop).toEqual({
      externalId: SHOP,
      name: 'muster-shop.ch',
      status: 'active',
      info: {
        name: 'muster-shop.ch',
        status: 'active',
        terminated: false,
        nameservers: ns('ana', 'bob'),
        handle: null,
        createdAt: '2023-01-10T08:00:00.000Z',
        expiresAt: null,
        autoRenew: null,
        providerDns: true,
        zone: {
          status: 'active',
          type: 'full',
          paused: false,
          originalNameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
          originalRegistrar: 'Demo Registrar',
          activatedAt: '2023-01-10T14:30:00.000Z',
          plan: 'Free Website',
        },
      },
      meta: { zoneType: 'full', plan: 'free', accountId: DEMO_CLOUDFLARE_ACCOUNT.id },
    });
    expect(beispiel!.info).toMatchObject({
      nameservers: ns('ivy', 'rob'),
      createdAt: '2026-10-01T09:15:00.000Z',
      providerDns: false,
      zone: {
        status: 'pending',
        originalNameservers: ['ns1.example-registrar.de', 'ns2.example-registrar.de'],
        activatedAt: null,
      },
    });
    expect(alt!.info).toMatchObject({
      nameservers: ns('ana', 'bob'),
      providerDns: false,
      zone: { status: 'moved', originalNameservers: ['a.ns.joker.com', 'b.ns.joker.com'] },
    });
    expect(await cf().getDomain(BEISPIEL)).toEqual(beispiel!.info);

    // The demo registrar delegates muster-shop.ch to exactly these name servers.
    new DemoAdapter(REGISTRAR, {});
    expect(demoDelegation('muster-shop.ch')).toEqual(shop!.info!.nameservers);
  });

  it('seeds the records of each zone', async () => {
    const shop = await cf().listDnsRecords(SHOP);
    const plain = { proxied: false, proxiable: false, comment: null };
    expect(shop.map(({ id: _id, ...r }) => r)).toEqual([
      { type: 'A', name: '@', data: '185.101.20.11', ttl: 1, proxied: true, proxiable: true, comment: null },
      {
        type: 'CNAME',
        name: 'www',
        data: 'muster-shop.ch',
        ttl: 1,
        proxied: true,
        proxiable: true,
        comment: null,
      },
      { type: 'MX', name: '@', data: '10 mail.muster-ag.ch', ttl: 1, ...plain },
      {
        type: 'TXT',
        name: '@',
        data: 'google-site-verification=Xq3v9cWm2LkR8tYp0zNdA7sHbEu4FjGi1oQ6KeTr5yU',
        ttl: 3600,
        ...plain,
        comment: 'Google Search Console',
      },
      { type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none', ttl: 1, ...plain },
      { type: 'CAA', name: '@', data: '0 issue "letsencrypt.org"', ttl: 1, ...plain },
      { type: 'HTTPS', name: '@', data: '1 . alpn="h3,h2"', ttl: 1, readOnly: true, ...plain },
    ]);

    const beispiel = await cf().listDnsRecords(BEISPIEL);
    expect(beispiel.map((r) => [r.type, r.name, r.data, r.proxied, r.proxiable])).toEqual([
      ['A', '@', '203.0.113.20', false, true],
      ['CNAME', 'www', 'beispiel-gmbh.de', true, true],
      ['MX', '@', '10 mx.beispiel-gmbh.de', false, false],
      ['A', 'mx', '203.0.113.25', false, true],
      ['A', 'intern', '10.0.0.5', false, false],
    ]);
    const alt = await cf().listDnsRecords(ALT);
    expect(alt.map((r) => [r.type, r.name, r.data])).toEqual([['A', '@', '185.101.20.12']]);

    const ids = [...shop, ...beispiel, ...alt].map((r) => r.id);
    expect(ids).toEqual(ids.map((_, i) => recordId(i + 1)));
    for (const id of ids) expect(id).toMatch(CLOUDFLARE_ID);
  });

  it('starts with the CDN settings of each zone', async () => {
    expect(await cf().getCdnSettings(SHOP)).toEqual({
      ...AUTO_CDN,
      sslAutomatic: false,
      alwaysUseHttps: true,
    });
    // Automatic SSL/TLS, effective mode Full.
    expect(await cf().getCdnSettings(BEISPIEL)).toEqual(AUTO_CDN);
    expect(await cf().getCdnSettings(ALT)).toEqual(AUTO_CDN);
  });

  it('reports the account in the connection test and the overview', async () => {
    expect(await cf().testConnection()).toEqual({
      token: 'active',
      tokenExpires: null,
      account: 'Demo Account',
      accountId: DEMO_CLOUDFLARE_ACCOUNT.id,
      zones: 3,
      zoneCreation: true,
    });
    expect(await cf().overview()).toEqual({
      nodes: [],
      storages: [],
      facts: [
        { label: 'Account', value: 'Demo Account' },
        { label: 'Zones', value: '3' },
        { label: 'Active', value: '1' },
        { label: 'Pending', value: '1' },
        { label: 'Moved', value: '1' },
        { label: 'Zone creation', value: 'yes' },
      ],
    });
  });

  it('echoes explorer requests', async () => {
    expect(await cf().rawRequest('PATCH', '/zones/x/settings/ssl', { value: 'full' })).toEqual({
      status: 200,
      data: {
        method: 'PATCH',
        path: '/zones/x/settings/ssl',
        body: { value: 'full' },
        note: 'Demo provider echo',
      },
    });
    expect((await cf().rawRequest('GET', '/zones')).data).toMatchObject({ method: 'GET', body: null });
  });

  // --- Records ---------------------------------------------------------------------

  describe('records', () => {
    it('adds records with automatic TTL, unproxied, in the format the real adapter reads back', async () => {
      const a = await add(BEISPIEL, { type: 'A', name: 'Shop', data: '203.0.113.30' });
      expect(a).toEqual({
        id: recordId(14),
        type: 'A',
        name: 'shop',
        data: '203.0.113.30',
        ttl: 1,
        proxied: false,
        proxiable: true,
        comment: null,
      });
      expect(await cf().listDnsRecords(BEISPIEL)).toContainEqual(a);

      expect(
        await add(BEISPIEL, { type: 'CNAME', name: 'docs', data: 'Docs.Example.NET.', ttl: 300 }),
      ).toMatchObject({ data: 'docs.example.net', ttl: 300, proxiable: true });
      expect((await add(BEISPIEL, { type: 'MX', name: '@', data: '020  Backup-MX.example.net.' })).data).toBe(
        '20 backup-mx.example.net',
      );
      expect(
        (await add(BEISPIEL, { type: 'SRV', name: '_sip._tcp', data: '10 5 5060 sip.example.net.' })).data,
      ).toBe('10 5 5060 sip.example.net');
      expect(
        (await add(BEISPIEL, { type: 'CAA', name: '@', data: '0 issuewild letsencrypt.org' })).data,
      ).toBe('0 issuewild "letsencrypt.org"');
      expect((await add(BEISPIEL, { type: 'AAAA', name: 'v6', data: '2A0E:3E9::20' })).data).toBe(
        '2a0e:3e9::20',
      );
      expect(await add(BEISPIEL, { type: 'TXT', name: '', data: 'v=spf1 mx -all', ttl: 60 })).toMatchObject({
        name: '@',
        data: 'v=spf1 mx -all',
        ttl: 60,
        proxiable: false,
      });
    });

    it('proxies only A, AAAA and CNAME records', async () => {
      for (const input of [
        { type: 'MX', name: '@', data: '20 mx2.beispiel-gmbh.de' },
        { type: 'TXT', name: 'proxy', data: 'nope' },
        { type: 'CAA', name: '@', data: '0 iodef "mailto:security@beispiel-gmbh.de"' },
      ]) {
        const err = await caught(add(BEISPIEL, { ...input, proxied: true }));
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe('Only A, AAAA and CNAME records can be proxied');
      }
      expect(
        await add(BEISPIEL, { type: 'AAAA', name: '@', data: '2a0e:3e9::20', proxied: true }),
      ).toMatchObject({
        proxied: true,
        proxiable: true,
      });
      expect(
        await add(BEISPIEL, { type: 'CNAME', name: 'blog', data: 'ghs.example.net', proxied: true }),
      ).toMatchObject({ proxied: true });
      const mx = find(await cf().listDnsRecords(BEISPIEL), 'MX', '@');
      expect((await caught(update(BEISPIEL, mx.id, { proxied: true }))).statusCode).toBe(400);
      // A proxied CNAME cannot turn into a TXT record without dropping the proxy.
      const www = find(await cf().listDnsRecords(BEISPIEL), 'CNAME', 'www');
      expect((await caught(update(BEISPIEL, www.id, { type: 'TXT', data: 'x' }))).statusCode).toBe(400);
    });

    it('never proxies private addresses', async () => {
      const privateAddresses = [
        ['A', '10.1.2.3'],
        ['A', '172.16.0.1'],
        ['A', '172.31.255.254'],
        ['A', '192.168.1.1'],
        ['A', '127.0.0.1'],
        ['AAAA', 'fd00::1'],
        ['AAAA', 'fc12:3456::7'],
      ];
      for (const [i, [type, data]] of privateAddresses.entries()) {
        const err = await caught(add(BEISPIEL, { type: type!, name: `p${i}`, data: data!, proxied: true }));
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe(`${data} is a private address, Cloudflare cannot proxy it`);
        // Without the proxy they are fine, but not proxiable.
        expect(await add(BEISPIEL, { type: type!, name: `p${i}`, data: data! })).toMatchObject({
          proxied: false,
          proxiable: false,
        });
      }
      const publicAddresses = [
        ['A', '11.0.0.1'],
        ['A', '126.255.255.255'],
        ['A', '172.15.255.255'],
        ['A', '172.32.0.1'],
        ['A', '192.169.0.1'],
        ['AAAA', '2a0e:3e9::11'],
      ];
      for (const [i, [type, data]] of publicAddresses.entries()) {
        expect(await add(BEISPIEL, { type: type!, name: `q${i}`, data: data!, proxied: true })).toMatchObject(
          {
            proxied: true,
            proxiable: true,
          },
        );
      }

      // The seeded intern record cannot be proxied, a proxied record cannot point to a private address.
      const intern = find(await cf().listDnsRecords(BEISPIEL), 'A', 'intern');
      expect((await caught(update(BEISPIEL, intern.id, { proxied: true }))).statusCode).toBe(400);
      const apex = find(await cf().listDnsRecords(SHOP), 'A', '@');
      expect((await caught(update(SHOP, apex.id, { data: '192.168.0.10' }))).statusCode).toBe(400);
      // Unproxied first, then the private address is accepted.
      expect(await update(SHOP, apex.id, { proxied: false })).toMatchObject({
        proxied: false,
        proxiable: true,
      });
      expect(await update(SHOP, apex.id, { data: '192.168.0.10' })).toMatchObject({ proxiable: false });
    });

    it('takes TTL 1 (automatic) or 60 to 86400 seconds', async () => {
      for (const ttl of [0, 30, 59, 86_401, 90_000]) {
        const err = await caught(add(BEISPIEL, { type: 'TXT', name: `t${ttl}`, data: 'x', ttl }));
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe('TTL must be 1 (automatic) or between 60 and 86400 seconds');
      }
      for (const ttl of [1, 60, 3600, 86_400]) {
        expect((await add(BEISPIEL, { type: 'TXT', name: `t${ttl}`, data: 'x', ttl })).ttl).toBe(ttl);
      }
      const txt = find(await cf().listDnsRecords(SHOP), 'TXT', '_dmarc');
      expect((await caught(update(SHOP, txt.id, { ttl: 30 }))).statusCode).toBe(400);
      expect(await update(SHOP, txt.id, { ttl: 7200 })).toMatchObject({ id: txt.id, ttl: 7200 });
    });

    it('forces the automatic TTL on proxied records', async () => {
      const cdn = await add(BEISPIEL, {
        type: 'A',
        name: 'cdn',
        data: '203.0.113.40',
        ttl: 3600,
        proxied: true,
      });
      expect(cdn).toMatchObject({ proxied: true, ttl: 1 });

      const api = await add(BEISPIEL, { type: 'A', name: 'api', data: '203.0.113.41', ttl: 300 });
      expect(api).toMatchObject({ proxied: false, ttl: 300 });
      expect(await update(BEISPIEL, api.id, { proxied: true })).toMatchObject({ proxied: true, ttl: 1 });
      expect(await update(BEISPIEL, api.id, { ttl: 600 })).toMatchObject({ proxied: true, ttl: 1 });
      // Without the proxy the automatic TTL stays until another one is set.
      expect(await update(BEISPIEL, api.id, { proxied: false })).toMatchObject({ proxied: false, ttl: 1 });
      expect(await update(BEISPIEL, api.id, { ttl: 600 })).toMatchObject({ ttl: 600 });
      // Fields left out keep their value.
      expect(await update(BEISPIEL, api.id, { data: '203.0.113.42' })).toEqual({
        id: api.id,
        type: 'A',
        name: 'api',
        data: '203.0.113.42',
        ttl: 600,
        proxied: false,
        proxiable: true,
        comment: null,
      });
    });

    it('keeps a CNAME record alone on its name', async () => {
      const message = 'An A, AAAA, or CNAME record with that host already exists.';
      for (const input of [
        { type: 'A', name: 'www', data: '185.101.20.11' },
        { type: 'TXT', name: 'WWW', data: 'x' },
        { type: 'CNAME', name: 'www', data: 'shop.example.net' },
        // The apex holds A, MX, TXT, CAA and HTTPS records.
        { type: 'CNAME', name: '@', data: 'shop.example.net' },
      ]) {
        const err = await caught(add(SHOP, input));
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe(message);
      }
      const records = await cf().listDnsRecords(SHOP);
      expect((await caught(update(SHOP, find(records, 'TXT', '_dmarc').id, { name: 'www' }))).message).toBe(
        message,
      );
      expect(
        (await caught(update(SHOP, find(records, 'CAA', '@').id, { type: 'CNAME', data: 'x.example.net' })))
          .message,
      ).toBe(message);
      // The CNAME itself can change.
      const www = find(records, 'CNAME', 'www');
      expect(await update(SHOP, www.id, { data: 'shop.muster-shop.ch' })).toMatchObject({ id: www.id });

      // At the apex of an empty zone a CNAME is fine (flattened), and then alone there.
      const { zone } = await cf().createZone('leer.ch');
      expect(await add(zone.externalId, { type: 'CNAME', name: '@', data: 'muster-shop.ch' })).toMatchObject({
        name: '@',
      });
      expect((await caught(add(zone.externalId, { type: 'TXT', name: '@', data: 'x' }))).message).toBe(
        message,
      );
    });

    it('refuses NS records at the apex and next to other records', async () => {
      const apex = await caught(add(BEISPIEL, { type: 'NS', name: '@', data: 'ns1.example.net' }));
      expect(apex.statusCode).toBe(400);
      expect(apex.message).toBe('Cloudflare manages the name servers of the zone itself');

      // A delegated subdomain with two name servers.
      const dev = await add(BEISPIEL, { type: 'NS', name: 'dev', data: 'ns1.example.net' });
      await add(BEISPIEL, { type: 'NS', name: 'dev', data: 'ns2.example.net' });
      const nsMessage = 'NS records cannot share their name with records of other types.';
      expect((await caught(add(BEISPIEL, { type: 'A', name: 'dev', data: '203.0.113.50' }))).message).toBe(
        nsMessage,
      );
      expect((await caught(add(BEISPIEL, { type: 'NS', name: 'mx', data: 'ns1.example.net' }))).message).toBe(
        nsMessage,
      );
      expect((await caught(update(BEISPIEL, dev.id, { name: '@' }))).message).toBe(
        'Cloudflare manages the name servers of the zone itself',
      );
      expect(
        (await caught(add(BEISPIEL, { type: 'NS', name: 'dev', data: 'NS1.example.net.' }))).message,
      ).toBe('An identical record already exists.');
    });

    it('lists read-only types that can be deleted but not changed', async () => {
      const https = find(await cf().listDnsRecords(SHOP), 'HTTPS', '@');
      expect(https.readOnly).toBe(true);
      const err = await caught(update(SHOP, https.id, { ttl: 300 }));
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('HTTPS records cannot be changed, only deleted');

      for (const type of ['HTTPS', 'DNSKEY', 'ALIAS']) {
        const refused = await caught(add(SHOP, { type, name: 'x', data: 'example.net' }));
        expect(refused.statusCode).toBe(400);
        expect(refused.message).toBe(`${type} records cannot be added or changed at Cloudflare`);
      }
      const txt = find(await cf().listDnsRecords(SHOP), 'TXT', '_dmarc');
      expect((await caught(update(SHOP, txt.id, { type: 'DNSKEY' }))).statusCode).toBe(400);

      await cf().deleteDnsRecord(SHOP, https.id);
      expect((await cf().listDnsRecords(SHOP)).map((r) => r.id)).not.toContain(https.id);
      expect((await caught(cf().deleteDnsRecord(SHOP, https.id))).statusCode).toBe(404);
    });

    it('gives a record a new id when its type changes', async () => {
      const mx = find(await cf().listDnsRecords(BEISPIEL), 'A', 'mx');
      const changed = await update(BEISPIEL, mx.id, { type: 'AAAA', data: '2a0e:3e9::25' });
      expect(changed.id).not.toBe(mx.id);
      expect(changed.id).toMatch(CLOUDFLARE_ID);
      expect(changed).toMatchObject({ type: 'AAAA', name: 'mx', data: '2a0e:3e9::25', ttl: 1 });
      const ids = (await cf().listDnsRecords(BEISPIEL)).map((r) => r.id);
      expect(ids).toContain(changed.id);
      expect(ids).not.toContain(mx.id);
      expect((await caught(update(BEISPIEL, mx.id, { ttl: 300 }))).statusCode).toBe(404);

      // The same type keeps id and comment; a new type drops the comment like the batch call.
      const txt = find(await cf().listDnsRecords(SHOP), 'TXT', '@');
      expect(await update(SHOP, txt.id, { data: 'google-site-verification=neu' })).toMatchObject({
        id: txt.id,
        comment: 'Google Search Console',
        ttl: 3600,
      });
      const retyped = await update(SHOP, txt.id, { type: 'MX', data: '20 mx2.muster-ag.ch' });
      expect(retyped).toMatchObject({
        type: 'MX',
        name: '@',
        data: '20 mx2.muster-ag.ch',
        ttl: 3600,
        comment: null,
      });
      expect(retyped.id).not.toBe(txt.id);
    });

    it('deletes records', async () => {
      const intern = find(await cf().listDnsRecords(BEISPIEL), 'A', 'intern');
      await cf().deleteDnsRecord(BEISPIEL, intern.id);
      expect((await cf().listDnsRecords(BEISPIEL)).map((r) => r.name)).not.toContain('intern');
    });

    it('answers 404 for unknown zones and records', async () => {
      const unknown = zoneId(99);
      const missing = [
        () => cf().getDomain(unknown),
        () => cf().listDnsRecords(unknown),
        () => add(unknown, { type: 'A', name: 'x', data: '203.0.113.1' }),
        () => cf().getCdnSettings(unknown),
        () => cf().updateCdnSetting(unknown, { alwaysUseHttps: true }),
        () => cf().purgeCache(unknown),
        () => cf().checkZoneActivation(unknown),
        () => cf().deleteDnsRecord(SHOP, recordId(999)),
        () => update(SHOP, recordId(999), { ttl: 300 }),
      ];
      for (const call of missing) expect((await caught(call())).statusCode).toBe(404);
      expect((await caught(cf().deleteDnsRecord(SHOP, recordId(999)))).message).toBe('DNS record not found');
    });

    it('keeps the state per connection across adapter instances until DemoAdapter.reset()', async () => {
      const early = cf();
      const added = await add(SHOP, { type: 'TXT', name: 'keep', data: 'kept' });
      expect(await new DemoCloudflareAdapter(CF).listDnsRecords(SHOP)).toContainEqual(added);
      expect(
        demoCloudflareState(CF)
          .zones.get(SHOP)!
          .records.map((r) => r.id),
      ).toContain(added.id);
      expect(await new DemoCloudflareAdapter('another-connection').listDnsRecords(SHOP)).not.toContainEqual(
        added,
      );

      DemoAdapter.reset();
      expect(await cf().listDnsRecords(SHOP)).not.toContainEqual(added);
      // An adapter the registry cached before the reset sees the fresh state too.
      expect(await early.listDnsRecords(SHOP)).not.toContainEqual(added);
      expect((await early.listDnsRecords(SHOP)).map((r) => r.id)).toContain(recordId(1));

      const again = await add(SHOP, { type: 'TXT', name: 'keep', data: 'kept' });
      resetDemoCloudflare();
      expect(await cf().listDnsRecords(SHOP)).not.toContainEqual(again);
    });
  });

  // --- Zones -------------------------------------------------------------------------

  describe('zone creation', () => {
    it('creates pending zones with name servers from the pool', async () => {
      new DemoAdapter(REGISTRAR, {});
      const first = await cf().createZone('Baeckerei-Huber.CH.');
      expect(first.created).toBe(true);
      expect(first.zone).toMatchObject({
        externalId: zoneId(4),
        name: 'baeckerei-huber.ch',
        status: 'pending',
        meta: { zoneType: 'full', plan: 'free', accountId: DEMO_CLOUDFLARE_ACCOUNT.id },
        info: {
          nameservers: ns('lea', 'tom'),
          providerDns: false,
          expiresAt: null,
          zone: {
            status: 'pending',
            type: 'full',
            paused: false,
            // What the demo registrar delegates to today.
            originalNameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
            originalRegistrar: null,
            activatedAt: null,
            plan: 'Free Website',
          },
        },
      });
      expect(first.zone.info!.createdAt).toEqual(expect.any(String));
      expect(await cf().listDnsRecords(zoneId(4))).toEqual([]);
      expect(await cf().getCdnSettings(zoneId(4))).toEqual(AUTO_CDN);

      const second = await cf().createZone('neu-kunde.ch');
      expect(second.zone.info).toMatchObject({
        nameservers: ns('kim', 'max'),
        zone: { originalNameservers: [] },
      });
      expect((await cf().createZone('dritter.ch')).zone.info!.nameservers).toEqual(ns('eva', 'leo'));
      expect((await cf().createZone('vierter.ch')).zone.info!.nameservers).toEqual(ns('lea', 'tom'));

      expect((await cf().listDomains()).map((z) => [z.externalId, z.status])).toEqual([
        [SHOP, 'active'],
        [BEISPIEL, 'pending'],
        [ALT, 'moved'],
        [zoneId(4), 'pending'],
        [zoneId(5), 'pending'],
        [zoneId(6), 'pending'],
        [zoneId(7), 'pending'],
      ]);
      expect((await cf().testConnection()).zones).toBe(7);
    });

    it('reuses a zone of the same name', async () => {
      const shop = (await cf().listDomains())[0];
      expect(await cf().createZone('muster-shop.ch')).toEqual({ created: false, zone: shop });
      const created = await cf().createZone('neu.ch');
      const reused = await cf().createZone('NEU.ch');
      expect(reused).toEqual({ created: false, zone: created.zone });
      expect(demoCloudflareState(CF).zones.size).toBe(4);
    });

    it('refuses invalid zone names', async () => {
      for (const name of ['localhost', 'bad_name.ch', '-x.ch', 'a..ch', '', 'x.c', 'with space.ch']) {
        const err = await caught(cf().createZone(name));
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe(`${name} is not a valid zone name`);
      }
      const unicode = await caught(cf().createZone('bäckerei.ch'));
      expect(unicode.statusCode).toBe(400);
      expect(unicode.message).toBe('bäckerei.ch is not an ASCII name, use the xn-- form');
      expect((await cf().createZone('xn--bckerei-dxa.ch')).created).toBe(true);
      expect(demoCloudflareState(CF).zones.size).toBe(4);
    });
  });

  describe('activation', () => {
    it('finds the delegation of a registrar domain in any demo connection', () => {
      expect(demoDelegation('muster-shop.ch')).toBeNull();
      demoHostingState(REGISTRAR);
      expect(demoDelegation('MUSTER-SHOP.ch')).toEqual(ns('ana', 'bob'));
      const copy = demoDelegation('muster-ag.ch')!;
      copy.push('ns3.example.net');
      expect(demoDelegation('muster-ag.ch')).toEqual(['ns1.fireapi.de', 'ns2.fireapi.de']);
      expect(demoDelegation('unknown.ch')).toBeNull();
    });

    it('activates a pending zone once the registrar delegates to it (getDomain, listDomains)', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
      const registrar = new DemoAdapter(REGISTRAR, {});
      const { zone } = await cf().createZone('baeckerei-huber.ch');
      expect(zone.info!.nameservers).toEqual(ns('lea', 'tom'));
      expect((await cf().getDomain(zone.externalId)).status).toBe('pending');

      // One of the two is not enough.
      await registrar.setNameservers(REG.huber, ['lea.ns.cloudflare.com', 'ns2.fireapi.de']);
      expect((await cf().getDomain(zone.externalId)).status).toBe('pending');

      // Order, case and a trailing dot do not matter.
      await registrar.setNameservers(REG.huber, ['TOM.ns.cloudflare.com.', 'lea.ns.cloudflare.com']);
      vi.setSystemTime(new Date('2026-10-10T12:05:00.000Z'));
      expect(await cf().getDomain(zone.externalId)).toMatchObject({
        status: 'active',
        providerDns: true,
        zone: { status: 'active', activatedAt: '2026-10-10T12:05:00.000Z' },
      });
      expect((await cf().listDomains()).find((z) => z.externalId === zone.externalId)!.status).toBe('active');

      // The zone list alone activates as well.
      const other = await cf().createZone('alpenblick-hotel.ch');
      await registrar.setNameservers(REG.alpenblick, other.zone.info!.nameservers!);
      expect(demoCloudflareState(CF).zones.get(other.zone.externalId)!.status).toBe('pending');
      const listed = (await cf().listDomains()).find((z) => z.externalId === other.zone.externalId)!;
      expect(listed).toMatchObject({ status: 'active', info: { providerDns: true } });
    });

    it('activates through checkZoneActivation and refuses zones that are not pending', async () => {
      const registrar = new DemoAdapter(REGISTRAR, {});
      const { zone } = await cf().createZone('muster-ag.ch');
      const status = () => demoCloudflareState(CF).zones.get(zone.externalId)!.status;
      const requested = { providerRef: null, message: 'Activation check requested' };

      expect(await cf().checkZoneActivation(zone.externalId)).toEqual(requested);
      expect(status()).toBe('pending');
      await registrar.setNameservers(REG.musterAg, zone.info!.nameservers!);
      expect(await cf().checkZoneActivation(zone.externalId)).toEqual(requested);
      expect(status()).toBe('active');
      expect(demoCloudflareState(CF).zones.get(zone.externalId)!.activatedAt).toEqual(expect.any(String));

      for (const id of [zone.externalId, SHOP, ALT]) {
        const err = await caught(cf().checkZoneActivation(id));
        expect(err.statusCode).toBe(409);
      }
      expect((await caught(cf().checkZoneActivation(SHOP))).message).toBe(
        'muster-shop.ch is not waiting for activation (status active)',
      );

      // beispiel-gmbh.de is not at the demo registrar: it stays pending.
      expect(await cf().checkZoneActivation(BEISPIEL)).toEqual(requested);
      expect((await cf().getDomain(BEISPIEL)).status).toBe('pending');
    });
  });

  // --- CDN ---------------------------------------------------------------------------

  describe('CDN', () => {
    it('switches Always Use HTTPS', async () => {
      expect(await cf().updateCdnSetting(SHOP, { alwaysUseHttps: false })).toMatchObject({
        alwaysUseHttps: false,
      });
      expect((await cf().getCdnSettings(SHOP)).alwaysUseHttps).toBe(false);
      expect(await cf().updateCdnSetting(BEISPIEL, { alwaysUseHttps: true })).toMatchObject({
        alwaysUseHttps: true,
      });
    });

    it('switches between Automatic SSL/TLS and a manual mode', async () => {
      // A manual mode turns Automatic SSL/TLS off ("custom").
      expect(await cf().updateCdnSetting(BEISPIEL, { sslMode: 'strict' })).toMatchObject({
        sslMode: 'strict',
        sslAutomatic: false,
      });
      // Automatic keeps a stricter mode and raises a weaker one to Full.
      expect(await cf().updateCdnSetting(BEISPIEL, { sslMode: 'auto' })).toMatchObject({
        sslMode: 'strict',
        sslAutomatic: true,
      });
      expect(await cf().updateCdnSetting(SHOP, { sslMode: 'flexible' })).toMatchObject({
        sslMode: 'flexible',
        sslAutomatic: false,
      });
      expect(await cf().updateCdnSetting(SHOP, { sslMode: 'auto' })).toMatchObject({
        sslMode: 'full',
        sslAutomatic: true,
      });
      expect(await cf().updateCdnSetting(SHOP, { sslMode: 'off' })).toMatchObject({
        sslMode: 'off',
        sslAutomatic: false,
      });
      expect(await cf().getCdnSettings(SHOP)).toMatchObject({ sslMode: 'off', sslAutomatic: false });
    });

    it('refuses settings the plan does not allow and malformed changes', async () => {
      const cdn = demoCloudflareState(CF).zones.get(SHOP)!.cdn;
      cdn.editable = { sslMode: false, alwaysUseHttps: false, developmentMode: false };
      for (const patch of [{ sslMode: 'strict' }, { alwaysUseHttps: false }, { developmentMode: true }]) {
        const err = await caught(cf().updateCdnSetting(SHOP, patch as CdnSettingPatch));
        expect(err.statusCode).toBe(422);
      }
      expect(await cf().getCdnSettings(SHOP)).toEqual({
        ...AUTO_CDN,
        sslAutomatic: false,
        alwaysUseHttps: true,
        editable: { sslMode: false, alwaysUseHttps: false, developmentMode: false },
      });

      for (const patch of [
        {},
        { sslMode: 'full', alwaysUseHttps: true },
        { sslMode: 'origin_pull' },
        { foo: 1 },
      ]) {
        const err = await caught(cf().updateCdnSetting(BEISPIEL, patch as unknown as CdnSettingPatch));
        expect(err.statusCode).toBe(400);
      }
      expect(await cf().getCdnSettings(BEISPIEL)).toEqual(AUTO_CDN);
    });

    it('counts development mode down and switches it off after 3 hours', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const t0 = Date.parse('2026-10-10T08:00:00.000Z');
      vi.setSystemTime(t0);
      expect(await cf().updateCdnSetting(SHOP, { developmentMode: true })).toMatchObject({
        developmentMode: true,
        developmentModeRemaining: 10_800,
      });
      vi.setSystemTime(t0 + 61_000);
      expect(await cf().getCdnSettings(SHOP)).toMatchObject({
        developmentMode: true,
        developmentModeRemaining: 10_739,
      });
      vi.setSystemTime(t0 + 10_799_000);
      expect((await cf().getCdnSettings(SHOP)).developmentModeRemaining).toBe(1);
      vi.setSystemTime(t0 + 10_800_000);
      expect(await cf().getCdnSettings(SHOP)).toMatchObject({
        developmentMode: false,
        developmentModeRemaining: null,
      });
      vi.setSystemTime(t0 + 20_000_000);
      expect((await cf().getCdnSettings(SHOP)).developmentMode).toBe(false);

      // Switching it on again starts the 3 hours anew; off by hand ends it at once.
      const t1 = t0 + 30_000_000;
      vi.setSystemTime(t1);
      await cf().updateCdnSetting(SHOP, { developmentMode: true });
      vi.setSystemTime(t1 + 3_600_000);
      expect((await cf().getCdnSettings(SHOP)).developmentModeRemaining).toBe(7_200);
      expect((await cf().updateCdnSetting(SHOP, { developmentMode: true })).developmentModeRemaining).toBe(
        10_800,
      );
      expect(await cf().updateCdnSetting(SHOP, { developmentMode: false })).toMatchObject({
        developmentMode: false,
        developmentModeRemaining: null,
      });
    });

    it('accepts purges with a reference per request', async () => {
      expect(await cf().purgeCache(SHOP)).toEqual({ providerRef: 'demo-purge-1', message: 'Purge accepted' });
      expect(await new DemoCloudflareAdapter(CF).purgeCache(BEISPIEL)).toEqual({
        providerRef: 'demo-purge-2',
        message: 'Purge accepted',
      });
    });
  });
});

// ---------------------------------------------------------------------------------------

describe('Demo Cloudflare seed', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { ENABLE_DEMO_CLOUDFLARE: 'true' } });
  });
  afterAll(async () => {
    await t?.close();
  });

  const zoneOwners = async (connectionId: string) =>
    (
      await t.db
        .select({ name: domains.name, org: organizations.slug })
        .from(domains)
        .leftJoin(organizations, eq(organizations.id, domains.orgId))
        .where(eq(domains.providerConnectionId, connectionId))
        .orderBy(domains.name)
    ).map((r) => [r.name, r.org]);

  it('hands out the zones of the synced demo Cloudflare, only unassigned ones', async () => {
    const connection = await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo-cloudflare'),
    });
    expect(connection).toMatchObject({ type: 'demo', name: 'Demo Cloudflare' });
    // The first seed ran before the connection was synced: no zones yet, but the module is there.
    expect(await zoneOwners(connection!.id)).toEqual([]);
    const beispiel = await t.db.query.organizations.findFirst({
      where: eq(organizations.slug, 'beispiel-gmbh'),
    });
    expect(beispiel!.modules).toContain('dns');

    await t.ctx.sync.syncConnection(connection!);
    const log = await seedDemo(t.db, DEMO_PASSWORD);
    expect(log).toContain('assigned zone beispiel-gmbh.de to Beispiel GmbH');
    expect(await zoneOwners(connection!.id)).toEqual([
      ['alt-muster.ch', null],
      ['beispiel-gmbh.de', 'beispiel-gmbh'],
      ['muster-shop.ch', 'muster-ag'],
    ]);

    // Staff gave the shop zone to Beispiel GmbH: the seed leaves it there and has nothing to do.
    await t.db
      .update(domains)
      .set({ orgId: beispiel!.id })
      .where(and(eq(domains.providerConnectionId, connection!.id), eq(domains.name, 'muster-shop.ch')));
    const again = await seedDemo(t.db, DEMO_PASSWORD);
    expect(again.filter((line) => line.startsWith('assigned zone') || line.startsWith('module dns'))).toEqual(
      [],
    );
    expect(await zoneOwners(connection!.id)).toContainEqual(['muster-shop.ch', 'beispiel-gmbh']);
  });
});
