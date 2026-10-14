import type {
  MonitorFacts,
  MonitorHistoryDto,
  MonitorHistoryRange,
  MonitorKind,
  MonitorStatus,
} from '@weblion/shared';
import { unsupported } from '../../lib/errors';
import type {
  MonitorInput,
  MonitorInventory,
  MonitorLive,
  MonitorPatch,
  MonitoringStatus,
  RemoteMonitor,
} from '../types';

/**
 * Simulated Uptime Kuma instance for the demo provider: eight monitors (one paused, one group),
 * a status page for Muster AG and generated history, kept in memory per connection like the
 * other demo data. Management is always on. Placeholder until the simulation is implemented:
 * the names below are the contract the demo adapter and the tests use. No monitors yet, so the
 * sync of the demo connection keeps working.
 */

export const DEMO_KUMA_URL = 'https://status.demo.weblion.one';
export const DEMO_KUMA_VERSION = '2.5.6';

/** A simulated monitor (Kuma ids are numbers, kept as text). */
export interface DemoMonitor {
  externalId: string;
  name: string;
  type: MonitorKind | 'group';
  url: string | null;
  hostname: string | null;
  port: number | null;
  keyword: string | null;
  invertKeyword: boolean;
  method: 'GET' | 'HEAD';
  acceptedStatusCodes: string[];
  status: MonitorStatus;
  active: boolean;
  intervalSeconds: number;
  ignoreTls: boolean;
  parentId: string | null;
  facts: MonitorFacts;
}

export interface DemoMonitoringState {
  /** By Kuma id. */
  monitors: Map<string, DemoMonitor>;
  /** Next Kuma id for created monitors (from 100). */
  nextId: number;
  /** Status pages by slug. */
  statusPages: Map<string, { title: string; monitorIds: string[] }>;
  /** Write calls, for tests. */
  payloads: { event: string; externalId: string | null }[];
}

const notImplemented = () => unsupported('demo monitoring not implemented yet');

/** The state of one demo connection. */
export function demoMonitoringState(_connectionId: string): DemoMonitoringState {
  return { monitors: new Map(), nextId: 100, statusPages: new Map(), payloads: [] };
}

/** Test helper: forget all simulated monitoring state. */
export function resetDemoMonitoring(): void {}

/**
 * The monitoring methods of ProviderAdapter (same names and arguments, async like the contract);
 * DemoAdapter delegates to them. `serverIps` gives the addresses of a demo server by external id.
 */
export class DemoMonitoring {
  constructor(
    private readonly state: DemoMonitoringState,
    private readonly serverIps: (externalId: string) => string[],
  ) {}

  /** Every simulated monitor, paused ones too (management is always on). */
  async listMonitors(): Promise<MonitorInventory> {
    return { monitors: [], complete: true, managementError: null };
  }

  async getMonitor(_externalId: string): Promise<MonitorLive> {
    throw notImplemented();
  }

  async getMonitorHistory(
    _externalId: string,
    _range: MonitorHistoryRange,
    _options: { statusPageSlug: string | null },
  ): Promise<MonitorHistoryDto | null> {
    throw notImplemented();
  }

  monitorHistoryRanges(_options: { statusPageSlug: string | null }): MonitorHistoryRange[] {
    throw notImplemented();
  }

  monitorManagement(): boolean {
    return true;
  }

  async monitoringStatus(): Promise<MonitoringStatus> {
    throw notImplemented();
  }

  async createMonitor(_input: MonitorInput): Promise<RemoteMonitor> {
    throw notImplemented();
  }

  async updateMonitor(_externalId: string, _patch: MonitorPatch): Promise<void> {
    throw notImplemented();
  }

  async pauseMonitor(_externalId: string): Promise<void> {
    throw notImplemented();
  }

  async resumeMonitor(_externalId: string): Promise<void> {
    throw notImplemented();
  }

  async deleteMonitor(_externalId: string): Promise<void> {
    throw notImplemented();
  }

  async getStatusPage(_slug: string): Promise<{ slug: string; title: string; monitorIds: string[] }> {
    throw notImplemented();
  }

  statusPageUrl(slug: string): string {
    return `${DEMO_KUMA_URL}/status/${encodeURIComponent(slug)}`;
  }

  /** Test helper: a status as Kuma would report it after the next check. */
  setStatus(_externalId: string, _status: 'up' | 'down' | 'pending' | 'maintenance'): void {
    throw notImplemented();
  }

  /** Test helper: simulates a deletion in Uptime Kuma (the sync then marks the row missing). */
  removeMonitor(_externalId: string): void {
    throw notImplemented();
  }

  /** Test helper: the write calls so far, oldest first. */
  payloads(): { event: string; externalId: string | null }[] {
    return [...this.state.payloads];
  }
}
