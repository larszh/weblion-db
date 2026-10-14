import type { Capability, PowerAction } from '@weblion/shared';
import { ProviderError, unsupported } from '../../lib/errors';
import type { ProviderAdapter, RemoteServer, ServerRef, ThreeCxConfig } from '../types';

/** External id of the one phone system a 3CX connection reports. */
export const THREECX_SYSTEM_ID = 'pbx';

/**
 * A 3CX V20 phone system (PBX), reached through its Configuration API (XAPI) with an OAuth2
 * client of its own. Placeholder until the adapter is implemented: no servers, no phone systems.
 */
export class ThreeCxAdapter implements ProviderAdapter {
  readonly type = 'threecx' as const;

  constructor(private readonly config: ThreeCxConfig) {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    throw unsupported(`3CX is not implemented yet (${this.config.baseUrl})`);
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError('3CX', `3CX has no servers (${ref.externalId})`, 404);
  }
}
