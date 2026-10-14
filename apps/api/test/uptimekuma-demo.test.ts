import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { EMPTY_MONITOR_FACTS } from '@weblion/shared';
import type { ModuleKey, MonitorHistoryDto, MonitorHistoryPoint } from '@weblion/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  monitorAllowances,
  monitorStatusPages,
  monitors,
  organizations,
  providerConnections,
  servers,
  users,
} from '../src/db/schema';
import { seedMonitoringDemo } from '../src/db/seed-monitoring';
import { AppError, ProviderError } from '../src/lib/errors';
import {
  DEMO_KUMA_STATUS_PAGE,
  DEMO_KUMA_URL,
  DEMO_KUMA_VERSION,
  DemoMonitoring,
  demoMonitoringState,
  resetDemoMonitoring,
} from '../src/providers/demo/monitoring';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { createAdapter } from '../src/providers/registry';
import type { MonitorInput, ProviderAdapter, RemoteMonitor } from '../src/providers/types';
import { createTestApp, type TestApp } from './helpers';

const T0 = Date.UTC(2026, 9, 14, 9, 34, 12);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The last check of the minutely monitors before T0. */
const LAST = Date.UTC(2026, 9, 14, 9, 34);
const sec = (ms: number) => ms / 1000;
const iso = (ms: number) => new Date(ms).toISOString();
/** Addresses of the demo server monitor 4 pings, IPv6 first like some providers list them. */
const SERVER_IPS = ['2a0e:3e8::1', '185.100.7.10'];
const PAGE = { statusPageSlug: DEMO_KUMA_STATUS_PAGE };
const NO_PAGE = { statusPageSlug: null };

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected the promise to reject');
}

/** 400 "Validation failed" with the field as the issue path, like the Uptime Kuma adapter. */
async function invalid(promise: Promise<unknown>, path: string): Promise<void> {
  const err = await caught(promise);
  expect({ status: err.statusCode, code: err.code, message: err.message }).toEqual({
    status: 400,
    code: 'bad_request',
    message: 'Validation failed',
  });
  expect((err.details as { path: string }[]).map((d) => d.path)).toEqual([path]);
}

async function badRequest(promise: Promise<unknown>): Promise<AppError> {
  const err = await caught(promise);
  expect({ status: err.statusCode, code: err.code }).toEqual({ status: 400, code: 'bad_request' });
  return err;
}

/** A missing monitor or status page: ProviderError with HTTP 404 and the provider name "Demo". */
async function missing(promise: Promise<unknown>): Promise<AppError> {
  const err = await caught(promise);
  expect(err).toBeInstanceOf(ProviderError);
  expect({ status: err.statusCode, code: err.code }).toEqual({ status: 404, code: 'provider_error' });
  expect(err.message).toMatch(/^Demo: /);
  return err;
}

const total = (points: MonitorHistoryPoint[], key: 'up' | 'down' | 'maintenance') =>
  points.reduce((sum, p) => sum + p[key], 0);
const at = (history: MonitorHistoryDto | null, ms: number) => history?.points.find((p) => p.t === sec(ms));

const input = (extra: Partial<MonitorInput> = {}): MonitorInput => ({
  kind: 'http',
  name: '[muster-ag] Blog',
  url: 'https://blog.muster-ag.ch',
  hostname: null,
  port: null,
  keyword: null,
  invertKeyword: false,
  method: 'GET',
  acceptedStatusCodes: ['200-299'],
  intervalSeconds: 60,
  ignoreTls: false,
  ...extra,
});

