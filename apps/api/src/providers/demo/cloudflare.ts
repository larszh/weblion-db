import type { Capability, DomainKind, PowerAction } from '@weblion/shared';
import { notFound, unsupported } from '../../lib/errors';
import type { ProviderAdapter, RemoteServer, ServerRef } from '../types';

/**
 * Simulated Cloudflare account for the second, opt-in demo connection (DemoConfig.flavor
 * "cloudflare"). Placeholder until the simulation is implemented: no servers, no zones.
 */
export class DemoCloudflareAdapter implements ProviderAdapter {
  readonly type = 'demo' as const;

  constructor(private readonly connectionId: string) {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    throw unsupported(`not implemented yet (${this.connectionId})`);
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(_ref: ServerRef): Promise<RemoteServer> {
    throw notFound('Server');
  }

  domainKind(): DomainKind {
    return 'zone';
  }
}

/** Test helper: forget all simulated Cloudflare state. */
export function resetDemoCloudflare(): void {}
