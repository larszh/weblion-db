import type { Capability, DomainKind, PowerAction } from '@weblion/shared';
import { ProviderError, unsupported } from '../../lib/errors';
import type { CloudflareConfig, ProviderAdapter, RemoteServer, ServerRef } from '../types';
import { CLOUDFLARE_PROVIDER } from './constants';

/** Client settings (request budget, concurrency). Replaced by CloudflareClientOptions of client.ts. */
interface CloudflareAdapterOptions {
  timeoutMs?: number;
  maxInFlight?: number;
  budget?: { max: number; windowMs: number };
  rateLimitMaxWaitMs?: number;
}

/** Cloudflare (DNS zones and CDN). Placeholder until the adapter is implemented: no servers. */
export class CloudflareAdapter implements ProviderAdapter {
  readonly type = 'cloudflare' as const;

  constructor(
    private readonly config: CloudflareConfig,
    _options: CloudflareAdapterOptions = {},
  ) {}

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    throw unsupported(`not implemented yet (${this.config.baseUrl})`);
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError(CLOUDFLARE_PROVIDER, `Cloudflare has no servers (${ref.externalId})`, 404);
  }

  domainKind(): DomainKind {
    return 'zone';
  }
}
