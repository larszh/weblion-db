import { Fragment, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, Check, Scale, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  comparePlaceholders,
  intlLocale,
  lineBreakCount,
  LOCALE_META,
  LOCALES,
  placeholdersOf,
  type Locale,
  type TargetLocale,
  type TranslationCellDto,
  type TranslationCheckName,
  type TranslationEntryDto,
  type TranslationSuggestionDto,
} from '@weblion/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { formatRelative } from '@/lib/format';
import {
  useConfirmTranslation,
  useReviewTranslation,
  useRevertTranslation,
  useSaveTranslation,
  useSuggestTranslation,
} from '@/lib/api/i18n';
import { Flag } from '@/components/server-bits';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, CopyButton, Notice, Textarea } from '@/components/ui/primitives';

/**
 * The texts of the translation admin (i18n 17.2, 17.3): a table with one column per language from `md` up, one
 * card per key with a row per language below it, and the inline cell editor with live placeholder chips.
 */

// --- Pure helpers (tested) ----------------------------------------------------------------------

/** Micro-USD as "12.34" in the UI language; small amounts with four decimals so a cent is never shown as 0. */
export function formatUsd(micros: number, locale: Locale): string {
  const usd = micros / 1_000_000;
  const digits = micros > 0 && micros < 10_000 ? 4 : 2;
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(usd);
}

/** What the console shows instead of a missing value: English for fr, it and nl, else German. */
export function fallbackText(entry: TranslationEntryDto, locale: Locale): string | null {
  if (locale === 'de') return null;
  if (locale !== 'en' && entry.cells.en.value) return entry.cells.en.value;
  return entry.cells.de.value;
}

export type CellBadge = 'missing' | 'stale' | 'manual' | 'ai' | 'aiReviewed' | 'demo' | 'hidden';

/** The badges of one cell (i18n 17.2): state, origin, demo, not shown. */
export function cellBadges(cell: TranslationCellDto): CellBadge[] {
  const badges: CellBadge[] = [];
  if (cell.state === 'missing') badges.push('missing');
  if (cell.state === 'stale') badges.push('stale');
  if (cell.origin === 'manual') badges.push('manual');
  if (cell.origin === 'ai') badges.push(cell.reviewed ? 'aiReviewed' : 'ai');
  if (cell.demo) badges.push('demo');
  if (cell.hidden) badges.push('hidden');
  return badges;
}

export interface PlaceholderChip {
  name: string;
  ok: boolean;
  /** Not in the German text. */
  extra: boolean;
}

/** One chip per placeholder of the German text (green when the draft has it as often), red for extra ones. */
export function placeholderChips(source: string, draft: string): PlaceholderChip[] {
  const { missing, extra } = comparePlaceholders(source, draft);
  const names = [...new Set(placeholdersOf(source))];
  return [
    ...names.map((name) => ({ name, ok: !missing.includes(name), extra: false })),
    ...[...new Set(extra)].map((name) => ({ name, ok: false, extra: true })),
  ];
}

/** The German text a cell is checked against: the compiled German for a German edit, else the effective one. */
export function sourceFor(entry: TranslationEntryDto, locale: Locale): string {
  if (locale === 'de') return entry.cells.de.compiled ?? entry.cells.de.value ?? '';
  return entry.cells.de.value ?? '';
}

/** Save is possible: text present, placeholders and line breaks as in German. */
export function draftValid(source: string, draft: string): boolean {
  if (draft.trim() === '') return false;
  if (lineBreakCount(source) !== lineBreakCount(draft)) return false;
  return placeholderChips(source, draft).every((c) => c.ok);
}

// --- Media query --------------------------------------------------------------------------------

const DESKTOP = '(min-width: 768px)';

function subscribeDesktop(callback: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

/** true or false in the browser; null in a static render (both layouts are then rendered with the editor). */
function useDesktop(): boolean | null {
  return useSyncExternalStore(
    subscribeDesktop,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DESKTOP).matches : null),
    () => null,
  );
}

// --- Badges -------------------------------------------------------------------------------------

