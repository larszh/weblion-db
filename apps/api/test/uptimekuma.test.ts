import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client';
import type { ProviderConnection } from '../src/db/schema';
import { SecretBox } from '../src/lib/crypto';
import { AppError, ProviderError } from '../src/lib/errors';
import { ProviderRegistry } from '../src/providers/registry';
import { UptimeKumaAdapter, type UptimeKumaAdapterOptions } from '../src/providers/uptimekuma/adapter';
import {
  MONITOR_SECRET_FIELDS,
  applyPatch,
  buildAddPayload,
  chartPoints,
  describeKumaMessage,
  kumaTarget,
  kumaTime,
  parseKumaMetrics,
  parsePrometheusText,
  redactMonitorSecrets,
  remoteFromJson,
  sanitizeUrl,
  statusFromKuma,
  statusPagePoints,
  timeoutFor,
  toMonitorConfig,
  toMonitorEvent,
  type KumaMonitorJson,
} from '../src/providers/uptimekuma/parse';
import { KumaSocket, kumaSignIn, type KumaEvent } from '../src/providers/uptimekuma/socket';
import type { MonitorInput } from '../src/providers/types';
import {
  KUMA_API_KEY,
  KUMA_NOW,
  KUMA_PASSWORD,
  KUMA_STATUS_PAGE,
  KUMA_TOTP,
  KUMA_USER,
  kumaChartData,
  kumaFixture,
  kumaTimeText,
  startKumaMock,
  type KumaMock,
} from './uptimekuma-mock';

// Short timeouts: the mock answers at once, and Kuma 3.x is simulated by no answer at all.
const FAST: UptimeKumaAdapterOptions = { ackTimeoutMs: 1500, connectTimeoutMs: 1500, idleMs: 60_000 };

const mocks: KumaMock[] = [];
const adapters: UptimeKumaAdapter[] = [];
const sockets: KumaSocket[] = [];

afterEach(async () => {
  for (const a of adapters.splice(0)) a.close();
  for (const s of sockets.splice(0)) s.close();
  for (const m of mocks.splice(0)) await m.close();
  vi.restoreAllMocks();
});

async function kuma(options: Parameters<typeof startKumaMock>[0] = {}): Promise<KumaMock> {
  const mock = await startKumaMock(options);
  mocks.push(mock);
  return mock;
}

function adapterFor(
  mock: KumaMock,
  options: UptimeKumaAdapterOptions & { token?: string | boolean; apiKey?: string } = {},
): UptimeKumaAdapter {
  const { token, apiKey, ...rest } = options;
  const sessionToken = token === true ? mock.token() : typeof token === 'string' ? token : undefined;
  const adapter = new UptimeKumaAdapter(
    { baseUrl: mock.url, apiKey: apiKey ?? KUMA_API_KEY, ...(sessionToken ? { sessionToken } : {}) },
    { ...FAST, ...rest },
  );
  adapters.push(adapter);
  return adapter;
}

function socketFor(mock: KumaMock, token: string, options: UptimeKumaAdapterOptions = {}): KumaSocket {
  const socket = new KumaSocket(mock.url, token, { ...FAST, ...options });
  sockets.push(socket);
  return socket;
}

function metricsRequests(mock: KumaMock): number {
  return mock.requests.filter((r) => r.path.startsWith('/metrics')).length;
}

function lastEvent(mock: KumaMock, event: string) {
  const found = mock.events.filter((e) => e.event === event).at(-1);
  if (!found) throw new Error(`no ${event} event recorded`);
  return found;
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected a rejection');
}

const fixtureMonitor = () => JSON.parse(kumaFixture('monitor-2.5.6.json')) as KumaMonitorJson;
const SECRET_VALUES = [
  'hdr-secret-4711',
  'body-secret-4712',
  'basic-secret-4713',
  'client-4714',
  'oauth-secret-4715',
  'bearer-secret-4716',
  'tls-key-secret-4717',
  'monitor-4718',
  'abc123',
];

function input(fields: Partial<MonitorInput> & Pick<MonitorInput, 'kind'>): MonitorInput {
  return {
    name: '[muster-ag] Website',
    url: null,
    hostname: null,
    port: null,
    keyword: null,
    invertKeyword: false,
    method: 'GET',
    acceptedStatusCodes: ['200-299'],
    intervalSeconds: 60,
    ignoreTls: false,
    ...fields,
  };
}

/** The add payload every kind shares (section 9.3 of the design), for deep comparison. */
function addPayload(fields: Record<string, unknown>) {
  return {
    type: 'http',
    name: '[muster-ag] Website',
    url: 'https://',
    method: 'GET',
    hostname: null,
    port: null,
    keyword: null,
    invertKeyword: false,
    interval: 60,
    retryInterval: 60,
    resendInterval: 0,
    maxretries: 1,
    timeout: 48,
    notificationIDList: { '1': true },
    ignoreTls: false,
    upsideDown: false,
    expiryNotification: false,
    maxredirects: 10,
    accepted_statuscodes: ['200-299'],
    dns_resolve_type: 'A',
    dns_resolve_server: '1.1.1.1',
    docker_container: '',
    docker_host: null,
    proxyId: null,
    httpBodyEncoding: 'json',
    kafkaProducerBrokers: [],
    kafkaProducerSaslOptions: { mechanism: 'None' },
    rabbitmqNodes: [],
    conditions: [],
    ...fields,
  };
}

// ---------------------------------------------------------------------------

