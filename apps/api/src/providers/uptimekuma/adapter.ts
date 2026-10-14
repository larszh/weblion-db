import type { Capability, PowerAction } from '@weblion/shared';
import { ProviderError, unsupported } from '../../lib/errors';
import type { ProviderAdapter, RemoteServer, ServerRef, UptimeKumaConfig } from '../types';

/**
 * An Uptime Kuma 2.x instance: monitors read from /metrics with an API key, managed over the
 * Socket.IO protocol of its web UI once staff signed it in for management. Placeholder until the
 * adapter is implemented: no servers, no monitors.
 */
export class UptimeKumaAdapter implements ProviderAdapter {
  readonly type = 'uptimekuma' as const;

  constructor(private readonly config: UptimeKumaConfig) {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    throw unsupported(`Uptime Kuma is not implemented yet (${this.config.baseUrl})`);
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError('Uptime Kuma', `Uptime Kuma has no servers (${ref.externalId})`, 404);
  }
}
