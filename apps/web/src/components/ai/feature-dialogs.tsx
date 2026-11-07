import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import {
  LOCALE_META,
  LOCALES,
  TARGET_LOCALES,
  type AiAuditPeriod,
  type AiAuditSummaryResult,
  type AiCheckStatus,
  type AiDnsCheckResult,
  type AiDnsProposalDto,
  type AiHealthStatus,
  type AiProductTextsResult,
  type AiServerHealthResult,
  type Locale,
} from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import {
  useAiAuditSummary,
  useAiDnsCheck,
  useAiProductTexts,
  useAiServerHealth,
  type AiScope,
} from '@/lib/api/ai';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Flag } from '@/components/server-bits';
import { Badge, Field, Select, Spinner, Textarea } from '@/components/ui/primitives';
import { AiText } from './ai-text';
import { AiErrorBox, AiFootnote, ProposalCard, useAiAllowed } from './bits';
import { useApplyProposal } from './ai-provider';

/**
 * The feature dialogs of ai 10 and 12.5: DNS and mail check, audit summary, server analysis and product
 * texts. Each button renders only while the feature is available to the person (useAiAllowed); the
 * caller checks the feature's own permission (audit:read, server:metrics, ...).
 */

const CHECK_TONE: Record<AiCheckStatus, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  warning: 'warning',
  problem: 'danger',
};
const HEALTH_TONE: Record<AiHealthStatus, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  watch: 'warning',
  problem: 'danger',
};

function FeatureDialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="size-4 text-primary-text" aria-hidden />
          {title}
        </span>
      }
      size="lg"
      footer={
        footer ?? (
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        )
      }
    >
      {children}
    </Dialog>
  );
}

function Working({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted">
      <Spinner className="size-4" />
      {label}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="mb-1.5 text-[13px] font-semibold text-text">{children}</h4>;
}

function FeatureButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" icon={<Sparkles className="size-3.5" aria-hidden />} onClick={onClick}>
      {label}
    </Button>
  );
}

/** Runs the request once when the dialog opens (StrictMode runs effects twice in development). */
function useRunOnOpen(open: boolean, run: () => void) {
  const ran = useRef(false);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!open) {
      ran.current = false;
      return;
    }
    if (ran.current) return;
    ran.current = true;
    runRef.current();
  }, [open]);
}

// --- DNS and mail check (ai 10.2) ----------------------------------------------------

export function DnsCheckResultView({
  result,
  onApply,
}: {
  result: AiDnsCheckResult;
  onApply?: (proposal: AiDnsProposalDto) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-text">{t('ai.dns.zone', { zone: result.zone })}</span>
        <Badge tone={CHECK_TONE[result.overall]}>{t(`ai.dns.status.${result.overall}`)}</Badge>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {result.topics.map((topic) => (
          <li key={topic.topic} className="space-y-1 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-text">{t(`ai.dns.topic.${topic.topic}`)}</span>
              <Badge tone={CHECK_TONE[topic.status]}>{t(`ai.dns.status.${topic.status}`)}</Badge>
            </div>
            <AiText text={topic.finding} className="text-muted" />
          </li>
        ))}
      </ul>
      <section className="space-y-2">
        <SectionTitle>{t('ai.proposal.title')}</SectionTitle>
        {result.proposals.length === 0 ? (
          <p className="text-sm text-muted">{t('ai.dns.noProposals')}</p>
        ) : (
          result.proposals.map((p) => <ProposalCard key={p.id} proposal={p} onApply={onApply} />)
        )}
        {result.droppedProposals > 0 && (
          <p className="text-xs text-muted">{t('ai.dns.dropped', { count: result.droppedProposals })}</p>
        )}
      </section>
      <AiFootnote meta={result.meta} className="border-t border-border pt-3" />
    </div>
  );
}

