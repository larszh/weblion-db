import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  isLocale,
  LOCALES,
  TARGET_LOCALES,
  type GlossaryEntryDto,
  type Locale,
  type Paginated,
  type ServerTranslationKey,
  type StyleNotesDto,
  type TargetLocale,
  type TranslationCleanupResultDto,
  type TranslationEditResultDto,
  type TranslationEntryDto,
  type TranslationImportResultDto,
  type TranslationSummaryDto,
} from '@weblion/shared';
import { SECTIONS } from '@weblion/shared/i18n/sections/index';
import type { AppContext } from '../../context';
import { platformScope, requireSession } from '../../auth/access';
import { settings, translationGlossary, translationJobs, users } from '../../db/schema';
import {
  assertHardChecks,
  checkSource,
  cleanup,
  confirmCurrent,
  currentHash,
  prepareValue,
  revertOverride,
  saveOverride,
  setReviewed,
} from '../../i18n/entries';
import { exportLocale, exportOverrides } from '../../i18n/export';
import { cachedEntry, MAX_PAGE_SIZE, queryEntries, summaryStats } from '../../i18n/filters';
import { applyImport, parseImportFile, planImport } from '../../i18n/import';
import { DEFAULT_STYLE_NOTES, readStyleNotes, STYLE_SETTINGS_KEY } from '../../i18n/translator';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { jobDto } from './dto';
import { glossaryBuiltin, glossaryDuplicate, unknownKey } from './errors';

/** True when an If-None-Match header names the tag: exact, weak (W/"...") or one of a comma list. */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const tags = (Array.isArray(header) ? header.join(',') : header).split(',');
  return tags.some((raw) => {
    const tag = raw.trim();
    return tag === '*' || tag === etag || tag.replace(/^W\//, '') === etag;
  });
}

/** Text values in the audit details are cut to 300 characters (i18n 11.2). */
const cut = (value: string | null | undefined) =>
  value === null || value === undefined ? null : value.length > 300 ? value.slice(0, 300) : value;

const cellParams = z.object({ locale: z.enum(LOCALES), key: z.string().min(1).max(300) });
const idParams = z.object({ id: z.uuid() });

const entriesQuery = z.object({
  locale: z.enum([...LOCALES, 'any'] as const).optional(),
  filter: z.enum(['all', 'untranslated', 'stale', 'changed', 'ai', 'unreviewed', 'attention']).optional(),
  q: z.string().max(200).optional(),
  area: z.string().max(100).optional(),
  section: z.enum(SECTIONS).optional(),
  keys: z
    .string()
    .max(200_000)
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean)
        : undefined,
    )
    .refine((v) => !v || v.length <= 500, 'at most 500 keys'),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

const editBody = z.object({ value: z.string().min(1).max(20_000), reviewed: z.boolean().optional() });
const reviewBody = z.object({ reviewed: z.boolean() });
const cleanupBody = z.object({
  orphans: z.boolean(),
  sameAsCompiled: z.boolean(),
  demo: z.boolean(),
  dryRun: z.boolean().optional(),
});

const glossaryBody = z.object({
  term: z.string().trim().min(1).max(100),
  keep: z.boolean(),
  translations: z.partialRecord(z.enum(TARGET_LOCALES), z.string().trim().min(1).max(100)),
  note: z.string().trim().max(300).nullable().optional(),
});
const glossaryPatch = glossaryBody.partial();

const styleParams = z.object({ locale: z.enum(TARGET_LOCALES) });
const styleBody = z.object({ notes: z.string().max(2_000) });

const importBody = z.object({
  data: z.unknown(),
  dryRun: z.boolean(),
  replaceManual: z.boolean().optional(),
  markReviewed: z.boolean().optional(),
});

const exportQuery = z.object({
  scope: z.enum(['overrides', 'locale']).default('overrides'),
  locale: z.enum(LOCALES).optional(),
  only: z.enum(['missing']).optional(),
});

/** Import and export: 10 per minute per person each (i18n 11.3). */
const TRANSFER_PER_MINUTE = 10;
/** The import takes whole export files; the app default is 1 MB. */
const IMPORT_BODY_LIMIT = 5 * 1024 * 1024;