const BADGE_TONE: Record<CellBadge, 'neutral' | 'warning' | 'danger' | 'info' | 'primary' | 'success'> = {
  missing: 'danger',
  stale: 'warning',
  manual: 'primary',
  ai: 'info',
  aiReviewed: 'success',
  demo: 'neutral',
  hidden: 'neutral',
};

export function CellBadges({ cell }: { cell: TranslationCellDto }) {
  const { t } = useI18n();
  const badges = cellBadges(cell);
  return (
    <>
      {badges.map((b) => (
        <Badge key={b} tone={BADGE_TONE[b]}>
          {b === 'demo' ? t('ai.demoBadge') : t(`admin.i18n.badge.${b}`)}
        </Badge>
      ))}
      {cell.warnings.length > 0 && (
        <Badge
          tone="warning"
          title={cell.warnings.map((w) => t(`admin.i18n.check.${w}`)).join('\n')}
          className="gap-1"
        >
          <AlertTriangle className="size-3" aria-hidden />
          {t('admin.i18n.badge.warnings', { count: cell.warnings.length })}
        </Badge>
      )}
    </>
  );
}

function KeyMeta({ entry }: { entry: TranslationEntryDto }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <span>{entry.area}</span>
      <span aria-hidden>·</span>
      <span>{entry.section}</span>
      {entry.legal && (
        <Badge tone="warning" className="gap-1">
          <Scale className="size-3" aria-hidden />
          {t('admin.i18n.badge.legal')}
        </Badge>
      )}
      {entry.serverOnly && (
        <Badge tone="neutral">
          {entry.key.startsWith('pdf.') ? t('admin.i18n.tag.pdf') : t('admin.i18n.tag.email')}
        </Badge>
      )}
    </div>
  );
}

function LanguageLabel({ locale }: { locale: Locale }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text">
      <Flag country={LOCALE_META[locale].flag} decorative />
      {LOCALE_META[locale].native}
    </span>
  );
}

/** The value of a cell, or the muted fallback with "Fehlt". */
function CellValue({
  entry,
  locale,
  clamp,
}: {
  entry: TranslationEntryDto;
  locale: Locale;
  clamp?: boolean;
}) {
  const { t } = useI18n();
  const cell = entry.cells[locale];
  if (cell.value !== null) {
    return (
      <span
        className={cn('block text-sm break-words whitespace-pre-line text-text', clamp && 'line-clamp-2')}
      >
        {cell.value}
      </span>
    );
  }
  const fallback = fallbackText(entry, locale);
  return (
    <span className={cn('block text-sm break-words text-subtle italic', clamp && 'line-clamp-2')}>
      {fallback ? t('admin.i18n.cell.fallback', { text: fallback }) : t('admin.i18n.badge.missing')}
    </span>
  );
}

// --- Table and cards ----------------------------------------------------------------------------

export interface EditingCell {
  key: string;
  locale: Locale;
}

export interface TranslationsTableProps {
  entries: readonly TranslationEntryDto[];
  /** platform:i18n:write */
  canWrite: boolean;
  /** platform:i18n:write, platform:ai:use and the translations feature available (demo included). */
  canSuggest: boolean;
  /** An editor open from the start (tests, deep links). */
  initialEditing?: EditingCell | null;
  /** The draft of that editor. */
  initialDraft?: string;
}

