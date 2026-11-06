import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ServiceDto } from '@weblion/shared';
import { en } from '@weblion/shared/i18n/en';
import { I18nProvider } from '@/lib/i18n';
import { TooltipProvider } from '@/components/ui/menu';
import { formatDay } from './money';
import { ServiceTable } from './tables';

/**
 * A scheduled cancellation (end date, status still active or paused) shows its date instead of looking
 * ended; an ended service shows the end date only. Rendered on the server like the media tests; English is
 * the test's locale.
 */

const html = (node: ReactNode) =>
  renderToStaticMarkup(
    <I18nProvider>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nProvider>,
  );

const service = (patch: Partial<ServiceDto> = {}): ServiceDto => ({
  id: 'a6d4b1a0-0000-4000-8000-000000000001',
  orgId: 'a6d4b1a0-0000-4000-8000-000000000002',
  product: null,
  name: 'Managed Server',
  description: null,
  module: 'dns',
  resource: null,
  unitPrice: 1000,
  quantity: 1,
  currency: 'CHF',
  interval: 'monthly',
  taxRateBp: null,
  status: 'active',
  startsAt: '2026-10-01',
  nextBillingAt: '2026-12-01',
  endsAt: null,
  cancelledAt: null,
  deactivateModuleAtEnd: false,
  notes: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  ...patch,
});

const scheduledLabel = (date: string) =>
  en['billing.service.cancelledPer'].replace('{date}', formatDay(date, 'en'));
const endsLabel = (date: string) => en['billing.service.endsAt'].replace('{date}', formatDay(date, 'en'));
/** Text as React writes it into the markup (quotes escaped). */
const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const moduleOff = escaped(en['billing.service.moduleOffAtEnd'].split('{')[0]!);

describe('ServiceTable', () => {
  it('shows a scheduled cancellation with its date while the service still runs', () => {
    const markup = html(
      <ServiceTable
        services={[
          service({
            endsAt: '2026-12-15',
            cancelledAt: '2026-11-06T08:00:00.000Z',
            deactivateModuleAtEnd: true,
          }),
        ]}
        today="2026-11-06"
      />,
    );
    expect(markup).toContain(scheduledLabel('2026-12-15'));
    expect(markup).toContain(en['billing.serviceStatus.active']);
    expect(markup).toContain(moduleOff);
    // The period of 1 December is still billed.
    expect(markup).toContain(formatDay('2026-12-01', 'en'));
  });

  it('shows the end date once every period up to it is billed, and on a paused service', () => {
    const billed = html(
      <ServiceTable services={[service({ endsAt: '2026-12-15', nextBillingAt: '2027-01-01' })]} />,
    );
    expect(billed).toContain(scheduledLabel('2026-12-15'));
    expect(billed).toContain(endsLabel('2026-12-15'));
    expect(billed).not.toContain(formatDay('2027-01-01', 'en'));
    expect(billed).not.toContain(moduleOff);

    const paused = html(<ServiceTable services={[service({ status: 'suspended', endsAt: '2026-12-15' })]} />);
    expect(paused).toContain(scheduledLabel('2026-12-15'));
    expect(paused).toContain(en['billing.serviceStatus.suspended']);
  });

  it('says that a service past its end date ends once its last period is billed', () => {
    const waiting = service({ endsAt: '2026-11-26', nextBillingAt: '2026-11-01' });
    const markup = html(<ServiceTable services={[waiting]} today="2026-11-27" />);
    expect(markup).toContain(
      escaped(en['billing.service.endWaitsForBilling'].replace('{date}', formatDay('2026-11-26', 'en'))),
    );
    // Before the end date, or once billed up to it, the usual label.
    expect(html(<ServiceTable services={[waiting]} today="2026-11-26" />)).toContain(
      scheduledLabel('2026-11-26'),
    );
    const billed = html(
      <ServiceTable services={[{ ...waiting, nextBillingAt: '2026-12-01' }]} today="2026-11-27" />,
    );
    expect(billed).toContain(scheduledLabel('2026-11-26'));
    expect(billed).not.toContain(escaped(en['billing.service.endWaitsForBilling'].split('{date}')[1]!));
  });

  it('shows neither label without a cancellation and only the end date once it ended', () => {
    const running = html(<ServiceTable services={[service()]} />);
    expect(running).not.toContain(en['billing.service.cancelledPer'].split('{')[0]!);

    const ended = html(
      <ServiceTable
        services={[service({ status: 'cancelled', endsAt: '2026-11-06', nextBillingAt: null })]}
      />,
    );
    expect(ended).toContain(endsLabel('2026-11-06'));
    expect(ended).not.toContain(en['billing.service.cancelledPer'].split('{')[0]!);
    expect(ended).toContain(en['billing.serviceStatus.cancelled']);
  });
});
