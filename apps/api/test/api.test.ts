import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Secret, TOTP } from 'otpauth';
import { desc, eq } from 'drizzle-orm';
import {
  auditLogs,
  mediaAccounts,
  mediaAllowances,
  monitorAllowances,
  monitorStatusPages,
  monitors,
  phoneSystems,
  providerConnections,
} from '../src/db/schema';
import { redactExplorerBody, redactExplorerPath } from '../src/modules/admin/routes';
import { DemoAdapter } from '../src/providers/demo/adapter';
import type {
  JellyfinConfig,
  ProviderAdapter,
  ThreeCxConfig,
  UptimeKumaConfig,
} from '../src/providers/types';
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

  it('hands a root password from a rebuild only to interactive logins', async () => {
    // Hetzner answers a rebuild from a system image with a new root password.
    const answer = { message: 'Rebuild started', password: 'new-root-password' };
    const rebuild = vi.spyOn(DemoAdapter.prototype, 'rebuild').mockResolvedValue(answer);
    try {
      const anna = new Client(t.app);
      await anna.login('anna@muster.example');
      const id = serverId('web-02');
      const interactive = await anna.post(`/servers/${id}/rebuild`, { imageId: 'debian-12' });
      expect(interactive.statusCode).toBe(200);
      expect(json<{ password?: string }>(interactive).password).toBe('new-root-password');

      const { token } = json(
        await anna.post(`/orgs/${musterOrgId}/tokens`, { name: 'rebuild', scope: 'read_write' }),
      );
      const bot = new Client(t.app);
      bot.bearer = token;
      const viaToken = await bot.post(`/servers/${id}/rebuild`, { imageId: 'debian-12' });
      expect(viaToken.statusCode).toBe(200);
      expect(viaToken.body).not.toContain('new-root-password');

      const audit = await t.db.select().from(auditLogs);
      expect(JSON.stringify(audit)).not.toContain('new-root-password');
    } finally {
      rebuild.mockRestore();
    }
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

  it('keeps the private key of a CloudPanel connection inside the API', async () => {
    const pairRes = await admin.post('/admin/cloudpanel/keypair');
    expect(pairRes.statusCode).toBe(200);
    expect(pairRes.headers['cache-control']).toBe('no-store');
    const pair = json<{ privateKey: string; publicKey: string }>(pairRes);
    expect(pair.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
    expect(pair.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ weblion-console$/);
    const [entry] = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'provider.keypair_generate'));
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain(pair.privateKey.split('\n')[1]!);
    const anna = new Client(t.app);
    await anna.login('anna@muster.example');
    expect((await anna.post('/admin/cloudpanel/keypair')).statusCode).toBe(403);

    type Provider = { id: string; summary: Record<string, string> };
    const hostKeySha256 = `SHA256:${'A'.repeat(43)}`;
    const config = { host: '127.0.0.1', port: 9, privateKey: pair.privateKey, hostKeySha256 };
    const create = (overrides: Record<string, unknown>) =>
      admin.post('/admin/providers', {
        type: 'cloudpanel',
        name: 'CloudPanel Test',
        location: { country: 'CH', label: 'Test' },
        config: { ...config, ...overrides },
      });
    expect((await create({ privateKey: pair.publicKey })).statusCode).toBe(400);
    expect((await create({ privateKey: 'not a key' })).statusCode).toBe(400);
    expect((await create({ hostKeySha256: 'MD5:aa:bb' })).statusCode).toBe(400);
    expect((await create({ host: 'web1.example; rm -rf /' })).statusCode).toBe(400);
    expect((await create({ templates: ['Generic; x'] })).statusCode).toBe(400);

    const res = await create({ templates: ['Generic', 'Laravel*'], ipv4: ['203.0.113.10'] });
    expect(res.statusCode, res.body).toBe(200);
    const created = json<Provider>(res);
    expect(created.summary).toMatchObject({
      host: '127.0.0.1',
      port: '9',
      username: 'weblion-agent',
      hostKeySha256,
      publicKey: pair.publicKey,
      privateKey: '••••••',
      templates: 'Generic, Laravel*',
      ipv4: '203.0.113.10',
    });
    expect(JSON.stringify(created)).not.toContain(pair.privateKey.split('\n')[1]!);

    // An empty key keeps the stored one; lists can be removed.
    const edited = json<Provider>(
      await admin.patch(`/admin/providers/${created.id}`, {
        config: { privateKey: '', nodejs: true, ipv4: null },
      }),
    );
    expect(edited.summary).toMatchObject({ publicKey: pair.publicKey, nodejs: 'true' });
    expect(edited.summary.ipv4).toBeUndefined();
    expect((await admin.del(`/admin/providers/${created.id}`)).statusCode).toBe(200);
  });

  it('validates 3CX connections and shows no part of the client secret', async () => {
    type Provider = { id: string; summary: Record<string, string> };
    const create = (config: Record<string, unknown>) =>
      admin.post('/admin/providers', {
        type: 'threecx',
        name: '3CX Test',
        location: { country: 'CH', label: 'Test' },
        config: {
          baseUrl: 'https://pbx.example.test',
          clientId: 'weblion',
          clientSecret: 'xapi-secret-0123456789',
          ...config,
        },
      });
    for (const baseUrl of [
      'not a url',
      'http://pbx.example.test',
      'https://pbx.example.test/xapi/v1',
      'https://admin:pw@pbx.example.test',
      'https://pbx.example.test/?next=1',
    ]) {
      expect((await create({ baseUrl })).statusCode, baseUrl).toBe(400);
    }
    expect((await create({ clientId: 'web lion' })).statusCode).toBe(400);
    expect((await create({ clientSecret: 'short' })).statusCode).toBe(400);

    const res = await create({ baseUrl: 'https://pbx.example.test:5001/' });
    expect(res.statusCode, res.body).toBe(200);
    const created = json<Provider>(res);
    expect(created.summary).toMatchObject({
      baseUrl: 'https://pbx.example.test:5001',
      clientId: 'weblion',
      clientSecret: '••••••',
    });
    expect(JSON.stringify(created)).not.toContain('xapi-secret');
    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.resourceId, created.id));
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain('xapi-secret');

    // An empty secret keeps the stored one.
    const edited = json<Provider>(
      await admin.patch(`/admin/providers/${created.id}`, {
        config: { clientId: 'weblion-2', clientSecret: '' },
      }),
    );
    expect(edited.summary).toMatchObject({ clientId: 'weblion-2', clientSecret: '••••••' });
    const connection = await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.id, created.id),
    });
    expect(t.ctx.providers.decryptConfig<ThreeCxConfig>(connection!).clientSecret).toBe(
      'xapi-secret-0123456789',
    );

    // A phone system assigned to a customer keeps the connection.
    const [system] = await t.db
      .insert(phoneSystems)
      .values({
        providerConnectionId: created.id,
        externalId: 'pbx',
        name: 'pbx.example.test',
        orgId: musterOrgId,
      })
      .returning();
    const refused = await admin.del(`/admin/providers/${created.id}`);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toMatch(/phone systems/);
    await t.db.update(phoneSystems).set({ orgId: null }).where(eq(phoneSystems.id, system!.id));
    expect((await admin.del(`/admin/providers/${created.id}`)).statusCode).toBe(200);
    expect(
      await t.db.query.phoneSystems.findFirst({ where: eq(phoneSystems.id, system!.id) }),
    ).toBeUndefined();
  });

  it('keeps 3CX credentials out of audited explorer bodies', () => {
    expect(
      redactExplorerBody({
        FirstName: 'Anna',
        VMPIN: '1234',
        AuthID: '100abc',
        AuthPassword: { Concealed: true, Value: 'sip-secret' },
        AccessPassword: 'web-secret',
        LicenseKey: 'ABCD-EFGH',
        Phones: [{ ProvisioningLinkExt: 'https://pbx/provisioning/x', Model: 'Yealink' }],
        Ticket: 't-1',
      }),
    ).toEqual({
      FirstName: 'Anna',
      VMPIN: '[redacted]',
      AuthID: '[redacted]',
      AuthPassword: '[redacted]',
      AccessPassword: '[redacted]',
      LicenseKey: '[redacted]',
      Phones: [{ ProvisioningLinkExt: '[redacted]', Model: 'Yealink' }],
      Ticket: '[redacted]',
    });
  });

  it('validates Uptime Kuma connections and shows no secret', async () => {
    type Provider = { id: string; summary: Record<string, string> };
    const apiKey = 'uk3_kumaApiKey0123456789abcdefABCDEF0123456';
    const sessionToken = 'eyJhbGciOiJIUzI1NiJ9.kuma-session-token.signature';
    const create = (config: Record<string, unknown>) =>
      admin.post('/admin/providers', {
        type: 'uptimekuma',
        name: 'Kuma Test',
        location: { country: 'CH', label: 'Test' },
        config: { baseUrl: 'https://status.example.test', apiKey, ...config },
      });
    for (const baseUrl of [
      'not a url',
      'ftp://status.example.test',
      'https://status.example.test/dashboard',
      'https://admin:pw@status.example.test',
      'https://status.example.test/?next=1',
    ]) {
      expect((await create({ baseUrl })).statusCode, baseUrl).toBe(400);
    }
    expect((await create({ apiKey: 'kuma-key-0123456789abcdef' })).statusCode).toBe(400);
    expect((await create({ apiKey: 'uk3_short' })).statusCode).toBe(400);
    expect((await create({ sessionToken: 'short' })).statusCode).toBe(400);

    const res = await create({ baseUrl: 'http://10.0.0.20:3001/', sessionToken });
    expect(res.statusCode, res.body).toBe(200);
    const created = json<Provider>(res);
    expect(created.summary).toMatchObject({
      baseUrl: 'http://10.0.0.20:3001',
      apiKey: 'uk3_••••••',
      management: 'on',
    });
    expect(JSON.stringify(created)).not.toContain('kumaApiKey');
    expect(JSON.stringify(created)).not.toContain('kuma-session-token');
    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.resourceId, created.id));
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain('kumaApiKey');
    expect(JSON.stringify(audits)).not.toContain('kuma-session-token');

    const stored = async () => {
      const connection = await t.db.query.providerConnections.findFirst({
        where: eq(providerConnections.id, created.id),
      });
      return t.ctx.providers.decryptConfig<UptimeKumaConfig>(connection!);
    };
    // An empty key keeps the stored one, and so does the session on the same address.
    const edited = json<Provider>(
      await admin.patch(`/admin/providers/${created.id}`, {
        config: { baseUrl: 'http://10.0.0.20:3001', apiKey: '' },
      }),
    );
    expect(edited.summary).toMatchObject({ apiKey: 'uk3_••••••', management: 'on' });
    expect(await stored()).toMatchObject({ apiKey, sessionToken });
    // The session token never goes to another address.
    const moved = json<Provider>(
      await admin.patch(`/admin/providers/${created.id}`, {
        config: { baseUrl: 'https://status.example.test', apiKey: '' },
      }),
    );
    expect(moved.summary).toMatchObject({ baseUrl: 'https://status.example.test', management: 'off' });
    expect((await stored()).sessionToken).toBeUndefined();
    expect((await stored()).apiKey).toBe(apiKey);

    // Assigned monitors, allowances and status page links keep the connection. Beispiel GmbH has
    // no monitoring allowance of the demo seed (its primary key is the organization).
    const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
    const beispielOrgId = orgs.find((o) => o.slug === 'beispiel-gmbh')!.id;
    const [monitor] = await t.db
      .insert(monitors)
      .values({
        providerConnectionId: created.id,
        externalId: '12',
        name: 'Website',
        providerName: 'Website',
        type: 'http',
        orgId: musterOrgId,
      })
      .returning();
    const refused = await admin.del(`/admin/providers/${created.id}`);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toMatch(/monitors/);
    await t.db.update(monitors).set({ orgId: null }).where(eq(monitors.id, monitor!.id));
    await t.db.insert(monitorAllowances).values({
      orgId: beispielOrgId,
      providerConnectionId: created.id,
      maxMonitors: 5,
      minIntervalSeconds: 60,
    });
    expect((await admin.del(`/admin/providers/${created.id}`)).statusCode).toBe(409);
    await t.db.delete(monitorAllowances).where(eq(monitorAllowances.providerConnectionId, created.id));
    await t.db
      .insert(monitorStatusPages)
      .values({ orgId: beispielOrgId, providerConnectionId: created.id, slug: 'beispiel' });
    expect((await admin.del(`/admin/providers/${created.id}`)).statusCode).toBe(409);
    await t.db.delete(monitorStatusPages).where(eq(monitorStatusPages.providerConnectionId, created.id));
    expect((await admin.del(`/admin/providers/${created.id}`)).statusCode).toBe(200);
    expect(await t.db.query.monitors.findFirst({ where: eq(monitors.id, monitor!.id) })).toBeUndefined();
  });

  it('lets an adapter blank its own secrets in audited explorer writes', async () => {
    const demo = await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo'),
    });
    const adapter: ProviderAdapter = t.ctx.providers.forConnection(demo!);
    adapter.redactExplorerAudit = (path, body) => ({
      path: path.replace(/token=[^&]*/, 'token=***'),
      body: { ...body, headers: '[redacted]' },
    });
    try {
      const res = await admin.post('/admin/explorer', {
        providerId: demo!.id,
        method: 'POST',
        path: 'socket/editMonitor?token=abc',
        body: { headers: '{"X-Api": "header-secret"}', basic_auth_pass: 'pass-secret', name: 'Shop' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const [entry] = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'provider.explorer'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      // The adapter's redaction first, the generic one on top.
      expect(entry!.details).toMatchObject({
        path: 'socket/editMonitor?token=[redacted]',
        body: { headers: '[redacted]', basic_auth_pass: '[redacted]', name: 'Shop' },
      });
      expect(JSON.stringify(entry)).not.toContain('secret');
    } finally {
      delete adapter.redactExplorerAudit;
    }
  });

  it('validates Jellyfin connections and shows no part of the API key', async () => {
    type Provider = { id: string; summary: Record<string, string> };
    const apiKey = 'a3f1c2d4e5b6a7980f1e2d3c4b5a6978';
    const create = (config: Record<string, unknown>) =>
      admin.post('/admin/providers', {
        type: 'jellyfin',
        name: 'Jellyfin Test',
        location: { country: 'CH', label: 'Test' },
        config: { baseUrl: 'https://media.example.test', apiKey, ...config },
      });
    for (const baseUrl of [
      'not a url',
      'ftp://media.example.test',
      'https://admin:pw@media.example.test',
      'https://media.example.test/?next=1',
      'https://media.example.test/#web',
    ]) {
      expect((await create({ baseUrl })).statusCode, baseUrl).toBe(400);
    }
    expect((await create({ apiKey: 'jellyfin-api-key' })).statusCode).toBe(400);
    expect((await create({ apiKey: apiKey.slice(1) })).statusCode).toBe(400);
    expect((await create({ apiKey: `${apiKey.slice(1)}g` })).statusCode).toBe(400);
    // http on a private network is the operator's choice; the form warns.
    expect((await create({ baseUrl: 'http://10.0.0.30:8096' })).statusCode).toBe(200);

    // A base path is kept (Jellyfin's base URL), the key is stored in lower case.
    const res = await create({
      baseUrl: 'https://media.example.test/jellyfin/',
      apiKey: ` ${apiKey.toUpperCase()} `,
    });
    expect(res.statusCode, res.body).toBe(200);
    const created = json<Provider>(res);
    expect(created.summary).toMatchObject({
      baseUrl: 'https://media.example.test/jellyfin',
      apiKey: '••••••',
    });
    const stored = async () => {
      const connection = await t.db.query.providerConnections.findFirst({
        where: eq(providerConnections.id, created.id),
      });
      return t.ctx.providers.decryptConfig<JellyfinConfig>(connection!);
    };
    expect((await stored()).apiKey).toBe(apiKey);
    const list = (await admin.get('/admin/providers')).body;
    const audits = JSON.stringify(
      await t.db.select().from(auditLogs).where(eq(auditLogs.resourceId, created.id)),
    );
    for (const text of [JSON.stringify(created), list, audits]) {
      expect(text).not.toContain(apiKey.slice(0, 6));
      expect(text).not.toContain(apiKey.slice(-6));
    }

    // An empty key keeps the stored one.
    const edited = json<Provider>(
      await admin.patch(`/admin/providers/${created.id}`, {
        config: { baseUrl: 'https://media.example.test', apiKey: '' },
      }),
    );
    expect(edited.summary).toMatchObject({ baseUrl: 'https://media.example.test', apiKey: '••••••' });
    expect((await stored()).apiKey).toBe(apiKey);

    // A streaming allowance or an assigned account keeps the connection. Beispiel GmbH has no
    // streaming allowance of the demo seed (its primary key is the organization).
    const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
    const beispielOrgId = orgs.find((o) => o.slug === 'beispiel-gmbh')!.id;
    await t.db.insert(mediaAllowances).values({
      orgId: beispielOrgId,
      providerConnectionId: created.id,
      accountCode: 'apitest',
      maxAccounts: 3,
      maxStreams: 2,
    });
    const refused = await admin.del(`/admin/providers/${created.id}`);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toMatch(/streaming allowances/);
    await t.db.delete(mediaAllowances).where(eq(mediaAllowances.providerConnectionId, created.id));
    const [account] = await t.db
      .insert(mediaAccounts)
      .values({
        providerConnectionId: created.id,
        externalId: 'c0ffee00c0ffee00c0ffee00c0ffee00',
        username: 'anna-apitest',
        orgId: musterOrgId,
      })
      .returning();
    expect((await admin.del(`/admin/providers/${created.id}`)).statusCode).toBe(409);
    await t.db.update(mediaAccounts).set({ orgId: null }).where(eq(mediaAccounts.id, account!.id));
    expect((await admin.del(`/admin/providers/${created.id}`)).statusCode).toBe(200);
    expect(
      await t.db.query.mediaAccounts.findFirst({ where: eq(mediaAccounts.id, account!.id) }),
    ).toBeUndefined();
  });

  it('keeps Jellyfin passwords out of audited explorer bodies and paths', () => {
    expect(
      redactExplorerBody({
        Name: 'anna-kemaro',
        Password: 'new-secret',
        NewPw: 'new-secret',
        CurrentPw: 'old-secret',
        Pw: 'old-secret',
        Pin: '1234',
        EnableAllFolders: false,
      }),
    ).toEqual({
      Name: 'anna-kemaro',
      Password: '[redacted]',
      NewPw: '[redacted]',
      CurrentPw: '[redacted]',
      Pw: '[redacted]',
      Pin: '[redacted]',
      EnableAllFolders: false,
    });
    expect(redactExplorerPath('/Users/3bc7/Authenticate?pw=old-secret&x=1')).toBe(
      '/Users/3bc7/Authenticate?pw=[redacted]&x=1',
    );
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

describe('provider adapters', () => {
  it('keeps the adapter (and its caches) across syncs, but not across new credentials', async () => {
    const load = async () =>
      (await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.type, 'demo') }))!;
    const before = await load();
    const adapter = t.ctx.providers.forConnection(before);
    await t.ctx.sync.syncConnection(before);
    const after = await load();
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(t.ctx.providers.forConnection(after)).toBe(adapter);
    expect(t.ctx.providers.forConnection({ ...after, configEnc: t.ctx.box.encryptJson({}) })).not.toBe(
      adapter,
    );
    t.ctx.providers.invalidate(after.id);
  });
});