export function TranslationsTable({
  entries,
  canWrite,
  canSuggest,
  initialEditing = null,
  initialDraft,
}: TranslationsTableProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<EditingCell | null>(initialEditing);
  const desktop = useDesktop();
  const isEditing = (key: string, locale: Locale) => editing?.key === key && editing.locale === locale;
  const open = (key: string, locale: Locale) =>
    setEditing((current) => (current?.key === key && current.locale === locale ? null : { key, locale }));
  const onCellKey = (e: KeyboardEvent, key: string, locale: Locale) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(key, locale);
    }
  };
  const editor = (entry: TranslationEntryDto) =>
    editing && editing.key === entry.key ? (
      <CellEditor
        key={`${entry.key}:${editing.locale}`}
        entry={entry}
        locale={editing.locale}
        canWrite={canWrite}
        canSuggest={canSuggest}
        initialDraft={
          initialEditing?.key === entry.key && initialEditing.locale === editing.locale
            ? initialDraft
            : undefined
        }
        onClose={() => setEditing(null)}
      />
    ) : null;

  return (
    <>
      {/* From md: one column per language, the editor in a row below the edited one. */}
      <div className="hidden md:block">
        <div className="w-full overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="border-b border-border bg-surface-2">
              <tr>
                <th className="w-[19%] px-3 py-2.5 text-left text-xs font-medium tracking-wide text-muted uppercase">
                  {t('admin.i18n.col.key')}
                </th>
                {LOCALES.map((locale) => (
                  <th key={locale} className="px-3 py-2.5 text-left text-xs font-medium text-muted">
                    <LanguageLabel locale={locale} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <Fragment key={entry.key}>
                  <tr className="align-top">
                    <td className="px-3 py-3">
                      <div className="font-mono text-[12.5px] break-all text-text">{entry.key}</div>
                      <div className="mt-1">
                        <KeyMeta entry={entry} />
                      </div>
                    </td>
                    {LOCALES.map((locale) => (
                      <td key={locale} className="p-1">
                        <div
                          role="button"
                          tabIndex={0}
                          aria-expanded={isEditing(entry.key, locale)}
                          onClick={() => open(entry.key, locale)}
                          onKeyDown={(e) => onCellKey(e, entry.key, locale)}
                          className={cn(
                            'min-h-11 cursor-pointer rounded-md px-2 py-1.5 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
                            isEditing(entry.key, locale) && 'bg-primary-soft',
                          )}
                        >
                          <CellValue entry={entry} locale={locale} clamp />
                          <div className="mt-1 flex flex-wrap gap-1">
                            <CellBadges cell={entry.cells[locale]} />
                          </div>
                        </div>
                      </td>
                    ))}
                  </tr>
                  {desktop !== false && editing?.key === entry.key && (
                    <tr className="bg-surface-2/60">
                      <td colSpan={LOCALES.length + 1} className="px-3 py-3">
                        {editor(entry)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Below md: one card per key, one row per language, the editor below the tapped row (i18n 17.3). */}
      <div className="space-y-3 md:hidden">
        {entries.map((entry) => (
          <EntryCard
            key={entry.key}
            entry={entry}
            editing={editing?.key === entry.key ? editing.locale : null}
            onOpen={(locale) => open(entry.key, locale)}
            editor={desktop !== true ? editor(entry) : null}
          />
        ))}
      </div>
    </>
  );
}

export function EntryCard({
  entry,
  editing,
  onOpen,
  editor,
}: {
  entry: TranslationEntryDto;
  editing: Locale | null;
  onOpen: (locale: Locale) => void;
  editor: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-card" data-entry-card={entry.key}>
      <div className="border-b border-border px-4 py-3">
        <div className="font-mono text-[12.5px] break-all text-text">{entry.key}</div>
        <div className="mt-1">
          <KeyMeta entry={entry} />
        </div>
      </div>
      <div className="divide-y divide-border">
        {LOCALES.map((locale) => (
          <div key={locale}>
            <button
              type="button"
              onClick={() => onOpen(locale)}
              aria-expanded={editing === locale}
              className={cn(
                'grid min-h-11 w-full grid-cols-[92px_minmax(0,1fr)] gap-2 px-4 py-2.5 text-left hover:bg-surface-2',
                editing === locale && 'bg-primary-soft',
              )}
            >
              <LanguageLabel locale={locale} />
              <span className="min-w-0">
                <CellValue entry={entry} locale={locale} />
                <span className="mt-1 flex flex-wrap gap-1">
                  <CellBadges cell={entry.cells[locale]} />
                </span>
              </span>
            </button>
            {editing === locale && editor && <div className="border-t border-border px-4 py-3">{editor}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Cell editor --------------------------------------------------------------------------------

export interface CellEditorProps {
  entry: TranslationEntryDto;
  locale: Locale;
  canWrite: boolean;
  canSuggest: boolean;
  initialDraft?: string;
  onClose: () => void;
}

/** The inline editor of one cell (i18n 17.2). */
export function CellEditor({ entry, locale, canWrite, canSuggest, initialDraft, onClose }: CellEditorProps) {
  const { t, locale: uiLocale, applyOverride } = useI18n();
  const cell = entry.cells[locale];
  const source = sourceFor(entry, locale);
  const [draft, setDraft] = useState(initialDraft ?? cell.value ?? '');
  const [reviewed, setReviewed] = useState(true);
  const [revertOpen, setRevertOpen] = useState(false);
  const [result, setResult] = useState<{ warnings: TranslationCheckName[]; typographyFixed: boolean } | null>(
    null,
  );
  const [suggestion, setSuggestion] = useState<TranslationSuggestionDto | null>(null);
  const save = useSaveTranslation();
  const revert = useRevertTranslation();
  const review = useReviewTranslation();
  const confirm = useConfirmTranslation();
  const suggest = useSuggestTranslation();

  const chips = placeholderChips(source, draft);
  const sourceBreaks = lineBreakCount(source);
  const draftBreaks = lineBreakCount(draft);
  const valid = draftValid(source, draft);
  const hasOverride = cell.origin !== 'repo' || cell.hidden;
  const language = LOCALE_META[locale].native;
  const busy = save.isPending || revert.isPending || review.isPending || confirm.isPending;

  const submit = () => {
    if (!canWrite || !valid || busy) return;
    save.mutate(
      { locale, key: entry.key, value: draft, reviewed },
      {
        onSuccess: (res) => {
          const saved = res.entry.cells[locale];
          toast.success(t('admin.i18n.cell.saved'));
          applyOverride(locale, entry.key, saved.value);
          setDraft(saved.value ?? draft);
          if (saved.warnings.length > 0 || res.typographyFixed) {
            setResult({ warnings: saved.warnings, typographyFixed: res.typographyFixed });
          } else {
            onClose();
          }
        },
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const fallback = locale === 'de' ? null : fallbackText(entry, locale);

  return (
    <div className="space-y-3" data-cell-editor={`${locale}:${entry.key}`}>
      {entry.legal && <Notice tone="warning">{t('admin.i18n.cell.legalHint')}</Notice>}
      <div className="grid gap-3 lg:grid-cols-2">
        <SourceBlock label={t('admin.i18n.cell.source')} text={source}>
          {locale !== 'de' && entry.cells.de.origin !== 'repo' && (
            <p className="mt-1 text-xs text-muted">{t('admin.i18n.cell.sourceOverride')}</p>
          )}
        </SourceBlock>
        {locale !== 'de' && locale !== 'en' && entry.cells.en.value && (
          <SourceBlock label={t('admin.i18n.cell.reference')} text={entry.cells.en.value} />
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`cell-${locale}-${entry.key}`} className="block text-[13px] font-medium text-text">
          {t('admin.i18n.cell.value', { language })}
        </label>
        <Textarea
          id={`cell-${locale}-${entry.key}`}
          dir="auto"
          rows={Math.min(8, Math.max(2, draft.split('\n').length + 1))}
          value={draft}
          readOnly={!canWrite}
          placeholder={fallback ?? undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setResult(null);
          }}
          onKeyDown={onKeyDown}
          autoFocus={canWrite}
        />
        {(chips.length > 0 || sourceBreaks > 0) && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label={t('admin.i18n.cell.placeholders')}>
            {chips.map((chip) => (
              <span
                key={`${chip.extra ? 'x' : 'p'}:${chip.name}`}
                data-chip={chip.ok ? 'ok' : 'error'}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11.5px]',
                  chip.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                )}
              >
                {chip.ok ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
                {chip.ok
                  ? `{${chip.name}}`
                  : chip.extra
                    ? t('admin.i18n.cell.placeholderExtra', { name: `{${chip.name}}` })
                    : t('admin.i18n.cell.placeholderMissing', { name: `{${chip.name}}` })}
              </span>
            ))}
            {sourceBreaks > 0 && (
              <span
                data-chip={sourceBreaks === draftBreaks ? 'ok' : 'error'}
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[11.5px]',
                  sourceBreaks === draftBreaks
                    ? 'bg-success-soft text-success'
                    : 'bg-danger-soft text-danger',
                )}
              >
                {t('admin.i18n.cell.lineBreaks', { count: draftBreaks, expected: sourceBreaks })}
              </span>
            )}
          </div>
        )}
        {cell.updatedBy && cell.updatedAt && (
          <p className="text-xs text-muted">
            {t('admin.i18n.cell.updatedBy', {
              name: cell.updatedBy.name,
              when: formatRelative(cell.updatedAt, uiLocale),
            })}
          </p>
        )}
      </div>

      {result && (
        <div className="space-y-2">
          {result.typographyFixed && <Notice tone="info">{t('admin.i18n.cell.typographyFixed')}</Notice>}
          {result.warnings.length > 0 && (
            <Notice tone="warning">
              <ul className="list-disc space-y-0.5 pl-4">
                {result.warnings.map((w) => (
                  <li key={w}>{t(`admin.i18n.check.${w}`)}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}

      {suggestion && (
        <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          {suggestion.value !== null ? (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0 break-words whitespace-pre-line">{suggestion.value}</span>
              <Button size="sm" variant="outline" onClick={() => setDraft(suggestion.value ?? draft)}>
                {t('admin.i18n.cell.suggestApply')}
              </Button>
            </div>
          ) : (
            <span className="text-danger">
              {t('admin.i18n.cell.suggestFailed', {
                reason: suggestion.reason ? t(`admin.i18n.job.reason.${suggestion.reason}`) : '',
              })}
            </span>
          )}
        </div>
      )}

      {!canWrite ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">{t('admin.i18n.cell.readOnly')}</p>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="mr-2 inline-flex min-h-11 items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                className="size-4 accent-brand-blue"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              {t('admin.i18n.cell.reviewed')}
            </label>
            <Button variant="primary" size="sm" disabled={!valid} loading={save.isPending} onClick={submit}>
              {t('common.save')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            {canSuggest && !entry.legal && locale !== 'de' && (
              <Button
                size="sm"
                variant="outline"
                icon={<Sparkles className="size-4" aria-hidden />}
                loading={suggest.isPending}
                onClick={() =>
                  suggest.mutate(
                    { key: entry.key, locales: [locale as TargetLocale] },
                    { onSuccess: (res) => setSuggestion(res.suggestions[0] ?? null) },
                  )
                }
              >
                {t('admin.i18n.cell.suggest')}
              </Button>
            )}
            {cell.origin === 'ai' && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => review.mutate({ locale, key: entry.key, reviewed: !cell.reviewed })}
              >
                {cell.reviewed ? t('admin.i18n.cell.markUnreviewed') : t('admin.i18n.cell.markReviewed')}
              </Button>
            )}
            {cell.state === 'stale' && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                title={t('admin.i18n.cell.confirmHint')}
                onClick={() => confirm.mutate({ locale, key: entry.key })}
              >
                {t('admin.i18n.cell.confirm')}
              </Button>
            )}
            {hasOverride && (
              <Button size="sm" variant="danger-soft" disabled={busy} onClick={() => setRevertOpen(true)}>
                {t('admin.i18n.cell.revert')}
              </Button>
            )}
          </div>
          {cell.state === 'stale' && <p className="text-xs text-muted">{t('admin.i18n.cell.confirmHint')}</p>}
          <p className="hidden text-xs text-subtle sm:block">{t('admin.i18n.cell.shortcut')}</p>
        </>
      )}

      <ConfirmDialog
        open={revertOpen}
        onOpenChange={setRevertOpen}
        title={t('admin.i18n.cell.revertTitle')}
        description={
          cell.compiled !== null
            ? t('admin.i18n.cell.revertText', { language, value: cell.compiled })
            : t('admin.i18n.cell.revertMissing', { language })
        }
        confirmLabel={t('admin.i18n.cell.revert')}
        loading={revert.isPending}
        onConfirm={() =>
          revert.mutate(
            { locale, key: entry.key },
            {
              onSuccess: () => {
                toast.success(t('admin.i18n.cell.reverted'));
                applyOverride(locale, entry.key, null);
                setRevertOpen(false);
                onClose();
              },
            },
          )
        }
      />
    </div>
  );
}

function SourceBlock({ label, text, children }: { label: string; text: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <CopyButton value={text} />
      </div>
      <p className="mt-0.5 text-sm break-words whitespace-pre-line text-text">{text}</p>
      {children}
    </div>
  );
}
