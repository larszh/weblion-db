import { useEffect, useState } from 'react';
import { CURRENCIES, type BillingProfileDto, type Currency } from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApiMutation } from '@/lib/queries';
import { billingKeys } from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Field, Input, KeyValue, Select } from '@/components/ui/primitives';
import { formatRate, parsePercent, percentInput } from './money';

/**
 * Billing address of an organization ("Rechnungsadresse"). Customers edit the address, the
 * seller also sets currency, payment terms and a tax rate override. Without write access
 * the same data is shown read only.
 */

interface ProfileDraft {
  companyName: string;
  contactName: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  vatId: string;
  currency: Currency;
  paymentTermsDays: string;
  taxRate: string;
}

const toDraft = (p: BillingProfileDto): ProfileDraft => ({
  companyName: p.companyName ?? '',
  contactName: p.contactName ?? '',
  line1: p.line1 ?? '',
  line2: p.line2 ?? '',
  postalCode: p.postalCode ?? '',
  city: p.city ?? '',
  country: p.country,
  email: p.email ?? '',
  vatId: p.vatId ?? '',
  currency: p.currency,
  paymentTermsDays: String(p.paymentTermsDays),
  taxRate: percentInput(p.taxRateBp),
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function BillingProfileForm({
  profile,
  mode,
  readOnly,
  defaultTaxRateBp,
}: {
  profile: BillingProfileDto;
  mode: 'customer' | 'seller';
  readOnly?: boolean;
  /** The issuer's default rate, shown as placeholder for the override. */
  defaultTaxRateBp?: number;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(profile));
  useEffect(() => setDraft(toDraft(profile)), [profile]);
  const set = (patch: Partial<ProfileDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const seller = mode === 'seller';
  const countryOk = /^[A-Za-z]{2}$/.test(draft.country.trim());
  const emailOk = !draft.email.trim() || EMAIL.test(draft.email.trim());
  const terms = Number(draft.paymentTermsDays);
  const termsOk = /^\d+$/.test(draft.paymentTermsDays.trim()) && terms <= 365;
  const taxBp = draft.taxRate.trim() === '' ? null : parsePercent(draft.taxRate);
  const taxOk = draft.taxRate.trim() === '' || taxBp !== null;
  const valid = countryOk && emailOk && (!seller || (termsOk && taxOk));

  const save = useApiMutation(
    () => {
      const address = {
        companyName: draft.companyName,
        contactName: draft.contactName,
        line1: draft.line1,
        line2: draft.line2,
        postalCode: draft.postalCode,
        city: draft.city,
        country: draft.country.trim().toUpperCase(),
        email: draft.email.trim(),
        vatId: draft.vatId,
      };
      return seller
        ? api.put<BillingProfileDto>(`/billing/customers/${profile.orgId}/profile`, {
            ...address,
            currency: draft.currency,
            paymentTermsDays: terms,
            taxRateBp: taxBp,
          })
        : api.put<BillingProfileDto>(`/orgs/${profile.orgId}/billing/profile`, address);
    },
    { success: t('billing.profile.saved'), invalidate: [billingKeys.all] },
  );

  if (readOnly) {
    const v = (value: string | null) => value || <span className="text-subtle">–</span>;
    return (
      <Card>
        <CardHeader title={t('billing.profile.title')} description={t('billing.profile.readOnly')} />
        <CardBody className="py-2">
          <KeyValue
            items={[
              { label: t('billing.profile.companyName'), value: v(profile.companyName) },
              { label: t('billing.profile.contactName'), value: v(profile.contactName) },
              {
                label: t('billing.profile.address'),
                value: v(
                  [
                    profile.line1,
                    profile.line2,
                    [profile.postalCode, profile.city].filter(Boolean).join(' '),
                    profile.country,
                  ]
                    .filter(Boolean)
                    .join(', '),
                ),
              },
              { label: t('billing.profile.email'), value: v(profile.email) },
              { label: t('billing.profile.vatId'), value: v(profile.vatId) },
              { label: t('billing.profile.currency'), value: profile.currency },
              {
                label: t('billing.profile.terms'),
                value: t('billing.profile.termsValue', { days: profile.paymentTermsDays }),
              },
            ]}
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={t('billing.profile.title')}
        description={seller ? t('billing.profile.sellerText') : t('billing.profile.customerText')}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate(undefined);
        }}
      >
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t('billing.profile.companyName')} htmlFor="bp-company">
            <Input
              id="bp-company"
              value={draft.companyName}
              maxLength={100}
              onChange={(e) => set({ companyName: e.target.value })}
            />
          </Field>
          <Field label={t('billing.profile.contactName')} htmlFor="bp-contact">
            <Input
              id="bp-contact"
              value={draft.contactName}
              maxLength={100}
              onChange={(e) => set({ contactName: e.target.value })}
            />
          </Field>
          <Field label={t('billing.profile.line1')} htmlFor="bp-line1">
            <Input
              id="bp-line1"
              value={draft.line1}
              maxLength={100}
              onChange={(e) => set({ line1: e.target.value })}
            />
          </Field>
          <Field label={t('billing.profile.line2')} htmlFor="bp-line2">
            <Input
              id="bp-line2"
              value={draft.line2}
              maxLength={100}
              onChange={(e) => set({ line2: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <Field label={t('billing.profile.postalCode')} htmlFor="bp-zip">
              <Input
                id="bp-zip"
                value={draft.postalCode}
                maxLength={16}
                onChange={(e) => set({ postalCode: e.target.value })}
              />
            </Field>
            <Field label={t('billing.profile.city')} htmlFor="bp-city">
              <Input
                id="bp-city"
                value={draft.city}
                maxLength={60}
                onChange={(e) => set({ city: e.target.value })}
              />
            </Field>
          </div>
          <Field
            label={t('billing.profile.country')}
            htmlFor="bp-country"
            hint={t('billing.profile.countryHint')}
            error={!countryOk ? t('billing.profile.countryError') : undefined}
          >
            <Input
              id="bp-country"
              value={draft.country}
              maxLength={2}
              className="uppercase"
              onChange={(e) => set({ country: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field
            label={t('billing.profile.email')}
            htmlFor="bp-email"
            hint={t('billing.profile.emailHint')}
            error={!emailOk ? t('billing.profile.emailError') : undefined}
          >
            <Input
              id="bp-email"
              type="email"
              value={draft.email}
              maxLength={200}
              onChange={(e) => set({ email: e.target.value })}
            />
          </Field>
          <Field label={t('billing.profile.vatId')} htmlFor="bp-vat" hint={t('billing.profile.vatIdHint')}>
            <Input
              id="bp-vat"
              value={draft.vatId}
              maxLength={40}
              onChange={(e) => set({ vatId: e.target.value })}
            />
          </Field>
        </CardBody>

        {seller ? (
          <div className="border-t border-border">
            <div className="px-5 pt-4 text-[13px] font-semibold text-text">
              {t('billing.profile.terms.title')}
            </div>
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <Field
                label={t('billing.profile.currency')}
                htmlFor="bp-currency"
                hint={t('billing.profile.currencyHint')}
              >
                <Select
                  id="bp-currency"
                  value={draft.currency}
                  onChange={(e) => set({ currency: e.target.value as Currency })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('billing.profile.terms')}
                htmlFor="bp-terms"
                hint={t('billing.profile.termsHint')}
                error={!termsOk ? t('billing.profile.termsError') : undefined}
              >
                <Input
                  id="bp-terms"
                  inputMode="numeric"
                  value={draft.paymentTermsDays}
                  onChange={(e) => set({ paymentTermsDays: e.target.value })}
                />
              </Field>
              <Field
                label={t('billing.profile.taxRate')}
                htmlFor="bp-tax"
                hint={
                  defaultTaxRateBp !== undefined
                    ? t('billing.profile.taxRateHint', { rate: formatRate(defaultTaxRateBp, locale) })
                    : undefined
                }
                error={!taxOk ? t('billing.rateError') : undefined}
              >
                <Input
                  id="bp-tax"
                  inputMode="decimal"
                  value={draft.taxRate}
                  placeholder={defaultTaxRateBp !== undefined ? percentInput(defaultTaxRateBp) : ''}
                  onChange={(e) => set({ taxRate: e.target.value })}
                />
              </Field>
            </CardBody>
          </div>
        ) : (
          <div className="border-t border-border px-5 py-3 text-sm text-muted">
            {t('billing.profile.customerTerms', {
              currency: profile.currency,
              days: profile.paymentTermsDays,
            })}
          </div>
        )}
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button type="submit" variant="primary" disabled={!valid} loading={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
