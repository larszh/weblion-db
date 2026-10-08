import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Currency, PaymentMethod } from '@weblion/shared';
import type { Env } from '../config/env';
import type { Database } from '../db/client';
import {
  billingProfiles,
  creditTransactions,
  invoices,
  organizations,
  payments,
  settings,
  type Invoice,
} from '../db/schema';
import { billingAddressOf, invoiceLinesOf, loadProfile } from '../modules/billing/dto';
import { issuerSettings } from '../modules/billing/settings';
import { todayZurich } from '../modules/billing/dates';

/**
 * Zoho Books: invoices the platform issues, and the payments on them, are pushed to Zoho
 * Books as contacts, invoices (with our numbers) and customer payments. Invoices of
 * resellers are none of the platform's accounting and are marked "skipped".
 *
 * Auth is the OAuth refresh token flow; the access token is cached until shortly before
 * it expires. Sync calls are fire-and-forget: they record their outcome on the invoice
 * (zohoStatus/zohoError) or payment (zohoPaymentId) and never throw into the caller.
 * Syncs of one invoice run one after another, so nothing is pushed twice.
 */

const STATE_KEY = 'zoho.state';

interface ZohoState {
  lastError: string | null;
  lastErrorAt: string | null;
  lastSyncAt: string | null;
}

/** A problem worth showing to staff: Zoho's own message or something missing on our side. */
class ZohoError extends Error {}

/** Zoho's built-in payment modes. TWINT and credit have none of their own. */
const PAYMENT_MODES: Record<PaymentMethod, string> = {
  card: 'creditcard',
  twint: 'others',
  bank_transfer: 'banktransfer',
  cash: 'cash',
  credit: 'others',
  other: 'others',
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  card: 'Karte (Stripe)',
  twint: 'TWINT (Stripe)',
  bank_transfer: 'Banküberweisung',
  cash: 'Bar',
  credit: 'Guthaben',
  other: 'Andere',
};

/** Minor units to the decimal amounts Zoho expects. */
const decimal = (minor: number) => Math.round(minor) / 100;

const regionNames = new Intl.DisplayNames(['de'], { type: 'region' });
const countryName = (code: string) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

type Json = Record<string, unknown>;

