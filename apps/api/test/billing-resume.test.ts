import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, desc, eq, ne } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  type EndedEarlyServiceDto,
  type InvoiceDetailDto,
  type ModuleKey,
  type ServiceDto,
  type ServiceResumePreviewDto,
} from '@weblion/shared';
import {
  auditLogs,
  invoiceLines,
  invoices,
  memberships,
  organizations,
  products,
  services,
  users,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/crypto';
import { addDays, addMonths, nextBillingDate, todayZurich } from '../src/modules/billing/dates';
import { BillingJob } from '../src/modules/billing/recurring';
import { ADMIN, Client, DEMO_PASSWORD, createTestApp, json, type TestApp } from './helpers';

/**
 * Restoring services that a cancellation to a later date ended at once before the fix of November 2026
 * (status cancelled, no billing date, end date after today). The legacy state is written into the database
 * directly, the way the old cancel route left it, with its audit entry { endsAt, moduleDeactivated }.
 */

let t: TestApp;
let admin: Client;
let anna: Client;
let reto: Client;
let rita: Client;
let job: BillingJob;
let alpenId: string;
let huberId: string;
let ritaResellerId: string;
let ritaCustomerId: string;

const today = todayZurich();

async function customer(slug: string, modules: ModuleKey[] = ['servers'], parentOrgId: string | null = null) {
  const [org] = await t.db
    .insert(organizations)
    .values({ name: slug, slug, kind: 'customer', boundary: DEFAULT_CUSTOMER_BOUNDARY, modules, parentOrgId })
    .returning();
  return org!.id;
}

async function service(orgId: string, extra: Record<string, unknown> = {}, client = admin) {
  const res = await client.post(`/billing/customers/${orgId}/services`, {
    name: 'Managed Server',
    unitPrice: 1000,
    interval: 'monthly',
    startsAt: addMonths(today, -2),
    activateModule: false,
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<ServiceDto>(res);
}

/**
 * What the cancel route did before the fix with an end date after today: the service ended at once, and with
 * "Modul sperren" the module went off at once.
 */
async function legacyCancel(svc: ServiceDto, endsAt: string, opts: { moduleOff?: boolean } = {}) {
  await t.db
    .update(services)
    .set({ status: 'cancelled', nextBillingAt: null, endsAt, cancelledAt: new Date() })
    .where(eq(services.id, svc.id));
  const off = opts.moduleOff && svc.module ? svc.module : null;
  if (off) {
    const org = (await t.db.query.organizations.findFirst({ where: eq(organizations.id, svc.orgId) }))!;
    await t.db
      .update(organizations)
      .set({ modules: org.modules.filter((m) => m !== off) })
      .where(eq(organizations.id, svc.orgId));
  }
  await t.db.insert(auditLogs).values({
    action: 'service.cancel',
    orgId: svc.orgId,
    resourceType: 'service',
    resourceId: svc.id,
    status: 'success',
    actorName: 'Admin',
    details: { endsAt, moduleDeactivated: off },
  });
}

async function load(id: string) {
  return (await t.db.query.services.findFirst({ where: eq(services.id, id) }))!;
}

async function modulesOf(orgId: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }))!.modules;
}

async function preview(id: string, client = admin) {
  const res = await client.get(`/services/${id}/resume`);
  expect(res.statusCode, res.body).toBe(200);
  return json<ServiceResumePreviewDto>(res);
}

async function resume(id: string, body: Record<string, unknown>, client = admin) {
  return client.post(`/services/${id}/resume`, body);
}

async function billedPeriods(serviceId: string) {
  return t.db
    .select({ start: invoiceLines.periodStart, end: invoiceLines.periodEnd })
    .from(invoiceLines)
    .where(eq(invoiceLines.serviceId, serviceId))
    .orderBy(invoiceLines.periodStart);
}

async function audits(serviceId: string, action: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.resourceId, serviceId), eq(auditLogs.action, action)))
    .orderBy(desc(auditLogs.id));
}

/** Period starts of a monthly service from `from` while `keep` holds, stepping like the billing run. */
function starts(startsAt: string, from: string, keep: (start: string) => boolean): string[] {
  const out: string[] = [];
  for (let d: string | null = from; d && keep(d); d = nextBillingDate(d, 'monthly', startsAt)) out.push(d);
  return out;
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  reto = new Client(t.app);
  await reto.login('reseller@alpen.example');
  alpenId = (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, 'alpen-hosting') }))!
    .id;
  huberId = (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, 'baeckerei-huber') }))!
    .id;

  // A second reseller with a customer of its own.
  const [reseller] = await t.db
    .insert(organizations)
    .values({
      name: 'Resume Reseller AG',
      slug: 'resume-reseller',
      kind: 'reseller',
      boundary: DEFAULT_RESELLER_BOUNDARY,
      modules: ['servers', 'dns'],
    })
    .returning();
  ritaResellerId = reseller!.id;
  ritaCustomerId = await customer('resume-reseller-kunde', ['servers'], ritaResellerId);
  const [ritaUser] = await t.db
    .insert(users)
    .values({ email: 'rita@resume.example', name: 'Rita', passwordHash: await hashPassword(DEMO_PASSWORD) })
    .returning();
  await t.db.insert(memberships).values({ orgId: ritaResellerId, userId: ritaUser!.id, role: 'owner' });
  rita = new Client(t.app);
  await rita.login('rita@resume.example');

  job = new BillingJob(t.ctx, null as never);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.close();
});

