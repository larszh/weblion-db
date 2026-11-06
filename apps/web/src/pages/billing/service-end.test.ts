import { describe, expect, it } from 'vitest';
import type { ServiceDto } from '@weblion/shared';
import { servicesKeepingModule } from './service-end';

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
