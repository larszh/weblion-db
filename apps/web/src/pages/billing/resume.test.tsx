import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { formatMoney, type ServiceDto, type ServiceResumePreviewDto } from '@weblion/shared';
import { en } from '@weblion/shared/i18n/en';
import { TooltipProvider } from '@/components/ui/menu';
import { withI18n } from '@/test/i18n';
import { EndedEarlyList } from './ended-early';
import { formatDay } from './money';
import { ResumeServiceForm } from './seller-dialogs';
import { billsFromNext, endedEarly, resumeBody, resumeDefaults, resumeSwitches } from './service-end';
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
    .reduce((s, [k, v]) => s.replace(`{${k}}`, v), en[key])
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
  endsAt: '2026-12-31',
  cancelledAt: '2026-10-02T08:00:00.000Z',
  currency: 'CHF',
  interval: 'monthly',
  firstUnbilled: '2026-10-01',
  missedPeriods: [
    { start: '2026-10-01', end: '2026-10-31', amount: 5000 },
    { start: '2026-11-01', end: '2026-11-30', amount: 5000 },
  ],
  missedTotal: 10000,
  nextFromToday: '2026-12-01',
  periodAmount: 5000,
  module: 'dns',
  moduleActive: true,
  moduleDeactivatedByCancel: false,
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
      deactivateAtEnd: true,
    });
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
    expect(markup).toContain(text('billing.service.restoreMissed'));
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
