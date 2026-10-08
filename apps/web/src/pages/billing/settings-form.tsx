import { useEffect, useState, type ReactNode } from 'react';
import {
  CURRENCIES,
  type BillingSettingsDto,
  type Currency,
  type InvoiceIssuerSettings,
} from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApiMutation, useMe } from '@/lib/queries';
import { billingKeys, useBillingSettings, useResellerIssuer } from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/menu';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Notice,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { formatRate, parsePercent, percentInput } from './money';

/**
 * Who issues invoices and how they look: the platform's billing settings (admin area) and
 * a reseller's own issuer details. Both edit the same InvoiceIssuerSettings.
 */

interface IssuerDraft {
  name: string;
  companyName: string;
  contactName: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  website: string;
  vatId: string;
  iban: string;
  bankName: string;
  invoicePrefix: string;
  defaultTaxRate: string;
  defaultCurrency: Currency;
  defaultPaymentTermsDays: string;
  invoiceFooter: string;
}

const toDraft = (s: InvoiceIssuerSettings): IssuerDraft => ({
  name: s.name,
  companyName: s.companyName ?? '',
  contactName: s.contactName ?? '',
  line1: s.line1 ?? '',
  line2: s.line2 ?? '',
  postalCode: s.postalCode ?? '',
  city: s.city ?? '',
  country: s.country,
  email: s.email ?? '',
  phone: s.phone ?? '',
  website: s.website ?? '',
  vatId: s.vatId ?? '',
  iban: s.iban ?? '',
  bankName: s.bankName ?? '',
  invoicePrefix: s.invoicePrefix,
  defaultTaxRate: percentInput(s.defaultTaxRateBp),
  defaultCurrency: s.defaultCurrency,
  defaultPaymentTermsDays: String(s.defaultPaymentTermsDays),
  invoiceFooter: s.invoiceFooter ?? '',
});