describe('Uptime Kuma parsing', () => {
  it('reads the Prometheus text format: comments, escapes, NaN, infinities, timestamps', () => {
    const text = [
      '# HELP demo A metric',
      '# TYPE demo gauge',
      '',
      'demo{a="quote \\" here",b="back\\\\slash",c="line\\nbreak",} 1.5',
      'nan_metric NaN',
      'inf_metric +Inf',
      'neg_inf{x="1"} -Inf',
      'with_ts{y="2"} 42 1700000000000',
      '   ',
      'broken{a="x} 1',
      'no_value{a="x"}',
    ].join('\r\n');
    const samples = parsePrometheusText(text);
    expect(samples.map((s) => s.name)).toEqual(['demo', 'nan_metric', 'inf_metric', 'neg_inf', 'with_ts']);
    expect(samples[0]).toEqual({
      name: 'demo',
      labels: { a: 'quote " here', b: 'back\\slash', c: 'line\nbreak' },
      value: 1.5,
    });
    expect(samples[1]?.value).toBeNaN();
    expect(samples[2]?.value).toBe(Infinity);
    expect(samples[3]?.value).toBe(-Infinity);
    expect(samples[4]).toEqual({ name: 'with_ts', labels: { y: '2' }, value: 42 });
  });

  it('maps the 2.5.6 metrics by monitor_id with averages in ms, uptime, certificates and version', () => {
    const metrics = parseKumaMetrics(kumaFixture('metrics-2.5.6.txt'));
    expect(metrics.version).toBe('2.5.6');
    expect(metrics.withoutId).toBe(0);
    expect(metrics.uptimeMetrics).toBe(true);
    expect([...metrics.monitors.keys()]).toEqual(['1', '2', '3', '4', '5']);
    expect(metrics.monitors.get('1')).toEqual({
      id: '1',
      name: 'Muster Website',
      type: 'http',
      url: 'https://www.muster-ag.ch/health?token=abc123',
      hostname: null,
      port: null,
      status: 1,
      facts: {
        responseMs: 182,
        avgResponseMs24h: 204,
        avgResponseMs30d: 198,
        uptime24h: 0.9993,
        uptime30d: 0.99987,
        certDaysRemaining: 54,
        certValid: true,
      },
    });
    const shop = metrics.monitors.get('2');
    expect(shop?.name).toBe('Shop "Warenkorb" \\ Check');
    expect(shop?.status).toBe(0);
    expect(shop?.facts.avgResponseMs30d).toBeNull();
    expect(metrics.monitors.get('3')?.facts).toMatchObject({ responseMs: 12, certDaysRemaining: null });
    expect(metrics.monitors.get('4')).toMatchObject({
      type: 'port',
      hostname: 'mail.muster-ag.ch',
      port: 587,
    });
    expect(metrics.monitors.get('4')?.status).toBe(2);
    // The Kuma tag "env" is a label of monitor 1 and ends up nowhere.
    expect(JSON.stringify([...metrics.monitors.values()])).not.toContain('production');
  });

  it('reads 2.0.0 metrics with ids but without uptime and averages', () => {
    const metrics = parseKumaMetrics(kumaFixture('metrics-2.0.0.txt'));
    expect(metrics.version).toBe('2.0.0');
    expect(metrics.monitors.size).toBe(5);
    expect(metrics.uptimeMetrics).toBe(false);
    for (const m of metrics.monitors.values()) {
      expect(m.facts).toMatchObject({
        uptime24h: null,
        uptime30d: null,
        avgResponseMs24h: null,
        avgResponseMs30d: null,
      });
    }
    expect(metrics.monitors.get('1')?.facts.responseMs).toBe(182);
  });

  it('counts 1.23 samples without monitor_id and refuses the instance', async () => {
    const metrics = parseKumaMetrics(kumaFixture('metrics-1.23.txt'));
    expect(metrics.monitors.size).toBe(0);
    expect(metrics.withoutId).toBeGreaterThan(0);
    expect(metrics.version).toBe('1.23.17');

    const mock = await kuma({ metrics: kumaFixture('metrics-1.23.txt') });
    const adapter = adapterFor(mock);
    await expect(adapter.testConnection()).rejects.toThrow('Uptime Kuma 1.x is not supported');
    await expect(adapter.listMonitors()).rejects.toThrow('update to 2.0 or newer');
  });

  it('treats -1 response, default URLs and null labels as missing and parses ports', () => {
    const text = [
      'monitor_response_time{monitor_id="7",monitor_name="A",monitor_type="port",monitor_url="https://",monitor_hostname="db.example.ch",monitor_port="5432"} -1',
      'monitor_status{monitor_id="8",monitor_name="B",monitor_type="push",monitor_url="http://",monitor_hostname="null",monitor_port="undefined"} 1',
      'monitor_status{monitor_id="9",monitor_name="C",monitor_type="dns",monitor_url="",monitor_hostname="",monitor_port="99999"} 7',
    ].join('\n');
    const metrics = parseKumaMetrics(text);
    expect(metrics.monitors.get('7')).toMatchObject({ url: null, hostname: 'db.example.ch', port: 5432 });
    expect(metrics.monitors.get('7')?.facts.responseMs).toBeNull();
    expect(metrics.monitors.get('8')).toMatchObject({ url: null, hostname: null, port: null, status: 1 });
    // Unknown status values and impossible ports are dropped, not guessed.
    expect(metrics.monitors.get('9')).toMatchObject({ url: null, hostname: null, port: null, status: null });
    expect(statusFromKuma(0)).toBe('down');
    expect(statusFromKuma(2)).toBe('pending');
    expect(statusFromKuma(3)).toBe('maintenance');
    expect(statusFromKuma(null)).toBe('unknown');
  });

  it('builds targets without credentials and with lower-case hosts', () => {
    expect(sanitizeUrl('https://user:pw@example.ch/path?token=abc&x=1')).toBe(
      'https://example.ch/path?token=***&x=1',
    );
    expect(sanitizeUrl('https://example.ch/a?apiKey=1&Signature=2&page=3#access_token=xyz&b=1')).toBe(
      'https://example.ch/a?apiKey=***&Signature=***&page=3#access_token=***&b=1',
    );
    expect(sanitizeUrl('https://a:b@not a host/x')).toBe('https://not a host/x');
    expect(kumaTarget('http', 'https://user:pw@WWW.Example.CH/a?token=abc&x=1', null, null)).toEqual({
      target: 'https://WWW.Example.CH/a?token=***&x=1',
      targetHost: 'www.example.ch',
    });
    expect(kumaTarget('keyword', 'https://[2001:DB8::1]:8443/x', null, null)).toEqual({
      target: 'https://[2001:DB8::1]:8443/x',
      targetHost: '2001:db8::1',
    });
    expect(kumaTarget('ping', 'https://', '198.51.100.7', null)).toEqual({
      target: '198.51.100.7',
      targetHost: '198.51.100.7',
    });
    expect(kumaTarget('port', null, 'Mail.Muster-AG.ch', 587)).toEqual({
      target: 'mail.muster-ag.ch:587',
      targetHost: 'mail.muster-ag.ch',
    });
    expect(kumaTarget('port', null, '2001:db8::1', 443)).toEqual({
      target: '[2001:db8::1]:443',
      targetHost: '2001:db8::1',
    });
    expect(kumaTarget('port', null, '[2001:DB8::1]', 443).targetHost).toBe('2001:db8::1');
    expect(kumaTarget('dns', 'https://', 'example.ch', 53)).toEqual({
      target: 'example.ch',
      targetHost: 'example.ch',
    });
    expect(kumaTarget('group', 'https://', null, null)).toEqual({ target: null, targetHost: null });
  });

  it('turns Kuma heartbeat times (UTC without zone) into ISO 8601', () => {
    expect(kumaTime('2026-10-10 08:15:02.123')).toBe('2026-10-10T08:15:02.123Z');
    expect(kumaTime('2026-10-10 08:15:02')).toBe('2026-10-10T08:15:02.000Z');
    expect(kumaTime('2026-10-10T10:15:02+02:00')).toBe('2026-10-10T08:15:02.000Z');
    expect(kumaTime('yesterday')).toBeNull();
    expect(kumaTime('2026-13-45 99:99:99')).toBeNull();
    expect(kumaTime(1_700_000_000)).toBeNull();
    expect(
      toMonitorEvent({ status: 0, time: '2026-10-10 08:15:02.123', msg: '  timeout  ', ping: null }),
    ).toEqual({ status: 'down', at: '2026-10-10T08:15:02.123Z', message: 'timeout', responseMs: null });
    expect(toMonitorEvent({ status: 1, time: '2026-10-10 08:15:02', msg: '', ping: 12.6 })).toMatchObject({
      message: null,
      responseMs: 13,
    });
  });

  it('buckets chart data with a ping weighted by successful checks', () => {
    const day = chartPoints(kumaChartData(2, 24), '24h');
    expect(day.resolutionSeconds).toBe(300);
    expect(day.points).toHaveLength(288);
    expect(day.points.every((p) => p.t % 300 === 0)).toBe(true);
    expect(day.points.map((p) => p.t)).toEqual([...day.points.map((p) => p.t)].sort((a, b) => a - b));
    // The 20-minute outage 3 hours ago: four buckets without a successful check.
    const outage = day.points.filter((p) => p.down > 0);
    expect(outage.reduce((sum, p) => sum + p.down, 0)).toBe(20);
    expect(outage.filter((p) => p.up === 0).every((p) => p.ping === null)).toBe(true);

    const weighted = chartPoints(
      [
        { timestamp: 600, up: 1, down: 0, avgPing: 100 },
        { timestamp: 660, up: 3, down: 0, avgPing: 200 },
        { timestamp: 720, up: 0, down: 1, avgPing: 0 },
        { timestamp: 900, up: 0, down: 2, avgPing: 0 },
        { timestamp: 960, up: 0, down: 0, maintenance: 1, avgPing: 0 },
        { timestamp: 'x', up: 9 },
      ],
      '24h',
    );
    expect(weighted.points).toEqual([
      { t: 600, ping: 175, up: 4, down: 1, maintenance: 0 },
      { t: 900, ping: null, up: 0, down: 2, maintenance: 1 },
    ]);

    const month = chartPoints(kumaChartData(2, 720), '30d');
    expect(month.resolutionSeconds).toBe(21_600);
    expect(month.points).toHaveLength(120);
    expect(month.points.every((p) => p.t % 21_600 === 0)).toBe(true);
    expect(month.points.find((p) => p.down === 20)).toBeDefined();
    const week = chartPoints(kumaChartData(1, 168), '7d');
    expect(week).toMatchObject({ resolutionSeconds: 3600 });
    expect(week.points).toHaveLength(168);
  });

  it('blanks monitor secrets at any depth and keeps them out of the configuration', () => {
    const json = fixtureMonitor();
    const everySecret = Object.fromEntries(MONITOR_SECRET_FIELDS.map((key) => [key, `v-${key}`]));
    const redacted = redactMonitorSecrets({ list: [{ nested: everySecret }], top: everySecret }) as {
      list: { nested: Record<string, unknown> }[];
      top: Record<string, unknown>;
    };
    for (const key of MONITOR_SECRET_FIELDS) {
      expect(redacted.top[key]).toBe('[redacted]');
      expect(redacted.list[0]?.nested[key]).toBe('[redacted]');
    }
    // Keys that only look secret are blanked too; other fields stay.
    expect(redactMonitorSecrets({ smtpPassword: 'x', apiToken: 'y', name: 'n' })).toEqual({
      smtpPassword: '[redacted]',
      apiToken: '[redacted]',
      name: 'n',
    });

    const config = toMonitorConfig(json);
    expect(config).toEqual({
      url: 'https://www.muster-ag.ch/health?token=***',
      hostname: null,
      port: null,
      keyword: null,
      invertKeyword: false,
      method: 'GET',
      acceptedStatusCodes: ['200-299'],
      intervalSeconds: 60,
      retryIntervalSeconds: 60,
      maxRetries: 1,
      timeoutSeconds: 48,
      ignoreTls: false,
      upsideDown: false,
    });
    const text = JSON.stringify([config, remoteFromJson(json, undefined, undefined)]);
    for (const secret of SECRET_VALUES) expect(text).not.toContain(secret);
  });

  it('maps management JSON with paused monitors, groups and socket stats', () => {
    const json = fixtureMonitor();
    expect(remoteFromJson(json, undefined, { uptime24h: 0.9, avgPing24h: 204.5 })).toMatchObject({
      externalId: '1',
      status: 'unknown',
      active: true,
      intervalSeconds: 60,
      parentId: '5',
      target: 'https://www.muster-ag.ch/health?token=***',
      targetHost: 'www.muster-ag.ch',
      facts: { uptime24h: 0.9, avgResponseMs24h: 205, uptime30d: null },
    });
    expect(remoteFromJson({ ...json, active: 0 }, undefined, undefined).status).toBe('paused');
    // Paused in Kuma wins over a last beat that /metrics still holds.
    const reported = parseKumaMetrics(kumaFixture('metrics-2.5.6.txt')).monitors.get('1');
    expect(reported?.status).toBe(1);
    expect(remoteFromJson(json, reported, undefined).status).toBe('up');
    expect(remoteFromJson({ ...json, active: false }, reported, undefined)).toMatchObject({
      status: 'paused',
      facts: { responseMs: 182 },
    });
    expect(remoteFromJson({ ...json, active: '1', forceInactive: true }, undefined, undefined)).toMatchObject(
      {
        status: 'paused',
        active: false,
      },
    );
    expect(remoteFromJson({ ...json, active: 'maybe' }, undefined, undefined).active).toBeNull();
  });

  it('maps Kuma messages and keeps timeouts within Kuma rules', () => {
    expect(describeKumaMessage('authIncorrectCreds', true)).toBe('wrong user name or password');
    expect(describeKumaMessage('someNewKey', true)).toBe('someNewKey');
    expect(describeKumaMessage(undefined, undefined)).toBe('refused without a message');
    expect(describeKumaMessage('x'.repeat(400), false)).toHaveLength(300);
    expect(timeoutFor('http', 60)).toBe(48);
    expect(timeoutFor('keyword', 20)).toBe(16);
    expect(timeoutFor('ping', 60)).toBe(10);
    expect(timeoutFor('port', 3600)).toBe(48);
    expect(
      statusPagePoints(
        {
          heartbeatList: { '4': [{ status: 3, time: '2026-10-10 08:00:00.000', ping: null }, { time: 'x' }] },
        },
        '4',
      ),
    ).toEqual([{ t: KUMA_NOW, ping: null, up: 0, down: 0, maintenance: 1 }]);
    expect(statusPagePoints({ heartbeatList: {} }, '4')).toBeNull();
    expect(statusPagePoints('html', '4')).toBeNull();
  });
});

