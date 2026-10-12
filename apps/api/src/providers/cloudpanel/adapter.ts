import type { Capability, PowerAction } from '@weblion/shared';
import { ProviderError } from '../../lib/errors';
import type { CloudPanelConfig, ProviderAdapter, RemoteServer, ServerRef } from '../types';

/**
 * A CloudPanel server (websites), reached over SSH through the root wrapper weblion-clp.
 * Placeholder until the adapter is implemented: no servers, no websites.
 */
export class CloudPanelAdapter implements ProviderAdapter {
  readonly type = 'cloudpanel' as const;

  constructor(
    private readonly config: CloudPanelConfig,
    _options: { transport?: unknown; now?: () => number } = {},
  ) {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    throw new ProviderError('CloudPanel', `not implemented yet (${this.config.host})`);
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError('CloudPanel', `CloudPanel has no servers (${ref.externalId})`, 404);
  }
}
