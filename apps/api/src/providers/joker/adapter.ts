import type { Capability, PowerAction } from '@weblion/shared';
import { ProviderError } from '../../lib/errors';
import type { JokerConfig, ProviderAdapter, RemoteServer, ServerRef } from '../types';

/**
 * Joker.com (DMAPI). Placeholder until the adapter is implemented: domains only, no
 * servers.
 */
export class JokerAdapter implements ProviderAdapter {
  readonly type = 'joker' as const;

  constructor(private readonly config: JokerConfig) {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    throw new ProviderError('Joker', `not implemented yet (${this.config.baseUrl})`);
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError('Joker', `Joker.com has no servers (${ref.externalId})`, 404);
  }
}
