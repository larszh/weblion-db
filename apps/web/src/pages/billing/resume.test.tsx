import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { formatMoney, type ServiceDto, type ServiceResumePreviewDto } from '@weblion/shared';
import { en } from '@weblion/shared/i18n/en';
import { ApiError } from '@/lib/api';
import { TooltipProvider } from '@/components/ui/menu';
import { withI18n } from '@/test/i18n';
import { EndedEarlyList } from './ended-early';
import { formatDay } from './money';
import { ResumeServiceForm } from './seller-dialogs';
import {
  billsFromNext,
  endedEarly,
  resumeBilling,
  resumeBody,
  resumeDefaults,
  resumeRefusal,
  resumeSwitches,
} from './service-end';
import { ServiceTable } from './tables';

/**
 * Restoring a service a cancellation to a later date ended at once (until November 2026): the defaults and
 * choices of the dialog, the mark in the seller's service table and the card of the overviews. Rendered on the
 * server like the other billing tests; English is the test's locale.
 */

const html = (node: ReactNode) =>
  renderToStaticMarkup(
    withI18n(
      <MemoryRouter>
        <TooltipProvider>{node}</TooltipProvider>
      </MemoryRouter>,
      'en',
    ),
  );
const text = (key: keyof typeof en, values: Record<string, string> = {}) =>
  Object.entries(values)
    .reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), en[key])
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
/** The value of the checked radio button, whatever the attribute order. */
const checkedRadio = (markup: string) =>
  [...markup.matchAll(/<input type="radio"[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('checked=""'))
    .map((tag) => /value="(\w+)"/.exec(tag)?.[1]);
const chf = (amount: number) => formatMoney(amount, 'CHF', 'en');
const day = (date: string) => formatDay(date, 'en');

const today = '2026-11-07';

const preview = (patch: Partial<ServiceResumePreviewDto> = {}): ServiceResumePreviewDto => ({
  serviceId: 'a6d4b1a0-0000-4000-8000-000000000001',
  name: 'DNS S',
  startsAt: '2026-09-01',
  endsAt: '2026-12-31',
  cancelledAt: '2026-10-02T08:00:00.000Z',
  currency: 'CHF',
  interval: 'monthly',
  firstUnbilled: '2026-10-01',
  pausedBeforeCancel: false,
  missedPeriods: [
    { start: '2026-10-01', end: '2026-10-31', amount: 5000 },
    { start: '2026-11-01', end: '2026-11-30', amount: 5000 },
  ],
  missedTotal: 10000,
  nextFromToday: '2026-12-01',
  upcomingPeriods: [{ start: '2026-12-01', end: '2026-12-31', amount: 5000 }],
  upcomingTotal: 5000,
  periodAmount: 5000,
  module: 'dns',
  moduleActive: true,
  moduleDeactivatedByCancel: false,
  sellerHasModule: true,
  manualInvoices: [],
  ...patch,
});

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
  status: 'cancelled',
  startsAt: '2026-09-01',
  nextBillingAt: null,
  endsAt: '2026-12-31',
  cancelledAt: '2026-10-02T08:00:00.000Z',
  deactivateModuleAtEnd: false,
  notes: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  ...patch,
});