/** "Mit KI prüfen" for a domain (DomainDns) or a mail domain (mail DNS setup). */
export function DnsCheckButton({
  orgId,
  target,
  onApply,
}: {
  orgId: string;
  target: { domainId: string } | { mailDomainId: string };
  /** Default: hand the proposal to the domain's DNS tab (AiProvider). */
  onApply?: (proposal: AiDnsProposalDto) => void;
}) {
  const { t, locale } = useI18n();
  const allowed = useAiAllowed('dns_check');
  const [open, setOpen] = useState(false);
  const check = useAiDnsCheck(orgId);
  const applyProposal = useApplyProposal();
  const run = () =>
    check.mutate({
      domainId: 'domainId' in target ? target.domainId : null,
      mailDomainId: 'mailDomainId' in target ? target.mailDomainId : null,
      locale,
    });
  useRunOnOpen(open, run);
  if (!allowed) return null;
  const apply = (proposal: AiDnsProposalDto) => {
    setOpen(false);
    (onApply ?? applyProposal)(proposal);
  };
  return (
    <>
      <FeatureButton label={t('ai.dns.button')} onClick={() => setOpen(true)} />
      <FeatureDialog open={open} onOpenChange={setOpen} title={t('ai.dns.title')}>
        {check.isPending ? (
          <Working label={t('ai.assistant.thinking')} />
        ) : check.isError ? (
          <AiErrorBox error={check.error} onRetry={run} />
        ) : check.data ? (
          <DnsCheckResultView result={check.data} onApply={apply} />
        ) : null}
      </FeatureDialog>
    </>
  );
}

// --- Audit summary (ai 10.3) ---------------------------------------------------------

const PERIODS: AiAuditPeriod[] = ['day', 'week', 'month'];
/** The API sends at most this many entries to the model (cut: true beyond). */
const AUDIT_MAX_ENTRIES = 500;

