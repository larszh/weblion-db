import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  type InvoiceDetailDto,
  type ModuleKey,
  type ServiceDto,
} from '@weblion/shared';
import { auditLogs, invoiceLines, organizations, services, settings } from '../src/db/schema';
import { addDays, addMonths, todayZurich } from '../src/modules/billing/dates';
import { BillingJob } from '../src/modules/billing/recurring';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

/**
 * Cancellations with an end date after today (scheduled): the service keeps running and is billed up
 * to the end date, the daily job ends it afterwards and only then switches its module off.
 */

let t: TestApp;
let admin: Client;
let anna: Client;
let reto: Client;
let job: BillingJob;
let huberId: string;

const today = todayZurich();
type Generated = { invoice: InvoiceDetailDto | null };

/** A platform customer of its own, so a test can bill and end without touching the others. */
async function customer(slug: string, modules: ModuleKey[] = ['servers']) {
  const [org] = await t.db
    .insert(organizations)
    .values({
      name: slug,
      slug,
      kind: 'customer',
      boundary: DEFAULT_CUSTOMER_BOUNDARY,
      modules,
    })
    .returning();
  return org!.id;
}

async function service(orgId: string, extra: Record<string, unknown> = {}) {
  const res = await admin.post(`/billing/customers/${orgId}/services`, {
    name: 'Managed Server',
    unitPrice: 1000,
    interval: 'monthly',
    startsAt: addMonths(today, -1),
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<ServiceDto>(res);
}

async function cancel(id: string, body: Record<string, unknown>, client = admin) {
  return client.post(`/services/${id}/cancel`, body);
}

async function load(id: string) {
  return (await t.db.query.services.findFirst({ where: eq(services.id, id) }))!;
}

async function modulesOf(orgId: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }))!.modules;
}

async function generate(orgId: string, until: string) {
  const res = await admin.post(`/billing/customers/${orgId}/invoices/generate`, { until });
  expect(res.statusCode, res.body).toBe(200);
  return json<Generated>(res).invoice;
}

/** Period starts billed for a service, over all invoices. */
async function billedPeriods(serviceId: string) {
  const rows = await t.db
    .select({ start: invoiceLines.periodStart, end: invoiceLines.periodEnd })
    .from(invoiceLines)
    .where(eq(invoiceLines.serviceId, serviceId))
    .orderBy(invoiceLines.periodStart);
  return rows;
}

async function audits(serviceId: string, action: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.resourceId, serviceId), eq(auditLogs.action, action)))
    .orderBy(desc(auditLogs.id));
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  reto = new Client(t.app);
  await reto.login('reseller@alpen.example');
  huberId = (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, 'baeckerei-huber') }))!
    .id;
  job = new BillingJob(t.ctx, null as never);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.close();
});

describe('immediate cancellation', () => {
  it('ends the service at once without a date, with today or with a date in the past', async () => {
    const orgId = await customer('cancel-now', ['servers', 'dns']);
    const now = await service(orgId, { module: 'dns', activateModule: false });
    const ended = json<ServiceDto>(await cancel(now.id, { deactivateModule: true }));
    expect(ended).toMatchObject({ status: 'cancelled', nextBillingAt: null, endsAt: today });
    expect(ended.cancelledAt).not.toBeNull();
    expect(ended.deactivateModuleAtEnd).toBe(false);
    expect(await modulesOf(orgId)).toEqual(['servers']);

    const withToday = await service(orgId);
    expect(json<ServiceDto>(await cancel(withToday.id, { endsAt: today }))).toMatchObject({
      status: 'cancelled',
      nextBillingAt: null,
      endsAt: today,
    });
    const past = await service(orgId);
    const yesterday = addDays(today, -1);
    expect(json<ServiceDto>(await cancel(past.id, { endsAt: yesterday }))).toMatchObject({
      status: 'cancelled',
      nextBillingAt: null,
      endsAt: yesterday,
    });

    const [entry] = await audits(now.id, 'service.cancel');
    expect(entry!.details).toMatchObject({ endsAt: today, scheduled: false, moduleDeactivated: 'dns' });
  });

  it('answers 409 on a service that has ended', async () => {
    const orgId = await customer('cancel-twice');
    const svc = await service(orgId);
    expect((await cancel(svc.id, {})).statusCode).toBe(200);
    expect((await cancel(svc.id, {})).statusCode).toBe(409);
    expect((await cancel(svc.id, { endsAt: addMonths(today, 1) })).statusCode).toBe(409);
    expect((await admin.post(`/services/${svc.id}/cancel/withdraw`)).statusCode).toBe(409);
  });
});