/** ISO 13616 check (mod 97), the same rule the API applies. */
function ibanValid(input: string): boolean {
  const iban = input.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkIssuer(d: IssuerDraft) {
  const taxBp = parsePercent(d.defaultTaxRate);
  const terms = Number(d.defaultPaymentTermsDays);
  const errors = {
    name: !d.name.trim(),
    country: !/^[A-Za-z]{2}$/.test(d.country.trim()),
    email: !!d.email.trim() && !EMAIL.test(d.email.trim()),
    iban: !!d.iban.trim() && !ibanValid(d.iban),
    prefix: !/^[A-Za-z0-9]{1,8}$/.test(d.invoicePrefix.trim()),
    tax: taxBp === null,
    terms: !/^\d+$/.test(d.defaultPaymentTermsDays.trim()) || terms > 365,
  };
  const valid = !Object.values(errors).some(Boolean);
  const value: InvoiceIssuerSettings = {
    name: d.name.trim(),
    companyName: d.companyName.trim() || null,
    contactName: d.contactName.trim() || null,
    line1: d.line1.trim() || null,
    line2: d.line2.trim() || null,
    postalCode: d.postalCode.trim() || null,
    city: d.city.trim() || null,
    country: d.country.trim().toUpperCase(),
    email: d.email.trim() || null,
    phone: d.phone.trim() || null,
    website: d.website.trim() || null,
    vatId: d.vatId.trim() || null,
    iban: d.iban.replace(/\s+/g, '').toUpperCase() || null,
    bankName: d.bankName.trim() || null,
    invoicePrefix: d.invoicePrefix.trim().toUpperCase(),
    defaultTaxRateBp: taxBp ?? 0,
    defaultCurrency: d.defaultCurrency,
    defaultPaymentTermsDays: terms,
    invoiceFooter: d.invoiceFooter.trim() || null,
  };
  return { errors, valid, value };
}

function Section({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="px-5 pt-4">
        <h4 className="text-[13px] font-semibold text-text">{title}</h4>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <CardBody className="grid gap-4 sm:grid-cols-2">{children}</CardBody>
    </div>
  );
}

/** The issuer fields. `id` keeps input ids unique when two forms are on one page. */
function IssuerFields({
  id,
  draft,
  set,
  disabled,
}: {
  id: string;
  draft: IssuerDraft;
  set: (patch: Partial<IssuerDraft>) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const { errors } = checkIssuer(draft);
  const f = (name: string) => `${id}-${name}`;
  const text = (key: keyof IssuerDraft, max: number, extra: { type?: string; placeholder?: string } = {}) => (
    <Input
      id={f(key)}
      value={draft[key] as string}
      maxLength={max}
      disabled={disabled}
      onChange={(e) => set({ [key]: e.target.value } as Partial<IssuerDraft>)}
      {...extra}
    />
  );
  const year = new Date().getFullYear();
  const prefix = draft.invoicePrefix.trim().toUpperCase() || 'WL';
  return (
    <div className="divide-y divide-border">
      <Section title={t('billing.issuer.sender')} hint={t('billing.issuer.senderHint')}>
        <Field
          label={t('billing.issuer.name')}
          htmlFor={f('name')}
          hint={t('billing.issuer.nameHint')}
          error={errors.name ? t('billing.issuer.nameError') : undefined}
        >
          {text('name', 100)}
        </Field>
        <Field label={t('billing.profile.companyName')} htmlFor={f('companyName')}>
          {text('companyName', 100)}
        </Field>
        <Field label={t('billing.profile.contactName')} htmlFor={f('contactName')}>
          {text('contactName', 100)}
        </Field>
        <Field label={t('billing.profile.line1')} htmlFor={f('line1')}>
          {text('line1', 100)}
        </Field>
        <Field label={t('billing.profile.line2')} htmlFor={f('line2')}>
          {text('line2', 100)}
        </Field>
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Field label={t('billing.profile.postalCode')} htmlFor={f('postalCode')}>
            {text('postalCode', 16)}
          </Field>
          <Field label={t('billing.profile.city')} htmlFor={f('city')}>
            {text('city', 60)}
          </Field>
        </div>
        <Field
          label={t('billing.profile.country')}
          htmlFor={f('country')}
          hint={t('billing.profile.countryHint')}
          error={errors.country ? t('billing.profile.countryError') : undefined}
        >
          <Input
            id={f('country')}
            value={draft.country}
            maxLength={2}
            disabled={disabled}
            className="uppercase"
            onChange={(e) => set({ country: e.target.value.toUpperCase() })}
          />
        </Field>
      </Section>

      <Section title={t('billing.issuer.contact')}>
        <Field
          label={t('billing.issuer.email')}
          htmlFor={f('email')}
          error={errors.email ? t('billing.profile.emailError') : undefined}
        >
          {text('email', 200, { type: 'email' })}
        </Field>
        <Field label={t('billing.issuer.phone')} htmlFor={f('phone')}>
          {text('phone', 40, { placeholder: '+41 44 000 00 00' })}
        </Field>
        <Field label={t('billing.issuer.website')} htmlFor={f('website')}>
          {text('website', 200, { placeholder: 'https://' })}
        </Field>
      </Section>

      <Section title={t('billing.issuer.taxBank')} hint={t('billing.issuer.taxBankHint')}>
        <Field label={t('billing.profile.vatId')} htmlFor={f('vatId')} hint={t('billing.issuer.vatIdHint')}>
          {text('vatId', 40, { placeholder: 'CHE-123.456.789 MWST' })}
        </Field>
        <Field
          label={t('billing.issuer.iban')}
          htmlFor={f('iban')}
          hint={t('billing.issuer.ibanHint')}
          error={errors.iban ? t('billing.issuer.ibanError') : undefined}
        >
          {text('iban', 42, { placeholder: 'CH00 0000 0000 0000 0000 0' })}
        </Field>
        <Field label={t('billing.issuer.bankName')} htmlFor={f('bankName')}>
          {text('bankName', 100)}
        </Field>
      </Section>

      <Section title={t('billing.issuer.invoices')}>
        <Field
          label={t('billing.issuer.prefix')}
          htmlFor={f('prefix')}
          hint={t('billing.issuer.prefixHint', { example: `${prefix}-${year}-00001` })}
          error={errors.prefix ? t('billing.issuer.prefixError') : undefined}
        >
          <Input
            id={f('prefix')}
            value={draft.invoicePrefix}
            maxLength={8}
            disabled={disabled}
            className="uppercase"
            onChange={(e) => set({ invoicePrefix: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field
          label={t('billing.issuer.currency')}
          htmlFor={f('currency')}
          hint={t('billing.issuer.currencyHint')}
        >
          <Select
            id={f('currency')}
            value={draft.defaultCurrency}
            disabled={disabled}
            onChange={(e) => set({ defaultCurrency: e.target.value as Currency })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('billing.issuer.taxRate')}
          htmlFor={f('tax')}
          hint={
            errors.tax
              ? undefined
              : t('billing.issuer.taxRateHint', {
                  rate: formatRate(parsePercent(draft.defaultTaxRate) ?? 0, locale),
                })
          }
          error={errors.tax ? t('billing.rateError') : undefined}
        >
          <Input
            id={f('tax')}
            inputMode="decimal"
            value={draft.defaultTaxRate}
            disabled={disabled}
            onChange={(e) => set({ defaultTaxRate: e.target.value })}
          />
        </Field>
        <Field
          label={t('billing.issuer.terms')}
          htmlFor={f('terms')}
          hint={t('billing.issuer.termsHint')}
          error={errors.terms ? t('billing.profile.termsError') : undefined}
        >
          <Input
            id={f('terms')}
            inputMode="numeric"
            value={draft.defaultPaymentTermsDays}
            disabled={disabled}
            onChange={(e) => set({ defaultPaymentTermsDays: e.target.value })}
          />
        </Field>
        <Field
          label={t('billing.issuer.footer')}
          htmlFor={f('footer')}
          hint={t('billing.issuer.footerHint')}
          className="sm:col-span-2"
        >
          <Textarea
            id={f('footer')}
            rows={3}
            maxLength={1000}
            value={draft.invoiceFooter}
            disabled={disabled}
            onChange={(e) => set({ invoiceFooter: e.target.value })}
          />
        </Field>
      </Section>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4 px-5 py-3.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} label={label} disabled={disabled} />
    </label>
  );
}

/** Platform billing settings: issuer, numbering, defaults and automation. */
export function BillingSettingsForm() {
  const { t } = useI18n();
  const me = useMe();
  const canWrite = me.data?.platformPermissions.includes('platform:settings') ?? false;
  const settings = useBillingSettings();
  const [draft, setDraft] = useState<IssuerDraft | null>(null);
  const [flags, setFlags] = useState<Omit<BillingSettingsDto, 'issuer'> | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setDraft(toDraft(settings.data.issuer));
    setFlags({
      autoFinalizeRecurring: settings.data.autoFinalizeRecurring,
      sendInvoiceEmails: settings.data.sendInvoiceEmails,
      autoApplyCredit: settings.data.autoApplyCredit,
    });
  }, [settings.data]);

  const checked = draft ? checkIssuer(draft) : null;
  const save = useApiMutation(
    () => api.put<BillingSettingsDto>('/admin/settings/billing', { issuer: checked!.value, ...flags! }),
    { success: t('billing.settings.saved'), invalidate: [billingKeys.all] },
  );

  if (settings.isPending || (!draft && !settings.isError)) {
    return (
      <Card>
        <LoadingBlock rows={6} />
      </Card>
    );
  }
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  if (!draft || !flags || !checked) return null;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (checked.valid && canWrite) save.mutate(undefined);
      }}
    >
      {!canWrite && <Notice tone="info">{t('billing.settings.readOnly')}</Notice>}
      <Card>
        <CardHeader
          title={t('billing.settings.issuerTitle')}
          description={t('billing.settings.issuerText')}
        />
        <IssuerFields
          id="bs"
          draft={draft}
          set={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
          disabled={!canWrite}
        />
      </Card>
      <Card>
        <CardHeader title={t('billing.settings.automation')} />
        <div className="divide-y divide-border">
          <ToggleRow
            label={t('billing.settings.sendInvoiceEmails')}
            hint={t('billing.settings.sendInvoiceEmailsHint')}
            checked={flags.sendInvoiceEmails}
            onCheckedChange={(v) => setFlags({ ...flags, sendInvoiceEmails: v })}
            disabled={!canWrite}
          />
          <ToggleRow
            label={t('billing.settings.autoApplyCredit')}
            hint={t('billing.settings.autoApplyCreditHint')}
            checked={flags.autoApplyCredit}
            onCheckedChange={(v) => setFlags({ ...flags, autoApplyCredit: v })}
            disabled={!canWrite}
          />
          <ToggleRow
            label={t('billing.settings.autoFinalizeRecurring')}
            hint={t('billing.settings.autoFinalizeRecurringHint')}
            checked={flags.autoFinalizeRecurring}
            onCheckedChange={(v) => setFlags({ ...flags, autoFinalizeRecurring: v })}
            disabled={!canWrite}
          />
        </div>
      </Card>
      {canWrite && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!checked.valid && <span className="text-sm text-danger">{t('billing.settings.invalid')}</span>}
          <Button type="submit" variant="primary" disabled={!checked.valid} loading={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </form>
  );
}

/** Issuer details a reseller prints on the invoices to its customers. */
export function ResellerIssuerForm({ orgId }: { orgId: string }) {
  const { t } = useI18n();
  const issuer = useResellerIssuer(orgId);
  const [draft, setDraft] = useState<IssuerDraft | null>(null);
  useEffect(() => {
    if (issuer.data) setDraft(toDraft(issuer.data));
  }, [issuer.data]);

  const checked = draft ? checkIssuer(draft) : null;
  const save = useApiMutation(
    () => api.put<InvoiceIssuerSettings>(`/orgs/${orgId}/reseller/issuer`, checked!.value),
    { success: t('billing.issuer.saved'), invalidate: [billingKeys.all] },
  );

  if (issuer.isPending || (!draft && !issuer.isError)) {
    return (
      <Card>
        <LoadingBlock rows={6} />
      </Card>
    );
  }
  if (issuer.isError) return <ErrorState error={issuer.error} onRetry={() => void issuer.refetch()} />;
  if (!draft || !checked) return null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (checked.valid) save.mutate(undefined);
      }}
    >
      <Card>
        <CardHeader title={t('billing.issuer.title')} description={t('billing.issuer.text')} />
        <IssuerFields id="ri" draft={draft} set={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))} />
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-3">
          {!checked.valid && <span className="text-sm text-danger">{t('billing.settings.invalid')}</span>}
          <Button type="submit" variant="primary" disabled={!checked.valid} loading={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </Card>
    </form>
  );
}
