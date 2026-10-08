import { and, eq, isNull } from 'drizzle-orm';
import { INTERVAL_MONTHS, type BillingInterval, type ModuleKey } from '@weblion/shared';
import type { Database } from './client';
import {
  billingProfiles,
  domains,
  invoices,
  organizations,
  products,
  projects,
  servers,
  services,
  type Organization,
  type Product,
} from './schema';
import { addCredit } from '../modules/billing/ledger';
import { createDraft, finalizeInTx, markPaidInTx } from '../modules/billing/invoices';
import { addDays, addMonths, formatDateCH, todayZurich } from '../modules/billing/dates';

const PLATFORM_PRODUCTS: {
  name: string;
  description: string;
  module: ModuleKey | null;
  unitPrice: number;
  interval: BillingInterval;
}[] = [
  {
    name: 'Cloud Server S',
    description: '2 vCPU, 4 GB RAM, 80 GB SSD',
    module: 'servers',
    unitPrice: 1900,
    interval: 'monthly',
  },
  {
    name: 'Cloud Server M',
    description: '4 vCPU, 8 GB RAM, 160 GB SSD',
    module: 'servers',
    unitPrice: 3900,
    interval: 'monthly',
  },
  {
    name: 'Webhosting Basic',
    description: '10 GB Speicher, 10 Postfächer, 5 Datenbanken',
    module: 'webhosting',
    unitPrice: 990,
    interval: 'monthly',
  },
  {
    name: 'Domain .ch',
    description: 'Registrierung und DNS',
    module: 'dns',
    unitPrice: 1800,
    interval: 'yearly',
  },
  {
    name: 'Einrichtung',
    description: 'Einmalige Einrichtung',
    module: null,
    unitPrice: 4900,
    interval: 'once',
  },
];

/**
 * Demo data for the billing area: the platform price list, services, invoices and credit
 * for Muster AG and, if the reseller demo exists, an invoice a reseller sends to its
 * customer. Idempotent. Called from seedDemo after the base data exists.
 */
export async function seedBillingDemo(db: Database, log: string[]): Promise<void> {
  const catalog = new Map<string, Product>();
  for (const p of PLATFORM_PRODUCTS) {
    let product = await db.query.products.findFirst({
      where: and(isNull(products.ownerOrgId), eq(products.name, p.name)),
    });
    if (!product) {
      [product] = await db
        .insert(products)
        .values({ ...p, ownerOrgId: null, currency: 'CHF' })
        .returning();
      log.push(`product ${p.name}`);
    }
    catalog.set(p.name, product!);
  }

  const muster = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'muster-ag') });
  if (muster) await seedCustomer(db, log, muster, catalog);

  const huber = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'baeckerei-huber') });
  if (huber?.parentOrgId) await seedResellerCustomer(db, log, huber);
}

/** First day of the month `offset` months from now. */
function monthStart(offset: number): string {
  return addMonths(`${todayZurich().slice(0, 7)}-01`, offset);
}

function period(name: string, start: string, interval: BillingInterval) {
  const end = addDays(addMonths(start, INTERVAL_MONTHS[interval]), -1);
  return {
    description: `${name}, ${formatDateCH(start)} - ${formatDateCH(end)}`,
    periodStart: start,
    periodEnd: end,
  };
}

