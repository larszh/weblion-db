import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { BillingProfileDto } from '@weblion/shared';
import { withI18n } from '@/test/i18n';
import { BillingProfileForm } from './profile-form';

const html = (node: ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{withI18n(node, 'de')}</QueryClientProvider>,
  );

const profile = (patch: Partial<BillingProfileDto> = {}): BillingProfileDto => ({
  orgId: 'c1e2c3d4-0000-4000-8000-000000000001',
  companyName: 'Lingua AG',
  contactName: null,
  line1: null,
  line2: null,
  postalCode: null,
  city: null,
  country: 'CH',
  email: null,
  vatId: null,
  currency: 'CHF',
  paymentTermsDays: 30,
  taxRateBp: null,
  locale: null,
  effectiveLocale: 'it',
  ownerLocale: 'it',
  updatedAt: null,
  ...patch,
});

describe('BillingProfileForm, "Sprache für Rechnungen" (i18n 9)', () => {
  it('names the owner’s language in the first option, also while the profile has a language of its own', () => {
    const own = html(
      <BillingProfileForm profile={profile({ locale: 'fr', effectiveLocale: 'fr' })} mode="customer" />,
    );
    expect(own).toContain('<option value="">Sprache des Owners (Italiano)</option>');
    expect(own).toContain('<option value="fr" lang="fr" selected="">Français</option>');
    expect(own).not.toContain('>Sprache des Owners</option>');

    const none = html(<BillingProfileForm profile={profile()} mode="customer" />);
    expect(none).toContain('<option value="" selected="">Sprache des Owners (Italiano)</option>');
  });

  it('names no language while the API does not know the owner’s (ownerLocale null)', () => {
    // Never the profile's own language passed off as the owner's.
    const unknown = html(
      <BillingProfileForm
        profile={profile({ locale: 'fr', effectiveLocale: 'fr', ownerLocale: null })}
        mode="customer"
      />,
    );
    expect(unknown).toContain('<option value="">Sprache des Owners</option>');
    expect(unknown).not.toContain('Sprache des Owners (');
  });

  it('shows the owner’s language read only when the profile has none of its own', () => {
    const out = html(<BillingProfileForm profile={profile()} mode="customer" readOnly />);
    expect(out).toContain('Sprache des Owners (Italiano)');
    const own = html(
      <BillingProfileForm
        profile={profile({ locale: 'fr', effectiveLocale: 'fr' })}
        mode="customer"
        readOnly
      />,
    );
    expect(own).toContain('Français</span>');
    expect(own).not.toContain('Sprache des Owners');
  });
});