describe('scheduled cancellation', () => {
  it('keeps the service running and bills every period up to the end date, none after', async () => {
    const orgId = await customer('cancel-later');
    const startsAt = addMonths(today, -1);
    const svc = await service(orgId, { startsAt });
    // Periods start on startsAt, +1 and +2 months up to the end date; +3 months is after it.
    const endsAt = addDays(addMonths(startsAt, 2), 5);
    const scheduled = json<ServiceDto>(await cancel(svc.id, { endsAt }));
    expect(scheduled).toMatchObject({ status: 'active', nextBillingAt: startsAt, endsAt });
    expect(scheduled.cancelledAt).not.toBeNull();

    const invoice = await generate(orgId, addMonths(startsAt, 12));
    expect(invoice).not.toBeNull();
    const periods = await billedPeriods(svc.id);
    expect(periods.map((p) => p.start)).toEqual([startsAt, addMonths(startsAt, 1), addMonths(startsAt, 2)]);
    // The last period ends on the end date.
    expect(periods.at(-1)!.end).toBe(endsAt);
    // The billing date stays on the period after the end (so a withdrawal continues there), not billed.
    const after = await load(svc.id);
    expect([after.status, after.nextBillingAt]).toEqual(['active', addMonths(startsAt, 3)]);
    expect(await generate(orgId, addMonths(startsAt, 12))).toBeNull();
    // The daily job finds nothing due either.
    const run = await job.runDue(addMonths(startsAt, 12));
    expect(run.failed).toBe(0);
    expect((await billedPeriods(svc.id)).length).toBe(3);
  });

  it('keeps the module until the end step, which switches it off and audits the end', async () => {
    const orgId = await customer('cancel-module', ['servers', 'dns']);
    const svc = await service(orgId, { module: 'dns', startsAt: today });
    const endsAt = addDays(today, 20);
    const scheduled = json<ServiceDto>(await cancel(svc.id, { endsAt, deactivateModule: true }));
    expect(scheduled).toMatchObject({ status: 'active', endsAt, deactivateModuleAtEnd: true });
    expect(await modulesOf(orgId)).toEqual(['servers', 'dns']);
    const [entry] = await audits(svc.id, 'service.cancel');
    expect(entry!.details).toMatchObject({ endsAt, scheduled: true, moduleDeactivatedAtEnd: 'dns' });

    // On the end date itself the service still runs.
    await job.runDue(endsAt);
    await job.endDue(endsAt);
    expect((await load(svc.id)).status).toBe('active');
    expect(await modulesOf(orgId)).toEqual(['servers', 'dns']);

    const dayAfter = addDays(endsAt, 1);
    await job.runDue(dayAfter);
    const result = await job.endDue(dayAfter);
    expect(result.failed).toBe(0);
    const ended = await load(svc.id);
    expect(ended).toMatchObject({
      status: 'cancelled',
      nextBillingAt: null,
      endsAt,
      deactivateModuleAtEnd: false,
    });
    expect(await modulesOf(orgId)).toEqual(['servers']);
    expect((await billedPeriods(svc.id)).map((p) => p.start)).toEqual([today]);

    const [end] = await audits(svc.id, 'service.end');
    expect(end).toMatchObject({ actorName: 'Abrechnungsjob', actorUserId: null, orgId, status: 'success' });
    expect(end!.details).toEqual({ endsAt, moduleDeactivated: 'dns' });
    // Ending happens once.
    await job.endDue(addDays(endsAt, 2));
    expect(await audits(svc.id, 'service.end')).toHaveLength(1);
  });

  it('does not end an active service before its last period up to the end date is billed', async () => {
    const orgId = await customer('cancel-unbilled');
    const startsAt = addMonths(today, -2);
    const svc = await service(orgId, { startsAt });
    const endsAt = addDays(today, 3);
    await cancel(svc.id, { endsAt });
    const dayAfter = addDays(endsAt, 1);

    // Invoicing off: the end step alone leaves it running with its periods due.
    await job.endDue(dayAfter);
    expect((await load(svc.id)).status).toBe('active');
    expect(await billedPeriods(svc.id)).toHaveLength(0);

    // A billing run first, then the end step.
    await job.runDue(dayAfter);
    expect((await billedPeriods(svc.id)).map((p) => p.start)).toEqual([
      startsAt,
      addMonths(startsAt, 1),
      addMonths(startsAt, 2),
    ]);
    await job.endDue(dayAfter);
    expect(await load(svc.id)).toMatchObject({ status: 'cancelled', nextBillingAt: null });
  });

  it('ends a paused service at its date without billing the paused periods', async () => {
    const orgId = await customer('cancel-paused');
    const svc = await service(orgId, { startsAt: addMonths(today, -2) });
    expect((await admin.patch(`/services/${svc.id}`, { status: 'suspended' })).statusCode).toBe(200);
    const endsAt = addDays(today, 10);
    expect(json<ServiceDto>(await cancel(svc.id, { endsAt }))).toMatchObject({ status: 'suspended', endsAt });

    await job.runDue(addDays(endsAt, 1));
    await job.endDue(endsAt);
    expect((await load(svc.id)).status).toBe('suspended');
    await job.endDue(addDays(endsAt, 1));
    expect(await load(svc.id)).toMatchObject({ status: 'cancelled', nextBillingAt: null });
    expect(await billedPeriods(svc.id)).toHaveLength(0);
  });

  it('changes the date when cancelled again, and ends the service with today', async () => {
    const orgId = await customer('cancel-change', ['servers', 'dns']);
    const svc = await service(orgId, { module: 'dns', startsAt: today });
    const first = addDays(today, 30);
    const second = addDays(today, 60);
    await cancel(svc.id, { endsAt: first, deactivateModule: true });
    const changed = json<ServiceDto>(await cancel(svc.id, { endsAt: second }));
    expect(changed).toMatchObject({ status: 'active', endsAt: second, deactivateModuleAtEnd: false });
    const [entry] = await audits(svc.id, 'service.cancel');
    expect(entry!.details).toMatchObject({ endsAt: second, scheduled: true, previousEndsAt: first });

    const now = json<ServiceDto>(await cancel(svc.id, { endsAt: today, deactivateModule: true }));
    expect(now).toMatchObject({ status: 'cancelled', nextBillingAt: null, endsAt: today });
    expect(await modulesOf(orgId)).toEqual(['servers']);
  });

  it('can be withdrawn while the service runs, and billing continues after the old end date', async () => {
    const orgId = await customer('cancel-withdraw', ['servers', 'dns']);
    const startsAt = addMonths(today, -1);
    const svc = await service(orgId, { module: 'dns', startsAt });
    const endsAt = addDays(addMonths(startsAt, 1), 3);
    await cancel(svc.id, { endsAt, deactivateModule: true });
    // Billed ahead up to the end date: the billing date stays on the period after it.
    await generate(orgId, addMonths(startsAt, 6));
    expect((await billedPeriods(svc.id)).map((p) => p.start)).toEqual([startsAt, addMonths(startsAt, 1)]);

    const res = await admin.post(`/services/${svc.id}/cancel/withdraw`);
    expect(res.statusCode, res.body).toBe(200);
    expect(json<ServiceDto>(res)).toMatchObject({
      status: 'active',
      endsAt: null,
      cancelledAt: null,
      deactivateModuleAtEnd: false,
      nextBillingAt: addMonths(startsAt, 2),
    });
    const [entry] = await audits(svc.id, 'service.cancel_withdraw');
    expect(entry!.details).toEqual({ endsAt });
    expect((await admin.post(`/services/${svc.id}/cancel/withdraw`)).statusCode).toBe(409);

    await generate(orgId, addMonths(startsAt, 3));
    expect((await billedPeriods(svc.id)).map((p) => p.start)).toEqual([
      startsAt,
      addMonths(startsAt, 1),
      addMonths(startsAt, 2),
      addMonths(startsAt, 3),
    ]);
    // The end step leaves it alone and the module stays.
    await job.endDue(addMonths(startsAt, 6));
    expect((await load(svc.id)).status).toBe('active');
    expect(await modulesOf(orgId)).toEqual(['servers', 'dns']);
  });

  it('cannot be withdrawn once the end date has passed', async () => {
    const orgId = await customer('cancel-passed');
    const svc = await service(orgId);
    await cancel(svc.id, { endsAt: addDays(today, 5) });
    // As if the end date had passed and the daily job not yet ended it.
    await t.db
      .update(services)
      .set({ endsAt: addDays(today, -1) })
      .where(eq(services.id, svc.id));
    expect((await admin.post(`/services/${svc.id}/cancel/withdraw`)).statusCode).toBe(409);
  });

  it('lets only the seller cancel and withdraw', async () => {
    const platformService = await service(await customer('cancel-perms'));
    await cancel(platformService.id, { endsAt: addDays(today, 30) });
    // The customer and another seller: the same answer from both routes.
    const muster = (await t.db.query.organizations.findFirst({
      where: eq(organizations.slug, 'muster-ag'),
    }))!;
    const own = await service(muster.id);
    await cancel(own.id, { endsAt: addDays(today, 30) });
    for (const [client, id] of [
      [anna, own.id],
      [reto, platformService.id],
    ] as const) {
      const cancelRes = await cancel(id, { endsAt: addDays(today, 40) }, client);
      const withdrawRes = await client.post(`/services/${id}/cancel/withdraw`);
      expect([403, 404]).toContain(cancelRes.statusCode);
      expect(withdrawRes.statusCode).toBe(cancelRes.statusCode);
    }
    expect((await load(own.id)).endsAt).toBe(addDays(today, 30));

    // A reseller manages its own customer's services.
    const res = await reto.post(`/billing/customers/${huberId}/services`, {
      name: 'DNS',
      unitPrice: 500,
      interval: 'yearly',
    });
    expect(res.statusCode, res.body).toBe(200);
    const huberService = json<ServiceDto>(res);
    expect((await cancel(huberService.id, { endsAt: addDays(today, 30) }, reto)).statusCode).toBe(200);
    expect((await reto.post(`/services/${huberService.id}/cancel/withdraw`)).statusCode).toBe(200);
    await cancel(own.id, {});
  });
});

