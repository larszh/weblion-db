import type { Capability, PowerAction } from '@weblion/shared';
import { ProviderError } from '../../lib/errors';
import type { MailcowConfig, ProviderAdapter, RemoteServer, ServerRef } from '../types';

/** Mailcow (e-mail). Placeholder until the adapter is implemented: no servers. */
export class MailcowAdapter implements ProviderAdapter {
  readonly type = 'mailcow' as const;

  constructor(
    private readonly config: MailcowConfig,
    _options: { timeoutMs?: number; maxInFlight?: number } = {},
  ) {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    throw new ProviderError('Mailcow', `not implemented yet (${this.config.baseUrl})`);
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError('Mailcow', `Mailcow has no servers (${ref.externalId})`, 404);
  }
}