describe('preview', () => {
  it('lists every period since the start when nothing was billed, with the run amounts', async () => {
    const orgId = await customer('resume-none', ['servers', 'dns']);
    const startsAt = addMonths(today, -2);
    const svc = await service(orgId, { startsAt, module: 'dns', quantity: 2, unitPrice: 1250 });
    const endsAt = addDays(addMonths(today, 2), 3);
    await legacyCancel(svc, endsAt);

    const p = await preview(svc.id);
    const missed = starts(startsAt, startsAt, (d) => d < today);
    expect(missed.length).toBeGreaterThanOrEqual(2);
    expect(p).toMatchObject({
      serviceId: svc.id,
      name: 'Managed Server',
      endsAt,
      currency: 'CHF',
      interval: 'monthly',
      firstUnbilled: startsAt,
      nextFromToday: starts(startsAt, startsAt, (d) => d <= addMonths(today, 1)).find((d) => d >= today),
      periodAmount: 2500,
      missedTotal: missed.length * 2500,
      module: 'dns',
      moduleActive: true,
      moduleDeactivatedByCancel: false,
    });
    expect(p.cancelledAt).not.toBeNull();
    expect(p.missedPeriods.map((m) => m.start)).toEqual(missed);
    expect(p.missedPeriods[0]).toEqual({
      start: startsAt,
      end: addDays(nextBillingDate(startsAt, 'monthly', startsAt)!, -1),
      amount: 2500,
    });
    // What the run bills from today up to the end date, with either choice: the last period ends on the end date.
    const upcoming = starts(startsAt, p.nextFromToday!, (d) => d <= endsAt);
    expect(p).toMatchObject({
      startsAt,
      pausedBeforeCancel: false,
      upcomingTotal: upcoming.length * 2500,
      sellerHasModule: true,
      manualInvoices: [],
    });
    expect(p.upcomingPeriods.map((u) => u.start)).toEqual(upcoming);
    expect(p.upcomingPeriods.at(-1)!.end).toBe(endsAt);
  });

  it('starts after the last period on an invoice that is not void, drafts included', async () => {
    const orgId = await customer('resume-billed', ['servers', 'dns']);
    const startsAt = addMonths(today, -3);
    const svc = await service(orgId, { startsAt, module: 'dns' });
    // A draft with the first two periods (counts as billed).
    const gen = await admin.post(`/billing/customers/${orgId}/invoices/generate`, {
      until: addMonths(startsAt, 1),
    });
    expect(json<{ invoice: InvoiceDetailDto }>(gen).invoice.status).toBe('draft');
    // A void invoice with the third period (does not count).
    const third = addMonths(startsAt, 2);
    const manual = await admin.post(`/billing/customers/${orgId}/invoices`, {
      lines: [
        {
          description: 'Managed Server',
          quantity: 1,
          unitPrice: 1000,
          serviceId: svc.id,
          periodStart: third,
          periodEnd: addDays(addMonths(startsAt, 3), -1),
        },
      ],
    });
    const manualId = json<InvoiceDetailDto>(manual).id;
    expect((await admin.post(`/invoices/${manualId}/finalize`, { send: false })).statusCode).toBe(200);
    expect((await admin.post(`/invoices/${manualId}/void`, { reason: 'Test' })).statusCode).toBe(200);
    await legacyCancel(svc, addDays(today, 40), { moduleOff: true });

    const p = await preview(svc.id);
    expect(p.firstUnbilled).toBe(third);
    expect(p.missedPeriods.map((m) => m.start)).toEqual(starts(startsAt, third, (d) => d < today));
    expect(p).toMatchObject({ module: 'dns', moduleActive: false, moduleDeactivatedByCancel: true });
  });

  it('has no periods for a one-off service, billed or not', async () => {
    const orgId = await customer('resume-once');
    const billed = await service(orgId, {
      name: 'Einrichtung',
      interval: 'once',
      startsAt: addDays(today, -20),
    });
    await admin.post(`/billing/customers/${orgId}/invoices/generate`, { until: today });
    expect(await billedPeriods(billed.id)).toHaveLength(1);
    const unbilled = await service(orgId, { name: 'Umzug', interval: 'once', startsAt: addDays(today, 5) });
    for (const s of [billed, unbilled]) await legacyCancel(s, addDays(today, 30));

    const a = await preview(billed.id);
    expect(a).toMatchObject({ firstUnbilled: null, nextFromToday: null, missedPeriods: [], missedTotal: 0 });
    const b = await preview(unbilled.id);
    expect(b).toMatchObject({
      firstUnbilled: unbilled.startsAt,
      nextFromToday: unbilled.startsAt,
      missedPeriods: [],
      periodAmount: 1000,
    });

    // Restored, the billed one has nothing left to bill; the other is billed once, on its date.
    const resumed = json<ServiceDto>(
      await resume(billed.id, { billFrom: 'missed', activateModule: false, deactivateModuleAtEnd: false }),
    );
    expect(resumed).toMatchObject({ status: 'active', nextBillingAt: null });
    await resume(unbilled.id, { billFrom: 'next', activateModule: false, deactivateModuleAtEnd: false });
    await job.runDue(addDays(today, 60));
    expect(await billedPeriods(billed.id)).toHaveLength(1);
    expect((await billedPeriods(unbilled.id)).map((p) => p.start)).toEqual([unbilled.startsAt]);
    await job.endDue(addDays(today, 31));
    expect((await load(billed.id)).status).toBe('cancelled');
    expect((await load(unbilled.id)).status).toBe('cancelled');
  });
});

