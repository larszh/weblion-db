import { describe, expect, it } from 'vitest';
import type { MonitorConfig, MonitorDto, MonitorHistoryPoint } from '@weblion/shared';
import { ApiError } from '@/lib/api';
import type { TFunction } from '@/lib/i18n';
import { isMonitoringProvider } from '@/lib/api/monitoring';
import {
  certLevel,
  createMonitorBody,
  defaultHistoryRange,
  emptyMonitorForm,
  errorDetail,
  errorPath,
  filterMonitors,
  formatResponse,
  formatUptime,
  freeMonitorSlots,
  instanceCount,
  intervalChoices,
  intervalLabel,
  monitorErrorText,
  monitorFormFrom,
  monitorFormIssues,
  monitorPatch,
  parseStatusCodes,
  sortMonitors,
  stripTone,
  targetHref,
  targetIssueText,
  type MonitorFormState,
} from './bits';
import { monitorActions } from './dialogs';

/** Returns the key and the parameters, so the tests see which text was chosen. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${Object.values(params).join(',')})` : key) as TFunction;

const form = (patch: Partial<MonitorFormState> = {}): MonitorFormState => ({
  ...emptyMonitorForm(60),
  name: 'Website',
  url: 'https://www.muster-ag.ch',
  ...patch,
});

const point = (p: Partial<MonitorHistoryPoint>): MonitorHistoryPoint => ({
  t: 0,
  ping: null,
  up: 0,
  down: 0,
  maintenance: 0,
  ...p,
});

describe('formatUptime', () => {
  it('floors to two decimals and never rounds up to 100 %', () => {
    expect(formatUptime(1, 'de')).toBe('100 %');
    expect(formatUptime(0.99996, 'de')).toBe('99.99 %');
    expect(formatUptime(0.999999999, 'en')).toBe('99.99 %');
    expect(formatUptime(0.95125, 'de')).toBe('95.12 %');
    expect(formatUptime(0.9993, 'de')).toBe('99.93 %');
    expect(formatUptime(0, 'de')).toBe('0.00 %');
  });

  it('is not thrown off by floating point (0.57 * 10000 is 5699.999...)', () => {
    expect(formatUptime(0.57, 'de')).toBe('57.00 %');
  });

  it('shows a dash without a figure and clamps out of range ratios', () => {
    expect(formatUptime(null, 'de')).toBe('–');
    expect(formatUptime(undefined, 'de')).toBe('–');
    expect(formatUptime(Number.NaN, 'de')).toBe('–');
    expect(formatUptime(1.2, 'de')).toBe('100 %');
    expect(formatUptime(-0.1, 'de')).toBe('0.00 %');
  });
});

describe('formatResponse', () => {
  it('shows ms below a second and seconds above', () => {
    expect(formatResponse(182, 'de')).toBe('182 ms');
    expect(formatResponse(12.6, 'de')).toBe('13 ms');
    expect(formatResponse(1250, 'de')).toBe('1.25 s');
    expect(formatResponse(15_400, 'en')).toBe('15.4 s');
  });

  it('shows a dash for missing and negative values (Kuma reports -1 without a ping)', () => {
    expect(formatResponse(null, 'de')).toBe('–');
    expect(formatResponse(-1, 'de')).toBe('–');
  });
});

describe('certLevel', () => {
  it('is red when invalid or below 7 days, amber below 21 days', () => {
    expect(certLevel(54, true)).toBe('ok');
    expect(certLevel(21, true)).toBe('ok');
    expect(certLevel(20, true)).toBe('warning');
    expect(certLevel(7, true)).toBe('warning');
    expect(certLevel(6, true)).toBe('danger');
    expect(certLevel(-3, true)).toBe('danger');
    expect(certLevel(54, false)).toBe('danger');
    expect(certLevel(null, false)).toBe('danger');
  });

  it('is null for checks without certificate facts', () => {
    expect(certLevel(null, null)).toBeNull();
    expect(certLevel(undefined, undefined)).toBeNull();
  });
});

describe('intervals', () => {
  it('labels seconds, minutes and hours', () => {
    expect(intervalLabel(t, 20)).toBe('uptime.interval.seconds(20)');
    expect(intervalLabel(t, 60)).toBe('uptime.interval.minute(1)');
    expect(intervalLabel(t, 300)).toBe('uptime.interval.minutes(5)');
    expect(intervalLabel(t, 3600)).toBe('uptime.interval.hour(1)');
    expect(intervalLabel(t, 21_600)).toBe('uptime.interval.hours(6)');
    expect(intervalLabel(t, 90)).toBe('uptime.interval.seconds(90)');
    expect(intervalLabel(t, null)).toBe('–');
  });

  it('offers the choices from the allowance minimum on, and keeps a current value', () => {
    expect(intervalChoices(60)).toEqual([60, 120, 300, 600, 900, 1800, 3600]);
    expect(intervalChoices(10)[0]).toBe(20);
    expect(intervalChoices(60, 45)).toEqual([45, 60, 120, 300, 600, 900, 1800, 3600]);
    expect(intervalChoices(60, 120)).toEqual([60, 120, 300, 600, 900, 1800, 3600]);
  });

  it('starts a new form at one minute, or at the allowance minimum when that is longer', () => {
    expect(emptyMonitorForm(60).intervalSeconds).toBe(60);
    expect(emptyMonitorForm(20).intervalSeconds).toBe(60);
    expect(emptyMonitorForm(120).intervalSeconds).toBe(120);
    expect(emptyMonitorForm(100).intervalSeconds).toBe(120);
  });
});

describe('parseStatusCodes', () => {
  it('reads codes and ranges separated by commas', () => {
    expect(parseStatusCodes('200-299')).toEqual(['200-299']);
    expect(parseStatusCodes(' 200-299, 301 ,301')).toEqual(['200-299', '301']);
  });

  it('refuses anything else', () => {
    expect(parseStatusCodes('')).toBeNull();
    expect(parseStatusCodes('2xx')).toBeNull();
    expect(parseStatusCodes('600')).toBeNull();
    expect(parseStatusCodes(Array.from({ length: 11 }, (_, i) => String(200 + i)).join(','))).toBeNull();
  });
});

describe('lists', () => {
  const list = [
    { name: 'beta', status: 'up', target: 'https://beta.ch' },
    { name: 'Alpha', status: 'paused', target: 'alpha.ch' },
    { name: 'zeta', status: 'down', target: null },
    { name: 'gamma', status: 'down', target: 'mail.gamma.ch:25' },
  ] as Pick<MonitorDto, 'name' | 'status' | 'target'>[];

  it('sorts down first, then by name', () => {
    expect(sortMonitors(list).map((m) => m.name)).toEqual(['gamma', 'zeta', 'Alpha', 'beta']);
  });

  it('filters by status and searches name and target', () => {
    expect(filterMonitors(list, '', 'down').map((m) => m.name)).toEqual(['zeta', 'gamma']);
    expect(filterMonitors(list, 'MAIL', 'all').map((m) => m.name)).toEqual(['gamma']);
    expect(filterMonitors(list, 'alp', 'up')).toEqual([]);
  });

  it('counts instances and free slots', () => {
    expect(
      instanceCount([{ provider: { id: 'a' } }, { provider: { id: 'a' } }, { provider: { id: 'b' } }] as Pick<
        MonitorDto,
        'provider'
      >[]),
    ).toBe(2);
    expect(freeMonitorSlots({ maxMonitors: 10, committed: 4 })).toBe(6);
    expect(freeMonitorSlots({ maxMonitors: 10, committed: 12 })).toBe(0);
  });

  it('links only http(s) targets', () => {
    expect(targetHref('https://www.muster-ag.ch')).toBe('https://www.muster-ag.ch');
    expect(targetHref('javascript:alert(1)')).toBeNull();
    expect(targetHref('mail.muster-ag.ch:25')).toBeNull();
  });
});

describe('history', () => {
  it('colours a strip cell red with any failure, green with a good check, blue for maintenance only', () => {
    expect(stripTone(point({ up: 4, down: 1 }))).toBe('down');
    expect(stripTone(point({ up: 4, maintenance: 1 }))).toBe('up');
    expect(stripTone(point({ maintenance: 2 }))).toBe('maintenance');
    expect(stripTone(point({}))).toBe('none');
  });

  it('starts at 24 h, else at the last checks', () => {
    expect(defaultHistoryRange(['recent', '24h', '7d', '30d'])).toBe('24h');
    expect(defaultHistoryRange(['recent'])).toBe('recent');
    expect(defaultHistoryRange([])).toBeNull();
  });
});

describe('monitor form', () => {
  it('checks the name and the target of the kind', () => {
    expect(monitorFormIssues(t, form())).toEqual({});
    expect(monitorFormIssues(t, form({ name: '  ' })).name).toBe('uptime.form.nameRequired');
    expect(monitorFormIssues(t, form({ name: 'a\u0007b' })).name).toBe('uptime.form.nameInvalid');
    expect(monitorFormIssues(t, form({ url: 'ftp://x.ch' })).url).toBe('uptime.form.urlInvalid');
    expect(monitorFormIssues(t, form({ url: 'https://user:pw@x.ch' })).url).toBe(
      'uptime.form.urlCredentials',
    );
    expect(monitorFormIssues(t, form({ kind: 'keyword' })).keyword).toBe('uptime.form.keywordRequired');
    expect(monitorFormIssues(t, form({ kind: 'ping', hostname: 'https://x.ch' })).hostname).toBe(
      'uptime.form.hostnameInvalid',
    );
    expect(monitorFormIssues(t, form({ kind: 'port', hostname: 'mail.x.ch', port: '0' })).port).toBe(
      'uptime.form.portInvalid',
    );
    expect(monitorFormIssues(t, form({ kind: 'port', hostname: '2001:db8::1', port: '443' }))).toEqual({});
    expect(monitorFormIssues(t, form({ statusCodes: '2xx' })).acceptedStatusCodes).toBe(
      'uptime.form.statusCodesInvalid',
    );
  });

  it('skips the target while the configuration cannot be read', () => {
    expect(monitorFormIssues(t, form({ url: '' }), false)).toEqual({});
  });

  it('sends only the fields of the kind on create', () => {
    expect(createMonitorBody(form({ statusCodes: '200-299, 301', ignoreTls: true }))).toEqual({
      kind: 'http',
      name: 'Website',
      url: 'https://www.muster-ag.ch',
      method: 'GET',
      acceptedStatusCodes: ['200-299', '301'],
      ignoreTls: true,
      intervalSeconds: 60,
    });
    expect(
      createMonitorBody(form({ kind: 'keyword', keyword: 'Warenkorb', invertKeyword: true, method: 'HEAD' })),
    ).toEqual({
      kind: 'keyword',
      name: 'Website',
      url: 'https://www.muster-ag.ch',
      keyword: 'Warenkorb',
      invertKeyword: true,
      method: 'HEAD',
      acceptedStatusCodes: ['200-299'],
      ignoreTls: false,
      intervalSeconds: 60,
    });
    expect(createMonitorBody(form({ kind: 'ping', hostname: ' Mail.X.ch ', intervalSeconds: 300 }))).toEqual({
      kind: 'ping',
      name: 'Website',
      hostname: 'Mail.X.ch',
      intervalSeconds: 300,
    });
    expect(createMonitorBody(form({ kind: 'port', hostname: 'mail.x.ch', port: '25' }))).toEqual({
      kind: 'port',
      name: 'Website',
      hostname: 'mail.x.ch',
      port: 25,
      intervalSeconds: 60,
    });
  });

  const config: MonitorConfig = {
    url: 'https://muster-shop.ch/?token=***',
    hostname: null,
    port: null,
    keyword: 'Warenkorb',
    invertKeyword: false,
    method: 'GET',
    acceptedStatusCodes: ['200-299'],
    intervalSeconds: 120,
    retryIntervalSeconds: 120,
    maxRetries: 1,
    timeoutSeconds: 48,
    ignoreTls: false,
    upsideDown: false,
  };

  it('fills the form from the configuration Uptime Kuma reports', () => {
    const initial = monitorFormFrom({ kind: 'keyword', name: 'Shop', intervalSeconds: 60 }, config);
    expect(initial).toMatchObject({
      kind: 'keyword',
      name: 'Shop',
      url: 'https://muster-shop.ch/?token=***',
      keyword: 'Warenkorb',
      intervalSeconds: 120,
      statusCodes: '200-299',
    });
    // Without the configuration, the stored interval.
    expect(monitorFormFrom({ kind: 'ping', name: 'Ping', intervalSeconds: 300 }, null).intervalSeconds).toBe(
      300,
    );
  });

  it('patches only what changed and never sends back a masked address', () => {
    const initial = monitorFormFrom({ kind: 'keyword', name: 'Shop', intervalSeconds: 120 }, config);
    expect(monitorPatch(initial, { ...initial })).toEqual({});
    expect(monitorPatch(initial, { ...initial, name: ' Shop 2 ', intervalSeconds: 300 })).toEqual({
      name: 'Shop 2',
      intervalSeconds: 300,
    });
    expect(monitorPatch(initial, { ...initial, keyword: 'Kasse', invertKeyword: true })).toEqual({
      keyword: 'Kasse',
      invertKeyword: true,
    });
    expect(monitorPatch(initial, { ...initial, statusCodes: '200-299,301', method: 'HEAD' })).toEqual({
      method: 'HEAD',
      acceptedStatusCodes: ['200-299', '301'],
    });
    expect(monitorPatch(initial, { ...initial, url: 'https://muster-shop.ch/' })).toEqual({
      url: 'https://muster-shop.ch/',
    });
    // While the configuration cannot be read, only name and interval go out.
    expect(monitorPatch(initial, { ...initial, url: 'https://x.ch', name: 'X' }, false)).toEqual({
      name: 'X',
    });
  });
});

describe('errors', () => {
  const validation = new ApiError(400, 'bad_request', 'Validation failed', [
    { path: 'url', message: 'This host name does not resolve' },
  ]);

  it('reads the field and the message of a validation error', () => {
    expect(errorPath(validation)).toBe('url');
    expect(errorDetail(validation)).toBe('This host name does not resolve');
    expect(errorPath(new ApiError(409, 'monitor_limit', 'full'))).toBeNull();
    expect(errorPath(new Error('x'))).toBeNull();
  });

  it('translates the refusals of the monitoring API and keeps the figures of a full allowance', () => {
    expect(
      monitorErrorText(t, new ApiError(409, 'monitor_limit', 'The allowance covers at most 10 monitors')),
    ).toBe('uptime.error.monitor_limit The allowance covers at most 10 monitors');
    expect(monitorErrorText(t, new ApiError(409, 'no_allowance', 'x'))).toBe('uptime.error.no_allowance');
    expect(monitorErrorText(t, new ApiError(409, 'read_only_monitor', 'x'))).toBe(
      'uptime.error.read_only_monitor',
    );
    expect(monitorErrorText(t, new ApiError(502, 'provider_error', 'Uptime Kuma: HTTP 500'))).toBe(
      'Uptime Kuma: HTTP 500',
    );
  });

  it('translates the shared target checks', () => {
    expect(targetIssueText(t, { path: 'url', message: 'An http:// or https:// address is required' })).toBe(
      'uptime.form.urlInvalid',
    );
    expect(targetIssueText(t, { path: 'url', message: 'At most 2000 characters' })).toBe(
      'uptime.form.urlTooLong',
    );
    expect(targetIssueText(t, { path: 'keyword', message: 'At most 200 characters' })).toBe(
      'uptime.form.keywordTooLong',
    );
    expect(targetIssueText(t, { path: 'port', message: 'x' })).toBe('uptime.form.portInvalid');
  });
});

describe('actions and providers', () => {
  it('offers the actions the API allows', () => {
    expect(monitorActions({ permissions: ['monitor:read'], active: true, status: 'up' })).toEqual({
      edit: false,
      pause: false,
      resume: false,
      delete: false,
    });
    expect(
      monitorActions({ permissions: ['monitor:read', 'monitor:write'], active: true, status: 'up' }),
    ).toEqual({ edit: true, pause: true, resume: false, delete: false });
    expect(
      monitorActions({
        permissions: ['monitor:read', 'monitor:write', 'monitor:delete'],
        active: false,
        status: 'paused',
      }),
    ).toEqual({ edit: true, pause: false, resume: true, delete: true });
  });

  it('knows which connections have monitors', () => {
    expect(isMonitoringProvider({ type: 'uptimekuma' })).toBe(true);
    expect(isMonitoringProvider({ type: 'demo', summary: {} })).toBe(true);
    expect(isMonitoringProvider({ type: 'demo', summary: { flavor: 'cloudflare' } })).toBe(false);
    expect(isMonitoringProvider({ type: 'nextcloud' })).toBe(false);
  });
});