describe('Uptime Kuma HTTP', () => {
  it('reads /metrics with the key as Basic password and follows no redirect', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock);
    await adapter.testConnection();
    const request = mock.requests.find((r) => r.path === '/metrics');
    expect(request?.headers.authorization).toBe(
      `Basic ${Buffer.from(`weblion:${KUMA_API_KEY}`).toString('base64')}`,
    );
    expect(request?.headers.accept).toBe('text/plain');

    let targetHits = 0;
    const target = createServer((_req, res) => {
      targetHits++;
      res.end('# TYPE monitor_status gauge\n');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = target.address() as AddressInfo;
      mock.state.override = (req) =>
        req.path === '/metrics'
          ? { status: 302, body: '', headers: { location: `http://127.0.0.1:${port}/metrics` } }
          : undefined;
      const err = await rejection(adapterFor(mock).testConnection());
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.message).toContain('the instance redirects, check the base URL');
      expect(targetHits).toBe(0);
    } finally {
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it('explains a 401 (key or the shared rate limit) without the key', async () => {
    const mock = await kuma({ metricsPerMinute: 2 });
    const wrongKey = 'uk3_WrongWrongWrongWrongWrong';
    const err = await rejection(adapterFor(mock, { apiKey: wrongKey }).testConnection());
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).upstreamStatus).toBe(401);
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('the API key was refused (HTTP 401)');
    expect(err.message).toContain('60 API requests per minute');
    expect(err.message).not.toContain(wrongKey);
    expect(err.message).not.toContain(Buffer.from(`weblion:${wrongKey}`).toString('base64'));

    // The bucket counts every request of the instance: the right key is refused too once it is empty.
    await adapterFor(mock).testConnection();
    const limited = await rejection(adapterFor(mock).testConnection());
    expect(limited.message).toContain('60 API requests per minute');
  });

  it('refuses an HTML answer and reports other statuses', async () => {
    const mock = await kuma();
    mock.state.override = (req) =>
      req.path === '/metrics'
        ? {
            status: 200,
            body: '<!DOCTYPE html><html>monitor_status</html>',
            headers: { 'content-type': 'text/html' },
          }
        : undefined;
    await expect(adapterFor(mock).testConnection()).rejects.toThrow('no Prometheus metrics in the answer');

    mock.state.override = (req) =>
      req.path === '/metrics' ? { status: 500, body: 'Internal error' } : undefined;
    await expect(adapterFor(mock).testConnection()).rejects.toThrow('HTTP 500: Internal error');

    mock.state.override = (req) => (req.path === '/metrics' ? { status: 404, body: 'Not Found' } : undefined);
    const notFound = await rejection(adapterFor(mock).testConnection());
    // Not a missing monitor: the caller must not read it as one.
    expect((notFound as ProviderError).upstreamStatus).toBeUndefined();
    expect(notFound.message).toContain('may block /metrics');

    const closed = new UptimeKumaAdapter({ baseUrl: 'http://127.0.0.1:1', apiKey: KUMA_API_KEY }, FAST);
    await expect(closed.testConnection()).rejects.toThrow('request failed');
  });

  it('caches /metrics for 30 s, shares concurrent reads and does not keep failures', async () => {
    const mock = await kuma();
    let now = 1_000_000;
    const adapter = adapterFor(mock, { now: () => now });
    await adapter.listMonitors();
    await Promise.all([adapter.getMonitor('1'), adapter.getMonitor('2')]);
    expect(metricsRequests(mock)).toBe(1);
    now += 29_000;
    await adapter.getMonitor('3');
    expect(metricsRequests(mock)).toBe(1);
    now += 2000;
    await adapter.getMonitor('3');
    expect(metricsRequests(mock)).toBe(2);

    const fresh = await kuma();
    const other = adapterFor(fresh);
    let failures = 1;
    fresh.state.override = (req) =>
      req.path === '/metrics' && failures-- > 0 ? { status: 503, body: 'busy' } : undefined;
    await expect(other.listMonitors()).rejects.toThrow('HTTP 503');
    const inventory = await other.listMonitors();
    expect(inventory).toMatchObject({ complete: false, managementError: null });
    expect(inventory.monitors).toHaveLength(5);
    expect(metricsRequests(fresh)).toBe(2);
  });

  it('answers getMonitor from /metrics without management', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock);
    const live = await adapter.getMonitor('4');
    expect(live).toEqual({
      monitor: {
        externalId: '4',
        name: 'Mail SMTP',
        type: 'port',
        target: 'mail.muster-ag.ch:587',
        targetHost: 'mail.muster-ag.ch',
        status: 'pending',
        active: true,
        intervalSeconds: null,
        parentId: null,
        facts: {
          responseMs: 35,
          avgResponseMs24h: 31,
          avgResponseMs30d: 30,
          uptime24h: 0.98,
          uptime30d: 0.999,
          certDaysRemaining: null,
          certValid: null,
        },
      },
      config: null,
      events: null,
    });
    const missing = await rejection(adapter.getMonitor('6'));
    expect((missing as ProviderError).upstreamStatus).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(missing.message).toContain('is not reported by /metrics (paused, deleted');
    await expect(adapter.createMonitor(input({ kind: 'http', url: 'https://x.ch' }))).rejects.toMatchObject({
      statusCode: 422,
      code: 'unsupported',
    });
    expect(adapter.monitorManagement()).toBe(false);
  });
});

