import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Secret, TOTP } from 'otpauth';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

let t: TestApp;
let admin: Client;
let musterOrgId: string;
let servers: { id: string; name: string; project: { id: string; name: string } }[];

const serverId = (name: string) => servers.find((s) => s.name === name)!.id;

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
  musterOrgId = orgs.find((o) => o.slug === 'muster-ag')!.id;
  servers = json(await admin.get(`/orgs/${musterOrgId}/servers`));
});

afterAll(async () => {
  await t?.close();
});

describe('authentication', () => {
  it('rejects wrong passwords and anonymous requests', async () => {
    const c = new Client(t.app);
    expect((await c.post('/auth/login', { email: ADMIN.email, password: 'nope' })).statusCode).toBe(401);
    expect((await c.get('/auth/me')).statusCode).toBe(401);
    expect((await c.get(`/orgs/${musterOrgId}/servers`)).statusCode).toBe(401);
  });

  it('requires the X-Requested-With header for cookie authenticated writes', async () => {
    const c = new Client(t.app);
    await c.login('anna@muster.example');
    const res = await c.request(
      'POST',
      `/servers/${serverId('web-01')}/power`,
      { action: 'reboot' },
      {
        'x-requested-with': '',
      },
    );
    expect(res.statusCode).toBe(403);
  });

  it('runs the full two factor flow', async () => {
    const c = new Client(t.app);
    await c.login('carla@muster.example');
    const setup = json<{ secret: string; qr: string }>(await c.post('/auth/mfa/setup'));
    expect(setup.qr).toMatch(/^data:image\/png;base64,/);
    const totp = new TOTP({ secret: Secret.fromBase32(setup.secret) });
    expect((await c.post('/auth/mfa/enable', { code: '000000' })).statusCode).toBe(400);
    expect((await c.post('/auth/mfa/enable', { code: totp.generate() })).statusCode).toBe(200);
    await c.post('/auth/logout');

    const second = new Client(t.app);
    const first = json(
      await second.post('/auth/login', { email: 'carla@muster.example', password: 'demo-password-123' }),
    );
    expect(first).toEqual({ mfaRequired: true });
    // A half finished login must not reach the API.
    expect((await second.get(`/orgs/${musterOrgId}/servers`)).statusCode).toBe(401);
    expect((await second.post('/auth/login/mfa', { code: '123456' })).statusCode).toBe(401);
    const done = await second.post('/auth/login/mfa', { code: totp.generate() });
    expect(done.statusCode).toBe(200);
    expect(json(done).user.mfaEnabled).toBe(true);
    expect((await second.get(`/orgs/${musterOrgId}/servers`)).statusCode).toBe(200);
  });
});

