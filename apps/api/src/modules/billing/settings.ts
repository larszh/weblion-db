import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { isIBANValid } from 'swissqrbill/utils';
import {
  CURRENCIES,
  DEFAULT_TAX_RATE_BP,
  type BillingSettingsDto,
  type InvoiceIssuerSettings,
} from '@weblion/shared';
import type { DbOrTx } from '../../db/client';
import { billingProfiles, organizations, settings } from '../../db/schema';

/**
 * Who issues invoices and how they look. The platform keeps its settings in the settings
 * table (key "billing"), resellers in billing_profiles.issuer of their own organization.
 */

const SETTINGS_KEY = 'billing';

export const DEFAULT_ISSUER: InvoiceIssuerSettings = {
  name: 'weblion.one',
  companyName: null,
  contactName: null,
  line1: null,
  line2: null,
  postalCode: null,
  city: null,
  country: 'CH',
  email: null,
  phone: null,
  website: null,
  vatId: null,
  iban: null,
  bankName: null,
  invoicePrefix: 'WL',
  defaultTaxRateBp: DEFAULT_TAX_RATE_BP,
  defaultCurrency: 'CHF',
  defaultPaymentTermsDays: 30,
  invoiceFooter: null,
};

export const DEFAULT_BILLING_SETTINGS: BillingSettingsDto = {
  issuer: DEFAULT_ISSUER,
  autoFinalizeRecurring: false,
  sendInvoiceEmails: true,
  autoApplyCredit: true,
};

/** Optional free text: trimmed, empty becomes null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/**
 * Like optionalText, for partial updates: a missing key stays undefined (keep the value),
 * null or an empty string clear it.
 */
export const patchText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

export const optionalEmail = z
  .email()
  .max(200)
  .nullish()
  .or(z.literal(''))
  .transform((v) => v || null);

/** Tax rate in basis points, 0 to 100 %. */
export const taxRateSchema = z.number().int().min(0).max(10_000);

export const countrySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'expected a two letter country code')
  .transform((v) => v.toUpperCase());

export const issuerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  companyName: optionalText(100),
  contactName: optionalText(100),
  line1: optionalText(100),
  line2: optionalText(100),
  postalCode: optionalText(16),
  city: optionalText(60),
  country: countrySchema.default('CH'),
  email: optionalEmail,
  phone: optionalText(40),
  website: optionalText(200),
  vatId: optionalText(40),
  iban: optionalText(42)
    .transform((v) => (v ? v.replace(/\s+/g, '').toUpperCase() : null))
    .refine((v) => v === null || isIBANValid(v), 'invalid IBAN'),
  bankName: optionalText(100),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,8}$/, '1 to 8 letters or digits'),
  defaultTaxRateBp: taxRateSchema,
  defaultCurrency: z.enum(CURRENCIES),
  defaultPaymentTermsDays: z.number().int().min(0).max(365),
  invoiceFooter: optionalText(1000),
});

export const billingSettingsSchema = z.object({
  issuer: issuerSchema,
  autoFinalizeRecurring: z.boolean(),
  sendInvoiceEmails: z.boolean(),
  autoApplyCredit: z.boolean(),
});

/** Platform billing settings, filled up with defaults for anything never saved. */
export async function getBillingSettings(db: DbOrTx): Promise<BillingSettingsDto> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, SETTINGS_KEY) });
  const stored = (row?.value ?? {}) as Partial<BillingSettingsDto>;
  return {
    ...DEFAULT_BILLING_SETTINGS,
    ...stored,
    issuer: { ...DEFAULT_ISSUER, ...(stored.issuer ?? {}) },
  };
}

export async function saveBillingSettings(db: DbOrTx, value: BillingSettingsDto): Promise<void> {
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Issuer settings of a reseller: what it saved, else derived from its organization and address. */
export async function resellerIssuer(db: DbOrTx, resellerOrgId: string): Promise<InvoiceIssuerSettings> {
  // Sequential on purpose: `db` may be a transaction, which runs one query at a time.
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, resellerOrgId) });
  const profile = await db.query.billingProfiles.findFirst({
    where: eq(billingProfiles.orgId, resellerOrgId),
  });
  const platform = await getBillingSettings(db);
  const derived: InvoiceIssuerSettings = {
    ...DEFAULT_ISSUER,
    name: org?.name ?? 'Reseller',
    companyName: profile?.companyName ?? null,
    contactName: profile?.contactName ?? null,
    line1: profile?.line1 ?? null,
    line2: profile?.line2 ?? null,
    postalCode: profile?.postalCode ?? null,
    city: profile?.city ?? null,
    country: profile?.country ?? 'CH',
    email: profile?.email ?? null,
    vatId: profile?.vatId ?? null,
    invoicePrefix: defaultPrefix(org?.slug ?? ''),
    defaultTaxRateBp: platform.issuer.defaultTaxRateBp,
    defaultCurrency: profile?.currency ?? platform.issuer.defaultCurrency,
  };
  return profile?.issuer ? { ...derived, ...profile.issuer } : derived;
}

/** "hosting-partner" -> "HOST". Only a starting point, resellers set their own prefix. */
function defaultPrefix(slug: string): string {
  return (
    slug
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 4)
      .toUpperCase() || 'RE'
  );
}

/** Issuer settings for invoices of `issuerOrgId` (null = the platform). */
export async function issuerSettings(db: DbOrTx, issuerOrgId: string | null): Promise<InvoiceIssuerSettings> {
  if (!issuerOrgId) return (await getBillingSettings(db)).issuer;
  return resellerIssuer(db, issuerOrgId);
}

/** Memoized issuer names for building many DTOs in one request. */
export function issuerNames(db: DbOrTx): (issuerOrgId: string | null) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  return (issuerOrgId) => {
    const key = issuerOrgId ?? 'platform';
    let name = cache.get(key);
    if (!name) {
      name = issuerSettings(db, issuerOrgId).then((s) => s.name);
      cache.set(key, name);
    }
    return name;
  };
}