describe('Uptime Kuma management session', () => {
  it('signs in with the token over a websocket without Origin and reads version, notifications and list', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock, { token: true });
    const inventory = await adapter.listMonitors();
    expect(inventory.complete).toBe(true);
    expect(mock.eventCount('loginByToken')).toBe(1);
    expect(lastEvent(mock, 'loginByToken').args).toEqual([mock.token()]);
    const handshake = mock.handshakes[0];
    expect(handshake?.upgrade).toBe('websocket');
    expect(handshake?.origin).toBeUndefined();
    expect(handshake?.cookie).toBeUndefined();
    expect(adapter.socket?.version).toBe('2.5.6');
    expect(adapter.socket?.defaultNotificationIds).toEqual([1]);
    expect(adapter.socket?.monitorList?.byId.size).toBe(6);
    expect(adapter.socket?.stats.get('2')).toEqual({
      uptime24h: 0.95,
      uptime30d: 0.99987,
      avgPing24h: 204.5,
    });
    expect(adapter.monitorManagement()).toBe(true);
  });

  it('is closed by the registry when it drops the adapter after a credential change', async () => {
    const mock = await kuma();
    const box = new SecretBox(Buffer.alloc(32, 7).toString('base64'));
    const registry = new ProviderRegistry({} as Database, box);
    const config = { baseUrl: mock.url, apiKey: KUMA_API_KEY, sessionToken: mock.token() };
    const connection = {
      id: '00000000-0000-4000-8000-000000000001',
      type: 'uptimekuma',
      configEnc: box.encryptJson(config),
    } as ProviderConnection;

    const first = registry.forConnection(connection);
    await first.listMonitors!();
    expect(mock.connectedSockets()).toBe(1);
    // A new token (sign-in again): the next lookup builds a new adapter and closes the old one.
    const second = registry.forConnection({ ...connection, configEnc: box.encryptJson({ ...config }) });
    expect(second).not.toBe(first);
    await vi.waitFor(() => expect(mock.connectedSockets()).toBe(0));

    await second.listMonitors!();
    expect(mock.connectedSockets()).toBe(1);
    // Sign-out: the route invalidates the connection.
    registry.invalidate(connection.id);
    await vi.waitFor(() => expect(mock.connectedSockets()).toBe(0));
  });

  it('refuses a token after a Kuma password change, without the token in the message', async () => {
    const mock = await kuma();
    const token = mock.token();
    mock.rotatePassword();
    const err = await rejection(socketFor(mock, token).call('getMonitorList'));
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).upstreamStatus).toBe(401);
    expect(err.message).toContain('Sign in again under Admin > Monitoring');
    expect(err.message).not.toContain(token);
    await vi.waitFor(() => expect(mock.connectedSockets()).toBe(0));
  });

  it('signs in again after Kuma drops the connection or the session, and closes when idle', async () => {
    const mock = await kuma();
    const socket = socketFor(mock, mock.token());
    await socket.call('getMonitorList');
    expect(socket.connected).toBe(true);

    mock.kick();
    await vi.waitFor(() => expect(socket.connected).toBe(false));
    await expect(socket.call('getMonitor', 1)).resolves.toMatchObject({ ok: true });
    expect(mock.eventCount('loginByToken')).toBe(2);

    // Kuma restarted behind a proxy: the connection stays, the sign-in is gone.
    mock.forgetSessions();
    await expect(socket.call('getMonitor', 1)).resolves.toMatchObject({ ok: true });
    expect(mock.eventCount('loginByToken')).toBe(3);

    const idle = socketFor(mock, mock.token(), { idleMs: 150 });
    await idle.call('getMonitorList');
    expect(idle.connected).toBe(true);
    await vi.waitFor(() => expect(idle.connected).toBe(false), { timeout: 2000 });
    await vi.waitFor(() => expect(mock.connectedSockets()).toBe(1));
  });

  it('keeps reading through /metrics when Kuma 3.x does not answer the sign-in', async () => {
    const mock = await kuma({ version3: true });
    const adapter = adapterFor(mock, { token: true, ackTimeoutMs: 300 });
    const inventory = await adapter.listMonitors();
    expect(inventory.complete).toBe(false);
    expect(inventory.monitors).toHaveLength(5);
    expect(inventory.managementError).toContain(
      'Uptime Kuma 3.x signs in differently and is not supported for management',
    );

    // A detail read falls back to /metrics, and the status reports the failure without a new attempt.
    const live = await adapter.getMonitor('1');
    expect(live).toMatchObject({ config: null, events: null, monitor: { status: 'up' } });
    const attempts = mock.eventCount('loginByToken');
    const status = await adapter.monitoringStatus();
    expect(status).toMatchObject({ management: 'error', version: '2.5.6', uptimeMetrics: true });
    expect(status.managementError).toContain('3.x');
    expect(mock.eventCount('loginByToken')).toBe(attempts);
    await expect(adapter.pauseMonitor('1')).rejects.toThrow('not supported for management');
  });

  it('lists paused monitors with management and opens a session at most every 10 minutes', async () => {
    const mock = await kuma();
    let now = 5_000_000;
    const adapter = adapterFor(mock, { token: true, now: () => now });
    const first = await adapter.listMonitors();
    expect(first.complete).toBe(true);
    expect(first.monitors).toHaveLength(6);
    const byId = new Map(first.monitors.map((m) => [m.externalId, m]));
    expect(byId.get('6')).toMatchObject({ status: 'paused', active: false, name: 'Alpenblick Hotel' });
    expect(byId.get('1')).toMatchObject({ status: 'up', active: true, intervalSeconds: 60, parentId: '5' });
    expect(byId.get('2')).toMatchObject({ status: 'down', intervalSeconds: 120 });

    // While the session is open, its pushed list answers without a request.
    const lists = mock.eventCount('getMonitorList');
    await expect(adapter.listMonitors()).resolves.toMatchObject({ complete: true, managementError: null });
    expect(mock.eventCount('getMonitorList')).toBe(lists);

    mock.kick();
    await vi.waitFor(() => expect(adapter.socket?.connected).toBe(false));
    now += 5 * 60_000;
    const between = await adapter.listMonitors();
    expect(between).toMatchObject({ complete: false, managementError: null });
    expect(between.monitors.map((m) => m.externalId)).not.toContain('6');
    expect(mock.eventCount('loginByToken')).toBe(1);

    now += 5 * 60_000;
    const again = await adapter.listMonitors();
    expect(again.complete).toBe(true);
    expect(mock.eventCount('loginByToken')).toBe(2);
  });

  it('fills uptime and averages of Kuma 2.0 from the session stats', async () => {
    const mock = await kuma({ metrics: kumaFixture('metrics-2.0.0.txt') });
    const adapter = adapterFor(mock, { token: true });
    const inventory = await adapter.listMonitors();
    const shop = inventory.monitors.find((m) => m.externalId === '2');
    expect(shop?.facts).toMatchObject({ uptime24h: 0.95, uptime30d: 0.99987, avgResponseMs24h: 205 });
    const plain = adapterFor(mock);
    const facts = (await plain.listMonitors()).monitors.find((m) => m.externalId === '2')?.facts;
    expect(facts).toMatchObject({ uptime24h: null, avgResponseMs24h: null });
    await expect(plain.testConnection()).resolves.toMatchObject({ version: '2.0.0', uptimeMetrics: false });
  });

  it('refuses events outside the whitelist before anything is sent', async () => {
    const mock = await kuma();
    const socket = socketFor(mock, mock.token());
    const err = await rejection(socket.call('setSettings' as KumaEvent, {}));
    expect(err.statusCode).toBe(400);
    expect(mock.events).toHaveLength(0);
    expect(mock.connectedSockets()).toBe(0);
  });
});