async function seedCustomer(db: Database, log: string[], org: Organization, catalog: Map<string, Product>) {
  await db
    .insert(billingProfiles)
    .values({
      orgId: org.id,
      companyName: 'Muster AG',
      contactName: 'Anna Muster',
      line1: 'Bahnhofstrasse 10',
      postalCode: '8001',
      city: 'Zürich',
      country: 'CH',
      email: 'buchhaltung@muster.example',
      vatId: 'CHE-123.456.789 MWST',
    })
    .onConflictDoNothing();

  const existing = await db.query.invoices.findFirst({ where: eq(invoices.orgId, org.id) });
  if (existing) return;

  const [web] = await db
    .select({ id: servers.id })
    .from(servers)
    .innerJoin(projects, eq(projects.id, servers.projectId))
    .where(and(eq(projects.orgId, org.id), eq(servers.name, 'web-01')))
    .limit(1);
  const domain = await db.query.domains.findFirst({ where: eq(domains.orgId, org.id) });

  const serverProduct = catalog.get('Cloud Server M')!;
  const domainProduct = catalog.get('Domain .ch')!;
  const setupProduct = catalog.get('Einrichtung')!;
  const prev = monthStart(-1);
  const current = monthStart(0);

  const [server, domainService, setup] = await db
    .insert(services)
    .values([
      {
        orgId: org.id,
        productId: serverProduct.id,
        name: serverProduct.name,
        description: serverProduct.description,
        module: 'servers',
        resourceType: web ? 'server' : null,
        resourceId: web?.id ?? null,
        unitPrice: serverProduct.unitPrice,
        interval: 'monthly',
        startsAt: prev,
        nextBillingAt: monthStart(1),
      },
      {
        orgId: org.id,
        productId: domainProduct.id,
        name: domain ? `Domain ${domain.name}` : domainProduct.name,
        description: domainProduct.description,
        module: 'dns',
        resourceType: domain ? 'domain' : null,
        resourceId: domain?.id ?? null,
        unitPrice: domainProduct.unitPrice,
        interval: 'yearly',
        startsAt: current,
        nextBillingAt: addMonths(current, 12),
      },
      {
        orgId: org.id,
        productId: setupProduct.id,
        name: setupProduct.name,
        description: setupProduct.description,
        unitPrice: setupProduct.unitPrice,
        interval: 'once',
        startsAt: prev,
        nextBillingAt: null,
      },
    ])
    .returning();

  const line = (
    svc: typeof server,
    extra: Partial<{ description: string; periodStart: string; periodEnd: string }>,
  ) => ({
    description: svc!.name,
    quantity: 1,
    unit: null,
    unitPrice: svc!.unitPrice,
    taxRateBp: 810,
    total: svc!.unitPrice,
    serviceId: svc!.id,
    periodStart: null,
    periodEnd: null,
    ...extra,
  });

  await db.transaction(async (tx) => {
    // Last month: paid by bank transfer.
    const paid = await createDraft(
      tx,
      org,
      {
        lines: [line(server, period(server!.name, prev, 'monthly')), line(setup, { periodStart: prev })],
        issueDate: prev,
      },
      null,
    );
    await finalizeInTx(tx, paid.id, null);
    await markPaidInTx(tx, paid.id, { method: 'bank_transfer', reference: 'Zahlung via E-Banking' }, null);

    // This month: still open.
    const open = await createDraft(
      tx,
      org,
      {
        lines: [
          line(server, period(server!.name, current, 'monthly')),
          line(domainService, period(domainService!.name, current, 'yearly')),
        ],
        issueDate: current,
      },
      null,
    );
    await finalizeInTx(tx, open.id, null);

    await addCredit(tx, {
      orgId: org.id,
      amount: 5000,
      currency: 'CHF',
      type: 'topup',
      description: 'Guthaben aufgeladen (Banküberweisung)',
    });
  });
  log.push('billing demo for Muster AG');
}

async function seedResellerCustomer(db: Database, log: string[], org: Organization) {
  const resellerId = org.parentOrgId!;
  const existing = await db.query.invoices.findFirst({ where: eq(invoices.orgId, org.id) });
  if (existing) return;

  let product = await db.query.products.findFirst({
    where: and(eq(products.ownerOrgId, resellerId), eq(products.name, 'Wartung und Support')),
  });
  if (!product) {
    [product] = await db
      .insert(products)
      .values({
        ownerOrgId: resellerId,
        name: 'Wartung und Support',
        description: 'Updates, Backups prüfen, Support per E-Mail',
        unitPrice: 4500,
        currency: 'CHF',
        interval: 'monthly',
      })
      .returning();
  }

  await db
    .insert(billingProfiles)
    .values({
      orgId: org.id,
      companyName: org.name,
      contactName: 'Hans Huber',
      line1: 'Dorfstrasse 12',
      postalCode: '3011',
      city: 'Bern',
      country: 'CH',
    })
    .onConflictDoNothing();

  const current = monthStart(0);
  const [service] = await db
    .insert(services)
    .values({
      orgId: org.id,
      productId: product!.id,
      name: product!.name,
      description: product!.description,
      unitPrice: product!.unitPrice,
      interval: 'monthly',
      startsAt: current,
      nextBillingAt: monthStart(1),
    })
    .returning();

  await db.transaction(async (tx) => {
    const draft = await createDraft(
      tx,
      org,
      {
        lines: [
          {
            ...period(service!.name, current, 'monthly'),
            quantity: 1,
            unit: null,
            unitPrice: service!.unitPrice,
            taxRateBp: 810,
            total: service!.unitPrice,
            serviceId: service!.id,
          },
        ],
        issueDate: current,
      },
      null,
    );
    await finalizeInTx(tx, draft.id, null);
  });
  log.push(`billing demo for ${org.name} (reseller invoice)`);
}