describe('access control', () => {
  it('limits a restricted member to the resources of their policy', async () => {
    const ben = new Client(t.app);
    await ben.login('ben@muster.example');
    const visible = json<{ name: string }[]>(await ben.get(`/orgs/${musterOrgId}/servers`))
      .map((s) => s.name)
      .sort();
    expect(visible).toEqual(['db-primary', 'web-01', 'web-02']);
    expect((await ben.post(`/servers/${serverId('web-01')}/power`, { action: 'reboot' })).statusCode).toBe(
      200,
    );
    expect((await ben.post(`/servers/${serverId('mail')}/power`, { action: 'reboot' })).statusCode).toBe(404);
    expect(
      (await ben.post(`/servers/${serverId('web-01')}/backups/restore`, { backupId: 'x' })).statusCode,
    ).toBe(403);
    expect((await ben.get(`/orgs/${musterOrgId}/members`)).statusCode).toBe(403);
  });

  it('keeps destructive actions behind the customer boundary', async () => {
    const anna = new Client(t.app);
    await anna.login('anna@muster.example');
    const web = json<{ permissions: string[] }>(await anna.get(`/servers/${serverId('web-01')}`));
    expect(web.permissions).toContain('server:rebuild');
    expect(web.permissions).not.toContain('server:delete');
    expect((await anna.del(`/servers/${serverId('web-01')}`, { confirm: 'web-01' })).statusCode).toBe(403);
  });

  it('hides other organizations entirely', async () => {
    const dev = new Client(t.app);
    await dev.login('dev@beispiel.example');
    expect((await dev.get(`/orgs/${musterOrgId}`)).statusCode).toBe(404);
    expect((await dev.get(`/servers/${serverId('web-01')}`)).statusCode).toBe(404);
  });

  it('lets attached deny policies override a role', async () => {
    const anna = new Client(t.app);
    await anna.login('anna@muster.example');
    const policy = json(
      await anna.post(`/orgs/${musterOrgId}/policies`, {
        name: 'No console',
        statements: [{ effect: 'deny', actions: ['server:console'] }],
      }),
    );
    const members = json<{ membershipId: string; email: string }[]>(
      await anna.get(`/orgs/${musterOrgId}/members`),
    );
    const carla = members.find((m) => m.email === 'carla@muster.example')!;
    const res = await anna.patch(`/orgs/${musterOrgId}/members/${carla.membershipId}`, {
      role: 'admin',
      policyIds: [policy.id],
    });
    expect(res.statusCode).toBe(200);
    expect(json(res).policies).toHaveLength(1);
  });

  it('rejects policies with unknown actions', async () => {
    const res = await admin.post(`/orgs/${musterOrgId}/policies`, {
      name: 'Broken',
      statements: [{ effect: 'allow', actions: ['server:explode'] }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('prevents removing the last owner', async () => {
    const anna = new Client(t.app);
    await anna.login('anna@muster.example');
    const members = json<{ membershipId: string; email: string }[]>(
      await anna.get(`/orgs/${musterOrgId}/members`),
    );
    const self = members.find((m) => m.email === 'anna@muster.example')!;
    expect((await anna.del(`/orgs/${musterOrgId}/members/${self.membershipId}`)).statusCode).toBe(409);
  });
});

describe('api tokens', () => {
  it('scopes read tokens to reading and to one organization', async () => {
    const anna = new Client(t.app);
    await anna.login('anna@muster.example');
    const created = json<{ token: string }>(
      await anna.post(`/orgs/${musterOrgId}/tokens`, { name: 'ci', scope: 'read' }),
    );
    expect(created.token).toMatch(/^wlc_/);

    const bot = new Client(t.app);
    bot.bearer = created.token;
    expect((await bot.get(`/orgs/${musterOrgId}/servers`)).statusCode).toBe(200);
    expect((await bot.post(`/servers/${serverId('web-01')}/power`, { action: 'reboot' })).statusCode).toBe(
      403,
    );
    // Account management needs an interactive session.
    expect((await bot.post(`/orgs/${musterOrgId}/tokens`, { name: 'x', scope: 'read' })).statusCode).toBe(
      403,
    );

    bot.bearer = 'wlc_invalid_token';
    expect((await bot.get(`/orgs/${musterOrgId}/servers`)).statusCode).toBe(401);
  });

  it('lets read & write tokens operate servers', async () => {
    const anna = new Client(t.app);
    await anna.login('anna@muster.example');
    const { token } = json(
      await anna.post(`/orgs/${musterOrgId}/tokens`, { name: 'ops', scope: 'read_write' }),
    );
    const bot = new Client(t.app);
    bot.bearer = token;
    expect((await bot.post(`/servers/${serverId('web-02')}/power`, { action: 'reboot' })).statusCode).toBe(
      200,
    );
  });
});

describe('server operations', () => {
  it('creates and lists backups and snapshots', async () => {
    const id = serverId('db-primary');
    expect((await admin.post(`/servers/${id}/backups`, { description: 'test' })).statusCode).toBe(200);
    const backups = json<{ description: string }[]>(await admin.get(`/servers/${id}/backups`));
    expect(backups.some((b) => b.description === 'test')).toBe(true);

    expect((await admin.post(`/servers/${id}/snapshots`, { name: 'before-update' })).statusCode).toBe(200);
    const snaps = json<{ id: string }[]>(await admin.get(`/servers/${id}/snapshots`));
    expect(snaps.map((s) => s.id)).toContain('before-update');
    expect((await admin.del(`/servers/${id}/snapshots/before-update`)).statusCode).toBe(200);
  });

  it('serves metrics in the requested range', async () => {
    const res = await admin.get(`/servers/${serverId('web-01')}/metrics?range=week`);
    const body = json<{ range: string; points: unknown[] }>(res);
    expect(body.range).toBe('week');
    expect(body.points.length).toBeGreaterThan(10);
  });

  it('records actions and audit entries', async () => {
    const id = serverId('web-02');
    await admin.post(`/servers/${id}/power`, { action: 'reboot' });
    const tasks = json<{ actions: { type: string }[] }>(await admin.get(`/servers/${id}/tasks`));
    expect(tasks.actions.map((a) => a.type)).toContain('power.reboot');
    const activity = json<{ items: { action: string }[] }>(await admin.get(`/servers/${id}/activity`));
    expect(activity.items.map((a) => a.action)).toContain('server.power.reboot');
  });

  it('honours delete protection and the name confirmation', async () => {
    const id = serverId('mail');
    await admin.patch(`/servers/${id}`, { protection: { delete: true } });
    expect((await admin.del(`/servers/${id}`, { confirm: 'mail' })).statusCode).toBe(423);
    await admin.patch(`/servers/${id}`, { protection: { delete: false } });
    expect((await admin.del(`/servers/${id}`, { confirm: 'wrong' })).statusCode).toBe(400);
  });

  it('validates labels and power actions', async () => {
    const id = serverId('web-01');
    expect((await admin.patch(`/servers/${id}`, { labels: { 'bad key!': 'x' } })).statusCode).toBe(400);
    expect((await admin.patch(`/servers/${id}`, { labels: { env: 'prod', tier: 'web' } })).statusCode).toBe(
      200,
    );
    expect((await admin.post(`/servers/${id}/power`, { action: 'explode' })).statusCode).toBe(400);
  });

  it('only accepts firewall ports together with tcp or udp', async () => {
    const rules = `/servers/${serverId('web-01')}/firewall/rules`;
    const rule = { direction: 'in', action: 'ACCEPT', dport: '22' };
    const icmp = await admin.post(rules, { ...rule, protocol: 'icmp' });
    expect(icmp.statusCode).toBe(400);
    expect(icmp.body).toContain('tcp or udp');
    expect((await admin.post(rules, rule)).statusCode).toBe(400);
    expect((await admin.post(rules, { ...rule, dport: null, sport: '53', protocol: null })).statusCode).toBe(
      400,
    );
    expect((await admin.post(rules, { ...rule, protocol: 'tcp' })).statusCode).toBe(200);
    expect((await admin.post(rules, { ...rule, dport: '', protocol: 'icmp' })).statusCode).toBe(200);
    const firewall = json<{ rules: { protocol: string; dport: string | null }[] }>(
      await admin.get(`/servers/${serverId('web-01')}/firewall`),
    );
    // New rules go first.
    expect(firewall.rules.slice(0, 2).map((r) => r.protocol)).toEqual(['icmp', 'tcp']);
  });
});

describe('administration', () => {
  it('creates a customer with an owner invitation that can be accepted', async () => {
    const created = json<{ id: string; inviteLink: string; slug: string }>(
      await admin.post('/admin/orgs', { name: 'Neukunde AG', ownerEmail: 'chef@neukunde.example' }),
    );
    expect(created.slug).toBe('neukunde-ag');
    const token = created.inviteLink.split('/invite/')[1]!;

    const guest = new Client(t.app);
    const info = json(await guest.get(`/auth/invitations/${token}`));
    expect(info).toMatchObject({ email: 'chef@neukunde.example', role: 'owner', userExists: false });
    const accepted = await guest.post(`/auth/invitations/${token}/accept`, {
      name: 'Chef',
      password: 'a-strong-password',
    });
    expect(accepted.statusCode).toBe(200);
    const me = json<{ memberships: { orgSlug: string; role: string }[] }>(await guest.get('/auth/me'));
    expect(me.memberships).toEqual([expect.objectContaining({ orgSlug: 'neukunde-ag', role: 'owner' })]);
    // Invitations are single use.
    expect((await new Client(t.app).get(`/auth/invitations/${token}`)).statusCode).toBe(404);
  });

  it('assigns unassigned servers to customer projects', async () => {
    const unassigned = json<{ id: string }[]>(await admin.get('/admin/servers?assigned=no'));
    expect(unassigned.length).toBeGreaterThan(0);
    const detail = json<{ projects: { id: string }[] }>(await admin.get(`/admin/orgs/${musterOrgId}`));
    const res = await admin.post(`/admin/servers/${unassigned[0]!.id}/assign`, {
      projectId: detail.projects[0]!.id,
    });
    expect(res.statusCode).toBe(200);
  });

  it('never returns provider secrets', async () => {
    const created = json<{ id: string; summary: Record<string, string> }>(
      await admin.post('/admin/providers', {
        type: 'fire24',
        name: 'Second 24fire',
        location: { country: 'DE', label: 'Test' },
        config: { apiKey: 'super-secret-api-key-123' },
      }),
    );
    expect(JSON.stringify(created)).not.toContain('super-secret-api-key-123');
    expect(created.summary.apiKey).toMatch(/…/);
    expect((await admin.del(`/admin/providers/${created.id}`)).statusCode).toBe(200);
  });

  it('removes a stored credential when an edit sends null', async () => {
    type Provider = { id: string; summary: Record<string, string> };
    const created = json<Provider>(
      await admin.post('/admin/providers', {
        type: 'joker',
        name: 'Joker Test',
        location: { country: 'DE', label: 'Test' },
        // Nothing listens there: the initial background sync fails right away.
        config: { apiKey: 'joker-test-api-key', baseUrl: 'http://127.0.0.1:9/request' },
      }),
    );
    expect(created.summary.apiKey).toMatch(/…/);
    // Without a replacement nothing is left to sign in with.
    const empty = await admin.patch(`/admin/providers/${created.id}`, { config: { apiKey: null } });
    expect(empty.statusCode).toBe(400);
    const switched = json<Provider>(
      await admin.patch(`/admin/providers/${created.id}`, {
        config: { apiKey: null, username: 'reseller', password: 'joker-password' },
      }),
    );
    expect(switched.summary).toMatchObject({ username: 'reseller' });
    expect(switched.summary.apiKey).toBeUndefined();
    // Empty values still keep what is stored.
    const kept = json<Provider>(
      await admin.patch(`/admin/providers/${created.id}`, { config: { username: 'reseller', password: '' } }),
    );
    expect(kept.summary).toMatchObject({ username: 'reseller' });
    expect((await admin.del(`/admin/providers/${created.id}`)).statusCode).toBe(200);
  });

  it('keeps customers out of the admin area', async () => {
    const anna = new Client(t.app);
    await anna.login('anna@muster.example');
    expect((await anna.get('/admin/stats')).statusCode).toBe(403);
    expect((await anna.get('/admin/providers')).statusCode).toBe(403);
  });

  it('records failed logins in the global audit log', async () => {
    await new Client(t.app).post('/auth/login', { email: 'ghost@nowhere.example', password: 'x' });
    const log = json<{ items: { action: string; status: string; actor: { name: string } }[] }>(
      await admin.get('/admin/audit?action=auth.login&status=failure'),
    );
    expect(log.items.some((i) => i.actor.name === 'ghost@nowhere.example')).toBe(true);
  });
});
