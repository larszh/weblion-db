import { describe, expect, it } from 'vitest';
import type { ServiceDto } from '@weblion/shared';
import { endPassed, fullPeriodAhead, servicesKeepingModule, waitsForBilling } from './service-end';

/** The rules of a scheduled cancellation as the pages apply them, the same as the API's. */

const today = '2026-11-06';

const service = (patch: Partial<ServiceDto> = {}): ServiceDto => ({
  id: 'a6d4b1a0-0000-4000-8000-000000000001',
  orgId: 'a6d4b1a0-0000-4000-8000-000000000002',
  product: null,
  name: 'DNS S',
  description: null,
  module: 'dns',
  resource: null,
  unitPrice: 5000,
  quantity: 1,
  currency: 'CHF',
  interval: 'monthly',
  taxRateBp: null,
  status: 'active',
  startsAt: '2026-08-31',
  nextBillingAt: '2026-11-30',
  endsAt: null,
  cancelledAt: null,
  deactivateModuleAtEnd: false,
  notes: null,
  createdAt: '2026-08-31T08:00:00.000Z',
  ...patch,
});

describe('servicesKeepingModule', () => {
  it('lists the other running services with the same module', () => {
    const own = service();
    const next = service({ id: 'b2', name: 'DNS M', startsAt: '2026-11-27' });
    const paused = service({ id: 'b3', name: 'DNS Paused', status: 'suspended' });
    const endsLater = service({ id: 'b4', name: 'DNS Later', endsAt: today });
    const all = [
      own,
      next,
      paused,
      endsLater,
      service({ id: 'c1', name: 'Ended', status: 'cancelled', endsAt: '2026-10-01' }),
      service({ id: 'c2', name: 'Passed', endsAt: '2026-11-05' }),
      service({ id: 'c3', name: 'Mail', module: 'mail' }),
      service({ id: 'c4', name: 'No module', module: null }),
    ];
    expect(servicesKeepingModule(own, all, today).map((s) => s.name)).toEqual([
      'DNS M',
      'DNS Paused',
      'DNS Later',
    ]);
    expect(servicesKeepingModule(service({ module: null }), all, today)).toEqual([]);
  });
});

describe('endPassed and waitsForBilling', () => {
  it('can be changed until the end date, and waits for billing only with a period up to it open', () => {
    const scheduled = service({ endsAt: '2026-11-26', nextBillingAt: '2026-11-01' });
    expect(endPassed(scheduled, '2026-11-26')).toBe(false);
    expect(endPassed(scheduled, '2026-11-27')).toBe(true);
    expect(waitsForBilling(scheduled, '2026-11-26')).toBe(false);
    expect(waitsForBilling(scheduled, '2026-11-27')).toBe(true);
    // Billed up to the end date, paused (not billed) or without a cancellation: nothing to wait for.
    expect(waitsForBilling({ ...scheduled, nextBillingAt: '2026-12-01' }, '2026-11-27')).toBe(false);
    expect(waitsForBilling({ ...scheduled, status: 'suspended' }, '2026-11-27')).toBe(false);
    expect(endPassed(service(), '2026-11-27')).toBe(false);
    // An ended service is not a scheduled cancellation any more.
    expect(endPassed(service({ status: 'cancelled', endsAt: '2026-11-01' }), '2026-11-27')).toBe(false);
  });
});

describe('fullPeriodAhead', () => {
  it('names the period an end on or after the next billing date still bills in full', () => {
    // Anchored on the 31st: the November period starts on 30 November, "end of November" bills it.
    const monthly = service();
    expect(fullPeriodAhead(monthly, '2026-11-30', today)).toEqual({
      from: '2026-11-30',
      endBefore: '2026-11-29',
    });
    // Before the next period, today (an immediate end) or nothing to bill: no notice.
    expect(fullPeriodAhead(monthly, '2026-11-29', today)).toBeNull();
    expect(fullPeriodAhead({ ...monthly, nextBillingAt: '2026-11-06' }, today, today)).toBeNull();
    expect(fullPeriodAhead({ ...monthly, status: 'suspended' }, '2026-12-15', today)).toBeNull();
    expect(fullPeriodAhead({ ...monthly, interval: 'once' }, '2026-12-15', today)).toBeNull();
    expect(fullPeriodAhead({ ...monthly, nextBillingAt: null }, '2026-12-15', today)).toBeNull();
    expect(fullPeriodAhead(monthly, '', today)).toBeNull();
  });

  it('names the last period that starts on or before the end date, not the next one', () => {
    // Monthly from 01.12.2026: the run bills 01.12, 01.01 and so on up to the end date.
    const monthly = service({ startsAt: '2026-06-01', nextBillingAt: '2026-12-01' });
    expect(fullPeriodAhead(monthly, '2026-12-15', today)).toEqual({
      from: '2026-12-01',
      endBefore: '2026-11-30',
    });
    expect(fullPeriodAhead(monthly, '2027-01-15', today)).toEqual({
      from: '2027-01-01',
      endBefore: '2026-12-31',
    });
    // On the last day of a period nothing is paid for unused time.
    expect(fullPeriodAhead(monthly, '2027-03-31', today)).toBeNull();
    expect(fullPeriodAhead(monthly, '2026-12-31', today)).toBeNull();
    expect(fullPeriodAhead(monthly, '2027-04-01', today)).toEqual({
      from: '2027-04-01',
      endBefore: '2027-03-31',
    });
    // Anchored on the 31st: the periods start on 30.11, 31.12, 31.01, 28.02 and 31.03.
    const anchored = service();
    expect(fullPeriodAhead(anchored, '2027-03-01', today)).toEqual({
      from: '2027-02-28',
      endBefore: '2027-02-27',
    });
    expect(fullPeriodAhead(anchored, '2027-03-30', today)).toBeNull();
    // A quarter from 01.12.2026 runs to 28.02.2027.
    const quarterly = service({ interval: 'quarterly', startsAt: '2026-09-01', nextBillingAt: '2026-12-01' });
    expect(fullPeriodAhead(quarterly, '2027-02-28', today)).toBeNull();
    expect(fullPeriodAhead(quarterly, '2027-03-15', today)).toEqual({
      from: '2027-03-01',
      endBefore: '2027-02-28',
    });
  });

  it('offers the end before the period only while that day is not past', () => {
    const yearly = service({ interval: 'yearly', nextBillingAt: '2026-11-16' });
    expect(fullPeriodAhead(yearly, '2026-12-02', '2026-11-15')).toEqual({
      from: '2026-11-16',
      endBefore: '2026-11-15',
    });
    // The period has begun and is due: it is billed in any case.
    expect(fullPeriodAhead(yearly, '2026-12-02', '2026-11-20')).toEqual({
      from: '2026-11-16',
      endBefore: null,
    });
  });
});