describe('Uptime Kuma monitor writes', () => {
  it('creates each kind with exactly the 2.0.0 field set and default notifications', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock, { token: true });

    const created = await adapter.createMonitor(input({ kind: 'http', url: 'https://www.muster-ag.ch' }));
    expect(lastEvent(mock, 'add').args).toEqual([addPayload({ url: 'https://www.muster-ag.ch' })]);
    expect(created).toMatchObject({
      externalId: '100',
      name: '[muster-ag] Website',
      type: 'http',
      target: 'https://www.muster-ag.ch',
      targetHost: 'www.muster-ag.ch',
      status: 'pending',
      active: true,
      intervalSeconds: 60,
    });

    await adapter.createMonitor(
      input({
        kind: 'keyword',
        name: '[muster-ag] Shop',
        url: 'https://shop.muster-ag.ch',
        keyword: 'Warenkorb',
        invertKeyword: true,
        method: 'HEAD',
        acceptedStatusCodes: ['200', '300-399'],
        intervalSeconds: 20,
        ignoreTls: true,
        // Fields of other kinds are not sent.
        hostname: 'ignored.example.ch',
        port: 8080,
      }),
    );
    expect(lastEvent(mock, 'add').args).toEqual([
      addPayload({
        type: 'keyword',
        name: '[muster-ag] Shop',
        url: 'https://shop.muster-ag.ch',
        method: 'HEAD',
        keyword: 'Warenkorb',
        invertKeyword: true,
        interval: 20,
        retryInterval: 20,
        timeout: 16,
        ignoreTls: true,
        accepted_statuscodes: ['200', '300-399'],
      }),
    ]);

    const ping = await adapter.createMonitor(
      input({ kind: 'ping', name: '[muster-ag] Router', hostname: '198.51.100.20', url: 'https://x.ch' }),
    );
    expect(lastEvent(mock, 'add').args).toEqual([
      addPayload({
        type: 'ping',
        name: '[muster-ag] Router',
        hostname: '198.51.100.20',
        timeout: 10,
        ping_count: 3,
        ping_numeric: true,
        packetSize: 56,
        ping_per_request_timeout: 2,
      }),
    ]);
    expect(ping).toMatchObject({ target: '198.51.100.20', status: 'pending' });

    await adapter.createMonitor(
      input({ kind: 'port', name: '[muster-ag] SMTP', hostname: 'mail.example.ch', port: 587 }),
    );
    expect(lastEvent(mock, 'add').args).toEqual([
      addPayload({ type: 'port', name: '[muster-ag] SMTP', hostname: 'mail.example.ch', port: 587 }),
    ]);
    expect(mock.monitors.get(103)).toMatchObject({ type: 'port', port: 587, active: true });
  });

  it('leaves the ping options out on instances whose monitors do not have them', async () => {
    const mock = await kuma();
    for (const m of mock.monitors.values()) delete m.ping_count;
    for (const key of ['ping_count', 'ping_numeric', 'packetSize', 'ping_per_request_timeout']) {
      mock.addKeys.delete(key);
    }
    const adapter = adapterFor(mock, { token: true });
    await adapter.createMonitor(input({ kind: 'ping', name: 'P', hostname: '198.51.100.20' }));
    expect(lastEvent(mock, 'add').args).toEqual([
      addPayload({ type: 'ping', name: 'P', hostname: '198.51.100.20', timeout: 10 }),
    ]);
    // The same code without detection: a key the instance lacks fails the insert.
    const payload = buildAddPayload(input({ kind: 'ping', name: 'P', hostname: '198.51.100.20' }), {
      notificationIds: [],
      knownKeys: new Set(['ping_count']),
    });
    await expect(adapter.socket!.call('add', payload)).rejects.toThrow('does not know a field');
  });

  it('maps a key the frozen schema does not know and Kuma validation texts', async () => {
    const mock = await kuma();
    mock.addKeys.delete('conditions');
    const adapter = adapterFor(mock, { token: true });
    const err = await rejection(adapter.createMonitor(input({ kind: 'http', url: 'https://x.ch' })));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('this Uptime Kuma version does not know a field the console sends');
    expect(err.message).toContain('no column named conditions');

    mock.addKeys.add('conditions');
    const tooShort = await rejection(adapter.socket!.call('add', { ...addPayload({}), interval: 10 }));
    expect(tooShort.statusCode).toBe(400);
    expect(tooShort.message).toBe('Uptime Kuma: Interval cannot be less than 20 seconds');

    // The adapter checks first, so nothing reaches Kuma.
    const adds = mock.eventCount('add');
    await expect(
      adapter.createMonitor(input({ kind: 'http', url: 'https://x.ch', intervalSeconds: 10 })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(adapter.createMonitor(input({ kind: 'http', url: 'ftp://x.ch' }))).rejects.toMatchObject({
      statusCode: 400,
      details: [{ path: 'url' }],
    });
    await expect(
      adapter.createMonitor(input({ kind: 'http', url: 'https://x.ch', acceptedStatusCodes: ['2xx'] })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      adapter.createMonitor({ ...input({ kind: 'http', url: 'https://x.ch' }), kind: 'dns' as 'http' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mock.eventCount('add')).toBe(adds);
  });

  it('edits with the full JSON from getMonitor and changes only the patched keys', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock, { token: true });
    await adapter.updateMonitor('1', { name: '[muster-ag] Neu', intervalSeconds: 30, ignoreTls: true });
    const sent = lastEvent(mock, 'editMonitor').args[0];
    expect(sent).toEqual({
      ...fixtureMonitor(),
      name: '[muster-ag] Neu',
      interval: 30,
      retryInterval: 30,
      timeout: 24,
      ignoreTls: true,
    });
    // Nothing was nulled: the secrets of the monitor are still set in Kuma.
    expect(mock.monitors.get(1)).toMatchObject({
      basic_auth_pass: 'basic-secret-4713',
      headers: '{"X-Api-Key": "hdr-secret-4711"}',
      parent: 5,
      notificationIDList: { '1': true, '2': true },
    });

    await adapter.updateMonitor('2', {
      url: 'https://shop2.muster-ag.ch',
      keyword: 'Kasse',
      invertKeyword: true,
      hostname: 'ignored.example.ch',
      intervalSeconds: 120,
    });
    const keyword = lastEvent(mock, 'editMonitor').args[0] as Record<string, unknown>;
    expect(keyword).toMatchObject({
      url: 'https://shop2.muster-ag.ch',
      keyword: 'Kasse',
      invertKeyword: true,
    });
    // Unchanged interval: retry interval and timeout stay as they were.
    expect(keyword).toMatchObject({ interval: 120, retryInterval: 120, timeout: 48, hostname: null });

    await expect(adapter.updateMonitor('2', { keyword: '' })).rejects.toMatchObject({
      statusCode: 400,
      details: [{ path: 'keyword' }],
    });
    await expect(adapter.updateMonitor('1', { intervalSeconds: 5 })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(adapter.updateMonitor('999', { name: 'x' })).rejects.toMatchObject({ statusCode: 404 });

    expect(applyPatch(fixtureMonitor(), {})).toEqual(fixtureMonitor());
  });

  it('pauses, resumes and deletes with numeric ids and refuses malformed ids before any traffic', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock, { token: true });
    await adapter.getMonitorHistory('1', '24h', { statusPageSlug: null });
    await adapter.getMonitor('2');
    const metricsBefore = metricsRequests(mock);
    await adapter.pauseMonitor('1');
    expect(lastEvent(mock, 'pauseMonitor').args).toEqual([1]);
    expect(mock.monitors.get(1)?.active).toBe(false);
    // A write drops the cached /metrics and the charts of the monitor.
    await adapter.getMonitor('2');
    expect(metricsRequests(mock)).toBe(metricsBefore + 1);
    await adapter.getMonitorHistory('1', '24h', { statusPageSlug: null });
    expect(mock.eventCount('getMonitorChartData')).toBe(2);
    await adapter.resumeMonitor('1');
    expect(lastEvent(mock, 'resumeMonitor').args).toEqual([1]);
    expect(mock.monitors.get(1)?.active).toBe(true);
    await adapter.deleteMonitor('6');
    expect(lastEvent(mock, 'deleteMonitor').args).toEqual([6]);
    expect(mock.monitors.has(6)).toBe(false);
    // Kuma deletes unknown ids silently.
    await expect(adapter.deleteMonitor('6')).resolves.toBeUndefined();

    for (const call of [() => adapter.pauseMonitor('999'), () => adapter.resumeMonitor('999')]) {
      const err = await rejection(call());
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Uptime Kuma: monitor 999 not found in Uptime Kuma');
    }
    await expect(adapter.getMonitor('999')).rejects.toMatchObject({ statusCode: 404 });

    const fresh = await kuma();
    const other = adapterFor(fresh, { token: true });
    for (const call of [
      () => other.pauseMonitor('12a'),
      () => other.resumeMonitor('-1'),
      () => other.deleteMonitor('1 OR 1=1'),
      () => other.updateMonitor('99999999999', { name: 'x' }),
      () => other.getMonitor('1e3'),
      () => other.getMonitorHistory('x', '24h', { statusPageSlug: null }),
    ]) {
      await expect(call()).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(fresh.events).toHaveLength(0);
    expect(fresh.requests).toHaveLength(0);
  });

  it('reads a monitor live: configuration without secrets and the last 20 status changes', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock, { token: true });
    const live = await adapter.getMonitor('1');
    expect(lastEvent(mock, 'getMonitor').args).toEqual([1]);
    expect(lastEvent(mock, 'monitorImportantHeartbeatListPaged').args).toEqual([1, 0, 20]);
    expect(live.monitor).toMatchObject({
      status: 'up',
      active: true,
      parentId: '5',
      facts: { responseMs: 182 },
    });
    expect(live.config).toMatchObject({ url: 'https://www.muster-ag.ch/health?token=***', maxRetries: 1 });
    expect(live.events).toHaveLength(20);
    expect(live.events?.[0]).toEqual({
      status: 'down',
      at: new Date((KUMA_NOW - 13) * 1000).toISOString(),
      message: 'connect ECONNREFUSED 185.101.0.25:443 (0)',
      responseMs: null,
    });
    expect(live.events?.[1]).toMatchObject({ status: 'up', message: '200 - OK', responseMs: 181 });
    expect(kumaTimeText(KUMA_NOW)).toBe('2026-10-10 08:00:00.000');
    const text = JSON.stringify(live);
    for (const secret of SECRET_VALUES) expect(text).not.toContain(secret);

    // A paused monitor is absent from /metrics but known to the session.
    expect((await adapter.getMonitor('6')).monitor).toMatchObject({ status: 'paused', active: false });
  });
});

