import type { Capability, PowerAction } from '@weblion/shared';
import { ProviderError } from '../../lib/errors';
import type { NextcloudConfig, ProviderAdapter, RemoteServer, ServerRef } from '../types';

/** Nextcloud (cloud storage). Placeholder until the adapter is implemented: no servers. */
export class NextcloudAdapter implements ProviderAdapter {
  readonly type = 'nextcloud' as const;

  constructor(private readonly config: NextcloudConfig) {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    throw new ProviderError('Nextcloud', `not implemented yet (${this.config.baseUrl})`);
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError('Nextcloud', `Nextcloud has no servers (${ref.externalId})`, 404);
  }
}