/**
 * Translation routes (i18n 13, 14.2): A1 public, the admin routes A2 to A16 for platform staff. Reading needs
 * platform:i18n:read, every write platform:i18n:write and an audit entry; none of them needs AI (plan O10).
 * Every write reloads the overrides, so the change is live at once.
 */
export async function i18nRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit, i18n } = ctx;

  // A1, public: the login page needs the overrides before anyone is signed in. The texts are UI texts the
  // public bundle carries anyway; email.* and pdf.* never leave the server.
  app.get<{ Params: { locale: string } }>(
    '/i18n/overrides/:locale',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { locale } = req.params;
      if (!isLocale(locale)) throw notFound('Locale');
      const { etag, body } = ctx.i18n.payload(locale);
      // no-cache: the browser revalidates every time; the web sends If-None-Match itself (i18n 5.3).
      reply.header('etag', etag).header('cache-control', 'no-cache');
      if (etagMatches(req.headers['if-none-match'], etag)) return reply.status(304).send();
      return body;
    },
  );

  async function reading(req: FastifyRequest) {
    const auth = requireSession(req);
    await access.assert(req, 'platform:i18n:read', platformScope);
    return auth;
  }

  async function writing(req: FastifyRequest) {
    const auth = requireSession(req);
    await access.assert(req, 'platform:i18n:write', platformScope);
    return auth;
  }

  function knownKey(key: string): ServerTranslationKey {
    if (!i18n.catalog.has(key)) throw unknownKey(key);
    return key;
  }

  function entry(key: ServerTranslationKey): TranslationEntryDto {
    return cachedEntry(i18n, key)!;
  }

  /** Counted after the permission check, so nobody without it uses up the person's attempts. */
  function transferLimit(prefix: string) {
    const limiter = app.createRateLimit({
      max: TRANSFER_PER_MINUTE,
      timeWindow: '1 minute',
      keyGenerator: (req) => `${prefix}:${req.auth!.user.id}`,
    });
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const limit = await limiter(req);
      if (limit.isAllowed || !limit.isExceeded) return;
      reply.header('retry-after', limit.ttlInSeconds);
      throw new AppError(429, 'rate_limited', `Too many requests, retry in ${limit.ttlInSeconds} seconds`);
    };
  }
  const countImport = transferLimit('i18n-import');
  const countExport = transferLimit('i18n-export');

  // --- A2 summary, A3 entries -----------------------------------------------------------------------

  app.get('/admin/i18n/summary', async (req): Promise<TranslationSummaryDto> => {
    await reading(req);
    const [availability, active] = await Promise.all([
      ctx.ai.availability('translations'),
      db.query.translationJobs.findFirst({
        where: inArray(translationJobs.status, ['queued', 'running']),
        orderBy: desc(translationJobs.createdAt),
      }),
    ]);
    return {
      ...summaryStats(i18n),
      ai: availability,
      activeJob: active ? await jobDto(db, active) : null,
    };
  });

  app.get('/admin/i18n/entries', async (req): Promise<Paginated<TranslationEntryDto>> => {
    await reading(req);
    const query = parse(entriesQuery, req.query);
    return queryEntries(i18n, query);
  });

  // --- A4 to A8 cells -----------------------------------------------------------------------------

  app.put('/admin/i18n/entries/:locale/:key', async (req): Promise<TranslationEditResultDto> => {
    const auth = await writing(req);
    const params = parse(cellParams, req.params);
    const key = knownKey(params.key);
    const locale = params.locale;
    const body = parse(editBody, req.body);
    const source = checkSource(i18n, key, locale);
    const { value, typographyFixed } = prepareValue(locale, source, body.value);
    if (value.trim() === '') {
      throw badRequest('Validation failed', [{ path: 'value', message: 'the text is empty' }]);
    }
    assertHardChecks(source, value);
    const before = i18n.cell(locale, key).value;
    const reviewed = body.reviewed ?? true;
    await db.transaction((tx) =>
      saveOverride(tx, {
        key,
        locale,
        value,
        origin: 'manual',
        reviewed,
        sourceHash: currentHash(i18n, key, locale),
        demo: false,
        userId: auth.user.id,
      }),
    );
    await i18n.reload();
    await audit.record(req, {
      action: 'i18n.override_update',
      orgId: null,
      resourceType: 'translation',
      resourceId: `${locale}:${key}`,
      details: {
        key,
        locale,
        origin: 'manual',
        reviewed,
        before: cut(before),
        after: cut(value),
        typographyFixed,
      },
    });
    return { entry: entry(key), typographyFixed };
  });

  app.delete('/admin/i18n/entries/:locale/:key', async (req): Promise<TranslationEntryDto> => {
    await writing(req);
    const params = parse(cellParams, req.params);
    const key = knownKey(params.key);
    const row = i18n.override(params.locale, key);
    const deleted = await db.transaction((tx) => revertOverride(tx, key, params.locale));
    if (!deleted) throw notFound('Override');
    await i18n.reload();
    await audit.record(req, {
      action: 'i18n.override_revert',
      orgId: null,
      resourceType: 'translation',
      resourceId: `${params.locale}:${key}`,
      details: { key, locale: params.locale, origin: row?.origin ?? null, before: cut(row?.value) },
    });
    return entry(key);
  });

  app.post('/admin/i18n/entries/:locale/:key/review', async (req): Promise<TranslationEntryDto> => {
    const auth = await writing(req);
    const params = parse(cellParams, req.params);
    const key = knownKey(params.key);
    const body = parse(reviewBody, req.body);
    const changed = await db.transaction((tx) =>
      setReviewed(tx, key, params.locale, body.reviewed, auth.user.id),
    );
    if (!changed) throw notFound('Override');
    await i18n.reload();
    await audit.record(req, {
      action: 'i18n.override_review',
      orgId: null,
      resourceType: 'translation',
      resourceId: `${params.locale}:${key}`,
      details: { key, locale: params.locale, reviewed: body.reviewed },
    });
    return entry(key);
  });

  app.post('/admin/i18n/entries/:locale/:key/confirm', async (req): Promise<TranslationEntryDto> => {
    const auth = await writing(req);
    const params = parse(cellParams, req.params);
    const key = knownKey(params.key);
    await db.transaction((tx) => confirmCurrent(tx, i18n, key, params.locale, auth.user.id));
    await i18n.reload();
    await audit.record(req, {
      action: 'i18n.override_confirm',
      orgId: null,
      resourceType: 'translation',
      resourceId: `${params.locale}:${key}`,
      details: { key, locale: params.locale },
    });
    return entry(key);
  });

  app.post('/admin/i18n/cleanup', async (req): Promise<TranslationCleanupResultDto> => {
    await writing(req);
    const body = parse(cleanupBody, req.body);
    const result = await db.transaction((tx) => cleanup(tx, i18n, body));
    if (result.dryRun) return result;
    await i18n.reload();
    await audit.record(req, {
      action: 'i18n.cleanup',
      orgId: null,
      // Many cells at once: the resource type of the cells, no single id.
      resourceType: 'translation',
      resourceId: null,
      details: {
        orphans: result.orphans,
        sameAsCompiled: result.sameAsCompiled,
        demo: result.demo,
        deleted: result.orphans + result.sameAsCompiled + result.demo,
      },
    });
    return result;
  });

  // --- A9 to A12 glossary -------------------------------------------------------------------------

  async function glossaryEntries(id?: string): Promise<GlossaryEntryDto[]> {
    const rows = await db
      .select({
        id: translationGlossary.id,
        term: translationGlossary.term,
        keep: translationGlossary.keep,
        translations: translationGlossary.translations,
        note: translationGlossary.note,
        builtIn: translationGlossary.builtIn,
        updatedById: translationGlossary.updatedBy,
        updatedByName: users.name,
        updatedAt: translationGlossary.updatedAt,
      })
      .from(translationGlossary)
      .leftJoin(users, eq(users.id, translationGlossary.updatedBy))
      .where(id ? eq(translationGlossary.id, id) : undefined)
      .orderBy(desc(translationGlossary.builtIn), asc(translationGlossary.term));
    return rows.map((r) => ({
      id: r.id,
      term: r.term,
      keep: r.keep,
      translations: r.translations,
      note: r.note,
      builtIn: r.builtIn,
      updatedBy: r.updatedById ? { id: r.updatedById, name: r.updatedByName ?? '' } : null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async function termTaken(term: string, exceptId?: string): Promise<boolean> {
    const found = await db
      .select({ id: translationGlossary.id })
      .from(translationGlossary)
      .where(
        and(
          sql`lower(${translationGlossary.term}) = lower(${term})`,
          exceptId ? ne(translationGlossary.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return found.length > 0;
  }

  const isUniqueViolation = (err: unknown) => (err as { code?: unknown })?.code === '23505';

  app.get('/admin/i18n/glossary', async (req): Promise<GlossaryEntryDto[]> => {
    await reading(req);
    return glossaryEntries();
  });

  app.post('/admin/i18n/glossary', async (req): Promise<GlossaryEntryDto> => {
    const auth = await writing(req);
    const body = parse(glossaryBody, req.body);
    if (await termTaken(body.term)) throw glossaryDuplicate(body.term);
    let id: string;
    try {
      const [row] = await db
        .insert(translationGlossary)
        .values({
          term: body.term,
          keep: body.keep,
          translations: body.translations,
          note: body.note || null,
          builtIn: false,
          updatedBy: auth.user.id,
        })
        .returning({ id: translationGlossary.id });
      id = row!.id;
    } catch (err) {
      // Two saves of the same term at once: the unique index decides.
      if (isUniqueViolation(err)) throw glossaryDuplicate(body.term);
      throw err;
    }
    await i18n.reload();
    await audit.record(req, {
      action: 'i18n.glossary_create',
      orgId: null,
      resourceType: 'glossary',
      resourceId: id,
      details: { id, term: body.term, keep: body.keep, changed: ['term', 'keep', 'translations', 'note'] },
    });
    return (await glossaryEntries(id))[0]!;
  });

  app.patch('/admin/i18n/glossary/:id', async (req): Promise<GlossaryEntryDto> => {
    const auth = await writing(req);
    const { id } = parse(idParams, req.params);
    const body = parse(glossaryPatch, req.body);
    const current = await db.query.translationGlossary.findFirst({ where: eq(translationGlossary.id, id) });
    if (!current) throw notFound('Glossary term');
    if (body.term !== undefined && body.term !== current.term) {
      // The start seeds the built-in terms by their term; a renamed one would come back next to it.
      if (current.builtIn) {
        throw badRequest('Validation failed', [{ path: 'term', message: 'default terms keep their term' }]);
      }
      if (await termTaken(body.term, id)) throw glossaryDuplicate(body.term);
    }
    const next = {
      term: body.term ?? current.term,
      keep: body.keep ?? current.keep,
      translations: body.translations ?? current.translations,
      note: body.note !== undefined ? body.note || null : current.note,
    };
    const changed = (['term', 'keep', 'translations', 'note'] as const).filter(
      (field) => JSON.stringify(next[field]) !== JSON.stringify(current[field]),
    );
    try {
      await db
        .update(translationGlossary)
        .set({ ...next, updatedBy: auth.user.id })
        .where(eq(translationGlossary.id, id));
    } catch (err) {
      if (isUniqueViolation(err)) throw glossaryDuplicate(next.term);
      throw err;
    }
    await i18n.reload();
    await audit.record(req, {
      action: 'i18n.glossary_update',
      orgId: null,
      resourceType: 'glossary',
      resourceId: id,
      details: { id, term: next.term, keep: next.keep, changed },
    });
    return (await glossaryEntries(id))[0]!;
  });

  app.delete('/admin/i18n/glossary/:id', async (req) => {
    await writing(req);
    const { id } = parse(idParams, req.params);
    const current = await db.query.translationGlossary.findFirst({ where: eq(translationGlossary.id, id) });
    if (!current) throw notFound('Glossary term');
    // The seed of every start would bring a deleted default term back.
    if (current.builtIn) throw glossaryBuiltin(current.term);
    await db.delete(translationGlossary).where(eq(translationGlossary.id, id));
    await i18n.reload();
    await audit.record(req, {
      action: 'i18n.glossary_delete',
      orgId: null,
      resourceType: 'glossary',
      resourceId: id,
      details: { id, term: current.term, keep: current.keep, changed: [] },
    });
    return { ok: true };
  });

  // --- A13, A14 style notes -----------------------------------------------------------------------

  async function styleNotes(): Promise<StyleNotesDto> {
    return { defaults: DEFAULT_STYLE_NOTES, notes: await readStyleNotes(db) };
  }

  app.get('/admin/i18n/style', async (req): Promise<StyleNotesDto> => {
    await reading(req);
    return styleNotes();
  });

  app.put('/admin/i18n/style/:locale', async (req): Promise<StyleNotesDto> => {
    await writing(req);
    const { locale } = parse(styleParams, req.params);
    const { notes } = parse(styleBody, req.body);
    const text = notes.trim();
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${STYLE_SETTINGS_KEY}, 0))`);
      const value: Partial<Record<TargetLocale, string>> = { ...(await readStyleNotes(tx)) };
      if (text) value[locale] = text;
      else delete value[locale];
      await tx
        .insert(settings)
        .values({ key: STYLE_SETTINGS_KEY, value })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    });
    await audit.record(req, {
      action: 'i18n.style_update',
      orgId: null,
      resourceType: 'settings',
      resourceId: STYLE_SETTINGS_KEY,
      details: { locale, length: text.length },
    });
    return styleNotes();
  });

  // --- A15 import, A16 export ---------------------------------------------------------------------

  app.post(
    '/admin/i18n/import',
    { bodyLimit: IMPORT_BODY_LIMIT },
    async (req, reply): Promise<TranslationImportResultDto> => {
      const auth = await writing(req);
      await countImport(req, reply);
      const body = parse(importBody, req.body);
      const rows = parseImportFile(body.data);
      const { result, writes, skippedTotal } = planImport(i18n, rows, {
        dryRun: body.dryRun,
        replaceManual: body.replaceManual ?? false,
        markReviewed: body.markReviewed ?? false,
      });
      if (body.dryRun) return result;
      if (writes.length > 0) {
        await db.transaction((tx) => applyImport(tx, writes, auth.user.id));
        await i18n.reload();
      }
      await audit.record(req, {
        action: 'i18n.import',
        orgId: null,
        resourceType: 'translation',
        resourceId: null,
        details: {
          locales: [...new Set(rows.map((r) => r.locale))].sort(
            (a, b) => LOCALES.indexOf(a as Locale) - LOCALES.indexOf(b as Locale),
          ),
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          skipped: skippedTotal,
          replaceManual: body.replaceManual ?? false,
          markReviewed: body.markReviewed ?? false,
        },
      });
      return result;
    },
  );

  app.get('/admin/i18n/export', async (req, reply) => {
    await reading(req);
    await countExport(req, reply);
    const query = parse(exportQuery, req.query);
    const date = new Date().toISOString().slice(0, 10);
    let data: unknown;
    let name: string;
    if (query.scope === 'locale') {
      const locale = query.locale;
      if (!locale || !(TARGET_LOCALES as readonly string[]).includes(locale)) {
        throw badRequest('Validation failed', [{ path: 'locale', message: 'a target language is required' }]);
      }
      data = exportLocale(i18n, { locale: locale as TargetLocale, onlyMissing: query.only === 'missing' });
      name = `weblion-i18n-${locale}${query.only === 'missing' ? '-missing' : ''}-${date}.json`;
    } else {
      data = exportOverrides(i18n, { locale: query.locale });
      name = `weblion-i18n-overrides${query.locale ? `-${query.locale}` : ''}-${date}.json`;
    }
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}"`)
      .header('cache-control', 'no-store')
      .send(`${JSON.stringify(data, null, 2)}\n`);
  });
}
