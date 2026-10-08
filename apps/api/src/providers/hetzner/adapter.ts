import type { Capability, PowerAction } from '@weblion/shared';
import { ProviderError } from '../../lib/errors';
import type { HetznerConfig, ProviderAdapter, RemoteServer, ServerRef } from '../types';

/** Hetzner Cloud. Placeholder until the adapter is implemented. */
export class HetznerAdapter implements ProviderAdapter {
  readonly type = 'hetzner' as const;

  constructor(private readonly config: HetznerConfig) {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    throw new ProviderError('Hetzner', `not implemented yet (${this.config.baseUrl})`);
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError('Hetzner', `server ${ref.externalId} not found`, 404);
  }
}