describe('restore', () => {
  it('bills the missed periods and every period up to the end date with billFrom missed, then ends', async () => {
    const orgId = await customer('resume-missed', ['servers', 'dns']);
    const startsAt = addMonths(today, -2);
    const svc = await service(orgId, { startsAt, module: 'dns' });
    const endsAt = addDays(addMonths(today, 2), 3);
    await legacyCancel(svc, endsAt);
    const cancelledAt = (await load(svc.id)).cancelledAt;

    const res = await resume(svc.id, {
      billFrom: 'missed',
      activateModule: false,
      deactivateModuleAtEnd: false,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<ServiceDto>(res)).toMatchObject({
      status: 'active',
      nextBillingAt: startsAt,
      endsAt,
      deactivateModuleAtEnd: false,
    });
    expect((await load(svc.id)).cancelledAt).toEqual(cancelledAt);
    const [entry] = await audits(svc.id, 'service.resume');
    expect(entry!.details).toEqual({
      endsAt,
      status: 'active',
      nextBillingAt: startsAt,
      billFrom: 'missed',
      moduleActivated: null,
      deactivateModuleAtEnd: false,
    });
    // A scheduled cancellation now, so it cannot be restored a second time.
    expect(
      (await resume(svc.id, { billFrom: 'missed', activateModule: false, deactivateModuleAtEnd: false }))
        .statusCode,
    ).toBe(409);

    // The next run bills the missed periods and today's, a later one the rest up to the end date, none after.
    await job.runDue(today);
    expect((await billedPeriods(svc.id)).map((p) => p.start)).toEqual(
      starts(startsAt, startsAt, (d) => d <= today),
    );
    await job.runDue(addMonths(endsAt, 6));
    const all = starts(startsAt, startsAt, (d) => d <= endsAt);
    const periods = await billedPeriods(svc.id);
    expect(periods.map((p) => p.start)).toEqual(all);
    expect(periods.at(-1)!.end).toBe(endsAt);

    // Running on the end date, ended the day after; the module stays (not chosen).
    await job.endDue(endsAt);
    expect((await load(svc.id)).status).toBe('active');
    await job.endDue(addDays(endsAt, 1));
    expect(await load(svc.id)).toMatchObject({ status: 'cancelled', nextBillingAt: null });
    expect(await modulesOf(orgId)).toEqual(['servers', 'dns']);
  });

  it('skips the missed periods with billFrom next, switches the module on again and off at the end', async () => {
    const orgId = await customer('resume-next', ['servers', 'dns']);
    const startsAt = addMonths(today, -3);
    const svc = await service(orgId, { startsAt, module: 'dns' });
    await admin.post(`/billing/customers/${orgId}/invoices/generate`, { until: startsAt });
    const endsAt = addDays(addMonths(today, 1), 10);
    await legacyCancel(svc, endsAt, { moduleOff: true });
    expect(await modulesOf(orgId)).toEqual(['servers']);
    const p = await preview(svc.id);
    expect(p.missedPeriods.length).toBeGreaterThanOrEqual(2);

    const res = await resume(svc.id, { billFrom: 'next', activateModule: true, deactivateModuleAtEnd: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<ServiceDto>(res)).toMatchObject({
      status: 'active',
      nextBillingAt: p.nextFromToday,
      endsAt,
      deactivateModuleAtEnd: true,
    });
    expect(await modulesOf(orgId)).toEqual(['servers', 'dns']);
    const [entry] = await audits(svc.id, 'service.resume');
    expect(entry!.details).toEqual({
      endsAt,
      status: 'active',
      nextBillingAt: p.nextFromToday,
      billFrom: 'next',
      moduleActivated: 'dns',
      deactivateModuleAtEnd: true,
    });

    await job.runDue(addMonths(endsAt, 6));
    expect((await billedPeriods(svc.id)).map((b) => b.start)).toEqual([
      startsAt,
      ...starts(startsAt, p.nextFromToday!, (d) => d <= endsAt),
    ]);
    await job.endDue(addDays(endsAt, 1));
    expect((await load(svc.id)).status).toBe('cancelled');
    expect(await modulesOf(orgId)).toEqual(['servers']);
    const [end] = await audits(svc.id, 'service.end');
    expect(end!.details).toEqual({ endsAt, moduleDeactivated: 'dns' });
  });

  it('leaves the module off without activateModule and on a service without a module', async () => {
    const orgId = await customer('resume-module-off', ['servers', 'dns']);
    const svc = await service(orgId, { module: 'dns', startsAt: today });
    await legacyCancel(svc, addDays(today, 20), { moduleOff: true });
    await resume(svc.id, { billFrom: 'missed', activateModule: false, deactivateModuleAtEnd: true });
    expect(await modulesOf(orgId)).toEqual(['servers']);

    const plain = await service(orgId, { startsAt: today });
    await legacyCancel(plain, addDays(today, 20));
    const res = await resume(plain.id, {
      billFrom: 'missed',
      activateModule: true,
      deactivateModuleAtEnd: true,
    });
    expect(json<ServiceDto>(res)).toMatchObject({
      status: 'active',
      nextBillingAt: today,
      deactivateModuleAtEnd: false,
    });
    expect(await modulesOf(orgId)).toEqual(['servers']);
  });

  it('re-activates a module for a reseller customer only when the reseller has it', async () => {
    const svc = await service(ritaCustomerId, { module: 'dns', startsAt: today }, rita);
    await legacyCancel(svc, addDays(today, 20));
    expect(json<ServiceResumePreviewDto>(await rita.get(`/services/${svc.id}/resume`))).toMatchObject({
      module: 'dns',
      moduleActive: false,
      moduleDeactivatedByCancel: false,
    });
    const res = await resume(
      svc.id,
      { billFrom: 'next', activateModule: true, deactivateModuleAtEnd: false },
      rita,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(await modulesOf(ritaCustomerId)).toEqual(['servers', 'dns']);

    // A module the reseller does not have: refused, nothing changed.
    await t.db
      .update(organizations)
      .set({ modules: ['servers'] })
      .where(eq(organizations.id, ritaResellerId));
    const media = await service(ritaCustomerId, { name: 'Streaming', startsAt: today }, rita);
    await t.db.update(services).set({ module: 'media' }).where(eq(services.id, media.id));
    await legacyCancel({ ...media, module: 'media' }, addDays(today, 20));
    // The dialog greys the switch out.
    expect(json<ServiceResumePreviewDto>(await rita.get(`/services/${media.id}/resume`))).toMatchObject({
      module: 'media',
      moduleActive: false,
      sellerHasModule: false,
    });
    const refused = await resume(
      media.id,
      { billFrom: 'next', activateModule: true, deactivateModuleAtEnd: false },
      rita,
    );
    expect(refused.statusCode).toBe(409);
    expect((await load(media.id)).status).toBe('cancelled');
    await t.db
      .update(organizations)
      .set({ modules: ['servers', 'dns'] })
      .where(eq(organizations.id, ritaResellerId));
  });
});

describe('refusals', () => {
  it('answers 409 unless the service is cancelled with an end date after today', async () => {
    const orgId = await customer('resume-409');
    const running = await service(orgId);
    const scheduled = await service(orgId);
    expect(
      (await admin.post(`/services/${scheduled.id}/cancel`, { endsAt: addDays(today, 30) })).statusCode,
    ).toBe(200);
    const now = await service(orgId);
    expect((await admin.post(`/services/${now.id}/cancel`, {})).statusCode).toBe(200);
    const past = await service(orgId);
    await legacyCancel(past, addDays(today, 30));
    await t.db
      .update(services)
      .set({ endsAt: addDays(today, -1) })
      .where(eq(services.id, past.id));
    const body = { billFrom: 'missed', activateModule: false, deactivateModuleAtEnd: false };
    for (const s of [running, scheduled, now, past]) {
      const get = await admin.get(`/services/${s.id}/resume`);
      expect(get.statusCode, s.id).toBe(409);
      expect(json(get).error.details).toEqual({ reason: 'notEndedEarly' });
      expect((await resume(s.id, body)).statusCode, s.id).toBe(409);
    }
    expect((await load(running.id)).status).toBe('active');
    expect((await load(now.id)).status).toBe('cancelled');
  });

  it('validates the body', async () => {
    const svc = await service(await customer('resume-body'));
    await legacyCancel(svc, addDays(today, 30));
    expect(
      (await resume(svc.id, { billFrom: 'later', activateModule: false, deactivateModuleAtEnd: false }))
        .statusCode,
    ).toBe(400);
    expect((await resume(svc.id, { billFrom: 'missed' })).statusCode).toBe(400);
    expect((await load(svc.id)).status).toBe('cancelled');
  });

  it('lets only the seller see and restore', async () => {
    const platformService = await service(await customer('resume-perms'));
    await legacyCancel(platformService, addDays(today, 30));
    const muster = (await t.db.query.organizations.findFirst({
      where: eq(organizations.slug, 'muster-ag'),
    }))!;
    const own = await service(muster.id);
    await legacyCancel(own, addDays(today, 30));
    const huberService = await service(huberId, {}, reto);
    await legacyCancel(huberService, addDays(today, 30));
    const body = { billFrom: 'missed', activateModule: false, deactivateModuleAtEnd: false };

    // The customer itself, a reseller on a platform customer and another reseller's customer.
    for (const [client, id] of [
      [anna, own.id],
      [reto, platformService.id],
      [rita, huberService.id],
    ] as const) {
      const get = await client.get(`/services/${id}/resume`);
      expect([403, 404]).toContain(get.statusCode);
      expect((await resume(id, body, client)).statusCode).toBe(get.statusCode);
      expect((await load(id)).status).toBe('cancelled');
    }
    // The reseller on its own customer.
    expect((await reto.get(`/services/${huberService.id}/resume`)).statusCode).toBe(200);
    expect((await resume(huberService.id, body, reto)).statusCode).toBe(200);
  });
});

describe('list', () => {
  it('shows staff the platform customers and a reseller its own customers', async () => {
    const platformOrg = await customer('resume-list-platform');
    const a = await service(platformOrg, { name: 'Platform Dienst' });
    await legacyCancel(a, addDays(today, 30));
    const b = await service(huberId, { name: 'Huber Dienst' }, reto);
    await legacyCancel(b, addDays(today, 45));
    const c = await service(ritaCustomerId, { name: 'Rita Dienst' }, rita);
    await legacyCancel(c, addDays(today, 60));
    // Not listed: running, scheduled, ended at once.
    const running = await service(platformOrg, { name: 'Läuft' });
    await admin.post(`/services/${running.id}/cancel`, { endsAt: addDays(today, 10) });
    await admin.post(`/services/${(await service(platformOrg, { name: 'Sofort' })).id}/cancel`, {});

    const staff = json<EndedEarlyServiceDto[]>(await admin.get('/admin/billing/services/ended-early'));
    const mine = staff.find((s) => s.serviceId === a.id);
    expect(mine).toMatchObject({
      name: 'Platform Dienst',
      customer: { id: platformOrg, name: 'resume-list-platform' },
      endsAt: addDays(today, 30),
      module: null,
    });
    expect(mine!.cancelledAt).not.toBeNull();
    const staffIds = staff.map((s) => s.serviceId);
    expect(staffIds).not.toContain(b.id);
    expect(staffIds).not.toContain(c.id);
    expect(staffIds).not.toContain(running.id);
    expect(staff.every((s) => s.endsAt > today)).toBe(true);
    // The oldest end date first.
    expect([...staff].sort((x, y) => x.endsAt.localeCompare(y.endsAt)).map((s) => s.endsAt)).toEqual(
      staff.map((s) => s.endsAt),
    );

    const alpen = json<EndedEarlyServiceDto[]>(
      await reto.get(`/orgs/${alpenId}/reseller/services/ended-early`),
    );
    expect(alpen.map((s) => s.serviceId)).toContain(b.id);
    expect(alpen.every((s) => s.customer.id === huberId)).toBe(true);
    const ritas = json<EndedEarlyServiceDto[]>(
      await rita.get(`/orgs/${ritaResellerId}/reseller/services/ended-early`),
    );
    expect(ritas.map((s) => s.serviceId)).toContain(c.id);
    expect(ritas.every((s) => s.customer.id === ritaCustomerId)).toBe(true);

    // Restored, a service leaves the list.
    await resume(a.id, { billFrom: 'next', activateModule: false, deactivateModuleAtEnd: false });
    const after = json<EndedEarlyServiceDto[]>(await admin.get('/admin/billing/services/ended-early'));
    expect(after.map((s) => s.serviceId)).not.toContain(a.id);
  });

  it('is only for the seller', async () => {
    expect((await anna.get('/admin/billing/services/ended-early')).statusCode).toBe(403);
    expect((await rita.get(`/orgs/${alpenId}/reseller/services/ended-early`)).statusCode).toBe(404);
    expect((await reto.get(`/orgs/${ritaResellerId}/reseller/services/ended-early`)).statusCode).toBe(404);
    const muster = (await t.db.query.organizations.findFirst({
      where: eq(organizations.slug, 'muster-ag'),
    }))!;
    expect((await anna.get(`/orgs/${muster.id}/reseller/services/ended-early`)).statusCode).toBe(404);
  });
});

/** Period starts from `from` while `keep` holds, stepping like the billing run, for any interval. */
function periodStarts(
  startsAt: string,
  from: string | null,
  interval: 'monthly' | 'quarterly' | 'yearly',
  keep: (start: string) => boolean,
): string[] {
  const out: string[] = [];
  for (let d = from; d && keep(d); d = nextBillingDate(d, interval, startsAt)) out.push(d);
  return out;
}

const none = { activateModule: false, deactivateModuleAtEnd: false };

describe('state before the cancellation', () => {
  it('restores a service paused at the cancellation paused, as a scheduled cancellation keeps the pause', async () => {
    const orgId = await customer('resume-paused');
    const startsAt = addMonths(today, -4);
    const legacy = await service(orgId, { startsAt });
    // The same history, cancelled the way it works today.
    const control = await service(orgId, { startsAt, name: 'Control' });
    await admin.post(`/billing/customers/${orgId}/invoices/generate`, { until: startsAt });
    for (const s of [legacy, control]) {
      expect((await admin.patch(`/services/${s.id}`, { status: 'suspended' })).statusCode).toBe(200);
    }
    const endsAt = addMonths(today, 2);
    await legacyCancel(legacy, endsAt);
    expect((await admin.post(`/services/${control.id}/cancel`, { endsAt })).statusCode).toBe(200);

    const p = await preview(legacy.id);
    expect(p).toMatchObject({
      pausedBeforeCancel: true,
      firstUnbilled: addMonths(startsAt, 1),
      missedPeriods: [],
      missedTotal: 0,
      upcomingPeriods: [],
      upcomingTotal: 0,
    });
    const res = await resume(legacy.id, { billFrom: 'missed', ...none });
    expect(res.statusCode, res.body).toBe(200);
    const controlRow = await load(control.id);
    expect(json<ServiceDto>(res)).toMatchObject({
      status: 'suspended',
      nextBillingAt: controlRow.nextBillingAt,
      endsAt,
    });
    expect((await audits(legacy.id, 'service.resume'))[0]!.details).toMatchObject({
      status: 'suspended',
      nextBillingAt: controlRow.nextBillingAt,
    });

    // Paused, neither is billed; resumed, both continue from the period that begins then.
    await job.runDue(today);
    expect(await billedPeriods(legacy.id)).toHaveLength(1);
    for (const s of [legacy, control]) {
      expect((await admin.patch(`/services/${s.id}`, { status: 'active' })).statusCode).toBe(200);
    }
    await job.runDue(addMonths(endsAt, 1));
    const billed = (await billedPeriods(legacy.id)).map((b) => b.start);
    expect(billed).toEqual((await billedPeriods(control.id)).map((b) => b.start));
    expect(billed).not.toContain(addMonths(startsAt, 1));
    await job.endDue(addDays(endsAt, 1));
    expect((await load(legacy.id)).status).toBe('cancelled');
  });

  it('continues from a billing date set by hand before the cancellation: a pause resumed, free months', async () => {
    const orgId = await customer('resume-date-set');
    const startsAt = addMonths(today, -5);
    const resumed = await service(orgId, { startsAt, name: 'Pausiert und fortgesetzt' });
    const control = await service(orgId, { startsAt, name: 'Control' });
    const free = await service(orgId, { startsAt, name: 'Gratismonate' });
    await admin.post(`/billing/customers/${orgId}/invoices/generate`, { until: startsAt });
    // A resumed pause skips the paused periods (resumeBillingDate), three free months skip three.
    for (const s of [resumed, control]) {
      await admin.patch(`/services/${s.id}`, { status: 'suspended' });
      await admin.patch(`/services/${s.id}`, { status: 'active' });
    }
    const freeUntil = addMonths(startsAt, 4);
    await admin.patch(`/services/${free.id}`, { nextBillingAt: freeUntil });
    const endsAt = addMonths(today, 2);
    for (const s of [resumed, free]) await legacyCancel(s, endsAt);
    expect((await admin.post(`/services/${control.id}/cancel`, { endsAt })).statusCode).toBe(200);

    const a = await preview(resumed.id);
    expect(a.firstUnbilled).toBe((await load(control.id)).nextBillingAt);
    expect(a.missedPeriods).toEqual([]);
    const b = await preview(free.id);
    expect(b.firstUnbilled).toBe(freeUntil);
    expect(b.missedPeriods.map((m) => m.start)).toEqual(starts(startsAt, freeUntil, (d) => d < today));

    for (const s of [resumed, free]) {
      expect((await resume(s.id, { billFrom: 'missed', ...none })).statusCode).toBe(200);
    }
    await job.runDue(addMonths(endsAt, 1));
    const ctl = (await billedPeriods(control.id)).map((p) => p.start);
    expect((await billedPeriods(resumed.id)).map((p) => p.start)).toEqual(ctl);
    expect((await billedPeriods(free.id)).map((p) => p.start)).toEqual([
      startsAt,
      ...starts(startsAt, freeUntil, (d) => d <= endsAt),
    ]);
  });

  it('does not bill a period of a voided run invoice again, as the run would not', async () => {
    const orgId = await customer('resume-void-run');
    const startsAt = addMonths(today, -3);
    const svc = await service(orgId, { startsAt });
    const gen = json<{ invoice: InvoiceDetailDto }>(
      await admin.post(`/billing/customers/${orgId}/invoices/generate`, { until: addMonths(startsAt, 1) }),
    );
    expect((await admin.post(`/invoices/${gen.invoice.id}/finalize`, { send: false })).statusCode).toBe(200);
    expect(
      (await admin.post(`/invoices/${gen.invoice.id}/void`, { reason: 'Falsche Adresse' })).statusCode,
    ).toBe(200);
    // Reissued in the console's editor: lines without a service.
    const lines = gen.invoice.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    }));
    const reissued = json<InvoiceDetailDto>(
      await admin.post(`/billing/customers/${orgId}/invoices`, { lines }),
    );
    expect((await admin.post(`/invoices/${reissued.id}/finalize`, { send: false })).statusCode).toBe(200);
    await legacyCancel(svc, addMonths(today, 2));

    const p = await preview(svc.id);
    const third = addMonths(startsAt, 2);
    expect(p.firstUnbilled).toBe(third);
    expect(p.missedPeriods.map((m) => m.start)).toEqual(starts(startsAt, third, (d) => d < today));
    // Only invoices since the cancellation can hold periods the old cancellation left unbilled.
    expect(p.manualInvoices).toEqual([]);
    const later = json<InvoiceDetailDto>(await admin.post(`/billing/customers/${orgId}/invoices`, { lines }));
    expect((await preview(svc.id)).manualInvoices).toEqual([{ id: later.id, number: null }]);
    await admin.del(`/invoices/${later.id}`);

    await resume(svc.id, { billFrom: 'missed', ...none });
    await job.runDue(today);
    const open = await t.db
      .select({ start: invoiceLines.periodStart })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(and(eq(invoiceLines.serviceId, svc.id), ne(invoices.status, 'void')))
      .orderBy(invoiceLines.periodStart);
    expect(open.map((l) => l.start)).toEqual(starts(startsAt, third, (d) => d <= today));
  });

  it('bills a voided period again when the seller moved the billing date back for it before the cancellation', async () => {
    const orgId = await customer('resume-void-rebill');
    const startsAt = addMonths(today, -2);
    const svc = await service(orgId, { startsAt });
    const gen = json<{ invoice: InvoiceDetailDto }>(
      await admin.post(`/billing/customers/${orgId}/invoices/generate`, { until: startsAt }),
    );
    await admin.post(`/invoices/${gen.invoice.id}/finalize`, { send: false });
    await admin.post(`/invoices/${gen.invoice.id}/void`, { reason: 'Falscher Preis' });
    // So that the next run bills it again: the date set by hand is later than the voided invoice.
    expect((await admin.patch(`/services/${svc.id}`, { nextBillingAt: startsAt })).statusCode).toBe(200);
    await legacyCancel(svc, addMonths(today, 1));
    expect((await preview(svc.id)).firstUnbilled).toBe(startsAt);
  });
});

