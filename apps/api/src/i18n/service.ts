import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  fallbackChain,
  interpolate,
  isLegalKey,
  isTargetLocale,
  LEGAL_KEYS,
  LOCALES,
  type I18nOverridesDto,
  type I18nParams,
  type Locale,
  type ServerTranslationKey,
  type TranslationCellDto,
} from '@weblion/shared';
import { loadCatalog, type I18nCatalog } from '@weblion/shared/i18n/catalog';
import { checkValue } from '@weblion/shared/i18n/checks';
import { DEFAULT_GLOSSARY, type GlossaryTerm } from '@weblion/shared/i18n/glossary';
import type { Env } from '../config/env';
import type { Database } from '../db/client';
import { translationOverrides, users } from '../db/schema';
import { loadGlossary } from './glossary';
import { sourceHash } from './hash';

/** A translator bound to one locale (mails, PDF, server texts). */
export type Tr = (key: ServerTranslationKey, params?: I18nParams) => string;

/** One row of translation_overrides as the service keeps it in memory. */
interface OverrideRow {
  key: string;
  locale: Locale;
  value: string;
  origin: 'manual' | 'ai';
  sourceHash: string;
  reviewed: boolean;
  demo: boolean;
  updatedBy: { id: string; name: string } | null;
  updatedAt: Date;
}

/** How often start() asks the database whether another instance changed an override (i18n 8.1). */
const REFRESH_MS = 15_000;

/**
 * Server-side texts: the compiled catalog plus the overrides of the translation admin (i18n 8.1, 13).
 * Every override is held in memory; a cheap signature query every 15 s picks up the writes of other
 * instances, and the instance that wrote calls reload() at once.
 */