export class ZohoService {
  private token: { value: string; expiresAt: number } | null = null;
  private refreshing: Promise<string> | null = null;
  private currencyIds: Map<string, string> | null = null;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
  ) {}

  get configured(): boolean {
    const e = this.env;
    return !!(e.ZOHO_CLIENT_ID && e.ZOHO_CLIENT_SECRET && e.ZOHO_REFRESH_TOKEN && e.ZOHO_ORGANIZATION_ID);
  }

  /** Connection state for the admin area (GET /admin/integrations). */
  async status(): Promise<{
    configured: boolean;
    organizationId: string | null;
    lastError: string | null;
    lastSyncAt: string | null;
  }> {
    const state = await this.readState();
    return {
      configured: this.configured,
      organizationId: this.env.ZOHO_ORGANIZATION_ID ?? null,
      lastError: state.lastError,
      lastSyncAt: state.lastSyncAt,
    };
  }

  /** Logs in and looks up the configured organization. */
  async testConnection(): Promise<{ ok: boolean; organizationName?: string; error?: string }> {
    if (!this.configured) return { ok: false, error: 'Zoho Books is not configured' };
    try {
      const res = await this.api<{ organizations?: { organization_id?: unknown; name?: string }[] }>(
        'GET',
        '/organizations',
      );
      const org = res.organizations?.find((o) => String(o.organization_id) === this.env.ZOHO_ORGANIZATION_ID);
      if (!org) {
        throw new ZohoError(`Organization ${this.env.ZOHO_ORGANIZATION_ID} not found in this Zoho account`);
      }
      await this.saveState({ lastError: null, lastErrorAt: null });
      return { ok: true, ...(org.name ? { organizationName: org.name } : {}) };
    } catch (err) {
      const message = this.describe(err);
      this.log.warn({ err }, 'zoho connection test failed');
      await this.saveState({ lastError: message, lastErrorAt: new Date().toISOString() });
      return { ok: false, error: message };
    }
  }

  /**
   * Pushes a finalized platform invoice (and its contact) to Zoho Books, then every
   * payment on it that is not there yet. A voided invoice is voided in Zoho as well.
   */
  syncInvoice(invoiceId: string): Promise<void> {
    return this.serial(invoiceId, () => this.sync(invoiceId));
  }

  /** Pushes a succeeded payment of a platform invoice to Zoho Books. */
  async syncPayment(paymentId: string): Promise<void> {
    try {
      const payment = await this.db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
      if (!payment?.invoiceId || payment.status !== 'succeeded' || payment.zohoPaymentId) return;
      // The invoice sync pushes every payment Zoho does not have yet, this one included.
      await this.syncInvoice(payment.invoiceId);
    } catch (err) {
      this.log.warn({ err, paymentId }, 'zoho payment sync failed');
    }
  }

  /** Marks an invoice as void in Zoho Books. */
  voidInvoice(invoiceId: string): Promise<void> {
    return this.syncInvoice(invoiceId);
  }

  /** Retries platform invoices whose last sync failed or never finished. */
  async syncPending(limit = 100): Promise<{ synced: number; failed: number }> {
    const rows = await this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          isNull(invoices.issuerOrgId),
          inArray(invoices.status, ['open', 'paid', 'void']),
          inArray(invoices.zohoStatus, ['pending', 'error']),
        ),
      )
      .orderBy(asc(invoices.createdAt))
      .limit(limit);
    let synced = 0;
    let failed = 0;
    for (const { id } of rows) {
      await this.syncInvoice(id);
      const after = await this.db.query.invoices.findFirst({
        where: eq(invoices.id, id),
        columns: { zohoStatus: true },
      });
      if (after?.zohoStatus === 'synced' || after?.zohoStatus === 'skipped') synced++;
      else failed++;
    }
    return { synced, failed };
  }

  // --- Sync -------------------------------------------------------------------------

  /** Runs syncs of the same invoice one after another. */
  private serial(key: string, fn: () => Promise<void>): Promise<void> {
    const run = (this.queues.get(key) ?? Promise.resolve()).then(fn);
    const done = run.catch(() => undefined);
    this.queues.set(key, done);
    void done.then(() => {
      if (this.queues.get(key) === done) this.queues.delete(key);
    });
    return done;
  }

  private async sync(invoiceId: string): Promise<void> {
    let invoice: Invoice | undefined;
    try {
      invoice = await this.db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) });
      if (!invoice || invoice.status === 'draft') return;
      if (invoice.issuerOrgId) {
        // Resellers keep their own books.
        if (invoice.zohoStatus !== 'skipped')
          await this.mark(invoiceId, { zohoStatus: 'skipped', zohoError: null });
        return;
      }
      if (!this.configured) return;
      if (invoice.status === 'void' && !invoice.zohoInvoiceId) {
        await this.mark(invoiceId, { zohoStatus: 'skipped', zohoError: null });
        return;
      }
      // Stays "pending" if the process dies halfway, so sync-pending picks it up again.
      await this.mark(invoiceId, { zohoStatus: 'pending' });
      await this.push(invoice);
      await this.mark(invoiceId, { zohoStatus: 'synced', zohoError: null });
      await this.saveState({ lastSyncAt: new Date().toISOString(), lastError: null, lastErrorAt: null });
    } catch (err) {
      const message = this.describe(err);
      this.log.warn({ err, invoiceId }, 'zoho invoice sync failed');
      try {
        if (invoice && !invoice.issuerOrgId) {
          await this.mark(invoiceId, { zohoStatus: 'error', zohoError: message.slice(0, 1000) });
        }
        await this.saveState({ lastError: message, lastErrorAt: new Date().toISOString() });
      } catch (inner) {
        this.log.error({ err: inner, invoiceId }, 'storing the zoho sync error failed');
      }
    }
  }

  private async push(invoice: Invoice): Promise<void> {
    // Line items first: a missing tax mapping should fail before anything is created.
    const lineItems = await this.lineItems(invoice);
    const contactId = await this.ensureContact(invoice);
    const body = this.invoiceBody(invoice, contactId, lineItems);

    let zohoId = invoice.zohoInvoiceId;
    let remote: { status: string | null; total: number | null } = { status: null, total: null };
    if (!zohoId) {
      const created = await this.api<{ invoice?: Json }>('POST', '/invoices', {
        query: { ignore_auto_number_generation: 'true' },
        body,
      });
      zohoId = created.invoice?.invoice_id ? String(created.invoice.invoice_id) : null;
      if (!zohoId) throw new ZohoError('Zoho Books returned no invoice id');
      // Remember it right away: a retry must never create the invoice a second time.
      await this.mark(invoice.id, { zohoInvoiceId: zohoId });
      remote = remoteState(created.invoice, 'draft');
    } else if (invoice.zohoStatus !== 'synced' || invoice.status === 'void') {
      // An earlier attempt broke off or the invoice was voided since: ask where it stands.
      const current = await this.api<{ invoice?: Json }>('GET', `/invoices/${encodeURIComponent(zohoId)}`);
      remote = remoteState(current.invoice, null);
    }
    const path = `/invoices/${encodeURIComponent(zohoId)}`;

    if (invoice.status === 'void') {
      if (remote.status !== 'void') await this.api('POST', `${path}/status/void`);
      return;
    }
    if (remote.status === 'draft') {
      // Only drafts can still be corrected. Once sent, the invoice stays as it is.
      await this.alignTotal(invoice, path, remote.total, body, !invoice.zohoInvoiceId);
      await this.api('POST', `${path}/status/sent`);
    }
    await this.pushPayments(invoice, zohoId, contactId);
  }

  /**
   * We compute tax per rate, Zoho per line, which can differ by a cent. The difference
   * goes into Zoho's adjustment field so both totals and every payment match. A larger
   * difference means a wrong tax mapping: the draft stays unsent until it is fixed.
   */
  private async alignTotal(
    invoice: Invoice,
    path: string,
    remoteTotal: number | null,
    body: Json,
    justCreated: boolean,
  ): Promise<void> {
    const query = { ignore_auto_number_generation: 'true' };
    const diffTo = (total: number) => Math.round(invoice.total - total * 100);
    let total = remoteTotal;
    if (total !== null && !justCreated && Math.abs(diffTo(total)) > 100) {
      // A draft from an earlier attempt: send the lines again (e.g. ZOHO_TAX_IDS was fixed).
      const updated = await this.api<{ invoice?: Json }>('PUT', path, { query, body });
      total = remoteState(updated.invoice, null).total;
    }
    if (total === null) return;
    const diff = diffTo(total);
    if (diff === 0) return;
    if (Math.abs(diff) > 100) {
      throw new ZohoError(
        `Zoho Books computed a total of ${total.toFixed(2)} instead of ${decimal(invoice.total).toFixed(2)}, check ZOHO_TAX_IDS`,
      );
    }
    await this.api('PUT', path, {
      query,
      body: { ...body, adjustment: decimal(diff), adjustment_description: 'Rundungsdifferenz' },
    });
  }

  private invoiceBody(invoice: Invoice, contactId: string, lineItems: Json[]): Json {
    return {
      customer_id: contactId,
      invoice_number: invoice.number,
      date: invoice.issueDate,
      due_date: invoice.dueDate,
      is_inclusive_tax: false,
      line_items: lineItems,
      ...(invoice.notes ? { notes: invoice.notes } : {}),
    };
  }

  private async lineItems(invoice: Invoice): Promise<Json[]> {
    const taxIds = this.taxIds();
    const lines = await invoiceLinesOf(this.db, invoice.id);
    return lines.map((line) => {
      const taxId = taxIds.get(line.taxRateBp);
      if (!taxId && line.taxRateBp !== 0) {
        throw new ZohoError(`No Zoho tax id configured for ${line.taxRateBp / 100} % (ZOHO_TAX_IDS)`);
      }
      return {
        name: line.description.slice(0, 100),
        ...(line.description.length > 100 ? { description: line.description } : {}),
        rate: decimal(line.unitPrice),
        quantity: line.quantity,
        ...(line.unit ? { unit: line.unit } : {}),
        ...(taxId ? { tax_id: taxId } : {}),
      };
    });
  }

  /** ZOHO_TAX_IDS "810:123,0:456" as rate in basis points -> Zoho tax id. */
  private taxIds(): Map<number, string> {
    const map = new Map<number, string>();
    for (const part of (this.env.ZOHO_TAX_IDS ?? '').split(',')) {
      const [rate, id] = part.split(':').map((s) => s.trim());
      if (rate && id && /^\d+$/.test(rate)) map.set(Number(rate), id);
    }
    return map;
  }

  /**
   * The Zoho contact of the invoiced organization: the stored one, else an existing contact
   * with the same name (Zoho requires unique names), else a new one.
   */
  private async ensureContact(invoice: Invoice): Promise<string> {
    const profile = await loadProfile(this.db, invoice.orgId);
    if (profile?.zohoContactId) return profile.zohoContactId;
    const org = await this.db.query.organizations.findFirst({ where: eq(organizations.id, invoice.orgId) });
    if (!org) throw new ZohoError('Organization not found');
    const address = billingAddressOf(org, profile);
    const name = (address.companyName || org.name).slice(0, 200);

    const found = await this.api<{ contacts?: { contact_id?: unknown; contact_name?: string }[] }>(
      'GET',
      '/contacts',
      { query: { contact_name: name } },
    );
    const match = found.contacts?.find((c) => c.contact_name === name);
    let contactId = match?.contact_id ? String(match.contact_id) : null;
    if (!contactId) {
      const currencyId = await this.currencyId(invoice.currency);
      const [first, ...rest] = (address.contactName ?? '').trim().split(/\s+/);
      const created = await this.api<{ contact?: { contact_id?: unknown } }>('POST', '/contacts', {
        body: {
          contact_name: name,
          company_name: address.companyName ?? name,
          contact_type: 'customer',
          currency_id: currencyId,
          billing_address: {
            attention: address.contactName ?? undefined,
            address: address.line1 ?? undefined,
            street2: address.line2 ?? undefined,
            zip: address.postalCode ?? undefined,
            city: address.city ?? undefined,
            country: countryName(address.country),
          },
          ...(address.email
            ? {
                contact_persons: [
                  {
                    first_name: first || name,
                    ...(rest.length ? { last_name: rest.join(' ') } : {}),
                    email: address.email,
                    is_primary_contact: true,
                  },
                ],
              }
            : {}),
        },
      });
      contactId = created.contact?.contact_id ? String(created.contact.contact_id) : null;
      if (!contactId) throw new ZohoError('Zoho Books returned no contact id');
    }

    // Organizations without a profile get one, with the defaults they are billed with anyway.
    const issuer = await issuerSettings(this.db, null);
    await this.db
      .insert(billingProfiles)
      .values({
        orgId: invoice.orgId,
        zohoContactId: contactId,
        currency: invoice.currency,
        paymentTermsDays: issuer.defaultPaymentTermsDays,
      })
      .onConflictDoUpdate({ target: billingProfiles.orgId, set: { zohoContactId: contactId } });
    return contactId;
  }

  private async currencyId(code: Currency): Promise<string> {
    if (!this.currencyIds) {
      const res = await this.api<{ currencies?: { currency_id?: unknown; currency_code?: string }[] }>(
        'GET',
        '/settings/currencies',
      );
      this.currencyIds = new Map(
        (res.currencies ?? [])
          .filter((c) => c.currency_code && c.currency_id)
          .map((c) => [c.currency_code!.toUpperCase(), String(c.currency_id)]),
      );
    }
    const id = this.currencyIds.get(code);
    if (!id) throw new ZohoError(`Currency ${code} is not set up in Zoho Books`);
    return id;
  }

  /**
   * Pushes succeeded payments of an invoice that Zoho does not have yet. Only the part
   * applied to the invoice counts: an overpayment became credit and reaches Zoho when that
   * credit pays another invoice.
   */
  private async pushPayments(invoice: Invoice, zohoInvoiceId: string, contactId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.invoiceId, invoice.id),
          eq(payments.status, 'succeeded'),
          isNull(payments.zohoPaymentId),
        ),
      )
      .orderBy(asc(payments.completedAt), asc(payments.createdAt));
    for (const payment of rows) {
      const [credited] = await this.db
        .select({ sum: sql<string | null>`sum(${creditTransactions.amount})` })
        .from(creditTransactions)
        .where(and(eq(creditTransactions.paymentId, payment.id), gt(creditTransactions.amount, 0)));
      const applied = payment.amount - Number(credited?.sum ?? 0);
      if (applied <= 0) continue;
      const created = await this.api<{ payment?: { payment_id?: unknown } }>('POST', '/customerpayments', {
        body: {
          customer_id: contactId,
          payment_mode: PAYMENT_MODES[payment.method],
          amount: decimal(applied),
          date: todayZurich(payment.completedAt ?? payment.createdAt),
          ...(payment.reference ? { reference_number: payment.reference.slice(0, 100) } : {}),
          description: `${METHOD_LABELS[payment.method]}, weblion.one ${payment.id}`,
          invoices: [{ invoice_id: zohoInvoiceId, amount_applied: decimal(applied) }],
        },
      });
      const zohoPaymentId = created.payment?.payment_id ? String(created.payment.payment_id) : null;
      if (!zohoPaymentId) throw new ZohoError('Zoho Books returned no payment id');
      await this.db.update(payments).set({ zohoPaymentId }).where(eq(payments.id, payment.id));
    }
  }

  private async mark(invoiceId: string, values: Partial<typeof invoices.$inferInsert>): Promise<void> {
    await this.db.update(invoices).set(values).where(eq(invoices.id, invoiceId));
  }

  // --- HTTP -------------------------------------------------------------------------

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    this.refreshing ??= this.refreshToken().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshToken(): Promise<string> {
    const env = this.env;
    const res = await this.fetchJson(`${env.ZOHO_ACCOUNTS_URL.replace(/\/+$/, '')}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: env.ZOHO_REFRESH_TOKEN ?? '',
        client_id: env.ZOHO_CLIENT_ID ?? '',
        client_secret: env.ZOHO_CLIENT_SECRET ?? '',
      }).toString(),
    });
    const body = isJson(res.body) ? res.body : {};
    if (res.status >= 400 || typeof body.access_token !== 'string') {
      // Zoho answers with codes like "invalid_code", never with the credentials themselves.
      const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      throw new ZohoError(`Zoho login failed (${reason})`);
    }
    const expiresIn = Number(body.expires_in ?? 3600);
    // A minute of margin so a token never expires on its way to Zoho.
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max((Number.isFinite(expiresIn) ? expiresIn : 3600) - 60, 0) * 1000,
    };
    return body.access_token;
  }

  private async api<T = Json>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    opts: { query?: Record<string, string>; body?: Json } = {},
    retried = false,
  ): Promise<T> {
    const token = await this.accessToken();
    const url = new URL(`${this.env.ZOHO_API_URL.replace(/\/+$/, '')}${path}`);
    url.searchParams.set('organization_id', this.env.ZOHO_ORGANIZATION_ID ?? '');
    for (const [key, value] of Object.entries(opts.query ?? {})) url.searchParams.set(key, value);
    const res = await this.fetchJson(url.toString(), {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        Accept: 'application/json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && !retried) {
      // Revoked or expired early: log in again once.
      this.token = null;
      return this.api<T>(method, path, opts, true);
    }
    const body = isJson(res.body) ? res.body : {};
    if (res.status >= 400 || (typeof body.code === 'number' && body.code !== 0)) {
      const message = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
      throw new ZohoError(`${message}${typeof body.code === 'number' ? ` (code ${body.code})` : ''}`);
    }
    return body as T;
  }

  private async fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      const cause =
        err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
      throw new ZohoError(`Zoho Books is not reachable: ${cause}`);
    }
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON, the status code tells the rest.
    }
    return { status: response.status, body };
  }

  // --- State ------------------------------------------------------------------------

  /** Our own messages and Zoho's are fine to show, anything else stays in the server log. */
  private describe(err: unknown): string {
    return err instanceof ZohoError ? err.message : 'Unexpected error, see the server log';
  }

  private async readState(): Promise<ZohoState> {
    const row = await this.db.query.settings.findFirst({ where: eq(settings.key, STATE_KEY) });
    return {
      lastError: null,
      lastErrorAt: null,
      lastSyncAt: null,
      ...((row?.value ?? {}) as Partial<ZohoState>),
    };
  }

  private async saveState(patch: Partial<ZohoState>): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key: STATE_KEY, value: patch })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: sql`${settings.value} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() },
      });
  }
}

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Status and total of a Zoho invoice as returned by the API. */
function remoteState(invoice: Json | undefined, fallbackStatus: string | null) {
  const total = Number(invoice?.total);
  return {
    status: typeof invoice?.status === 'string' ? invoice.status : fallbackStatus,
    total: invoice && invoice.total !== undefined && Number.isFinite(total) ? total : null,
  };
}
