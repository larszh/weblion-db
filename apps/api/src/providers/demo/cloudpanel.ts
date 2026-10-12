import type { Capability, PowerAction } from '@weblion/shared';
import { ProviderError } from '../../lib/errors';
import type { DemoConfig, ProviderAdapter, RemoteServer, ServerRef } from '../types';

/**
 * Simulated CloudPanel server for the opt-in demo connection (DemoConfig.flavor "cloudpanel",
 * ENABLE_DEMO_CLOUDPANEL). The config carries the customer options of a real connection
 * (phpVersions, templates, nodejs). Placeholder until the simulation is implemented: no websites.
 */
export class DemoCloudPanelAdapter implements ProviderAdapter {
  readonly type = 'demo' as const;

  constructor(_connectionId: string, _config: DemoConfig = {}) {}

  /** Forgets the simulated state of every connection (tests). */
  static reset(): void {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    return { flavor: 'cloudpanel' };
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError('Demo', `no servers (${ref.externalId})`, 404);
  }
}