export class I18nService {
  readonly catalog: I18nCatalog;
  private overrides = new Map<Locale, Map<string, OverrideRow>>();
  private glossary: GlossaryTerm[] = [...DEFAULT_GLOSSARY];
  private signature: string | null = null;
  private hashes = new Map<string, { text: string; hash: string }>();
  private payloads = new Map<Locale, { etag: string; body: I18nOverridesDto }>();
  private timer: NodeJS.Timeout | null = null;
  /** Loads run one after the other, so a reload() after a write never loses against an older refresh. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Database,
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
    catalog: I18nCatalog = loadCatalog(),
  ) {
    this.catalog = catalog;
  }

  /** Reads every override (and the glossary for the cell warnings) into memory. */
  load(): Promise<void> {
    const run = this.queue.then(() => this.read());
    // A failed load must not block every later one; the caller still sees the error.
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** After a local write (admin save, import, job batch, cleanup, key save): reload now. */
  reload(): Promise<void> {
    return this.load();
  }

  /**
   * One refresh step of the timer: compares count and newest updated_at of overrides and glossary with the
   * state of the last load and reloads when they differ. Returns whether it reloaded. Public for tests, so
   * they drive the refresh without a real timer.
   */
  async refresh(): Promise<boolean> {
    const current = await this.readSignature();
    if (current === this.signature) return false;
    await this.load();
    return true;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.refresh().catch((err) => this.log.warn({ err }, 'translation overrides refresh failed'));
    }, REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Overrides (servable rows only), fallbackChain, the legal rule; then interpolate(). Never throws. */
  t(locale: Locale, key: ServerTranslationKey, params?: I18nParams): string {
    try {
      return interpolate(this.lookup(locale, key) ?? key, params);
    } catch (err) {
      this.log.warn({ err, key, locale }, 'translation lookup failed');
      return key;
    }
  }

  translator(locale: Locale): Tr {
    return (key, params) => this.t(locale, key, params);
  }

  /** Effective German text (servable German override, else compiled) and its sourceHash. */
  source(key: ServerTranslationKey): { text: string; hash: string } {
    const cached = this.hashes.get(key);
    if (cached) return cached;
    const row = this.overrides.get('de')?.get(key);
    const text = row && this.servable(row) ? row.value : (this.catalog.bundles.de[key] ?? key);
    const result = { text, hash: sourceHash(text) };
    this.hashes.set(key, result);
    return result;
  }

  /** Body and ETag of A1, cached until the next reload (i18n 13). */
  payload(locale: Locale): { etag: string; body: I18nOverridesDto } {
    const cached = this.payloads.get(locale);
    if (cached) return cached;

    const values: Record<string, string> = {};
    for (const row of this.overrides.get(locale)?.values() ?? []) {
      if (this.catalog.serverOnly.has(row.key) || !this.servable(row)) continue;
      values[row.key] = row.value;
    }
    // Legal keys: what the lookup serves when it is not the compiled text of the locale (a stale or missing
    // translation carries the English, else the German text, so an outdated notice is never shown).
    for (const key of LEGAL_KEYS) {
      if (!this.catalog.has(key) || this.catalog.serverOnly.has(key)) continue;
      const served = this.lookup(locale, key);
      if (served !== undefined && served !== this.catalog.bundles[locale][key]) values[key] = served;
    }

    const sorted: Record<string, string> = {};
    for (const key of Object.keys(values).sort()) sorted[key] = values[key]!;
    const body: I18nOverridesDto = { locale, values: sorted };
    const etag = `"${createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex').slice(0, 16)}"`;
    const result = { etag, body };
    this.payloads.set(locale, result);
    return result;
  }

  /** One admin cell (TranslationCellDto of i18n 14.1, state of i18n 15.1). */
  cell(locale: Locale, key: ServerTranslationKey): TranslationCellDto {
    const row = this.overrides.get(locale)?.get(key);
    const compiled = this.catalog.bundles[locale][key] ?? null;
    const served = row && this.servable(row) ? row : null;
    const value = served ? served.value : compiled;
    const source = this.source(key);

    let state: TranslationCellDto['state'];
    if (value === null) state = 'missing';
    else if (locale === 'de') {
      // German: stale when the repository text changed after the German edit.
      state = served && served.sourceHash !== sourceHash(compiled ?? key) ? 'stale' : 'current';
    } else if (served) state = served.sourceHash === source.hash ? 'current' : 'stale';
    else state = this.catalog.stamps[locale][key]?.[0] === source.hash ? 'current' : 'stale';

    const warnings =
      value === null || locale === 'de'
        ? []
        : checkValue({
            key,
            source: source.text,
            value,
            locale,
            glossary: this.glossary,
            skipLanguage: served?.demo ?? false,
          }).soft;

    return {
      locale,
      value,
      compiled,
      origin: served ? served.origin : 'repo',
      state,
      reviewed: served ? served.reviewed : true,
      demo: row?.demo ?? false,
      hidden: !!row && !served,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
      warnings,
    };
  }

  /** Demo rows exist only from demo jobs; they are served only while the emulator answers (plan O11). */
  private demoServable(): boolean {
    return this.env.ENABLE_DEMO_PROVIDER && !this.env.ANTHROPIC_API_KEY;
  }

  /** Rules 1 to 3 of i18n 8.1: the key exists, demo only in demo mode, legal keys of target locales current. */
  private servable(row: OverrideRow): boolean {
    if (!this.catalog.has(row.key)) return false;
    if (row.demo && !this.demoServable()) return false;
    if (isLegalKey(row.key) && isTargetLocale(row.locale)) {
      return row.sourceHash === this.source(row.key).hash;
    }
    return true;
  }

  /** The text of a key along the fallback chain without interpolation; undefined when no locale has one. */
  private lookup(locale: Locale, key: ServerTranslationKey): string | undefined {
    const legal = isLegalKey(key);
    for (const l of fallbackChain(locale)) {
      const row = this.overrides.get(l)?.get(key);
      if (row && this.servable(row)) return row.value;
      const compiled = this.catalog.bundles[l][key];
      if (compiled === undefined) continue;
      // A legal key takes only current values; the effective German text is current by definition.
      if (legal && l !== 'de' && this.catalog.stamps[l][key]?.[0] !== this.source(key).hash) continue;
      return compiled;
    }
    return undefined;
  }

  private async readSignature(): Promise<string> {
    const { rows } = await this.db.execute<{ oc: string; om: string | null; gc: string; gm: string | null }>(
      sql`select
        (select count(*) from translation_overrides)::text as oc,
        (select max(updated_at) from translation_overrides)::text as om,
        (select count(*) from translation_glossary)::text as gc,
        (select max(updated_at) from translation_glossary)::text as gm`,
    );
    const r = rows[0];
    return r ? `${r.oc}|${r.om ?? ''}|${r.gc}|${r.gm ?? ''}` : '';
  }

  private async read(): Promise<void> {
    // Signature first: a write between the two queries makes the next refresh() load once more, never less.
    const signature = await this.readSignature();
    const rows = await this.db
      .select({
        key: translationOverrides.key,
        locale: translationOverrides.locale,
        value: translationOverrides.value,
        origin: translationOverrides.origin,
        sourceHash: translationOverrides.sourceHash,
        reviewed: translationOverrides.reviewed,
        demo: translationOverrides.demo,
        updatedById: translationOverrides.updatedBy,
        updatedByName: users.name,
        updatedAt: translationOverrides.updatedAt,
      })
      .from(translationOverrides)
      .leftJoin(users, eq(users.id, translationOverrides.updatedBy));
    const glossary = await loadGlossary(this.db);

    const overrides = new Map<Locale, Map<string, OverrideRow>>(LOCALES.map((l) => [l, new Map()]));
    for (const r of rows) {
      overrides.get(r.locale)?.set(r.key, {
        key: r.key,
        locale: r.locale,
        value: r.value,
        origin: r.origin,
        sourceHash: r.sourceHash,
        reviewed: r.reviewed,
        demo: r.demo,
        updatedBy: r.updatedById ? { id: r.updatedById, name: r.updatedByName ?? '' } : null,
        updatedAt: r.updatedAt,
      });
    }
    this.overrides = overrides;
    // An empty table (first start before seedGlossary) still checks against the built-in terms.
    this.glossary = glossary.length > 0 ? glossary : [...DEFAULT_GLOSSARY];
    this.signature = signature;
    this.hashes.clear();
    this.payloads.clear();
  }
}
