import { intlLocale, type Locale, type TargetLocale } from './i18n/locales';
import type { ModuleKey } from './modules';

/**
 * Billing types shared by API and console.
 *
 * Money is always an integer amount in the smallest currency unit (Rappen / cents).
 * Tax rates are basis points (8.1 % = 810). Dates without time are "YYYY-MM-DD" strings.
 *
 * Who bills whom: an organization below a reseller is billed by that reseller, every
 * other organization by the platform (weblion.one). Zoho Books sync and online payments
 * (Stripe, incl. TWINT) only apply to invoices the platform issues.
 */

export const CURRENCIES = ['CHF', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const BILLING_INTERVALS = ['once', 'monthly', 'quarterly', 'yearly'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Months per interval, `once` has none. */
export const INTERVAL_MONTHS: Record<BillingInterval, number> = {
  once: 0,
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * Today in Europe/Zurich as "YYYY-MM-DD". Billing dates are Swiss local dates: the API decides with this day
 * (a cancellation ends at once or is scheduled, an end date has passed), so the console must use the same day
 * and not the browser's. Intl only, so it runs in the browser too.
 */
export function todayZurich(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The billing date after `current` ("YYYY-MM-DD") for a service that started on `startsAt`, or null for
 * one-off services. Keeps the start day where the month allows it, so a service from Jan 31 is billed on
 * Feb 28, Mar 31, Apr 30; a date moved by hand becomes the new anchor. Shared so the console steps through
 * the periods exactly as the billing run does.
 */
export function nextBillingDate(current: string, interval: BillingInterval, startsAt: string): string | null {
  const months = INTERVAL_MONTHS[interval];
  if (months === 0) return null;
  const [y, m, d] = dateParts(current);
  const anchor = dateParts(startsAt)[2];
  const onAnchor = d === Math.min(anchor, daysIn(y, m));
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(onAnchor ? anchor : d, daysIn(ny, nm));
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

function dateParts(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const INVOICE_STATUSES = ['draft', 'open', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const SERVICE_STATUSES = ['active', 'suspended', 'cancelled'] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const SERVICE_RESOURCE_TYPES = ['server', 'domain', 'webspace'] as const;
export type ServiceResourceType = (typeof SERVICE_RESOURCE_TYPES)[number];

export const CREDIT_TYPES = ['topup', 'adjustment', 'refund', 'invoice_payment'] as const;
export type CreditType = (typeof CREDIT_TYPES)[number];

export const PAYMENT_PROVIDERS = ['stripe', 'manual', 'credit'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/** card and twint go through Stripe Checkout, the rest is booked by staff. */
export const PAYMENT_METHODS = ['card', 'twint', 'bank_transfer', 'cash', 'credit', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'cancelled', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type ZohoSyncStatus = 'pending' | 'synced' | 'error' | 'skipped';

/** Swiss VAT standard rate since 2024. */
export const DEFAULT_TAX_RATE_BP = 810;

/**
 * Largest amount in minor units the database stores (a Postgres integer), CHF 21'474'836.47.
 * Line totals and invoice totals above it are refused.
 */
export const MAX_AMOUNT = 2_147_483_647;

export interface PostalAddress {
  companyName: string | null;
  contactName: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2 */
  country: string;
}

/** Billing details of an organization as a customer (who receives the invoice). */
export interface BillingProfileDto extends PostalAddress {
  orgId: string;
  /** Invoices are emailed here. Falls back to the organization owners. */
  email: string | null;
  vatId: string | null;
  currency: Currency;
  paymentTermsDays: number;
  /** Overrides the issuer's default tax rate, e.g. 0 for customers abroad. */
  taxRateBp: number | null;
  /** "Sprache für Rechnungen"; null = the owner's language (i18n 9). */
  locale: Locale | null;
  /** locale ?? users.locale of the oldest active owner ?? 'de'. */
  effectiveLocale: Locale;
  /**
   * users.locale of the oldest active owner ?? 'de', also while the profile has a language of its own, so the
   * option "Sprache des Owners (<Sprache>)" can always name it.
   */
  ownerLocale: Locale;
  updatedAt: string | null;
}

/** The party that issues invoices: the platform or a reseller. */
export interface InvoiceIssuerSettings extends PostalAddress {
  /** Name printed in the invoice header, e.g. "weblion.one GmbH". */
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  vatId: string | null;
  /** IBAN or QR-IBAN. With it, invoices get a Swiss QR bill. */
  iban: string | null;
  bankName: string | null;
  /** Number prefix, e.g. "WL" gives WL-2026-00001. */
  invoicePrefix: string;
  defaultTaxRateBp: number;
  defaultCurrency: Currency;
  defaultPaymentTermsDays: number;
  /** Free text below the line items, e.g. payment instructions. */
  invoiceFooter: string | null;
}

/** Platform wide billing settings (admin area). */
export interface BillingSettingsDto {
  issuer: InvoiceIssuerSettings;
  /** Finalize invoices generated from due services automatically instead of leaving drafts. */
  autoFinalizeRecurring: boolean;
  /** Email finalized invoices to the customer. */
  sendInvoiceEmails: boolean;
  /** Pay open invoices from credit automatically when they are finalized. */
  autoApplyCredit: boolean;
}

/** Name and description per target language; German stays in ProductDto.name and description (plan O14). */
export type ProductTranslations = Partial<Record<TargetLocale, { name: string; description: string | null }>>;

export interface ProductDto {
  id: string;
  /** null for the platform catalog, otherwise the reseller organization. */
  ownerOrgId: string | null;
  name: string;
  description: string | null;
  module: ModuleKey | null;
  unitPrice: number;
  currency: Currency;
  interval: BillingInterval;
  /** null means the issuer's default rate. */
  taxRateBp: number | null;
  active: boolean;
  /** Texts in the other languages; read them through productText(). */
  translations: ProductTranslations;
  createdAt: string;
}

/** A service ("Dienst") a customer has: billable and optionally linked to a resource. */
export interface ServiceDto {
  id: string;
  orgId: string;
  product: { id: string; name: string } | null;
  name: string;
  description: string | null;
  module: ModuleKey | null;
  resource: { type: ServiceResourceType; id: string; name: string | null } | null;
  unitPrice: number;
  quantity: number;
  currency: Currency;
  interval: BillingInterval;
  taxRateBp: number | null;
  status: ServiceStatus;
  startsAt: string;
  /** Next date an invoice line is due. null once a one-off service was billed or it ended. */
  nextBillingAt: string | null;
  /**
   * Last day of the service. Together with a status other than "cancelled" a scheduled cancellation: the
   * service runs and is billed up to this day and ends afterwards.
   */
  endsAt: string | null;
  cancelledAt: string | null;
  /** A scheduled cancellation also switches the module off when the service ends. False otherwise. */
  deactivateModuleAtEnd: boolean;
  /** Internal note of the seller. Always null in the customer's view. */
  notes: string | null;
  createdAt: string;
}

export interface InvoiceLineDto {
  id: string;
  position: number;
  description: string;
  quantity: number;
  /** e.g. "Monat", "Stk." */
  unit: string | null;
  unitPrice: number;
  taxRateBp: number;
  /** Net amount of the line: round(quantity * unitPrice). */
  total: number;
  serviceId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface InvoiceDto {
  id: string;
  /** Assigned when the invoice is finalized. Drafts have none. */
  number: string | null;
  org: { id: string; name: string; slug: string };
  issuer: { orgId: string | null; name: string };
  status: InvoiceStatus;
  currency: Currency;
  issueDate: string | null;
  dueDate: string | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  /** total - amountPaid */
  amountDue: number;
  overdue: boolean;
  zoho: { status: ZohoSyncStatus | null; invoiceId: string | null; error: string | null } | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface TaxBreakdownDto {
  rateBp: number;
  net: number;
  tax: number;
}

export interface InvoiceDetailDto extends InvoiceDto {
  lines: InvoiceLineDto[];
  taxBreakdown: TaxBreakdownDto[];
  /** Snapshot taken at finalization, live profile for drafts. */
  billingAddress: (PostalAddress & { email: string | null; vatId: string | null }) | null;
  notes: string | null;
  /** Why the invoice was voided. Only set for void invoices. */
  voidReason: string | null;
  payments: PaymentDto[];
  /** What the current user may do with this invoice. */
  can: { edit: boolean; finalize: boolean; void: boolean; markPaid: boolean; pay: boolean; send: boolean };
  /** Online payment methods available for this invoice right now. */
  payMethods: PaymentMethod[];
  /** invoices.locale (fixed at finalize) ?? the current billing language for drafts and old invoices. */
  locale: Locale;
}

export interface CreditTransactionDto {
  id: string;
  amount: number;
  currency: Currency;
  type: CreditType;
  description: string;
  invoice: { id: string; number: string | null } | null;
  paymentId: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  /** Balance after this transaction. */
  balanceAfter: number;
}

export interface PaymentDto {
  id: string;
  orgId: string;
  invoice: { id: string; number: string | null } | null;
  provider: PaymentProvider;
  method: PaymentMethod;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  reference: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Customer view: GET /orgs/:orgId/billing/summary */
export interface BillingSummaryDto {
  currency: Currency;
  balance: number;
  openTotal: number;
  overdueTotal: number;
  openCount: number;
  /** Who sends the invoices. */
  seller: { orgId: string | null; name: string };
  /** Online payment methods, empty when the seller is a reseller or Stripe is not set up. */
  payMethods: PaymentMethod[];
  activeServices: number;
  /** Sum of active recurring services per month, net. */
  monthlyRecurring: number;
}

/** Seller view of one customer: GET /billing/customers/:orgId */
export interface SellerCustomerBillingDto {
  org: { id: string; name: string; slug: string; status: 'active' | 'suspended'; modules: ModuleKey[] };
  seller: { orgId: string | null; name: string };
  profile: BillingProfileDto;
  summary: BillingSummaryDto;
  /** What the current user may do as the seller: write = book, invoice and change services. */
  can: { write: boolean };
}

/** Admin: GET /admin/billing/stats */
export interface BillingStatsDto {
  currency: Currency;
  openTotal: number;
  overdueTotal: number;
  openCount: number;
  overdueCount: number;
  paidThisMonth: number;
  creditOutstanding: number;
  monthlyRecurring: number;
  draftCount: number;
  zohoErrors: number;
}

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  taxRateBp?: number | null;
  serviceId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}

/**
 * The product text in a language: per field the translation when set, else the German text (plan O14).
 * de: name and description as stored.
 */
export function productText(
  product: Pick<ProductDto, 'name' | 'description' | 'translations'>,
  locale: Locale,
): { name: string; description: string | null } {
  if (locale === 'de') return { name: product.name, description: product.description };
  const translated = product.translations?.[locale];
  return {
    name: translated?.name?.trim() ? translated.name : product.name,
    description: translated?.description?.trim() ? translated.description : product.description,
  };
}

/**
 * Formats an amount in minor units in the Intl format of the locale, e.g. formatMoney(12345, 'CHF', 'de') gives
 * "CHF 123.45" and 'en' gives en-GB. Billing mails and the PDF pass 'de' (Swiss format in every language).
 */
export function formatMoney(amount: number, currency: Currency | string, locale: Locale = 'de'): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

/** Net line total in minor units. */
export function lineTotal(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice);
}

/** Tax on a net amount, rounded to the minor unit (Swiss invoices round to 0.01). */
export function taxFor(net: number, rateBp: number): number {
  return Math.round((net * rateBp) / 10_000);
}

/**
 * Totals for a set of lines. Tax is computed per rate on the summed net amount (not per
 * line) so the printed tax breakdown always adds up.
 */
export function invoiceTotals(lines: { quantity: number; unitPrice: number; taxRateBp: number }[]): {
  subtotal: number;
  taxTotal: number;
  total: number;
  breakdown: TaxBreakdownDto[];
} {
  const byRate = new Map<number, number>();
  let subtotal = 0;
  for (const line of lines) {
    const net = lineTotal(line.quantity, line.unitPrice);
    subtotal += net;
    byRate.set(line.taxRateBp, (byRate.get(line.taxRateBp) ?? 0) + net);
  }
  const breakdown = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rateBp, net]) => ({ rateBp, net, tax: taxFor(net, rateBp) }));
  const taxTotal = breakdown.reduce((sum, b) => sum + b.tax, 0);
  return { subtotal, taxTotal, total: subtotal + taxTotal, breakdown };
}