describe('resume defaults and body', () => {
  it('bills the missed periods when the module stayed on, as the customer kept using the service', () => {
    expect(resumeDefaults(preview())).toEqual({
      billFrom: 'missed',
      activateModule: false,
      deactivateModuleAtEnd: false,
    });
  });

  it('bills only from the next period and brings the module back when the cancellation switched it off', () => {
    expect(resumeDefaults(preview({ moduleActive: false, moduleDeactivatedByCancel: true }))).toEqual({
      billFrom: 'next',
      activateModule: true,
      deactivateModuleAtEnd: true,
    });
    // A reseller without the module cannot switch it on again: the switch starts off.
    expect(
      resumeDefaults(
        preview({ moduleActive: false, moduleDeactivatedByCancel: true, sellerHasModule: false }),
      ),
    ).toEqual({ billFrom: 'next', activateModule: false, deactivateModuleAtEnd: true });
  });

  it('bills the missed periods when the module switched off by the cancellation is on again', () => {
    // Someone switched it on by hand (or another service did): the customer could use the service unbilled.
    expect(resumeDefaults(preview({ moduleActive: true, moduleDeactivatedByCancel: true }))).toEqual({
      billFrom: 'missed',
      activateModule: false,
      deactivateModuleAtEnd: true,
    });
  });

  it('sends only the choices the dialog shows', () => {
    const all = { billFrom: 'next', activateModule: true, deactivateModuleAtEnd: true } as const;
    // The module is on: nothing to switch on.
    expect(resumeBody(preview(), all)).toEqual({ ...all, activateModule: false });
    // No module: neither switch.
    expect(resumeBody(preview({ module: null, moduleActive: false }), all)).toEqual({
      billFrom: 'next',
      activateModule: false,
      deactivateModuleAtEnd: false,
    });
    // No missed periods: both choices give the same date.
    expect(resumeBody(preview({ missedPeriods: [], missedTotal: 0 }), all).billFrom).toBe('missed');
    expect(resumeSwitches(preview({ moduleActive: false }))).toEqual({
      activate: true,
      canActivate: true,
      deactivateAtEnd: true,
    });
    // A module the seller does not have: never sent, the API would refuse the whole restore.
    expect(resumeBody(preview({ moduleActive: false, sellerHasModule: false }), all).activateModule).toBe(
      false,
    );
    // Paused at the cancellation: restored paused with its own date, the choice has no effect.
    expect(resumeBody(preview({ pausedBeforeCancel: true }), all).billFrom).toBe('missed');
  });

  it('sums what the run bills up to the end date with each choice', () => {
    expect(resumeBilling(preview(), 'missed')).toEqual({
      total: 15000,
      from: '2026-10-01',
      to: '2026-12-31',
      fullPeriod: null,
    });
    expect(resumeBilling(preview(), 'next')).toEqual({
      total: 5000,
      from: '2026-12-01',
      to: '2026-12-31',
      fullPeriod: null,
    });
    // The end date cuts the last period short, which the run bills in full.
    const cut = preview({
      endsAt: '2026-12-20',
      upcomingPeriods: [{ start: '2026-12-01', end: '2026-12-20', amount: 5000 }],
    });
    expect(resumeBilling(cut, 'next')?.fullPeriod).toEqual({ from: '2026-12-01', price: 5000 });
    // Nothing left with "next" when no period begins up to the end date.
    expect(resumeBilling(preview({ upcomingPeriods: [], upcomingTotal: 0 }), 'next')).toEqual({
      total: 0,
      from: null,
      to: null,
      fullPeriod: null,
    });
    expect(resumeBilling(preview({ pausedBeforeCancel: true }), 'missed')).toBeNull();
    expect(resumeBilling(preview({ interval: 'once' }), 'missed')).toBeNull();
  });

  it('tells the reasons of a refusal apart from other errors', () => {
    expect(resumeRefusal(new ApiError(409, 'conflict', 'x', { reason: 'sellerChanged' }))).toBe(
      'sellerChanged',
    );
    expect(resumeRefusal(new ApiError(409, 'conflict', 'x', { reason: 'notEndedEarly' }))).toBe(
      'notEndedEarly',
    );
    expect(resumeRefusal(new ApiError(409, 'conflict', 'The reseller does not have the module'))).toBeNull();
    expect(resumeRefusal(new ApiError(403, 'forbidden', 'x', { reason: 'sellerChanged' }))).toBeNull();
    expect(resumeRefusal(new TypeError('offline'))).toBeNull();
  });

  it('knows when no period begins between today and the end date', () => {
    expect(billsFromNext(preview())).toBe(true);
    expect(billsFromNext(preview({ endsAt: '2026-11-20', nextFromToday: '2026-12-01' }))).toBe(false);
    expect(billsFromNext(preview({ nextFromToday: null }))).toBe(false);
  });

  it('marks only a cancelled service with an end date after today', () => {
    expect(endedEarly(service(), today)).toBe(true);
    expect(endedEarly(service({ endsAt: today }), today)).toBe(false);
    expect(endedEarly(service({ status: 'active' }), today)).toBe(false);
    expect(endedEarly(service({ endsAt: null }), today)).toBe(false);
  });
});