describe('Uptime Kuma history and status pages', () => {
  it('serves charts from the session and the last checks from the status page', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock, { token: true });
    const day = await adapter.getMonitorHistory('2', '24h', { statusPageSlug: null });
    expect(day).toMatchObject({ range: '24h', source: 'kuma', resolutionSeconds: 300 });
    expect(day?.points).toHaveLength(288);
    expect(day?.points.some((p) => p.down > 0)).toBe(true);
    expect(lastEvent(mock, 'getMonitorChartData').args).toEqual([2, 24]);
    await adapter.getMonitorHistory('2', '24h', { statusPageSlug: null });
    expect(mock.eventCount('getMonitorChartData')).toBe(1);
    const month = await adapter.getMonitorHistory('2', '30d', { statusPageSlug: null });
    expect(month?.points).toHaveLength(120);
    expect(lastEvent(mock, 'getMonitorChartData').args).toEqual([2, 720]);
    await adapter.getMonitorHistory('2', '7d', { statusPageSlug: null });
    expect(lastEvent(mock, 'getMonitorChartData').args).toEqual([2, 168]);

    const recent = await adapter.getMonitorHistory('2', 'recent', { statusPageSlug: KUMA_STATUS_PAGE });
    expect(recent).toMatchObject({ range: 'recent', source: 'statusPage', resolutionSeconds: null });
    expect(recent?.points).toHaveLength(100);
    expect(recent?.points.at(-1)).toMatchObject({ t: KUMA_NOW + 2, up: 0, down: 1, ping: null });
    expect(recent?.points[0]).toMatchObject({ up: 1, down: 0, ping: 150 });
    expect(await adapter.getMonitorHistory('3', 'recent', { statusPageSlug: KUMA_STATUS_PAGE })).toBeNull();
    expect(await adapter.getMonitorHistory('1', 'recent', { statusPageSlug: 'other-page' })).toBeNull();
    expect(await adapter.getMonitorHistory('1', 'recent', { statusPageSlug: null })).toBeNull();
    // The heartbeat answer is cached per slug.
    await adapter.getMonitorHistory('1', 'recent', { statusPageSlug: KUMA_STATUS_PAGE });
    expect(
      mock.requests.filter((r) => r.path === `/api/status-page/heartbeat/${KUMA_STATUS_PAGE}`),
    ).toHaveLength(1);
    // Status pages are public: no credentials go along.
    expect(
      mock.requests.find((r) => r.path.startsWith('/api/status-page/'))?.headers.authorization,
    ).toBeUndefined();

    const plain = adapterFor(mock);
    expect(await plain.getMonitorHistory('2', '24h', { statusPageSlug: KUMA_STATUS_PAGE })).toBeNull();
    expect(plain.monitorHistoryRanges({ statusPageSlug: null })).toEqual([]);
    expect(plain.monitorHistoryRanges({ statusPageSlug: KUMA_STATUS_PAGE })).toEqual(['recent']);
    expect(adapter.monitorHistoryRanges({ statusPageSlug: null })).toEqual(['24h', '7d', '30d']);
    expect(adapter.monitorHistoryRanges({ statusPageSlug: KUMA_STATUS_PAGE })).toEqual([
      'recent',
      '24h',
      '7d',
      '30d',
    ]);
  });

  it('reads a status page and maps an unknown slug to 404', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock);
    await expect(adapter.getStatusPage('Muster-AG')).resolves.toEqual({
      slug: 'muster-ag',
      title: 'Muster AG Status',
      monitorIds: ['1', '2'],
    });
    const err = await rejection(adapter.getStatusPage('nope'));
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).upstreamStatus).toBe(404);
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('Status Page Not Found');
    await expect(adapter.getStatusPage('../metrics')).rejects.toMatchObject({ statusCode: 400 });
    expect(adapter.statusPageUrl('muster-ag')).toBe(`${mock.url}/status/muster-ag`);
  });
});