describe('Demo Uptime Kuma', () => {
  let id: string;
  const kuma = (ips: string[] = SERVER_IPS) =>
    new DemoMonitoring(demoMonitoringState(id), (externalId) => (externalId === 'demo-42-1' ? ips : []));
  const byId = async (k: DemoMonitoring, externalId: string): Promise<RemoteMonitor | undefined> =>
    (await k.listMonitors()).monitors.find((m) => m.externalId === externalId);

  beforeEach(() => {
    resetDemoMonitoring();
    id = randomUUID();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with the fixed dataset: eight monitors, a complete inventory, one paused', async () => {
    const k = kuma();
    const facts = (f: Partial<typeof EMPTY_MONITOR_FACTS>) => ({ ...EMPTY_MONITOR_FACTS, ...f });
    const base = { active: true, parentId: null };
    expect(await k.listMonitors()).toEqual({
      complete: true,
      managementError: null,
      monitors: [
        {
          ...base,
          externalId: '1',
          name: 'muster-ag.ch Website',
          type: 'http',
          target: 'https://www.muster-ag.ch',
          targetHost: 'www.muster-ag.ch',
          status: 'up',
          intervalSeconds: 60,
          facts: {
            responseMs: 182,
            avgResponseMs24h: 204,
            avgResponseMs30d: 198,
            uptime24h: 0.9993,
            uptime30d: 0.99987,
            certDaysRemaining: 54,
            certValid: true,
          },
        },
        {
          ...base,
          externalId: '2',
          name: '[muster-ag] Shop',
          type: 'keyword',
          target: 'https://muster-shop.ch',
          targetHost: 'muster-shop.ch',
          status: 'up',
          intervalSeconds: 120,
          facts: {
            responseMs: 240,
            avgResponseMs24h: 251,
            avgResponseMs30d: 247,
            uptime24h: 1,
            uptime30d: 0.9991,
            certDaysRemaining: 12,
            certValid: true,
          },
        },
        {
          ...base,
          externalId: '3',
          name: 'Mailserver SMTP',
          type: 'port',
          target: 'mail.muster-ag.ch:25',
          targetHost: 'mail.muster-ag.ch',
          status: 'down',
          intervalSeconds: 60,
          facts: facts({ uptime24h: 0.9512, uptime30d: 0.9971 }),
        },
        {
          ...base,
          externalId: '4',
          name: 'Webserver Ping',
          type: 'ping',
          target: '185.100.7.10',
          targetHost: '185.100.7.10',
          status: 'up',
          intervalSeconds: 60,
          facts: facts({
            responseMs: 12,
            avgResponseMs24h: 13,
            avgResponseMs30d: 13,
            uptime24h: 1,
            uptime30d: 1,
          }),
        },
        {
          ...base,
          externalId: '5',
          name: 'baeckerei-huber.ch',
          type: 'http',
          target: 'https://baeckerei-huber.ch',
          targetHost: 'baeckerei-huber.ch',
          status: 'up',
          intervalSeconds: 300,
          facts: {
            responseMs: 320,
            avgResponseMs24h: 310,
            avgResponseMs30d: 305,
            uptime24h: 1,
            uptime30d: 0.9998,
            certDaysRemaining: 6,
            certValid: true,
          },
        },
        {
          ...base,
          externalId: '6',
          name: 'alpenblick-hotel.ch',
          type: 'http',
          target: 'https://alpenblick-hotel.ch',
          targetHost: 'alpenblick-hotel.ch',
          status: 'paused',
          active: false,
          intervalSeconds: 60,
          facts: { ...EMPTY_MONITOR_FACTS },
        },
        {
          ...base,
          externalId: '7',
          name: 'Status API',
          type: 'http',
          target: 'https://api.weblion.example/health',
          targetHost: 'api.weblion.example',
          status: 'up',
          intervalSeconds: 30,
          facts: {
            responseMs: 95,
            avgResponseMs24h: 101,
            avgResponseMs30d: 99,
            uptime24h: 1,
            uptime30d: 1,
            certDaysRemaining: 80,
            certValid: true,
          },
        },
        {
          ...base,
          externalId: '8',
          name: 'Kunden-Websites',
          type: 'group',
          target: null,
          targetHost: null,
          status: 'up',
          intervalSeconds: 60,
          facts: facts({ uptime24h: 0.99 }),
        },
      ],
    });
    expect(k.monitorManagement()).toBe(true);
    expect(await k.monitoringStatus()).toEqual({
      version: DEMO_KUMA_VERSION,
      management: 'ok',
      managementError: null,
      uptimeMetrics: true,
    });
    expect(k.payloads()).toEqual([]);
  });

  it('reads configuration and status changes live', async () => {
    const k = kuma();
    const started = LAST - 180 * DAY;
    const three = await k.getMonitor('3');
    expect(three.monitor).toMatchObject({ externalId: '3', status: 'down', active: true });
    expect(three.config).toEqual({
      url: null,
      hostname: 'mail.muster-ag.ch',
      port: 25,
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
    expect(three.events).toEqual([
      {
        status: 'down',
        at: iso(LAST - 5 * MINUTE),
        message: 'connect ECONNREFUSED 185.101.0.25:25',
        responseMs: null,
      },
      { status: 'up', at: iso(LAST - 3 * HOUR + 20 * MINUTE), message: null, responseMs: 35 },
      {
        status: 'down',
        at: iso(LAST - 3 * HOUR),
        message: 'connect ETIMEDOUT 185.101.0.25:25',
        responseMs: null,
      },
      { status: 'up', at: iso(started), message: null, responseMs: 35 },
    ]);

    const two = await k.getMonitor('2');
    expect(two.config).toMatchObject({
      url: 'https://muster-shop.ch',
      keyword: 'Warenkorb',
      timeoutSeconds: 48,
    });
    expect(two.events?.[0]).toMatchObject({ status: 'up', message: '200 - OK, keyword is found' });
    expect((await k.getMonitor('4')).config).toMatchObject({ hostname: '185.100.7.10', timeoutSeconds: 10 });
    expect((await k.getMonitor('7')).config).toMatchObject({ intervalSeconds: 30, timeoutSeconds: 24 });
    const one = await k.getMonitor('1');
    expect(one.events?.slice(0, 2)).toEqual([
      { status: 'up', at: iso(LAST - 2 * DAY + 2 * MINUTE), message: '200 - OK', responseMs: 204 },
      { status: 'down', at: iso(LAST - 2 * DAY), message: 'timeout of 48000ms exceeded', responseMs: null },
    ]);
    // Every read is a copy.
    one.monitor.facts.responseMs = 1;
    one.config!.acceptedStatusCodes.push('500');
    expect((await k.getMonitor('1')).monitor.facts.responseMs).toBe(182);
    expect((await k.getMonitor('1')).config!.acceptedStatusCodes).toEqual(['200-299']);
  });

  it('pings the first IPv4 address of demo-42-1', async () => {
    // Through the demo adapter, with its own servers.
    const adapter = createAdapter('demo', id, { seed: 42, servers: 8 });
    expect(adapter).toBeInstanceOf(DemoAdapter);
    const server = (await adapter.listServers()).find((s) => s.externalId === 'demo-42-1')!;
    const ipv4 = server.ips.find((ip) => ip.version === 4)!.address;
    const four = (await adapter.listMonitors!()).monitors.find((m) => m.externalId === '4')!;
    expect(four).toMatchObject({ type: 'ping', target: ipv4, targetHost: ipv4 });

    // Without the server: the fallback, until an adapter that knows the server comes along.
    id = randomUUID();
    expect(await byId(kuma([]), '4')).toMatchObject({ target: '203.0.113.10' });
    expect(await byId(kuma(['2a0e:3e8::1']), '4')).toMatchObject({ target: '203.0.113.10' });
    expect(await byId(kuma(), '4')).toMatchObject({ target: '185.100.7.10' });
    // Bound once: a later adapter does not move it again.
    expect(await byId(kuma(['185.100.99.10']), '4')).toMatchObject({ target: '185.100.7.10' });
  });

  it('creates, updates, pauses, resumes and deletes like Kuma, kept across adapter instances', async () => {
    const k = kuma();
    const created = await k.createMonitor(input({ url: 'https://blog.muster-ag.ch/?token=abc&x=1' }));
    expect(created).toEqual({
      externalId: '100',
      name: '[muster-ag] Blog',
      type: 'http',
      target: 'https://blog.muster-ag.ch/?token=***&x=1',
      targetHost: 'blog.muster-ag.ch',
      status: 'pending',
      active: true,
      intervalSeconds: 60,
      parentId: null,
      facts: { ...EMPTY_MONITOR_FACTS },
    });
    const port = await k.createMonitor(
      input({ kind: 'port', name: '[muster-ag] SMTP', url: null, hostname: 'Mail.Example.ch', port: 587 }),
    );
    expect(port).toMatchObject({ externalId: '101', target: 'mail.example.ch:587', status: 'pending' });

    // Pending until the first check: no events, no history yet.
    const live = await k.getMonitor('100');
    expect(live.monitor.status).toBe('pending');
    expect(live.events).toEqual([]);
    expect(live.config).toMatchObject({ url: 'https://blog.muster-ag.ch/?token=***&x=1', hostname: null });
    expect((await k.getMonitorHistory('100', '24h', PAGE))!.points).toEqual([]);
    expect(await k.getMonitorHistory('100', 'recent', PAGE)).toBeNull();

    // The next list is after the first check.
    const listed = await k.listMonitors();
    expect(listed.monitors.map((m) => m.externalId)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '100',
      '101',
    ]);
    expect(listed.monitors.find((m) => m.externalId === '100')).toMatchObject({
      status: 'up',
      facts: {
        responseMs: 100,
        avgResponseMs24h: 100,
        avgResponseMs30d: 100,
        uptime24h: 1,
        uptime30d: 1,
        certDaysRemaining: 70,
        certValid: true,
      },
    });
    expect(listed.monitors.find((m) => m.externalId === '101')!.facts).toMatchObject({
      responseMs: 31,
      certDaysRemaining: null,
      certValid: null,
    });
    vi.setSystemTime(T0 + 10 * MINUTE);
    expect((await k.getMonitor('100')).events).toEqual([
      { status: 'up', at: iso(T0), message: '200 - OK', responseMs: 100 },
    ]);
    expect(total((await k.getMonitorHistory('100', '24h', NO_PAGE))!.points, 'up')).toBe(10);

    await k.updateMonitor('100', {
      name: '[muster-ag] Blog neu',
      intervalSeconds: 120,
      url: 'https://blog.muster-ag.ch/neu',
      method: 'HEAD',
      acceptedStatusCodes: ['200', '301-302'],
      ignoreTls: true,
    });
    const updated = await k.getMonitor('100');
    expect(updated.monitor).toMatchObject({
      name: '[muster-ag] Blog neu',
      target: 'https://blog.muster-ag.ch/neu',
      intervalSeconds: 120,
      status: 'up',
    });
    expect(updated.config).toMatchObject({
      url: 'https://blog.muster-ag.ch/neu',
      method: 'HEAD',
      acceptedStatusCodes: ['200', '301-302'],
      intervalSeconds: 120,
      retryIntervalSeconds: 120,
      timeoutSeconds: 48,
      ignoreTls: true,
    });
    // Fields that do not belong to the kind are ignored.
    await k.updateMonitor('101', { url: 'https://elsewhere.example', port: 465 });
    expect((await k.getMonitor('101')).monitor).toMatchObject({ target: 'mail.example.ch:465' });
    expect((await k.getMonitor('101')).config).toMatchObject({ url: null, port: 465 });

    await k.pauseMonitor('100');
    const paused = await byId(k, '100');
    expect(paused).toMatchObject({ status: 'paused', active: false, facts: { ...EMPTY_MONITOR_FACTS } });
    await k.pauseMonitor('100');
    await k.resumeMonitor('100');
    expect(await byId(k, '100')).toMatchObject({ status: 'up', active: true, facts: { responseMs: 100 } });

    // Another adapter instance of the same connection sees the same monitors; another connection not.
    const again = kuma();
    expect((await again.getMonitor('100')).monitor.name).toBe('[muster-ag] Blog neu');
    expect(again.payloads()).toEqual(k.payloads());
    const otherId = id;
    id = randomUUID();
    expect((await kuma().listMonitors()).monitors).toHaveLength(8);
    id = otherId;

    await k.deleteMonitor('100');
    await missing(k.getMonitor('100'));
    expect(await byId(k, '100')).toBeUndefined();
    // Unknown ids are no error for delete, like Kuma.
    await k.deleteMonitor('100');
    await k.deleteMonitor('424242');
    expect(k.payloads()).toEqual([
      { event: 'add', externalId: '100' },
      { event: 'add', externalId: '101' },
      { event: 'editMonitor', externalId: '100' },
      { event: 'editMonitor', externalId: '101' },
      { event: 'pauseMonitor', externalId: '100' },
      { event: 'pauseMonitor', externalId: '100' },
      { event: 'resumeMonitor', externalId: '100' },
      { event: 'deleteMonitor', externalId: '100' },
      { event: 'deleteMonitor', externalId: '100' },
      { event: 'deleteMonitor', externalId: '424242' },
    ]);

    // The reset forgets everything: the dataset again, new ids from 100.
    resetDemoMonitoring();
    const fresh = kuma();
    expect((await fresh.listMonitors()).monitors.map((m) => m.externalId)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
    expect(fresh.payloads()).toEqual([]);
    expect((await fresh.createMonitor(input())).externalId).toBe('100');
  });

  it('keeps created monitors across demo adapter instances and forgets them on DemoAdapter.reset', async () => {
    const first = createAdapter('demo', id, { seed: 42, servers: 8 });
    const created = await first.createMonitor!(input({ kind: 'ping', url: null, hostname: '185.100.7.10' }));
    const second = createAdapter('demo', id, { seed: 42, servers: 8 });
    expect((await second.getMonitor!(created.externalId)).monitor).toMatchObject({
      type: 'ping',
      target: '185.100.7.10',
    });
    DemoAdapter.reset();
    await missing(createAdapter('demo', id, { seed: 42, servers: 8 }).getMonitor!(created.externalId));
  });

  it('validates like the Uptime Kuma adapter, with 400 before anything is sent', async () => {
    const k = kuma();
    await invalid(k.createMonitor(input({ url: 'ftp://files.muster-ag.ch' })), 'url');
    await invalid(k.createMonitor(input({ url: 'https://user:secret@muster-ag.ch' })), 'url');
    await invalid(k.createMonitor(input({ kind: 'keyword', keyword: null })), 'keyword');
    await invalid(k.createMonitor(input({ kind: 'ping', url: null, hostname: 'https://x.ch' })), 'hostname');
    await invalid(
      k.createMonitor(input({ kind: 'port', url: null, hostname: 'mail.example.ch', port: 0 })),
      'port',
    );
    await invalid(k.createMonitor(input({ intervalSeconds: 10 })), 'intervalSeconds');
    await invalid(k.createMonitor(input({ intervalSeconds: 86_401 })), 'intervalSeconds');
    await invalid(k.createMonitor(input({ name: '  ' })), 'name');
    await invalid(k.createMonitor(input({ name: 'Zeile\nzwei' })), 'name');
    await invalid(k.createMonitor(input({ acceptedStatusCodes: ['2xx'] })), 'acceptedStatusCodes');
    await invalid(k.createMonitor(input({ acceptedStatusCodes: [] })), 'acceptedStatusCodes');
    await badRequest(k.createMonitor(input({ kind: 'dns' as never })));
    expect(k.payloads()).toEqual([]);
    expect((await k.listMonitors()).monitors).toHaveLength(8);

    // Updates check the merged target and change nothing when refused.
    await invalid(k.updateMonitor('2', { keyword: '' }), 'keyword');
    await invalid(k.updateMonitor('2', { url: 'not a url' }), 'url');
    await invalid(k.updateMonitor('3', { port: 70_000 }), 'port');
    await invalid(k.updateMonitor('1', { intervalSeconds: 10 }), 'intervalSeconds');
    await invalid(k.updateMonitor('1', { method: 'POST' as never }), 'method');
    expect((await k.getMonitor('2')).config).toMatchObject({
      keyword: 'Warenkorb',
      url: 'https://muster-shop.ch',
    });
    expect((await k.getMonitor('3')).config).toMatchObject({ port: 25 });
    expect(k.payloads()).toEqual([]);

    // Ids are Kuma integers; unknown ones are 404.
    for (const call of [
      () => k.getMonitor('12a'),
      () => k.getMonitorHistory('1; drop', '24h', NO_PAGE),
      () => k.updateMonitor('-1', {}),
      () => k.pauseMonitor('abc'),
      () => k.resumeMonitor(''),
      () => k.deleteMonitor('1.5'),
    ]) {
      await badRequest(call());
    }
    expect(k.payloads()).toEqual([]);
    const err = await missing(k.getMonitor('99'));
    expect(err.message).toBe('Demo: monitor 99 not found in Uptime Kuma');
    await missing(k.updateMonitor('99', { name: 'x' }));
    await missing(k.pauseMonitor('99'));
    await missing(k.resumeMonitor('99'));
    await missing(k.getMonitorHistory('99', 'recent', PAGE));
    // Kuma received the pause and resume (and answered "You do not own this monitor.").
    expect(k.payloads()).toEqual([
      { event: 'pauseMonitor', externalId: '99' },
      { event: 'resumeMonitor', externalId: '99' },
    ]);
  });

  it('serves history: the last checks of the status page and chart buckets', async () => {
    const k = kuma();
    expect(k.monitorHistoryRanges(PAGE)).toEqual(['recent', '24h', '7d', '30d']);
    expect(k.monitorHistoryRanges(NO_PAGE)).toEqual(['24h', '7d', '30d']);

    // recent: 100 checks every interval up to the last one, oldest first.
    const recent = (await k.getMonitorHistory('1', 'recent', PAGE))!;
    expect(recent).toMatchObject({ range: 'recent', source: 'statusPage', resolutionSeconds: null });
    expect(recent.points).toHaveLength(100);
    expect(recent.points.map((p) => p.t)).toEqual(
      Array.from({ length: 100 }, (_, i) => sec(LAST - (99 - i) * MINUTE)),
    );
    expect(recent.points.every((p) => p.up === 1 && p.ping! >= 173 && p.ping! <= 235)).toBe(true);
    // Deterministic: the same check has the same response time later.
    vi.setSystemTime(T0 + 5 * MINUTE);
    const later = (await k.getMonitorHistory('1', 'recent', PAGE))!;
    expect(later.points.slice(0, 95)).toEqual(recent.points.slice(5));
    vi.setSystemTime(T0);

    // Monitor 3 failed its last six checks.
    const three = (await k.getMonitorHistory('3', 'recent', PAGE))!.points;
    expect(three).toHaveLength(100);
    expect(three.slice(-6).every((p) => p.down === 1 && p.up === 0 && p.ping === null)).toBe(true);
    expect(three.at(-7)).toMatchObject({ up: 1, down: 0 });

    // Not on the page, no page, unknown page: nothing. A broken slug is refused.
    expect(await k.getMonitorHistory('7', 'recent', PAGE)).toBeNull();
    expect(await k.getMonitorHistory('4', 'recent', PAGE)).toBeNull();
    expect(await k.getMonitorHistory('1', 'recent', NO_PAGE)).toBeNull();
    expect(await k.getMonitorHistory('1', 'recent', { statusPageSlug: 'beispiel' })).toBeNull();
    await badRequest(k.getMonitorHistory('1', 'recent', { statusPageSlug: 'Muster AG!' }));

    // 24h: minutely entries in 5-minute buckets, with the 20-minute outage 3 hours ago.
    const day = (await k.getMonitorHistory('3', '24h', NO_PAGE))!;
    expect(day).toMatchObject({ range: '24h', source: 'kuma', resolutionSeconds: 300 });
    expect(day.points).toHaveLength(288);
    expect(day.points[0]!.t).toBe(sec(LAST - DAY + MINUTE));
    expect(day.points.at(-1)!.t).toBe(sec(LAST - 4 * MINUTE));
    expect(total(day.points, 'up') + total(day.points, 'down')).toBe(1440);
    expect(total(day.points, 'down')).toBe(26);
    const outage = LAST - 3 * HOUR;
    expect(at(day, outage - 4 * MINUTE)).toMatchObject({ up: 4, down: 1 });
    expect(at(day, outage + MINUTE)).toMatchObject({ up: 0, down: 5, ping: null });
    expect(at(day, outage + 16 * MINUTE)).toMatchObject({ up: 1, down: 4 });
    expect(at(day, outage + 21 * MINUTE)).toMatchObject({ up: 5, down: 0 });
    expect(at(day, LAST - 9 * MINUTE)).toMatchObject({ up: 4, down: 1 });
    expect(at(day, LAST - 4 * MINUTE)).toMatchObject({ up: 0, down: 5, ping: null });
    expect(at(day, LAST - 14 * MINUTE)!.ping).toBeGreaterThan(0);

    // 7d: hourly as delivered, with the 2-minute outage of monitor 1 two days ago.
    const week = (await k.getMonitorHistory('1', '7d', NO_PAGE))!;
    expect(week).toMatchObject({ range: '7d', resolutionSeconds: 3600 });
    expect(week.points).toHaveLength(168);
    expect(total(week.points, 'down')).toBe(2);
    expect(at(week, LAST - 2 * DAY - 34 * MINUTE)).toMatchObject({ up: 58, down: 2 });
    expect(week.points.at(-1)).toMatchObject({ t: sec(LAST - 34 * MINUTE), up: 35, down: 0 });

    // 30d: hourly entries in 6-hour buckets.
    const month = (await k.getMonitorHistory('1', '30d', NO_PAGE))!;
    expect(month).toMatchObject({ range: '30d', resolutionSeconds: 21_600 });
    expect(month.points).toHaveLength(120);
    expect(total(month.points, 'down')).toBe(2);
    expect(month.points.at(-1)).toMatchObject({ t: sec(Date.UTC(2026, 9, 14, 6)), up: 215 });
    expect(month.points[0]!.t).toBe(sec(Date.UTC(2026, 8, 14, 12)));

    // A group has checks without a response time.
    const group = (await k.getMonitorHistory('8', '24h', NO_PAGE))!;
    expect(group.points).toHaveLength(288);
    expect(group.points.every((p) => p.ping === null && p.up > 0)).toBe(true);

    // Paused monitor 6 (two days ago): no recent checks, the charts end at the pause.
    expect(await k.getMonitorHistory('6', 'recent', PAGE)).toBeNull();
    expect((await k.getMonitorHistory('6', '24h', NO_PAGE))!.points).toEqual([]);
    const pausedWeek = (await k.getMonitorHistory('6', '7d', NO_PAGE))!.points;
    expect(pausedWeek.at(-1)).toMatchObject({ t: sec(LAST - 2 * DAY - 34 * MINUTE), up: 34 });
    expect((await k.getMonitorHistory('6', '30d', NO_PAGE))!.points.length).toBeGreaterThan(100);

    // A monitor paused on the page keeps its last checks there.
    await k.pauseMonitor('2');
    vi.setSystemTime(T0 + HOUR);
    const pausedTwo = (await k.getMonitorHistory('2', 'recent', PAGE))!.points;
    expect(pausedTwo).toHaveLength(100);
    expect(pausedTwo.at(-1)!.t).toBe(sec(LAST));
  });

  it('lists the status page and its monitors', async () => {
    const k = kuma();
    expect(await k.getStatusPage('muster-ag')).toEqual({
      slug: 'muster-ag',
      title: 'Muster AG Status',
      monitorIds: ['1', '2', '3'],
    });
    expect((await k.getStatusPage(' Muster-AG ')).slug).toBe('muster-ag');
    const err = await missing(k.getStatusPage('beispiel'));
    expect(err.message).toBe('Demo: Status Page Not Found');
    await badRequest(k.getStatusPage('Muster AG!'));
    expect(k.statusPageUrl('muster-ag')).toBe(`${DEMO_KUMA_URL}/status/muster-ag`);
    expect(k.statusPageUrl('muster-ag')).toBe('https://status.demo.weblion.one/status/muster-ag');
    // Deleted monitors leave the page.
    await k.deleteMonitor('3');
    expect((await k.getStatusPage('muster-ag')).monitorIds).toEqual(['1', '2']);
  });

  it('test helpers: status after the next check, deletion in Kuma', async () => {
    const k = kuma();
    k.setStatus('1', 'down');
    expect(await byId(k, '1')).toMatchObject({
      status: 'down',
      facts: { responseMs: null, uptime24h: 0.9993 },
    });
    expect((await k.getMonitor('1')).events![0]).toEqual({
      status: 'down',
      at: iso(T0),
      message: 'Request failed with status code 503',
      responseMs: null,
    });
    vi.setSystemTime(T0 + 2 * MINUTE);
    const checks = (await k.getMonitorHistory('1', 'recent', PAGE))!.points;
    expect(checks.slice(-3).map((p) => p.down)).toEqual([0, 1, 1]);

    k.setStatus('1', 'maintenance');
    expect(await byId(k, '1')).toMatchObject({ status: 'maintenance', facts: { responseMs: null } });
    vi.setSystemTime(T0 + 4 * MINUTE);
    k.setStatus('1', 'up');
    expect(await byId(k, '1')).toMatchObject({ status: 'up', facts: { responseMs: 182 } });
    expect((await k.getMonitor('1')).events!.slice(0, 3).map((e) => [e.status, e.at, e.message])).toEqual([
      ['up', iso(T0 + 4 * MINUTE), '200 - OK'],
      ['maintenance', iso(T0 + 2 * MINUTE), 'Monitor under maintenance'],
      ['down', iso(T0), 'Request failed with status code 503'],
    ]);

    // "pending" until the next list.
    k.setStatus('2', 'pending');
    expect((await k.getMonitor('2')).monitor.status).toBe('pending');
    expect(await byId(k, '2')).toMatchObject({ status: 'up' });

    // Resumed monitors report what their next check says: monitor 3 is still down.
    await k.pauseMonitor('3');
    expect(await byId(k, '3')).toMatchObject({ status: 'paused', active: false });
    await k.resumeMonitor('3');
    expect(await byId(k, '3')).toMatchObject({ status: 'down', active: true });
    await k.resumeMonitor('6');
    expect(await byId(k, '6')).toMatchObject({ status: 'up', active: true, facts: { responseMs: 280 } });

    // Deleted in Kuma: gone from the list and the status page, nothing sent by the console.
    const sent = k.payloads().length;
    k.removeMonitor('3');
    expect(await byId(k, '3')).toBeUndefined();
    expect((await k.getStatusPage('muster-ag')).monitorIds).toEqual(['1', '2']);
    expect(k.payloads()).toHaveLength(sent);
    expect(() => k.removeMonitor('3')).toThrow(ProviderError);
    expect(() => k.setStatus('3', 'up')).toThrow(ProviderError);
  });
});

describe('Demo monitoring seed', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  const demo = async () =>
    (await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.envKey, 'demo') }))!;
  const org = async (slug: string) =>
    (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;
  const owners = async (connectionId: string) =>
    (
      await t.db
        .select({
          id: monitors.externalId,
          org: organizations.slug,
          origin: monitors.origin,
          name: monitors.name,
          providerName: monitors.providerName,
          createdBy: monitors.createdBy,
        })
        .from(monitors)
        .leftJoin(organizations, eq(organizations.id, monitors.orgId))
        .where(eq(monitors.providerConnectionId, connectionId))
        .orderBy(monitors.externalId)
    ).map((r) => ({ ...r, createdBy: r.createdBy ? 'set' : null }));
  const allowances = async (connectionId: string) =>
    (
      await t.db
        .select({
          slug: organizations.slug,
          maxMonitors: monitorAllowances.maxMonitors,
          minIntervalSeconds: monitorAllowances.minIntervalSeconds,
        })
        .from(monitorAllowances)
        .innerJoin(organizations, eq(organizations.id, monitorAllowances.orgId))
        .where(eq(monitorAllowances.providerConnectionId, connectionId))
        .orderBy(organizations.slug)
    ).map((r) => ({ ...r }));
  const pages = async (connectionId: string) =>
    t.db
      .select({ slug: organizations.slug, page: monitorStatusPages.slug, url: monitorStatusPages.url })
      .from(monitorStatusPages)
      .innerJoin(organizations, eq(organizations.id, monitorStatusPages.orgId))
      .where(eq(monitorStatusPages.providerConnectionId, connectionId));
  const setModules = async (slug: string, modules: ModuleKey[]) =>
    t.db.update(organizations).set({ modules }).where(eq(organizations.slug, slug));

  /** Starts over: no monitor rows, allowances, status page links or module of the demo seed. */
  async function clear(connectionId: string) {
    await t.db.delete(monitorStatusPages).where(eq(monitorStatusPages.providerConnectionId, connectionId));
    await t.db.delete(monitorAllowances).where(eq(monitorAllowances.providerConnectionId, connectionId));
    await t.db.delete(monitors).where(eq(monitors.providerConnectionId, connectionId));
    const muster = await org('muster-ag');
    await setModules(
      'muster-ag',
      muster.modules.filter((m) => m !== 'monitoring'),
    );
  }

  /** Rows the way the monitor sync inserts them: unassigned, origin "kuma", the Kuma name as display name. */
  async function insertLikeSync(connectionId: string, adapter = createAdapter('demo', connectionId, {})) {
    const { monitors: remote } = await adapter.listMonitors!();
    const now = new Date();
    await t.db
      .insert(monitors)
      .values(
        remote.map((r) => ({
          providerConnectionId: connectionId,
          externalId: r.externalId,
          name: r.name,
          providerName: r.name,
          type: r.type,
          target: r.target,
          targetHost: r.targetHost,
          status: r.status,
          active: r.active,
          intervalSeconds: r.intervalSeconds,
          facts: r.facts,
          meta: r.parentId ? { parentId: r.parentId } : {},
          lastSyncedAt: now,
        })),
      )
      .onConflictDoNothing();
  }

  it('assigns the demo monitors, sets the allowances and the status page link, once', async () => {
    const connection = await demo();
    const kept = {
      alpen: (await org('alpen-hosting')).modules,
      huber: (await org('baeckerei-huber')).modules,
    };
    await clear(connection.id);

    const log: string[] = [];
    await seedMonitoringDemo(t.db, log);
    // The seed syncs once when there are no rows. A sync that finds nothing leaves it with nothing to do.
    const synced = await t.db.select().from(monitors).where(eq(monitors.providerConnectionId, connection.id));
    if (synced.length === 0) {
      expect(log).toEqual([]);
      expect(await allowances(connection.id)).toEqual([]);
      expect(await pages(connection.id)).toEqual([]);
      expect((await org('muster-ag')).modules).not.toContain('monitoring');
      await insertLikeSync(connection.id);
      await seedMonitoringDemo(t.db, log);
    }
    expect(log).toEqual([
      'monitoring: 5 monitors assigned, module monitoring for Muster AG, 2 allowances, 1 status page',
    ]);

    const kuma = { origin: 'kuma', createdBy: null };
    expect(await owners(connection.id)).toEqual([
      {
        id: '1',
        org: 'muster-ag',
        ...kuma,
        name: 'muster-ag.ch Website',
        providerName: 'muster-ag.ch Website',
      },
      {
        id: '2',
        org: 'muster-ag',
        origin: 'console',
        name: 'Shop',
        providerName: '[muster-ag] Shop',
        createdBy: 'set',
      },
      { id: '3', org: 'muster-ag', ...kuma, name: 'Mailserver SMTP', providerName: 'Mailserver SMTP' },
      { id: '4', org: 'muster-ag', ...kuma, name: 'Webserver Ping', providerName: 'Webserver Ping' },
      {
        id: '5',
        org: 'baeckerei-huber',
        ...kuma,
        name: 'baeckerei-huber.ch',
        providerName: 'baeckerei-huber.ch',
      },
      { id: '6', org: null, ...kuma, name: 'alpenblick-hotel.ch', providerName: 'alpenblick-hotel.ch' },
      { id: '7', org: null, ...kuma, name: 'Status API', providerName: 'Status API' },
      { id: '8', org: null, ...kuma, name: 'Kunden-Websites', providerName: 'Kunden-Websites' },
    ]);
    const anna = await t.db.query.users.findFirst({ where: eq(users.email, 'anna@muster.example') });
    const shop = await t.db.query.monitors.findFirst({
      where: and(eq(monitors.providerConnectionId, connection.id), eq(monitors.externalId, '2')),
    });
    expect(shop!.createdBy).toBe(anna!.id);

    // Monitor 4 pings the demo server it is about (related monitors on the server page).
    const server = await t.db.query.servers.findFirst({
      where: and(eq(servers.providerConnectionId, connection.id), eq(servers.externalId, 'demo-42-1')),
    });
    const ping = await t.db.query.monitors.findFirst({
      where: and(eq(monitors.providerConnectionId, connection.id), eq(monitors.externalId, '4')),
    });
    expect(ping!.targetHost).toBe(server!.ips.find((ip) => ip.version === 4)!.address);

    expect((await org('muster-ag')).modules).toContain('monitoring');
    expect((await org('alpen-hosting')).modules).toEqual(kept.alpen);
    expect((await org('baeckerei-huber')).modules).toEqual(kept.huber);
    expect(await allowances(connection.id)).toEqual([
      { slug: 'alpen-hosting', maxMonitors: 50, minIntervalSeconds: 60 },
      { slug: 'muster-ag', maxMonitors: 10, minIntervalSeconds: 60 },
    ]);
    expect(await pages(connection.id)).toEqual([{ slug: 'muster-ag', page: 'muster-ag', url: null }]);
    // Beispiel GmbH gets nothing.
    const beispiel = await org('beispiel-gmbh');
    expect(
      await t.db.query.monitorAllowances.findFirst({ where: eq(monitorAllowances.orgId, beispiel.id) }),
    ).toBe(undefined);

    // Idempotent: nothing new, and what staff changed afterwards stays.
    const before = await owners(connection.id);
    const again: string[] = [];
    await seedMonitoringDemo(t.db, again);
    expect(again).toEqual([]);
    expect(await owners(connection.id)).toEqual(before);

    await t.db
      .update(monitors)
      .set({ orgId: null })
      .where(and(eq(monitors.providerConnectionId, connection.id), eq(monitors.externalId, '1')));
    const muster = await org('muster-ag');
    await setModules(
      'muster-ag',
      muster.modules.filter((m) => m !== 'monitoring'),
    );
    await seedMonitoringDemo(t.db, again);
    expect(again).toEqual([]);
    expect((await owners(connection.id)).find((r) => r.id === '1')!.org).toBeNull();
    expect((await org('muster-ag')).modules).not.toContain('monitoring');
    const assigned = await t.db
      .select({ id: monitors.id })
      .from(monitors)
      .where(and(eq(monitors.providerConnectionId, connection.id), isNotNull(monitors.orgId)));
    expect(assigned).toHaveLength(4);
  });

  it('runs the monitor sync once when the connection has no monitor rows', async () => {
    const connection = await demo();
    await clear(connection.id);
    const calls: { connectionId: string; type: string }[] = [];
    // A sync that stores what the adapter lists, in a fresh module graph so the seed picks it up.
    vi.resetModules();
    vi.doMock('../src/jobs/sync-monitoring', () => ({
      syncMonitors: async (_db: unknown, conn: { id: string }, adapter: ProviderAdapter) => {
        calls.push({ connectionId: conn.id, type: adapter.type });
        await insertLikeSync(conn.id, adapter);
        return { seen: 8, missing: 0, managementError: null };
      },
    }));
    try {
      const { seedMonitoringDemo: seed } = await import('../src/db/seed-monitoring');
      const log: string[] = [];
      await seed(t.db, log);
      expect(calls).toEqual([{ connectionId: connection.id, type: 'demo' }]);
      expect(log).toEqual([
        'monitoring: 5 monitors assigned, module monitoring for Muster AG, 2 allowances, 1 status page',
      ]);
      expect((await owners(connection.id)).map((r) => [r.id, r.org])).toEqual([
        ['1', 'muster-ag'],
        ['2', 'muster-ag'],
        ['3', 'muster-ag'],
        ['4', 'muster-ag'],
        ['5', 'baeckerei-huber'],
        ['6', null],
        ['7', null],
        ['8', null],
      ]);
      // Rows exist now: no second sync.
      await seed(t.db, log);
      expect(calls).toHaveLength(1);
      expect(log).toHaveLength(1);
    } finally {
      vi.doUnmock('../src/jobs/sync-monitoring');
      vi.resetModules();
    }
  });

  it('does nothing without the demo connection', async () => {
    const connection = await demo();
    await clear(connection.id);
    await t.db
      .update(providerConnections)
      .set({ envKey: null })
      .where(eq(providerConnections.id, connection.id));
    try {
      const log: string[] = [];
      await seedMonitoringDemo(t.db, log);
      expect(log).toEqual([]);
      expect(await owners(connection.id)).toEqual([]);
      expect(await allowances(connection.id)).toEqual([]);
      expect(await pages(connection.id)).toEqual([]);
      expect((await org('muster-ag')).modules).not.toContain('monitoring');
    } finally {
      await t.db
        .update(providerConnections)
        .set({ envKey: 'demo' })
        .where(eq(providerConnections.id, connection.id));
    }
  });
});
