import type { Capability, PowerAction } from '@weblion/shared';
import { ProviderError, unsupported } from '../../lib/errors';
import type { JellyfinConfig, ProviderAdapter, RemoteServer, ServerRef } from '../types';
import { JELLYFIN } from './rules';

/**
 * A Jellyfin media server, reached with an API key from its dashboard (full administrator rights).
 * Placeholder until the adapter is implemented: no servers, no streaming users.
 */
export class JellyfinAdapter implements ProviderAdapter {
  readonly type = 'jellyfin' as const;

  constructor(private readonly config: JellyfinConfig) {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    throw unsupported(`Jellyfin is not implemented yet (${this.config.baseUrl})`);
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError(JELLYFIN, `Jellyfin has no servers (${ref.externalId})`, 404);
  }
}