function Findings({ title, items }: { title: string; items: Array<{ text: string }> }) {
  if (items.length === 0) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((item, i) => (
          <li key={i}>
            <AiText text={item.text} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AuditSummaryResultView({ result }: { result: AiAuditSummaryResult }) {
  const { t } = useI18n();
  if (result.entries === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('ai.audit.none')}</p>
        <AiFootnote meta={result.meta} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <AiText text={result.summary} />
      <Findings title={t('ai.audit.highlights')} items={result.highlights} />
      <Findings title={t('ai.audit.unusual')} items={result.unusual} />
      <ul className="space-y-1 text-xs text-muted">
        <li>{t('ai.audit.entries', { count: result.entries })}</li>
        {result.cut && <li>{t('ai.audit.cut', { count: AUDIT_MAX_ENTRIES })}</li>}
        {result.hidden > 0 && <li>{t('ai.audit.hidden', { count: result.hidden })}</li>}
      </ul>
      <AiFootnote meta={result.meta} className="border-t border-border pt-3" />
    </div>
  );
}

/** "Mit KI zusammenfassen" with a period select (organization or admin audit log, admin dashboard). */
export function AuditSummaryButton({
  scope,
  filters,
  defaultPeriod = 'week',
}: {
  scope: AiScope;
  /** The filters of the audit view, so the summary covers what the person is looking at. */
  filters?: { action?: string | null; status?: 'success' | 'failure' | 'denied' | null };
  defaultPeriod?: AiAuditPeriod;
}) {
  const { t, locale } = useI18n();
  const allowed = useAiAllowed('audit_summary', scope === 'admin' ? 'admin' : 'org');
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<AiAuditPeriod>(defaultPeriod);
  const summary = useAiAuditSummary(scope);
  const run = (p: AiAuditPeriod = period) =>
    summary.mutate({
      period: p,
      action: filters?.action || null,
      resourceType: null,
      status: filters?.status ?? null,
      ...(scope === 'admin' ? { orgId: null } : {}),
      locale,
    });
  useRunOnOpen(open, () => run());
  if (!allowed) return null;
  return (
    <>
      <FeatureButton label={t('ai.audit.button')} onClick={() => setOpen(true)} />
      <FeatureDialog open={open} onOpenChange={setOpen} title={t('ai.audit.title')}>
        <div className="space-y-4">
          <Field label={t('ai.audit.period')} htmlFor="ai-audit-period">
            <Select
              id="ai-audit-period"
              value={period}
              disabled={summary.isPending}
              onChange={(e) => {
                const next = e.target.value as AiAuditPeriod;
                setPeriod(next);
                run(next);
              }}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`ai.audit.period.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          {summary.isPending ? (
            <Working label={t('ai.assistant.thinking')} />
          ) : summary.isError ? (
            <AiErrorBox error={summary.error} onRetry={() => run()} />
          ) : summary.data ? (
            <AuditSummaryResultView result={summary.data} />
          ) : null}
        </div>
      </FeatureDialog>
    </>
  );
}

// --- Server analysis (ai 10.4) -------------------------------------------------------

export function ServerHealthResultView({ result }: { result: AiServerHealthResult }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <Badge tone={HEALTH_TONE[result.overall]}>{t(`ai.health.status.${result.overall}`)}</Badge>
      <AiText text={result.summary} />
      <ul className="divide-y divide-border rounded-lg border border-border">
        {result.metrics.map((m) => (
          <li key={m.metric} className="space-y-1 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-text">{t(`ai.health.metric.${m.metric}`)}</span>
              <Badge tone={HEALTH_TONE[m.status]}>{t(`ai.health.status.${m.status}`)}</Badge>
            </div>
            <AiText text={m.finding} className="text-muted" />
          </li>
        ))}
      </ul>
      {result.recommendations.length > 0 && (
        <Findings
          title={t('ai.health.recommendations')}
          items={result.recommendations.map((text) => ({ text }))}
        />
      )}
      <AiFootnote meta={result.meta} className="border-t border-border pt-3" />
    </div>
  );
}

/** "Mit KI auswerten" in the metrics section of a server; the range follows the chart's range. */
export function ServerHealthButton({
  orgId,
  serverId,
  range: initial,
}: {
  orgId: string;
  serverId: string;
  range: 'day' | 'week';
}) {
  const { t, locale } = useI18n();
  const allowed = useAiAllowed('server_health');
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(initial);
  const health = useAiServerHealth(orgId);
  const run = (r: 'day' | 'week' = range) => health.mutate({ serverId, range: r, locale });
  useRunOnOpen(open, () => run());
  if (!allowed) return null;
  return (
    <>
      <FeatureButton
        label={t('ai.health.button')}
        onClick={() => {
          setRange(initial);
          setOpen(true);
        }}
      />
      <FeatureDialog open={open} onOpenChange={setOpen} title={t('ai.health.title')}>
        <div className="space-y-4">
          <Select
            aria-label={t('ai.audit.period')}
            value={range}
            disabled={health.isPending}
            className="w-auto"
            onChange={(e) => {
              const next = e.target.value as 'day' | 'week';
              setRange(next);
              run(next);
            }}
          >
            <option value="day">{t('ai.health.range.day')}</option>
            <option value="week">{t('ai.health.range.week')}</option>
          </Select>
          {health.isPending ? (
            <Working label={t('ai.assistant.thinking')} />
          ) : health.isError ? (
            <AiErrorBox error={health.error} onRetry={() => run()} />
          ) : health.data ? (
            <ServerHealthResultView result={health.data} />
          ) : null}
        </div>
      </FeatureDialog>
    </>
  );
}

// --- Product texts (ai 10.6) ---------------------------------------------------------

export type ProductTexts = AiProductTextsResult['texts'];

export interface ProductTextsInput {
  name: string;
  description: string | null;
  module: string | null;
  interval: string | null;
}

/**
 * "Texte mit KI" in the product dialog: write the texts (German included) or translate the German ones.
 * The result only fills the form; saving is the normal product save (ai 10.6).
 */
export function ProductTextsDialog({
  scope,
  open,
  onOpenChange,
  input,
  onApply,
}: {
  scope: AiScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  input: ProductTextsInput;
  onApply: (texts: ProductTexts) => void;
}) {
  const { t, locale } = useI18n();
  const texts = useAiProductTexts(scope);
  const [mode, setMode] = useState<'write' | 'translate'>(input.name.trim() ? 'translate' : 'write');
  const [notes, setNotes] = useState('');
  const offered: readonly Locale[] = mode === 'write' ? LOCALES : TARGET_LOCALES;
  const [chosen, setChosen] = useState<Locale[]>([...LOCALES]);
  const selected = offered.filter((l) => chosen.includes(l));
  const canRun =
    selected.length > 0 && (mode === 'write' ? !!input.name.trim() || !!notes.trim() : !!input.name.trim());

  const run = () =>
    texts.mutate({
      mode,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      module: input.module,
      interval: input.interval,
      notes: notes.trim() || null,
      locales: selected,
      locale,
    });

  const change = (next: boolean) => {
    if (!next) texts.reset();
    onOpenChange(next);
  };

  return (
    <FeatureDialog
      open={open}
      onOpenChange={change}
      title={t('ai.product.title')}
      footer={
        <>
          <Button variant="ghost" onClick={() => change(false)}>
            {t('common.cancel')}
          </Button>
          {texts.data ? (
            <Button
              variant="primary"
              onClick={() => {
                onApply(texts.data.texts);
                change(false);
              }}
            >
              {t('ai.product.apply')}
            </Button>
          ) : (
            <Button variant="primary" disabled={!canRun} loading={texts.isPending} onClick={run}>
              {t('ai.product.generate')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          {(['write', 'translate'] as const).map((m) => (
            <label
              key={m}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-brand-blue has-[:checked]:bg-primary-soft"
            >
              <input
                type="radio"
                name="ai-product-mode"
                className="accent-[var(--primary)]"
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  texts.reset();
                }}
              />
              {t(`ai.product.mode.${m}`)}
            </label>
          ))}
        </div>
        <Field label={t('ai.product.languages')}>
          <div className="flex flex-wrap gap-2">
            {offered.map((l) => (
              <label
                key={l}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  className="accent-[var(--primary)]"
                  checked={chosen.includes(l)}
                  onChange={(e) =>
                    setChosen((prev) => (e.target.checked ? [...prev, l] : prev.filter((x) => x !== l)))
                  }
                />
                <Flag country={LOCALE_META[l].flag} decorative />
                {LOCALE_META[l].native}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('ai.product.notes')} hint={t('ai.product.notesHint')} htmlFor="ai-product-notes">
          <Textarea
            id="ai-product-notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {texts.isPending ? (
          <Working label={t('ai.assistant.thinking')} />
        ) : texts.isError ? (
          <AiErrorBox error={texts.error} onRetry={run} />
        ) : texts.data ? (
          <ProductTextsResultView result={texts.data} />
        ) : null}
      </div>
    </FeatureDialog>
  );
}

export function ProductTextsResultView({ result }: { result: AiProductTextsResult }) {
  const { t } = useI18n();
  const filled = LOCALES.filter((l) => result.texts[l]);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {filled.map((l) => (
          <li key={l} className="rounded-lg border border-border px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Flag country={LOCALE_META[l].flag} decorative />
              {LOCALE_META[l].native}
            </div>
            <p className="mt-1 text-sm font-medium break-words text-text">{result.texts[l]!.name}</p>
            {result.texts[l]!.description && (
              <p className="mt-0.5 text-sm break-words whitespace-pre-line text-muted">
                {result.texts[l]!.description}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{t('ai.product.applyHint')}</p>
      <AiFootnote meta={result.meta} className="border-t border-border pt-3" />
    </div>
  );
}
