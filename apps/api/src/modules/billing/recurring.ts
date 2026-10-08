import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type pg from 'pg';
import { lineTotal, type Currency } from '@weblion/shared';
import type { AppContext } from '../../context';
import type { Tx } from '../../db/client';
import { organizations, products, services, settings, type Organization } from '../../db/schema';
import { billingCurrency, lockOrgBilling } from './ledger';
import { loadProfile } from './dto';
import { afterFinalize, amountsProblem, createDraft, finalizeInTx, type FinalizeResult } from './invoices';
import { getBillingSettings, issuerSettings } from './settings';
import { addDays, formatDateCH, nextBillingDate, todayZurich } from './dates';

/**
 * Recurring billing: services that are due become invoice lines, one line per service
 * and period, and their next billing date moves on. Runs per organization in a single
 * transaction under the organization's billing lock with the services locked, so two
 * runs at the same time (button and job, two instances) can never bill a period twice.
 */

/** Upper bound of periods per service and run, so a service far in the past can't explode an invoice. */
const MAX_PERIODS_PER_RUN = 24;

/** Advisory lock id of the daily job (the sync job uses 742_001 and 742_002). */
const JOB_LOCK = 742_003;
const JOB_STATE_KEY = 'billing_job';

export interface SkippedService {
  serviceId: string;
  name: string;
  currency: Currency;
  /** currency: in another currency than the customer's; amount: its line would not fit the invoice. */
  reason: 'currency' | 'amount';
}

export interface GenerateResult {
  /** The new invoice, null when nothing was due. */
  finalized: FinalizeResult | null;
  invoiceId: string | null;
  lines: number;
  /** Services that were due but not billed, they stay due. */
  skipped: SkippedService[];
}

export async function generateInTx(
  tx: Tx,
  org: Organization,
  until: string,
  opts: { finalize: boolean; userId: string | null },
): Promise<GenerateResult> {
  await lockOrgBilling(tx, org.id);
  const due = await tx
    .select({ service: services, productRate: products.taxRateBp })
    .from(services)
    .leftJoin(products, eq(products.id, services.productId))
    .where(
      and(
        eq(services.orgId, org.id),
        eq(services.status, 'active'),
        isNotNull(services.nextBillingAt),
        lte(services.nextBillingAt, until),
      ),
    )
    .orderBy(asc(services.createdAt), asc(services.id))
    .for('update', { of: services });
  if (due.length === 0) return { finalized: null, invoiceId: null, lines: 0, skipped: [] };

  const currency = await billingCurrency(tx, org.id);
  const profile = await loadProfile(tx, org.id);
  const issuer = await issuerSettings(tx, org.parentOrgId ?? null);
  const fallbackRate = profile?.taxRateBp ?? issuer.defaultTaxRateBp;
  const skipped: SkippedService[] = [];
  const lines: Parameters<typeof createDraft>[2]['lines'] = [];

  for (const { service, productRate } of due) {
    if (service.currency !== currency) {
      skipped.push({
        serviceId: service.id,
        name: service.name,
        currency: service.currency,
        reason: 'currency',
      });
      continue;
    }
    const taxRateBp = service.taxRateBp ?? productRate ?? fallbackRate;
    let next: string | null = service.nextBillingAt;
    let billed = 0;
    for (let n = 0; next && next <= until && n < MAX_PERIODS_PER_RUN; n++) {
      if (service.endsAt && next > service.endsAt) {
        next = null;
        break;
      }
      const following = nextBillingDate(next, service.interval, service.startsAt);
      let periodEnd = following ? addDays(following, -1) : null;
      if (periodEnd && service.endsAt && periodEnd > service.endsAt) periodEnd = service.endsAt;
      lines.push({
        description: periodEnd
          ? `${service.name}, ${formatDateCH(next)} - ${formatDateCH(periodEnd)}`
          : service.name,
        quantity: service.quantity,
        unit: null,
        unitPrice: service.unitPrice,
        taxRateBp,
        total: lineTotal(service.quantity, service.unitPrice),
        serviceId: service.id,
        periodStart: next,
        periodEnd,
      });
      // An amount beyond what the database holds would fail the whole run, every day.
      // The period stays due: it goes on a later invoice, or staff fix the price.
      if (amountsProblem(lines)) {
        lines.pop();
        break;
      }
      billed++;
      next = following;
    }
    if (billed === 0 && next === service.nextBillingAt) {
      // Not even its first due period fits.
      skipped.push({
        serviceId: service.id,
        name: service.name,
        currency: service.currency,
        reason: 'amount',
      });
      continue;
    }
    await tx.update(services).set({ nextBillingAt: next }).where(eq(services.id, service.id));
  }
  if (lines.length === 0) return { finalized: null, invoiceId: null, lines: 0, skipped };

  const draft = await createDraft(tx, org, { lines }, opts.userId);
  const finalized = opts.finalize ? await finalizeInTx(tx, draft.id, opts.userId) : null;
  return { finalized, invoiceId: draft.id, lines: lines.length, skipped };
}