describe('daily job', () => {
  it('bills first and then ends services, and still ends them with invoicing off', async () => {
    const pool = (t.db as unknown as { $client: import('pg').Pool }).$client;
    const reset = () =>
      t.db.delete(settings).where(inArray(settings.key, ['billing_job', 'billing_end_job']));

    await reset();
    const off = new BillingJob(t.ctx, pool, { invoicing: false });
    const offRun = vi.spyOn(off, 'runDue');
    const offEnd = vi.spyOn(off, 'endDue');
    await off.tick();
    await off.tick();
    expect(offRun).not.toHaveBeenCalled();
    expect(offEnd).toHaveBeenCalledTimes(1);
    // A process without invoicing must not mark the billing run of the day as done.
    expect(await t.db.query.settings.findFirst({ where: eq(settings.key, 'billing_job') })).toBeUndefined();

    await reset();
    const on = new BillingJob(t.ctx, pool);
    const runDue = vi.spyOn(on, 'runDue');
    const endDue = vi.spyOn(on, 'endDue');
    await Promise.all([on.tick(), on.tick()]);
    await on.tick();
    expect(runDue).toHaveBeenCalledTimes(1);
    expect(endDue).toHaveBeenCalledTimes(1);
    expect(runDue.mock.invocationCallOrder[0]!).toBeLessThan(endDue.mock.invocationCallOrder[0]!);
    const state = await t.db.query.settings.findFirst({ where: eq(settings.key, 'billing_end_job') });
    expect(state?.value).toMatchObject({ lastRun: today, failed: 0 });
  });
});