describe('Uptime Kuma management sign-in', () => {
  it('exchanges user name and password for the session token', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock);
    await expect(
      adapter.signInForManagement({ username: KUMA_USER, password: KUMA_PASSWORD }),
    ).resolves.toEqual({ sessionToken: mock.token(), version: '2.5.6' });
    expect(lastEvent(mock, 'login').args).toEqual([{ username: KUMA_USER, password: KUMA_PASSWORD }]);
    await vi.waitFor(() => expect(mock.connectedSockets()).toBe(0));
  });

  it('asks for the two-factor code, refuses wrong ones and never shows the password', async () => {
    const logged: unknown[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(...args));
    }
    const mock = await kuma({ twoFactor: true });
    const adapter = adapterFor(mock);
    const errors: AppError[] = [];

    const required = await rejection(
      adapter.signInForManagement({ username: KUMA_USER, password: KUMA_PASSWORD }),
    );
    expect(required).toMatchObject({ statusCode: 400, code: 'totp_required' });
    errors.push(required);
    const invalid = await rejection(
      adapter.signInForManagement({ username: KUMA_USER, password: KUMA_PASSWORD, totp: '654321' }),
    );
    expect(invalid).toMatchObject({ statusCode: 400, code: 'totp_invalid' });
    errors.push(invalid);
    await expect(
      adapter.signInForManagement({ username: KUMA_USER, password: KUMA_PASSWORD, totp: KUMA_TOTP }),
    ).resolves.toMatchObject({ sessionToken: mock.token() });
    expect(lastEvent(mock, 'login').args).toEqual([
      { username: KUMA_USER, password: KUMA_PASSWORD, token: KUMA_TOTP },
    ]);

    const wrong = await rejection(
      adapter.signInForManagement({ username: KUMA_USER, password: 'not-the-password-1' }),
    );
    expect(wrong).toBeInstanceOf(ProviderError);
    expect((wrong as ProviderError).upstreamStatus).toBe(401);
    expect(wrong.message).toBe('Uptime Kuma: wrong user name or password');
    errors.push(wrong);

    for (const err of errors) {
      const text = `${err.message} ${JSON.stringify(err)} ${err.stack ?? ''}`;
      expect(text).not.toContain(KUMA_PASSWORD);
      expect(text).not.toContain('not-the-password-1');
      expect(text).not.toContain('654321');
    }
    expect(JSON.stringify(logged)).not.toContain(KUMA_PASSWORD);
  });

  it('reports the instance-wide sign-in limit and a Kuma 3.x without the socket sign-in', async () => {
    const mock = await kuma({ loginsPerMinute: 1 });
    await kumaSignIn(mock.url, { username: KUMA_USER, password: KUMA_PASSWORD }, FAST);
    const limited = await rejection(
      kumaSignIn(mock.url, { username: KUMA_USER, password: KUMA_PASSWORD }, FAST),
    );
    expect((limited as ProviderError).upstreamStatus).toBe(429);
    expect(limited.message).toContain('Uptime Kuma allows 20 sign-ins per minute for the whole instance');
    expect(limited.message).not.toContain(KUMA_PASSWORD);

    const v3 = await kuma({ version3: true });
    const err = await rejection(
      kumaSignIn(v3.url, { username: KUMA_USER, password: KUMA_PASSWORD }, { ...FAST, ackTimeoutMs: 300 }),
    );
    expect(err.message).toContain('Uptime Kuma 3.x signs in differently');
    await vi.waitFor(() => expect(v3.connectedSockets()).toBe(0));

    const closed = await rejection(
      kumaSignIn('http://127.0.0.1:1', { username: KUMA_USER, password: KUMA_PASSWORD }, FAST),
    );
    expect(closed.message).toContain('connection failed');
    expect(closed.message).not.toContain(KUMA_PASSWORD);
  });
});