describe('seller change', () => {
  it('refuses to restore a service the previous seller sold, and lists it for nobody', async () => {
    const body = { billFrom: 'missed', ...none };
    // Moved by staff after the old cancellation, which a move did not count then.
    const moved = await customer('resume-moved');
    const a = await service(moved, { startsAt: addMonths(today, -1), name: 'Verkauft von der Plattform' });
    await legacyCancel(a, today);
    expect((await admin.patch(`/admin/orgs/${moved}`, { parentOrgId: ritaResellerId })).statusCode).toBe(200);
    await t.db
      .update(services)
      .set({ endsAt: addMonths(today, 3) })
      .where(eq(services.id, a.id));
    // Without a move in the audit log: a line on an invoice of the platform, a product of its catalog.
    const billedByPlatform = await customer('resume-moved-billed');
    const b = await service(billedByPlatform, { startsAt: addMonths(today, -1) });
    await admin.post(`/billing/customers/${billedByPlatform}/invoices/generate`, {});
    const cloud = (await t.db.query.products.findFirst({ where: eq(products.name, 'Cloud Server S') }))!;
    const fromCatalog = await customer('resume-moved-product');
    const c = await service(fromCatalog, { productId: cloud.id, startsAt: today });
    for (const [orgId, svc] of [
      [billedByPlatform, b],
      [fromCatalog, c],
    ] as const) {
      await legacyCancel(svc, addMonths(today, 3));
      await t.db
        .update(organizations)
        .set({ parentOrgId: ritaResellerId })
        .where(eq(organizations.id, orgId));
    }

    const ritas = json<EndedEarlyServiceDto[]>(
      await rita.get(`/orgs/${ritaResellerId}/reseller/services/ended-early`),
    );
    const staff = json<EndedEarlyServiceDto[]>(await admin.get('/admin/billing/services/ended-early'));
    for (const svc of [a, b, c]) {
      expect(ritas.map((s) => s.serviceId)).not.toContain(svc.id);
      expect(staff.map((s) => s.serviceId)).not.toContain(svc.id);
      const get = await rita.get(`/services/${svc.id}/resume`);
      expect(get.statusCode, svc.name).toBe(409);
      expect(json(get).error.details).toEqual({ reason: 'sellerChanged' });
      const post = await resume(svc.id, body, rita);
      expect(post.statusCode).toBe(409);
      expect(json(post).error.details).toEqual({ reason: 'sellerChanged' });
      expect((await load(svc.id)).status).toBe('cancelled');
    }
    // A service the reseller sold itself stays restorable, also after the customer went away and came back.
    const own = await service(ritaCustomerId, { name: 'Eigener Dienst', startsAt: today }, rita);
    await legacyCancel(own, addMonths(today, 3));
    expect((await rita.get(`/services/${own.id}/resume`)).statusCode).toBe(200);
    const back = await customer('resume-moved-back', ['servers'], ritaResellerId);
    const d = await service(back, { name: 'Hin und zurück', startsAt: today }, rita);
    await legacyCancel(d, today);
    for (const parentOrgId of [null, ritaResellerId]) {
      expect((await admin.patch(`/admin/orgs/${back}`, { parentOrgId })).statusCode).toBe(200);
    }
    await t.db
      .update(services)
      .set({ endsAt: addMonths(today, 3) })
      .where(eq(services.id, d.id));
    expect((await rita.get(`/services/${d.id}/resume`)).statusCode).toBe(200);
  });
});