/**
 * Daily job: bills every organization with due services. Runs hourly but works once per
 * day (remembered in the settings table) and only on the instance holding the lock.
 */
export class BillingJob {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly ctx: AppContext,
    private readonly pool: pg.Pool,
  ) {}

  /** Bills all due services up to `today`. Returns counts for the log. */
  async runDue(today = todayZurich()): Promise<{ orgs: number; invoices: number; failed: number }> {
    const { db, log } = this.ctx;
    const config = await getBillingSettings(db);
    const dueOrgIds = db
      .selectDistinct({ orgId: services.orgId })
      .from(services)
      .where(
        and(
          eq(services.status, 'active'),
          isNotNull(services.nextBillingAt),
          lte(services.nextBillingAt, today),
        ),
      );
    const due = await db.select().from(organizations).where(inArray(organizations.id, dueOrgIds));
    let created = 0;
    let failed = 0;
    for (const org of due) {
      try {
        // Resellers review and send their invoices themselves; the platform setting only
        // finalizes invoices the platform issues.
        const finalize = config.autoFinalizeRecurring && !org.parentOrgId;
        const result = await db.transaction((tx) => generateInTx(tx, org, today, { finalize, userId: null }));
        if (result.finalized) await afterFinalize(this.ctx, result.finalized, config.sendInvoiceEmails);
        if (result.invoiceId) {
          created++;
          await this.ctx.audit.record(null, {
            action: 'invoice.generate',
            orgId: result.finalized ? org.id : (org.parentOrgId ?? null),
            resourceType: 'invoice',
            resourceId: result.invoiceId,
            actorName: 'Abrechnungsjob',
            details: {
              customerOrgId: org.id,
              lines: result.lines,
              finalized: !!result.finalized,
              skipped: result.skipped.length,
            },
          });
        }
        if (result.skipped.length > 0) {
          log.warn({ orgId: org.id, skipped: result.skipped }, 'due services were not billed');
        }
      } catch (err) {
        failed++;
        log.error({ err, orgId: org.id }, 'recurring billing failed');
      }
    }
    return { orgs: due.length, invoices: created, failed };
  }

  /** One scheduled tick: runs at most once per day across all instances. */
  async tick(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [
        JOB_LOCK,
      ]);
      if (!rows[0]?.locked) return;
      try {
        const today = todayZurich();
        const state = await this.ctx.db.query.settings.findFirst({ where: eq(settings.key, JOB_STATE_KEY) });
        if ((state?.value as { lastRun?: string } | undefined)?.lastRun === today) return;
        const result = await this.runDue(today);
        const value = { lastRun: today, ...result };
        await this.ctx.db
          .insert(settings)
          .values({ key: JOB_STATE_KEY, value })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
        this.ctx.log.info({ ...result }, 'recurring billing done');
      } finally {
        await client.query('select pg_advisory_unlock($1)', [JOB_LOCK]);
      }
    } finally {
      client.release();
    }
  }

  start() {
    const run = () => {
      this.tick().catch((err) => this.ctx.log.warn({ err, job: 'billing' }, 'scheduled job failed'));
    };
    this.timers.push(setTimeout(run, 60_000));
    this.timers.push(setInterval(run, 3600_000));
    for (const t of this.timers) t.unref();
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