describe('ResumeServiceForm', () => {
  const render = (p: ServiceResumePreviewDto, keeping: ServiceDto[] = []) =>
    html(<ResumeServiceForm preview={p} value={resumeDefaults(p)} onChange={() => {}} keeping={keeping} />);

  it('lists the missed periods with their amounts and total and checks "bill retroactively"', () => {
    const markup = render(preview());
    // The explanation scrolls with the body, it is not in the dialog's fixed header.
    expect(markup).toContain(text('billing.service.restoreText', { date: day('2026-12-31') }));
    expect(markup).toContain(text('billing.service.restoreMissed'));
    expect(markup).toContain(text('billing.service.restoreTotal'));
    // What the choice bills up to the end date: the missed periods and December.
    expect(markup).toContain(
      text('billing.service.restoreBilled', {
        start: day('2026-10-01'),
        end: day('2026-12-31'),
        total: chf(15000),
      }),
    );
    expect(markup).toContain(
      text('billing.service.restorePeriod', { start: day('2026-10-01'), end: day('2026-10-31') }),
    );
    expect(markup).toContain(chf(5000));
    expect(markup).toContain(chf(10000));
    expect(checkedRadio(markup)).toEqual(['missed']);
    expect(markup).toContain(text('billing.service.restoreBillNext', { date: day('2026-12-01') }));
    // The module is on: only the switch for the end date, off by default.
    expect(markup).not.toContain(text('billing.service.restoreActivateModule').split('{')[0]!);
    expect(markup).toContain(text('billing.service.restoreDeactivateAtEnd').split('{')[0]!);
    expect(markup.match(/role="switch"/g)).toHaveLength(1);
    expect(markup).toContain('aria-checked="false"');
  });

  it('checks "only from the next period" and both module switches when the module was switched off', () => {
    const markup = render(preview({ moduleActive: false, moduleDeactivatedByCancel: true }));
    expect(checkedRadio(markup)).toEqual(['next']);
    expect(markup).toContain(text('billing.service.restoreActivateModule').split('{')[0]!);
    expect(markup.match(/role="switch"/g)).toHaveLength(2);
    expect(markup).not.toContain('aria-checked="false"');
    expect(markup).toContain(
      text('billing.service.restoreBilled', {
        start: day('2026-12-01'),
        end: day('2026-12-31'),
        total: chf(5000),
      }),
    );
  });

  it('disables switching the module on when the seller does not have it', () => {
    const markup = render(
      preview({ moduleActive: false, moduleDeactivatedByCancel: true, sellerHasModule: false }),
    );
    expect(markup).toContain(text('billing.service.restoreModuleMissing', { module: 'Domains & DNS' }));
    expect(markup).not.toContain(text('billing.service.activateModuleHint'));
    const activate = [...markup.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((m) => m[0]);
    expect(activate[0]).toContain('disabled=""');
    expect(activate[0]).toContain('aria-checked="false"');
  });

  it('says when the module switched off by the cancellation is on again', () => {
    const markup = render(preview({ moduleActive: true, moduleDeactivatedByCancel: true }));
    expect(markup).toContain(text('billing.service.restoreModuleBackOn', { module: 'Domains & DNS' }));
    expect(checkedRadio(markup)).toEqual(['missed']);
  });

  it('restores a service paused at the cancellation paused, without a choice', () => {
    const markup = render(
      preview({
        pausedBeforeCancel: true,
        missedPeriods: [],
        missedTotal: 0,
        upcomingPeriods: [],
        upcomingTotal: 0,
      }),
    );
    expect(markup).toContain(text('billing.service.restorePaused'));
    expect(markup).not.toContain('type="radio"');
    expect(markup).not.toContain(text('billing.service.restoreBilledNothing'));
  });

  it('warns of invoices with lines not linked to a service since the cancellation, and of a full last period', () => {
    const markup = render(
      preview({
        endsAt: '2026-12-20',
        upcomingPeriods: [{ start: '2026-12-01', end: '2026-12-20', amount: 5000 }],
        manualInvoices: [
          { id: 'i1', number: 'R-2026-0042' },
          { id: 'i2', number: null },
        ],
      }),
    );
    expect(markup).toContain(
      text('billing.service.restoreManualInvoices', {
        numbers: `R-2026-0042, ${en['billing.status.draft']}`,
      }),
    );
    expect(markup).toContain(
      text('billing.service.fullPeriod', { date: day('2026-12-01'), price: chf(5000) }),
    );
  });

  it('offers not to bill them when no period begins up to the end date, and says when another service keeps the module', () => {
    const markup = render(
      preview({ endsAt: '2026-11-20', nextFromToday: '2026-12-01', moduleDeactivatedByCancel: true }),
      [service({ id: 'other', name: 'DNS M', status: 'active', endsAt: null })],
    );
    expect(markup).toContain(text('billing.service.restoreBillNone'));
    expect(markup).not.toContain(text('billing.service.restoreBillNext', { date: day('2026-12-01') }));
    expect(markup).toContain('DNS M');
  });

  it('shows no choice without missed periods, and the open one-off charge', () => {
    const none = render(preview({ missedPeriods: [], missedTotal: 0, firstUnbilled: '2026-12-01' }));
    expect(none).not.toContain('type="radio"');
    expect(none).not.toContain(text('billing.service.restoreMissed'));
    // Billed up to its end already: nothing more.
    const billed = render(
      preview({
        missedPeriods: [],
        missedTotal: 0,
        upcomingPeriods: [],
        upcomingTotal: 0,
        nextFromToday: '2027-01-01',
      }),
    );
    expect(billed).toContain(text('billing.service.restoreBilledNothing'));
    const once = render(
      preview({
        interval: 'once',
        missedPeriods: [],
        missedTotal: 0,
        firstUnbilled: '2026-11-10',
        nextFromToday: '2026-11-10',
        module: null,
        moduleActive: false,
      }),
    );
    expect(once).toContain(text('billing.service.restoreOneOff', { price: chf(5000) }));
    expect(once).not.toContain('role="switch"');
  });
});

describe('seller table and overview card', () => {
  it('marks a service ended early in the seller view only', () => {
    const label = text('billing.service.endedEarly', { date: day('2026-12-31') });
    expect(html(<ServiceTable services={[service()]} showEndedEarly today={today} />)).toContain(label);
    const customer = html(<ServiceTable services={[service()]} today={today} />);
    expect(customer).not.toContain(label);
    expect(customer).toContain(text('billing.service.endsAt', { date: day('2026-12-31') }));
    // An immediate cancellation stays as it is.
    expect(
      html(<ServiceTable services={[service({ endsAt: today })]} showEndedEarly today={today} />),
    ).not.toContain(text('billing.service.endedEarly', { date: day(today) }));
  });

  it('lists the services with their customer, each linking to the customer services', () => {
    const markup = html(
      <EndedEarlyList
        items={[
          {
            serviceId: 's1',
            name: 'DNS S',
            customer: { id: 'c1', name: 'Muster AG' },
            endsAt: '2026-12-31',
            cancelledAt: null,
            module: 'dns',
          },
        ]}
        customerHref={(id) => `/admin/customers/${id}?tab=billing&billing=services`}
      />,
    );
    expect(markup).toContain(text('billing.endedEarly.title'));
    expect(markup).toContain('Muster AG');
    expect(markup).toContain('href="/admin/customers/c1?tab=billing&amp;billing=services"');
    expect(markup).toContain(text('billing.service.cancelledPer', { date: day('2026-12-31') }));
  });
});