describe('periods match the billing run', () => {
  const cases: {
    interval: 'monthly' | 'quarterly' | 'yearly';
    startsAt: string;
    billedUntil: string | null;
    endsAt: string;
  }[] = [
    { interval: 'monthly', startsAt: '2026-01-31', billedUntil: '2026-03-31', endsAt: '2027-02-27' },
    { interval: 'monthly', startsAt: '2026-05-31', billedUntil: null, endsAt: '2026-12-30' },
    { interval: 'monthly', startsAt: '2025-12-29', billedUntil: '2026-02-28', endsAt: '2027-03-01' },
    { interval: 'quarterly', startsAt: '2025-11-30', billedUntil: '2026-02-28', endsAt: '2027-01-15' },
    { interval: 'quarterly', startsAt: '2026-08-31', billedUntil: null, endsAt: '2026-12-31' },
    { interval: 'yearly', startsAt: '2024-02-29', billedUntil: '2025-02-28', endsAt: '2027-02-28' },
    { interval: 'yearly', startsAt: '2025-11-30', billedUntil: null, endsAt: addDays(today, 1) },
  ];
  for (const c of cases) {
    it(`${c.interval} from ${c.startsAt}, billed until ${c.billedUntil ?? 'never'}, ending ${c.endsAt}`, async () => {
      const orgId = await customer(`resume-run-${c.interval}-${c.startsAt}-${c.billedUntil ?? 'none'}`);
      const fields = { startsAt: c.startsAt, interval: c.interval, unitPrice: 1234, quantity: 1.5 };
      const missed = await service(orgId, fields);
      const next = await service(orgId, { ...fields, name: 'Next' });
      if (c.billedUntil)
        await admin.post(`/billing/customers/${orgId}/invoices/generate`, { until: c.billedUntil });
      const before = {
        missed: (await billedPeriods(missed.id)).length,
        next: (await billedPeriods(next.id)).length,
      };
      for (const s of [missed, next]) await legacyCancel(s, c.endsAt);
      const pm = await preview(missed.id);
      const pn = await preview(next.id);
      expect((await resume(missed.id, { billFrom: 'missed', ...none })).statusCode).toBe(200);
      expect((await resume(next.id, { billFrom: 'next', ...none })).statusCode).toBe(200);
      // Like the daily job: a run every week up to after the end date, then the end step.
      for (let d = today; d <= addDays(c.endsAt, 1); d = addDays(d, 7)) await job.runDue(d);
      await job.runDue(addDays(c.endsAt, 1));
      await job.endDue(addDays(c.endsAt, 1));
      const lines = async (id: string, skip: number) =>
        (
          await t.db
            .select({
              start: invoiceLines.periodStart,
              end: invoiceLines.periodEnd,
              amount: invoiceLines.total,
            })
            .from(invoiceLines)
            .where(eq(invoiceLines.serviceId, id))
            .orderBy(invoiceLines.periodStart)
        ).slice(skip);
      // Exactly what the preview said: the missed periods and the upcoming ones, the last trimmed to the end date.
      expect(await lines(missed.id, before.missed)).toEqual([...pm.missedPeriods, ...pm.upcomingPeriods]);
      expect(await lines(next.id, before.next)).toEqual(pn.upcomingPeriods);
      expect(pm.upcomingPeriods).toEqual(pn.upcomingPeriods);
      const all = periodStarts(c.startsAt, pm.firstUnbilled, c.interval, (d) => d <= c.endsAt);
      expect([...pm.missedPeriods, ...pm.upcomingPeriods].map((p) => p.start)).toEqual(all);
      expect((await load(missed.id)).status).toBe('cancelled');
      expect((await load(next.id)).status).toBe('cancelled');
    });
  }
});
