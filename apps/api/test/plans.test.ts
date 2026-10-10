import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  type ProviderLocation,
  type ServerDto,
  type ServerPlan,
} from '@weblion/shared';
import { servers as serversTable } from '../src/db/schema';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

/**
 * Fixed server sizes (Hetzner server types) and locations, exercised with the demo provider:
 * plans per server, plan based rescale, the create dialog's helper routes and creating a
 * server from a plan in a location.
 */

let t: TestApp;
let admin: Client;
let anna: Client;
let musterOrgId: string;
let webshopProjectId: string;
let demoProviderId: string;
let servers: ServerDto[];

const server = (name: string) => servers.find((s) => s.name === name)!;

/** What GET /servers/:id/plans returns: plans plus the one the server has now. */
type PlanOption = ServerPlan & { current: boolean };

/** The create route works in the background, so wait until the sync stored the server. */
async function waitForServer(name: string): Promise<ServerDto> {
  for (let i = 0; i < 50; i++) {
    const found = json<ServerDto[]>(await admin.get(`/admin/servers?q=${name}`)).find((s) => s.name === name);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server ${name} did not appear`);
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
  musterOrgId = orgs.find((o) => o.slug === 'muster-ag')!.id;
  const muster = json<{ projects: { id: string; name: string }[] }>(
    await admin.get(`/admin/orgs/${musterOrgId}`),
  );
  webshopProjectId = muster.projects.find((p) => p.name === 'Webshop')!.id;
  servers = json(await admin.get(`/orgs/${musterOrgId}/servers`));
  const providers = json<{ id: string; type: string }[]>(await admin.get('/admin/providers'));
  demoProviderId = providers.find((p) => p.type === 'demo')!.id;
});

afterAll(async () => {
  await t?.close();
});

describe('plans of a server', () => {
  it('lists the plans of the same architecture with prices for staff', async () => {
    const res = await admin.get(`/servers/${server('web-01').id}/plans`);
    expect(res.statusCode).toBe(200);
    const plans = json<PlanOption[]>(res);
    expect(plans.map((p) => p.id)).toContain('d4');
    expect(plans.map((p) => p.id)).not.toContain('d4-arm');
    expect(plans.every((p) => p.architecture === 'x86')).toBe(true);
    expect(plans.find((p) => p.id === 'd4')!.priceMonthly).toEqual({ amount: 1690, currency: 'EUR' });
    // The generated servers never changed their type, so no plan is known to be the current one.
    expect(plans.some((p) => p.current)).toBe(false);
  });

  it('needs server:rescale, which customers lack by default', async () => {
    const id = server('web-01').id;
    expect((await anna.get(`/servers/${id}/plans`)).statusCode).toBe(403);
    const carla = new Client(t.app);
    await carla.login('carla@muster.example');
    expect((await carla.get(`/servers/${id}/plans`)).statusCode).toBe(403);
    expect((await anna.post(`/servers/${id}/rescale`, { plan: 'd8' })).statusCode).toBe(403);
    // Other organizations do not even learn that the server exists.
    const dev = new Client(t.app);
    await dev.login('dev@beispiel.example');
    expect((await dev.get(`/servers/${id}/plans`)).statusCode).toBe(404);
  });

  it('hides the purchase price from customers with a widened boundary', async () => {
    const widened = [
      { effect: 'allow', actions: ['*'] },
      { effect: 'deny', actions: ['server:delete', 'server:config:read', 'platform:*', 'reseller:*'] },
    ];
    expect((await admin.patch(`/admin/orgs/${musterOrgId}`, { boundary: widened })).statusCode).toBe(200);
    try {
      const fresh = new Client(t.app);
      await fresh.login('anna@muster.example');
      const res = await fresh.get(`/servers/${server('web-01').id}/plans`);
      expect(res.statusCode).toBe(200);
      const plans = json<ServerPlan[]>(res);
      expect(plans.length).toBeGreaterThan(0);
      expect(plans.every((p) => p.priceMonthly === null)).toBe(true);
    } finally {
      await admin.patch(`/admin/orgs/${musterOrgId}`, { boundary: DEFAULT_CUSTOMER_BOUNDARY });
    }
  });
});

describe('rescale with a plan', () => {
  it('changes cores and memory, and the disk only with upgradeDisk', async () => {
    const target = servers.find((s) => s.name !== 'web-01' && (s.specs.cores ?? 0) <= 4)!;
    const startDisk = target.specs.diskGb!;
    const start = `d${target.specs.cores}`;

    const up = await admin.post(`/servers/${target.id}/rescale`, { plan: 'd16' });
    expect(up.statusCode).toBe(200);
    let dto = json<ServerDto>(await admin.get(`/servers/${target.id}?refresh=true`));
    expect(dto.specs).toMatchObject({ cores: 16, memoryMb: 32 * 1024, diskGb: startDisk });
    // The sync stored the new type, the plans route marks it.
    const plans = json<PlanOption[]>(await admin.get(`/servers/${target.id}/plans`));
    expect(plans.filter((p) => p.current).map((p) => p.id)).toEqual(['d16']);

    // Without a disk upgrade the way back stays open.
    expect((await admin.post(`/servers/${target.id}/rescale`, { plan: start })).statusCode).toBe(200);
    dto = json<ServerDto>(await admin.get(`/servers/${target.id}?refresh=true`));
    expect(dto.specs).toMatchObject({ cores: target.specs.cores, diskGb: startDisk });

    expect(
      (await admin.post(`/servers/${target.id}/rescale`, { plan: 'd16', upgradeDisk: true })).statusCode,
    ).toBe(200);
    dto = json<ServerDto>(await admin.get(`/servers/${target.id}?refresh=true`));
    expect(dto.specs.diskGb).toBe(640);
    const down = await admin.post(`/servers/${target.id}/rescale`, { plan: start });
    expect(down.statusCode).toBe(409);
    expect(json(down).error.message).toMatch(/larger than the disk/);

    const tasks = json<{ actions: { type: string; status: string }[] }>(
      await admin.get(`/servers/${target.id}/tasks`),
    );
    expect(tasks.actions.filter((a) => a.type === 'rescale')).toHaveLength(4);
  });

  it('rejects unknown plans, other architectures and mixed requests', async () => {
    const id = server('web-01').id;
    expect((await admin.post(`/servers/${id}/rescale`, { plan: 'nope' })).statusCode).toBe(400);
    expect((await admin.post(`/servers/${id}/rescale`, { plan: 'd4-arm' })).statusCode).toBe(400);
    expect((await admin.post(`/servers/${id}/rescale`, { plan: 'd8', cores: 8 })).statusCode).toBe(400);
    expect((await admin.post(`/servers/${id}/rescale`, { upgradeDisk: true })).statusCode).toBe(400);
    expect((await admin.post(`/servers/${id}/rescale`, {})).statusCode).toBe(400);
  });

  it('keeps the number based rescale of the demo provider', async () => {
    const target = server('web-01');
    const cores = (target.specs.cores ?? 2) + 2;
    expect((await admin.post(`/servers/${target.id}/rescale`, { cores })).statusCode).toBe(200);
    const dto = json<ServerDto>(await admin.get(`/servers/${target.id}?refresh=true`));
    expect(dto.specs.cores).toBe(cores);
  });
});

describe('create dialog helpers', () => {
  it('lists plans with prices, locations and images for staff', async () => {
    const plans = json<ServerPlan[]>(await admin.get(`/admin/providers/${demoProviderId}/plans`));
    expect(plans.map((p) => p.id)).toEqual(expect.arrayContaining(['d1', 'd4', 'd4-arm']));
    expect(plans.find((p) => p.id === 'd1')!.deprecated).toBe(true);
    expect(plans.find((p) => p.id === 'd4-arm')!.locations).toEqual(['fsn1']);

    const locations = json<ProviderLocation[]>(
      await admin.get(`/admin/providers/${demoProviderId}/locations`),
    );
    expect(locations.map((l) => l.id)).toEqual(['zrh1', 'fsn1', 'hel1']);
    expect(locations.find((l) => l.id === 'hel1')).toMatchObject({ country: 'FI', city: 'Helsinki' });

    const images = json<{ id: string }[]>(await admin.get(`/admin/providers/${demoProviderId}/images`));
    expect(images.map((i) => i.id)).toContain('debian-12');
  });

  it('keeps them in the admin area', async () => {
    for (const sub of ['plans', 'locations', 'images']) {
      expect((await anna.get(`/admin/providers/${demoProviderId}/${sub}`)).statusCode).toBe(403);
    }
  });
});

describe('create a server from a plan', () => {
  it('takes the size from the plan and shows the location of the server', async () => {
    const res = await admin.post('/admin/servers', {
      providerId: demoProviderId,
      name: 'plan-hel-01',
      plan: 'd4',
      location: 'hel1',
      imageId: 'debian-12',
      projectId: webshopProjectId,
    });
    expect(res.statusCode).toBe(200);
    expect(json(res).status).toBe('started');
    const created = await waitForServer('plan-hel-01');
    expect(created.specs).toMatchObject({ cores: 4, memoryMb: 8192, diskGb: 160 });
    // Country and city come from the server, the label from the connection.
    expect(created.location).toMatchObject({ country: 'FI', city: 'Helsinki', label: 'Demo (simuliert)' });
    expect(created.project?.id).toBe(webshopProjectId);
  });

  it('validates plan and location before anything is created', async () => {
    const base = { providerId: demoProviderId, name: 'plan-invalid', imageId: 'debian-12' };
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ plan: 'nope' }, /Unknown plan/],
      [{ plan: 'd1' }, /no longer be ordered/],
      [{ plan: 'd4-arm', location: 'hel1' }, /not available in this location/],
      [{ plan: 'd4', location: 'mars1' }, /Unknown location/],
      [{}, /Either a plan or cores/],
    ];
    for (const [extra, message] of cases) {
      const res = await admin.post('/admin/servers', { ...base, ...extra });
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      expect(errorText(json(res)), JSON.stringify(extra)).toMatch(message);
    }
  });

  it('still creates servers from cores, memory and disk', async () => {
    const res = await admin.post('/admin/servers', {
      providerId: demoProviderId,
      name: 'plain-01',
      cores: 2,
      memoryMb: 2048,
      diskGb: 20,
      imageId: 'debian-12',
    });
    expect(res.statusCode).toBe(200);
    const created = await waitForServer('plain-01');
    expect(created.specs).toMatchObject({ cores: 2, memoryMb: 2048, diskGb: 20 });
    expect(created.location.country).toBe('CH');
  });
});

describe('providers without plans', () => {
  let proxmoxId: string;
  let proxmoxServerId: string;

  beforeAll(async () => {
    const res = await admin.post('/admin/providers', {
      type: 'proxmox',
      name: 'Proxmox offline',
      location: { country: 'CH', city: 'Zürich', label: 'Zürich' },
      enabled: false,
      // Nothing listens there: the routes below must answer before talking to Proxmox.
      config: { baseUrl: 'https://127.0.0.1:9', tokenId: 'weblion@pve!test', tokenSecret: 'secret-secret' },
    });
    expect(res.statusCode).toBe(200);
    proxmoxId = json(res).id;
    const [row] = await t.db
      .insert(serversTable)
      .values({
        providerConnectionId: proxmoxId,
        externalId: 'qemu/100',
        name: 'pve-100',
        providerName: 'pve-100',
        kind: 'vm',
        status: 'running',
        specs: { cores: 2, memoryMb: 2048, diskGb: 32 },
        ips: [],
        node: 'pve01',
        meta: {},
      })
      .returning();
    proxmoxServerId = row!.id;
  });

  it('answers 422 instead of guessing', async () => {
    expect((await admin.get(`/servers/${proxmoxServerId}/plans`)).statusCode).toBe(422);
    expect((await admin.post(`/servers/${proxmoxServerId}/rescale`, { plan: 'cx22' })).statusCode).toBe(422);
    expect((await admin.get(`/admin/providers/${proxmoxId}/plans`)).statusCode).toBe(422);
    expect((await admin.get(`/admin/providers/${proxmoxId}/locations`)).statusCode).toBe(422);
    const create = await admin.post('/admin/servers', {
      providerId: proxmoxId,
      name: 'pve-new',
      plan: 'cx22',
      imageId: 'local:vztmpl/x',
    });
    expect(create.statusCode).toBe(422);
  });
});

describe('location per server', () => {
  it('takes ISO country codes from the provider, but not country names', async () => {
    const target = server('mail');
    await t.db
      .update(serversTable)
      .set({ meta: { datacenter: { name: 'nbg1-dc3', city: 'Nürnberg', country: 'de' } } })
      .where(eq(serversTable.id, target.id));
    let dto = json<ServerDto>(await admin.get(`/servers/${target.id}`));
    expect(dto.location).toMatchObject({ country: 'DE', city: 'Nürnberg' });

    // 24fire stores the country name, the connection's country stays.
    await t.db
      .update(serversTable)
      .set({ meta: { datacenter: { city: 'Nürnberg', country: 'Deutschland' } } })
      .where(eq(serversTable.id, target.id));
    dto = json<ServerDto>(await admin.get(`/servers/${target.id}`));
    expect(dto.location).toMatchObject({ country: 'CH', city: 'Nürnberg' });
  });
});

function errorText(body: { error: { message: string; details?: { message?: string }[] } }): string {
  return [body.error.message, ...(body.error.details ?? []).map((d) => d.message ?? '')].join(' ');
}

describe('mounted ISO', () => {
  it('follows the live configuration, not a stale sync', async () => {
    const id = server('web-02').id;
    const listed = json<{ isos: { id: string }[]; mounted: string | null }>(
      await admin.get(`/servers/${id}/isos`),
    );
    expect(listed.mounted).toBeNull();
    const iso = listed.isos[0]!.id;
    expect((await admin.post(`/servers/${id}/iso`, { isoId: iso })).statusCode).toBe(200);
    // The sync stores the mounted ISO in meta.iso.
    await admin.get(`/servers/${id}?refresh=true`);
    expect(json(await admin.get(`/servers/${id}/isos`)).mounted).toBe(iso);
    expect((await admin.del(`/servers/${id}/iso`)).statusCode).toBe(200);
    expect(json(await admin.get(`/servers/${id}/isos`)).mounted).toBeNull();
  });
});
