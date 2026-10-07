import type {
  BackupInfo,
  Capability,
  MetricRange,
  MetricsResult,
  MonitoringInfo,
  PowerAction,
  TrafficInfo,
} from '@weblion/shared';
import { ProviderError, unsupported } from '../../lib/errors';
import { httpRequest, isRecord, mapLimit, str, type HttpResponse } from '../http';
import type {
  ActionResult,
  Fire24Config,
  InfraOverview,
  ProviderAdapter,
  RawResponse,
  RemoteServer,
  ServerRef,
} from '../types';
import {
  FIRE24_ENDPOINTS,
  FIRE24_POWER_FIELD,
  FIRE24_POWER_MODES,
  type Fire24EndpointName,
} from './endpoints';
import {
  isKvmService,
  parseBackups,
  parseConfig,
  parseIncidences,
  parseServices,
  parseStatus,
  parseTimings,
  parseTrafficCurrent,
  parseTrafficLog,
} from './parse';

const PROVIDER = '24fire';

const RANGE_SECONDS: Record<MetricRange, number> = {
  hour: 3600,
  day: 86_400,
  week: 7 * 86_400,
  month: 31 * 86_400,
  year: 366 * 86_400,
};

interface Envelope {
  status?: string;
  message?: string;
  requestID?: string;
  data?: unknown;
}

export class Fire24Adapter implements ProviderAdapter {
  readonly type = 'fire24' as const;
  private readonly baseUrl: string;

  constructor(private readonly config: Fire24Config) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  capabilities(): Capability[] {
    return [
      'power',
      'metrics',
      'monitoring',
      'traffic',
      'backups',
      'backupRestore',
      'backupDelete',
      'networkInfo',
      'config',
    ];
  }

  powerActions(): PowerAction[] {
    return ['start', 'stop', 'reboot'];
  }

  private async send(method: string, path: string, form?: Record<string, unknown>): Promise<HttpResponse> {
    return httpRequest(PROVIDER, {
      method,
      url: `${this.baseUrl}${path}`,
      headers: { 'X-Fire-Apikey': this.config.apiKey },
      form,
    });
  }

  private async call<T = unknown>(
    name: Fire24EndpointName,
    id?: string,
    form?: Record<string, unknown>,
  ): Promise<T> {
    const endpoint = FIRE24_ENDPOINTS[name];
    const path = endpoint.path.replace('{id}', encodeURIComponent(id ?? ''));
    const res = await this.send(endpoint.method, path, form);
    const body = (isRecord(res.body) ? res.body : {}) as Envelope;

    if (res.status >= 400 || body.status === 'error') {
      let message =
        str(body.message) ?? (typeof res.body === 'string' ? res.body.slice(0, 200) : `HTTP ${res.status}`);
      if (res.status === 401) message = 'API key rejected (401). Check FIRE24_API_KEY.';
      if (res.status === 403 && 'plus' in endpoint && endpoint.plus) {
        message = `${message} (this endpoint needs an active 24fire+ subscription)`;
      }
      if ((res.status === 404 || res.status === 405) && !endpoint.verified) {
        message = `${message}. ${endpoint.method} ${endpoint.path} is not verified against the 24fire docs yet, see providers/fire24/endpoints.ts`;
      }
      throw new ProviderError(PROVIDER, message, res.status, { requestId: body.requestID });
    }
    return body.data as T;
  }

  async testConnection(): Promise<Record<string, unknown>> {
    const services = parseServices(await this.call('accountServices'));
    return {
      services: services.length,
      kvm: services.filter((s) => isKvmService(s) !== 'no').length,
    };
  }

  async listServers(): Promise<RemoteServer[]> {
    const services = parseServices(await this.call('accountServices')).filter(
      (s) => isKvmService(s) !== 'no',
    );
    const results = await mapLimit(services, 4, async (service) => {
      try {
        return await this.loadServer(service.internalId, service.name, service.raw);
      } catch (err) {
        // A "maybe" service that is not a KVM answers with an error, skip it quietly.
        if (isKvmService(service) === 'maybe') return null;
        throw err;
      }
    });
    return results.filter((s): s is RemoteServer => s !== null);
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    return this.loadServer(ref.externalId, null, null);
  }