describe('Uptime Kuma API explorer', () => {
  it('reads the documented HTTP paths and refuses everything else', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock, { token: true });
    const metrics = await adapter.rawRequest('GET', '/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.data).toEqual(expect.stringContaining('monitor_status'));
    expect(JSON.stringify(metrics)).not.toContain(KUMA_API_KEY);
    await expect(adapter.rawRequest('GET', `/api/status-page/${KUMA_STATUS_PAGE}`)).resolves.toMatchObject({
      status: 200,
      data: { config: { slug: KUMA_STATUS_PAGE } },
    });
    await expect(
      adapter.rawRequest('GET', `/api/status-page/heartbeat/${KUMA_STATUS_PAGE}`),
    ).resolves.toMatchObject({
      status: 200,
    });
    await expect(adapter.rawRequest('GET', '/api/badge/1/status')).resolves.toMatchObject({
      status: 200,
      data: expect.stringContaining('<svg'),
    });
    await expect(adapter.rawRequest('GET', `${mock.url}/api/entry-page`)).resolves.toMatchObject({
      status: 200,
      data: { entryPage: 'dashboard' },
    });
    // Kuma's own 404 answer comes back as it is.
    await expect(adapter.rawRequest('GET', '/api/status-page/nope')).resolves.toMatchObject({ status: 404 });
    // Credentials only go to /metrics.
    expect(mock.requests.filter((r) => r.headers.authorization).map((r) => r.path)).toEqual(['/metrics']);

    const before = mock.requests.length;
    for (const [method, path] of [
      ['GET', '/api/../metrics'],
      ['GET', '/api/%2e%2e/metrics'],
      ['GET', '//evil.example/metrics'],
      ['GET', '/settings'],
      ['GET', '/api/push/abc'],
      ['GET', '/metrics?x=1'],
      ['POST', `/api/status-page/${KUMA_STATUS_PAGE}`],
    ] as const) {
      await expect(adapter.rawRequest(method, path)).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(adapter.rawRequest('GET', '/settings')).rejects.toThrow('Allowed: /metrics');
    expect(mock.requests.length).toBe(before);
  });

  it('runs whitelisted socket reads and writes with redacted answers', async () => {
    const mock = await kuma();
    const adapter = adapterFor(mock, { token: true });
    const list = await adapter.rawRequest('GET', 'socket/getMonitorList');
    expect(list.status).toBe(200);
    const first = (list.data as Record<string, Record<string, unknown>>)['1'];
    expect(first).toMatchObject({
      name: 'Muster Website',
      basic_auth_pass: '[redacted]',
      headers: '[redacted]',
    });
    const one = await adapter.rawRequest('GET', 'socket/getMonitor?args=[1]');
    expect(one).toMatchObject({
      status: 200,
      data: { ok: true, monitor: { id: 1, bearer_token: '[redacted]' } },
    });
    for (const secret of SECRET_VALUES.filter((s) => s !== 'abc123')) {
      expect(JSON.stringify([list, one])).not.toContain(secret);
    }
    const chart = await adapter.rawRequest('GET', '/socket/getMonitorChartData?args=[1,24]');
    expect((chart.data as { data: unknown[] }).data).toHaveLength(1440);
    await expect(
      adapter.rawRequest('GET', 'socket/monitorImportantHeartbeatListPaged?args=[1,0,5]'),
    ).resolves.toMatchObject({
      status: 200,
      data: { data: expect.any(Array) },
    });

    await expect(adapter.rawRequest('POST', 'socket/pauseMonitor', { args: [3] })).resolves.toEqual({
      status: 200,
      data: { ok: true, msg: 'successPaused', msgi18n: true },
    });
    expect(mock.monitors.get(3)?.active).toBe(false);
    // Kuma's refusal is the answer, not an error.
    await expect(adapter.rawRequest('POST', 'socket/resumeMonitor', { args: [999] })).resolves.toEqual({
      status: 400,
      data: { ok: false, msg: 'You do not own this monitor.' },
    });
    const edit = { ...fixtureMonitor(), name: 'Explorer edit' };
    await expect(adapter.rawRequest('POST', 'socket/editMonitor', { args: [edit] })).resolves.toMatchObject({
      status: 200,
    });
    expect(mock.monitors.get(1)?.name).toBe('Explorer edit');

    const sent = mock.events.length;
    for (const [method, path, body] of [
      ['GET', 'socket/setSettings', undefined],
      ['POST', 'socket/setSettings', { args: [{}] }],
      ['POST', 'socket/addAPIKey', { args: [{}] }],
      ['POST', 'socket/uploadBackup', { args: ['{}'] }],
      ['GET', 'socket/login', undefined],
      ['POST', 'socket/loginByToken', { args: ['x'] }],
      ['POST', 'socket/getMonitor', { args: [1] }],
      ['GET', 'socket/pauseMonitor?args=[1]', undefined],
      ['GET', 'socket/getMonitor?args=["1"]', undefined],
      ['GET', 'socket/getMonitor?args=[1,2,3,4]', undefined],
      ['GET', 'socket/getMonitorList?args=[1]', undefined],
      ['POST', 'socket/pauseMonitor', { args: ['1'] }],
      ['POST', 'socket/editMonitor', { args: [1] }],
      ['POST', 'socket/deleteMonitor', {}],
    ] as const) {
      await expect(adapter.rawRequest(method, path, body)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(mock.events.length).toBe(sent);
    for (const event of ['setSettings', 'addAPIKey', 'uploadBackup', 'login']) {
      expect(mock.eventCount(event)).toBe(0);
    }

    const plain = adapterFor(mock);
    await expect(plain.rawRequest('GET', 'socket/getMonitorList')).rejects.toThrow(
      'not signed in for management',
    );
  });

  it('blanks monitor secrets in audited socket writes', () => {
    const adapter = new UptimeKumaAdapter({ baseUrl: 'https://status.example.ch', apiKey: KUMA_API_KEY });
    const audited = adapter.redactExplorerAudit('socket/editMonitor', {
      args: [
        { id: 1, name: 'Website', basic_auth_pass: 'secret-1', sshPrivateKey: 'secret-2', interval: 60 },
      ],
    });
    expect(audited).toEqual({
      path: 'socket/editMonitor',
      body: {
        args: [
          {
            id: 1,
            name: 'Website',
            basic_auth_pass: '[redacted]',
            sshPrivateKey: '[redacted]',
            interval: 60,
          },
        ],
      },
    });
  });
});

describe('Uptime Kuma connection and overview', () => {
  it('tests the connection and reports version, counts and the management state', async () => {
    const mock = await kuma();
    await expect(adapterFor(mock, { token: true }).testConnection()).resolves.toEqual({
      version: '2.5.6',
      monitors: 5,
      uptimeMetrics: true,
      management: 'ok',
    });
    await expect(adapterFor(mock).testConnection()).resolves.toMatchObject({ management: 'off' });
    const revoked = adapterFor(mock, { token: 'eyJhbGciOiJIUzI1NiJ9.revoked-token-value.mock' });
    const result = await revoked.testConnection();
    expect(result.management).toEqual(expect.stringContaining('Sign in again'));

    const overview = await adapterFor(mock, { token: true }).overview();
    expect(overview).toEqual({
      version: '2.5.6',
      nodes: [],
      storages: [],
      facts: [
        { label: 'Version', value: '2.5.6' },
        { label: 'Monitors', value: '5' },
        { label: 'Up', value: '3' },
        { label: 'Down', value: '1' },
        { label: 'Uptime figures', value: 'available' },
        { label: 'Management', value: 'on' },
        { label: 'Address', value: mock.url },
      ],
    });
    const offFacts = (await adapterFor(mock).overview()).facts;
    expect(offFacts).toContainEqual({ label: 'Management', value: 'off' });
    const errorFacts = (await revoked.overview()).facts.find((f) => f.label === 'Management');
    expect(errorFacts?.value).toMatch(/^error: Uptime Kuma: the stored management session was refused/);

    const old = await kuma({ metrics: kumaFixture('metrics-2.0.0.txt') });
    expect((await adapterFor(old).overview()).facts).toContainEqual({
      label: 'Uptime figures',
      value: 'needs Uptime Kuma 2.1',
    });
  });

  it('caches the monitoring status for 60 s', async () => {
    const mock = await kuma();
    let now = 9_000_000;
    const adapter = adapterFor(mock, { token: true, now: () => now });
    await expect(adapter.monitoringStatus()).resolves.toEqual({
      version: '2.5.6',
      management: 'ok',
      managementError: null,
      uptimeMetrics: true,
    });
    const lists = mock.eventCount('getMonitorList') + mock.eventCount('loginByToken');
    await adapter.monitoringStatus();
    expect(mock.eventCount('getMonitorList') + mock.eventCount('loginByToken')).toBe(lists);
    now += 61_000;
    await adapter.monitoringStatus();
    expect(mock.eventCount('getMonitorList')).toBeGreaterThan(0);

    const plain = adapterFor(mock);
    await expect(plain.monitoringStatus()).resolves.toMatchObject({
      management: 'off',
      managementError: null,
    });
  });
});
