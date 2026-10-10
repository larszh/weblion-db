import { eq } from 'drizzle-orm';
import type { ProviderType } from '@weblion/shared';
import type { Database } from '../db/client';
import { providerConnections, type ProviderConnection, type Server } from '../db/schema';
import type { SecretBox } from '../lib/crypto';
import { notFound } from '../lib/errors';
import { CloudflareAdapter } from './cloudflare/adapter';
import { DemoAdapter } from './demo/adapter';
import { DemoCloudflareAdapter } from './demo/cloudflare';
import { Fire24Adapter } from './fire24/adapter';
import { HetznerAdapter } from './hetzner/adapter';
import { JokerAdapter } from './joker/adapter';
import { MailcowAdapter } from './mailcow/adapter';
import { NextcloudAdapter } from './nextcloud/adapter';
import { ProxmoxAdapter } from './proxmox/adapter';
import type {
  CloudflareConfig,
  DemoConfig,
  Fire24Config,
  HetznerConfig,
  JokerConfig,
  MailcowConfig,
  NextcloudConfig,
  ProviderAdapter,
  ProviderConfig,
  ProxmoxConfig,
  ServerRef,
} from './types';

export function createAdapter(
  type: ProviderType,
  connectionId: string,
  config: ProviderConfig,
): ProviderAdapter {
  switch (type) {
    case 'fire24':
      return new Fire24Adapter(config as Fire24Config);
    case 'proxmox':
      return new ProxmoxAdapter(config as ProxmoxConfig);
    case 'hetzner':
      return new HetznerAdapter(config as HetznerConfig);
    case 'joker':
      return new JokerAdapter(config as JokerConfig);
    case 'nextcloud':
      return new NextcloudAdapter(config as NextcloudConfig);
    case 'cloudflare':
      return new CloudflareAdapter(config as CloudflareConfig);
    case 'mailcow':
      return new MailcowAdapter(config as MailcowConfig);
    case 'demo':
      // A second demo connection can simulate a Cloudflare account (ENABLE_DEMO_CLOUDFLARE).
      return (config as DemoConfig).flavor === 'cloudflare'
        ? new DemoCloudflareAdapter(connectionId)
        : new DemoAdapter(connectionId, config as DemoConfig);
  }
}

export function serverRef(server: Pick<Server, 'externalId' | 'kind' | 'node' | 'meta'>): ServerRef {
  return { externalId: server.externalId, kind: server.kind, node: server.node, meta: server.meta };
}

/** Builds and caches one adapter per provider connection. Credentials are decrypted on demand. */
export class ProviderRegistry {
  private readonly cache = new Map<string, { version: string; adapter: ProviderAdapter }>();

  constructor(
    private readonly db: Database,
    private readonly box: SecretBox,
  ) {}

  forConnection(connection: ProviderConnection): ProviderAdapter {
    // Rebuilt when the credentials change. Not on updatedAt: every sync touches the row, and
    // adapters keep caches worth more than one sync interval (Hetzner: server types, action polling).
    const version = connection.configEnc;
    const cached = this.cache.get(connection.id);
    if (cached && cached.version === version) return cached.adapter;
    const config = this.box.decryptJson<ProviderConfig>(connection.configEnc);
    const adapter = createAdapter(connection.type, connection.id, config);
    this.cache.set(connection.id, { version, adapter });
    return adapter;
  }

  async get(connectionId: string): Promise<{ connection: ProviderConnection; adapter: ProviderAdapter }> {
    const connection = await this.db.query.providerConnections.findFirst({
      where: eq(providerConnections.id, connectionId),
    });
    if (!connection) throw notFound('Provider');
    return { connection, adapter: this.forConnection(connection) };
  }

  decryptConfig<T extends ProviderConfig>(connection: ProviderConnection): T {
    return this.box.decryptJson<T>(connection.configEnc);
  }

  invalidate(connectionId: string) {
    this.cache.delete(connectionId);
  }
}
