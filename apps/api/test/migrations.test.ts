import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { createDb, type Database } from '../src/db/client';
import { migrationsFolder, runMigrations } from '../src/db/migrate';

/**
 * Migrations on data, not only on an empty database (i18n 10.3, review finding 14): the schema of 0009 with rows
 * as they exist today, then every later migration.
 */

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

let db: Database;
let pool: pg.Pool;
let tmp: string;
let journal: JournalEntry[];

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

/** The Postgres error code of a failing statement (23514 check, 23505 unique). */
async function failure(query: ReturnType<typeof sql>): Promise<string | undefined> {
  try {
    await db.execute(query);
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
}

beforeAll(async () => {
  ({ db, pool } = createDb(
    process.env.TEST_DATABASE_URL ?? 'postgres://weblion:weblion@localhost:5432/weblion_test',
  ));
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);

  const folder = migrationsFolder();
  journal = (
    JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as { entries: JournalEntry[] }
  ).entries;

  // The folder as it was at 0009_media_requests: the same files, the journal cut after idx 9.
  tmp = mkdtempSync(join(tmpdir(), 'wl-migrations-'));
  cpSync(folder, tmp, { recursive: true });
  const cut = JSON.parse(readFileSync(join(tmp, 'meta/_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  cut.entries = cut.entries.filter((e) => e.idx <= 9);
  writeFileSync(join(tmp, 'meta/_journal.json'), JSON.stringify(cut));
  await migrate(db, { migrationsFolder: tmp });

  // Rows as they exist today. Raw SQL: the TypeScript schema already has the columns of 0010 and 0011.
  for (const [email, locale] of [
    ['de@test.local', 'de'],
    ['en@test.local', 'en'],
    ['engb@test.local', 'EN-gb'],
    ['frch@test.local', 'fr-CH'],
    ['xx@test.local', 'xx'],
  ]) {
    await db.execute(sql`insert into users (email, name, locale) values (${email}, ${email}, ${locale})`);
  }
  await db.execute(sql`
    insert into organizations (name, slug, boundary)
    values ('Alt AG', 'alt-ag', '[{"sid":"Everything","effect":"allow","actions":["*"]}]'::jsonb)`);
  await db.execute(sql`
    insert into memberships (org_id, user_id, role)
    select o.id, u.id, 'owner' from organizations o, users u where o.slug = 'alt-ag' and u.email = 'en@test.local'`);
  await db.execute(
    sql`insert into billing_profiles (org_id) select id from organizations where slug = 'alt-ag'`,
  );
  await db.execute(sql`
    insert into invoices (number, org_id, status, issue_date, due_date, subtotal, total)
    select '2026-0001', id, 'open', '2026-10-01', '2026-10-31', 10000, 10000 from organizations where slug = 'alt-ag'`);
  await db.execute(sql`
    insert into invoice_lines (invoice_id, position, description, quantity, unit_price, tax_rate_bp, total)
    select id, 1, 'Webhosting', 1, 10000, 0, 10000 from invoices where number = '2026-0001'`);
  await db.execute(
    sql`insert into products (name, unit_price, interval) values ('Webhosting S', 1500, 'monthly')`,
  );
  await db.execute(sql`
    insert into services (org_id, name, unit_price, interval, starts_at, next_billing_at)
    select id, 'Webhosting S', 1500, 'monthly', '2026-10-01', '2026-11-01' from organizations where slug = 'alt-ag'`);

  await runMigrations(db);
});

afterAll(async () => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  await pool?.end();
});

describe('migrations 0010_ai and 0011_i18n on existing data', () => {
  it('normalize the stored languages', async () => {
    const users = await rows<{ email: string; locale: string }>(
      sql`select email, locale from users order by email`,
    );
    expect(Object.fromEntries(users.map((u) => [u.email, u.locale]))).toEqual({
      'de@test.local': 'de',
      'en@test.local': 'en',
      'engb@test.local': 'en',
      'frch@test.local': 'fr',
      'xx@test.local': 'de',
    });
  });

  it('leave AI off for existing organizations: opt-in per customer (plan O34)', async () => {
    const [org] = await rows<Record<string, unknown>>(
      sql`select ai_enabled, ai_disabled_by, ai_opt_out_at, ai_opt_out_by from organizations where slug = 'alt-ag'`,
    );
    expect(org).toEqual({
      ai_enabled: false,
      ai_disabled_by: null,
      ai_opt_out_at: null,
      ai_opt_out_by: null,
    });
    // A new organization starts off too.
    await db.execute(
      sql`insert into organizations (name, slug, boundary) values ('Neu AG', 'neu-ag', '[]'::jsonb)`,
    );
    const [fresh] = await rows<{ ai_enabled: boolean }>(
      sql`select ai_enabled from organizations where slug = 'neu-ag'`,
    );
    expect(fresh!.ai_enabled).toBe(false);
  });

  it('give products empty translations and billing data no language', async () => {
    const [product] = await rows<{ translations: unknown }>(sql`select translations from products`);
    expect(product!.translations).toEqual({});
    const [profile] = await rows<{ locale: string | null }>(sql`select locale from billing_profiles`);
    expect(profile!.locale).toBeNull();
    const [invoice] = await rows<{ locale: string | null }>(sql`select locale from invoices`);
    expect(invoice!.locale).toBeNull();
    const [lines] = await rows<{ n: number }>(sql`select count(*)::int as n from invoice_lines`);
    expect(lines!.n).toBe(1);
  });

  it('create the four new tables empty', async () => {
    for (const table of ['ai_usage', 'translation_overrides', 'translation_glossary', 'translation_jobs']) {
      const [r] = await rows<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`);
      expect(r!.n, table).toBe(0);
    }
  });

  it('refuse a language outside the five', async () => {
    expect(await failure(sql`update users set locale = 'es' where email = 'de@test.local'`)).toBe('23514');
    expect(await failure(sql`update billing_profiles set locale = 'es'`)).toBe('23514');
    expect(await failure(sql`update invoices set locale = 'xx'`)).toBe('23514');
    expect(
      await failure(sql`
        insert into translation_overrides (key, locale, value, origin, source_hash)
        values ('common.add', 'es', 'Añadir', 'manual', '0000000000000000')`),
    ).toBe('23514');
    expect(await failure(sql`update billing_profiles set locale = 'fr'`)).toBeUndefined();
    expect(await failure(sql`update billing_profiles set locale = null`)).toBeUndefined();
  });

  it('allow one queued or running translation job at a time', async () => {
    const job = sql`
      insert into translation_jobs (locales, scope, model, batches, total, estimate_micros)
      values ('["fr"]', '{"locales":["fr"],"selection":"untranslated","replaceManual":false}', 'claude-opus-5-5', '[]', 0, 0)`;
    expect(await failure(job)).toBeUndefined();
    expect(await failure(job)).toBe('23505');
    await db.execute(sql`update translation_jobs set status = 'completed'`);
    expect(await failure(job)).toBeUndefined();
    expect(await failure(sql`update translation_jobs set status = 'paused'`)).toBe('23514');
  });
});

describe('migration 0012_scheduled_cancellation on existing data', () => {
  it('leaves existing services without a remembered module choice', async () => {
    const [service] = await rows<Record<string, unknown>>(
      sql`select status, ends_at, deactivate_module_at_end from services where name = 'Webhosting S'`,
    );
    expect(service).toEqual({ status: 'active', ends_at: null, deactivate_module_at_end: false });
  });
});

describe('the migration journal', () => {
  it('numbers the migrations without gaps, in tag order, with strictly increasing timestamps', () => {
    expect(journal.map((e) => e.idx)).toEqual(journal.map((_, i) => i));
    for (const e of journal) expect(e.tag.startsWith(String(e.idx).padStart(4, '0') + '_')).toBe(true);
    for (let i = 1; i < journal.length; i++) {
      expect(journal[i]!.when, journal[i]!.tag).toBeGreaterThan(journal[i - 1]!.when);
    }
    expect(journal[10]?.tag).toBe('0010_ai');
    expect(journal[11]?.tag).toBe('0011_i18n');
  });

  it('applied every migration', async () => {
    const [applied] = await rows<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(applied!.n).toBe(journal.length);
  });
});