  private async loadServer(
    internalId: string,
    fallbackName: string | null,
    serviceRaw: Record<string, unknown> | null,
  ): Promise<RemoteServer> {
    const [configData, statusData] = await Promise.all([
      this.call('kvmConfig', internalId),
      this.call('kvmStatus', internalId).catch(() => null),
    ]);
    const config = parseConfig(configData);
    const status = statusData ? parseStatus(statusData) : null;
    const datacenter = isRecord(config.hostsystem?.datacenter) ? config.hostsystem.datacenter : null;

    return {
      externalId: internalId,
      name: config.hostname ?? fallbackName ?? internalId,
      kind: 'vm',
      status: status?.status ?? 'unknown',
      specs: config.specs,
      usage: status ? { ...status.usage, memoryTotalMb: config.specs.memoryMb } : null,
      ips: config.ips,
      os: config.os,
      node: str(config.hostsystem?.node) ?? str(config.hostsystem?.name),
      meta: {
        hostsystem: config.hostsystem,
        datacenter: datacenter
          ? { name: str(datacenter.name), city: str(datacenter.city), country: str(datacenter.country) }
          : null,
        iso: config.iso,
        task: status?.task ?? null,
        service: serviceRaw,
      },
    };
  }

  async power(ref: ServerRef, action: PowerAction): Promise<ActionResult> {
    const mode = FIRE24_POWER_MODES[action as keyof typeof FIRE24_POWER_MODES];
    if (!mode) throw unsupported(`24fire does not support the power action "${action}"`);
    await this.call('kvmPower', ref.externalId, { [FIRE24_POWER_FIELD]: mode });
    return { message: `Power command "${mode}" sent` };
  }

  async getMetrics(ref: ServerRef, range: MetricRange): Promise<MetricsResult> {
    const points = parseTimings(await this.call('kvmMonitoringTimings', ref.externalId));
    const since = Math.floor(Date.now() / 1000) - RANGE_SECONDS[range];
    return {
      range,
      resolutionSeconds: 600,
      series: [
        { key: 'cpu', unit: 'percent' },
        { key: 'memUsed', unit: 'bytes' },
        { key: 'ping', unit: 'ms' },
      ],
      points: points.filter((p) => p.t >= since),
    };
  }

  async getMonitoring(ref: ServerRef): Promise<MonitoringInfo> {
    return parseIncidences(await this.call('kvmMonitoringIncidences', ref.externalId));
  }

  async getTraffic(ref: ServerRef): Promise<TrafficInfo> {
    const [current, log] = await Promise.all([
      this.call('kvmTrafficCurrent', ref.externalId),
      this.call('kvmTrafficLog', ref.externalId).catch(() => null),
    ]);
    return { ...parseTrafficCurrent(current), log: log ? parseTrafficLog(log) : [] };
  }

  async listBackups(ref: ServerRef): Promise<BackupInfo[]> {
    return parseBackups(await this.call('kvmBackupList', ref.externalId));
  }

  async createBackup(ref: ServerRef, options: { description?: string }): Promise<ActionResult> {
    const data = await this.call('kvmBackupCreate', ref.externalId, {
      description: options.description ?? 'Erstellt über weblion.one Console',
    });
    return { providerRef: isRecord(data) ? str(data.backup_id) : null, message: 'Backup started' };
  }

  async restoreBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    await this.call('kvmBackupRestore', ref.externalId, { backup_id: backupId });
    return { providerRef: backupId, message: 'Restore started' };
  }

  async deleteBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    await this.call('kvmBackupDelete', ref.externalId, { backup_id: backupId });
    return { message: 'Backup deleted' };
  }

  async getConfig(ref: ServerRef): Promise<Record<string, unknown>> {
    const data = await this.call('kvmConfig', ref.externalId);
    return redactPasswords(isRecord(data) ? data : { data });
  }

  async overview(): Promise<InfraOverview> {
    const services = parseServices(await this.call('accountServices'));
    const byType = new Map<string, number>();
    for (const s of services) byType.set(s.type, (byType.get(s.type) ?? 0) + 1);
    return {
      nodes: [],
      storages: [],
      facts: [
        { label: 'Services', value: String(services.length) },
        ...[...byType.entries()].map(([type, count]) => ({ label: type, value: String(count) })),
      ],
    };
  }

  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (!normalized.startsWith('/api/')) throw unsupported('24fire paths must start with /api/');
    const res = await this.send(method.toUpperCase(), normalized, body);
    return { status: res.status, data: redactPasswords(res.body) };
  }
}

/** The KVM config contains the initial root password. It never leaves the API. */
export function redactPasswords<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactPasswords) as T;
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = /password|passwd|secret/i.test(key) ? '••••••' : redactPasswords(v);
  }
  return out as T;
}
