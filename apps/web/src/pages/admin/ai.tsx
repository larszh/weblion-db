import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, KeyRound, Settings2, Sparkles } from 'lucide-react';
import {
  AI_FEATURES,
  AI_MODELS,
  AI_PRICES,
  intlLocale,
  type AiErrorDto,
  type AiFeature,
  type AiGoLiveDto,
  type AiModel,
  type AiSettingsDto,
  type AiSettingsInput,
  type AiTestResultDto,
  type AiUsageStatus,
  type AiUsageTotalsDto,
  type Locale,
  type TranslationKey,
} from '@weblion/shared';
import { cn } from '@/lib/cn';
import { useI18n, hasKey, type TFunction } from '@/lib/i18n';
import { formatDate, formatNumber } from '@/lib/format';
import {
  aiErrorText,
  useAdminAiSettings,
  useAiErrors,
  useAiUsage,
  useDeleteAiKey,
  useSaveAiKey,
  useSaveAiSettings,
  useTestAi,
  type AiErrorsParams,
} from '@/lib/api/ai';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Select,
  UsageBar,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { AiText } from '@/components/ai/ai-text';
import { modelLabel, usdFromMicros } from '@/components/ai/bits';
import { Pager } from '@/pages/billing/bits';
import { TabBar, useTabParam } from '@/pages/reseller/bits';

/**
 * The KI page /admin/ai (ai 12.2): settings (status and master switch with the go-live checklist, key,
 * model, features, budget and limits, data notice), usage per month and the errors of the last 30 days.
 * Every route here needs platform:settings and works while AI is off (ai 5.4).
 */

type Tab = 'settings' | 'usage' | 'errors';

const NOTICE_LINK = '/admin/translations?tab=entries&q=ai.notice.text';

const MODEL_HINT: Record<AiModel, TranslationKey> = {
  'claude-opus-5-5': 'admin.ai.model.opusHint',
  'claude-sonnet-5-5': 'admin.ai.model.sonnetHint',
  'claude-haiku-5-5': 'admin.ai.model.haikuHint',
};

/** The settings as PUT /admin/ai/settings takes them, from what GET returned. */
export function settingsInput(s: AiSettingsDto): AiSettingsInput {
  return {
    enabled: s.enabled,
    model: s.model,
    features: { ...s.features },
    budgetUsd: s.budgetUsd,
    warnPercent: s.warnPercent,
    dailyOrgLimit: s.dailyOrgLimit,
    dailyUserLimit: s.dailyUserLimit,
  };
}

const usd = (micros: number) => `USD ${usdFromMicros(micros)}`;

/** The text of a reason of the test button or the errors tab, else the code as it is. */
function reasonText(t: TFunction, reason: string | null): string {
  if (!reason) return '–';
  const key = `admin.ai.reason.${reason}`;
  return hasKey(key) ? t(key as TranslationKey) : reason;
}

export function AdminAiPage() {
  const { t } = useI18n();
  const tabs = [
    { value: 'settings' as const, label: t('admin.ai.tab.settings'), icon: <Settings2 /> },
    { value: 'usage' as const, label: t('admin.ai.tab.usage'), icon: <BarChart3 /> },
    { value: 'errors' as const, label: t('admin.ai.tab.errors'), icon: <AlertTriangle /> },
  ];
  const [tab, setTab] = useTabParam<Tab>(tabs);
  return (
    <>
      <PageHeader title={t('nav.admin.ai')} description={t('admin.ai.subtitle')} />
      <TabBar tabs={tabs} current={tab} onChange={setTab} label={t('nav.admin.ai')} />
      {tab === 'settings' ? <SettingsTab /> : tab === 'usage' ? <UsageTab /> : <ErrorsTab />}
    </>
  );
}

// --- Settings ----------------------------------------------------------------------

function SettingsTab() {
  const settings = useAdminAiSettings();
  if (settings.isPending) return <LoadingBlock rows={6} />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  return <SettingsCards settings={settings.data} />;
}

function SettingsCards({ settings }: { settings: AiSettingsDto }) {
  const save = useSaveAiSettings();
  const put = (change: Partial<AiSettingsInput>) => save.mutate({ ...settingsInput(settings), ...change });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <StatusCard settings={settings} />
      <KeyCard settings={settings} />
      <ModelCard settings={settings} pending={save.isPending} onChange={(model) => put({ model })} />
      <FeaturesCard
        settings={settings}
        pending={save.isPending}
        onChange={(feature, on) => put({ features: { ...settings.features, [feature]: on } })}
      />
      <LimitsCard settings={settings} />
      <NoticeCard settings={settings} pending={save.isPending} onCheck={() => put({ noticeChecked: true })} />
    </div>
  );
}

function StatusBadges({ settings }: { settings: AiSettingsDto }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone={settings.enabled ? 'success' : 'neutral'}>
        {settings.enabled ? t('admin.ai.status.on') : t('admin.ai.status.off')}
      </Badge>
      {settings.demo ? (
        <Badge tone="warning">{t('admin.ai.status.demo')}</Badge>
      ) : settings.key.source === 'none' ? (
        <Badge tone="danger">{t('admin.ai.status.notConfigured')}</Badge>
      ) : null}
    </div>
  );
}

function StatusCard({ settings }: { settings: AiSettingsDto }) {
  const { t } = useI18n();
  const [goLive, setGoLive] = useState(false);
  const save = useSaveAiSettings(() => setGoLive(false));
  const [test, setTest] = useState<AiTestResultDto | null>(null);
  const tester = useTestAi(setTest);

  const toggle = (on: boolean) => {
    // Turning the master switch on outside demo mode asks for the go-live checklist (ai 5.1, 16).
    if (on && !settings.demo) setGoLive(true);
    else save.mutate({ ...settingsInput(settings), enabled: on });
  };

  return (
    <Card>
      <CardHeader title={t('admin.ai.status.title')} actions={<StatusBadges settings={settings} />} />
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{t('admin.ai.status.master')}</p>
            <p className="mt-0.5 text-xs text-muted">{t('admin.ai.status.masterHint')}</p>
          </div>
          <Switch
            checked={settings.enabled}
            disabled={save.isPending}
            label={t('admin.ai.status.master')}
            onCheckedChange={toggle}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" loading={tester.isPending} onClick={() => tester.mutate(undefined)}>
            {t('admin.ai.status.test')}
          </Button>
          {test && (
            <span className={cn('text-sm', test.ok ? 'text-success' : 'text-danger')}>
              {test.ok
                ? t('admin.ai.status.testOk', { model: modelLabel(test.model), ms: test.latencyMs })
                : t('admin.ai.status.testFailed', { reason: reasonText(t, test.reason) })}
            </span>
          )}
        </div>
      </CardBody>
      <GoLiveDialog
        open={goLive}
        onOpenChange={(open) => {
          setGoLive(open);
          if (!open) save.reset();
        }}
        stored={settings.goLive}
        pending={save.isPending}
        error={save.error}
        onConfirm={(checks) => save.mutate({ ...settingsInput(settings), enabled: true, goLive: checks })}
      />
    </Card>
  );
}

type GoLiveChecks = Omit<AiGoLiveDto, 'confirmedAt' | 'confirmedBy'>;

const GO_LIVE_ITEMS: Array<{ field: keyof GoLiveChecks; key: TranslationKey }> = [
  { field: 'contracts', key: 'admin.ai.status.enableCheck.contracts' },
  { field: 'transferBasis', key: 'admin.ai.status.enableCheck.transfer' },
  { field: 'noticeChecked', key: 'admin.ai.status.enableCheck.notice' },
  { field: 'workspaceChecked', key: 'admin.ai.status.enableCheck.workspace' },
];

/** The four checks of the go-live checklist, pre-filled with the stored ones (plan O34: no announcement date). */
export function goLiveDraft(stored: AiGoLiveDto | null): GoLiveChecks {
  return {
    contracts: stored?.contracts ?? false,
    transferBasis: stored?.transferBasis ?? false,
    noticeChecked: stored?.noticeChecked ?? false,
    workspaceChecked: stored?.workspaceChecked ?? false,
  };
}

export const goLiveReady = (checks: GoLiveChecks) => GO_LIVE_ITEMS.every((item) => checks[item.field]);

function GoLiveDialog({
  open,
  onOpenChange,
  stored,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stored: AiGoLiveDto | null;
  pending: boolean;
  error: unknown;
  onConfirm: (checks: GoLiveChecks) => void;
}) {
  const { t } = useI18n();
  const [checks, setChecks] = useState(() => goLiveDraft(stored));
  // Every opening starts from the stored checks again.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setChecks(goLiveDraft(stored));
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.ai.status.enableTitle')}
      description={t('admin.ai.status.enableText')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!goLiveReady(checks)}
            loading={pending}
            onClick={() => onConfirm(checks)}
          >
            {t('admin.ai.status.enableAction')}
          </Button>
        </>
      }
    >
      <GoLiveBody
        checks={checks}
        onChange={(field, value) => setChecks((c) => ({ ...c, [field]: value }))}
        error={error}
      />
    </Dialog>
  );
}

/** The dialog's body, rendered on its own by the tests (the dialog itself renders into a portal). */
export function GoLiveBody({
  checks,
  onChange,
  error,
}: {
  checks: GoLiveChecks;
  onChange: (field: keyof GoLiveChecks, value: boolean) => void;
  error?: unknown;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3 text-sm">
      {GO_LIVE_ITEMS.map((item) => (
        <label key={item.field} className="flex items-start gap-2.5 text-text">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
            checked={checks[item.field]}
            onChange={(e) => onChange(item.field, e.target.checked)}
          />
          <span>{t(item.key)}</span>
        </label>
      ))}
      <Notice tone="info">{t('admin.ai.status.enableOptIn')}</Notice>
      {!!error && (
        <p role="alert" className="text-sm text-danger">
          {aiErrorText(t, error)}
        </p>
      )}
    </div>
  );
}

function KeyCard({ settings }: { settings: AiSettingsDto }) {
  const { t, locale } = useI18n();
  const [key, setKey] = useState('');
  const [deleting, setDeleting] = useState(false);
  const save = useSaveAiKey(() => setKey(''));
  const remove = useDeleteAiKey(() => setDeleting(false));
  const { source, savedAt, savedBy, envSet } = settings.key;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (key.trim()) save.mutate({ key: key.trim() });
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <KeyRound className="size-4 text-muted" aria-hidden />
            {t('admin.ai.key.title')}
          </span>
        }
        actions={
          <Badge tone={source === 'none' ? 'neutral' : 'success'}>{t(`admin.ai.key.source.${source}`)}</Badge>
        }
      />
      <CardBody className="space-y-4">
        {source === 'ui' && savedAt && (
          <p className="text-sm text-muted">
            {t('admin.ai.key.savedBy', { date: formatDate(savedAt, locale), name: savedBy?.name ?? '–' })}
          </p>
        )}
        <form onSubmit={submit} className="space-y-3" autoComplete="off">
          <Field
            label={t('admin.ai.key.label')}
            htmlFor="ai-key"
            hint={t('admin.ai.key.hint')}
            error={save.error ? aiErrorText(t, save.error) : undefined}
          >
            {/* Never filled from the server: the key is write-only (ai 5.2). */}
            <Input
              id="ai-key"
              type="password"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (save.error) save.reset();
              }}
              placeholder="sk-ant-..."
              autoComplete="new-password"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={!key.trim()} loading={save.isPending}>
              {source === 'ui' ? t('admin.ai.key.replace') : t('admin.ai.key.save')}
            </Button>
            {source === 'ui' && (
              <Button size="sm" variant="danger-soft" onClick={() => setDeleting(true)}>
                {t('admin.ai.key.delete')}
              </Button>
            )}
          </div>
        </form>
      </CardBody>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('admin.ai.key.delete')}
        description={
          envSet
            ? `${t('admin.ai.key.deleteConfirm')} ${t('admin.ai.key.envFallback')}`
            : t('admin.ai.key.deleteConfirm')
        }
        confirmLabel={t('admin.ai.key.delete')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

function ModelCard({
  settings,
  pending,
  onChange,
}: {
  settings: AiSettingsDto;
  pending: boolean;
  onChange: (model: AiModel) => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader title={t('admin.ai.model.title')} description={t('admin.ai.model.hint')} />
      <CardBody className="space-y-3">
        <div className="space-y-2" role="radiogroup" aria-label={t('admin.ai.model.title')}>
          {AI_MODELS.map((model) => {
            const price = AI_PRICES[model];
            const active = settings.model === model;
            return (
              <label
                key={model}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm',
                  active ? 'border-brand-blue bg-primary-soft' : 'border-border hover:bg-surface-2',
                )}
              >
                <input
                  type="radio"
                  name="ai-model"
                  className="mt-1 accent-[var(--primary)]"
                  checked={active}
                  disabled={pending}
                  onChange={() => onChange(model)}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-text">{modelLabel(model)}</span>
                  <span className="block text-xs text-muted">{t(MODEL_HINT[model])}</span>
                  <span className="block text-xs text-subtle">
                    {t('admin.ai.model.price', {
                      input: price.input.toFixed(2),
                      output: price.output.toFixed(2),
                    })}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted">{t('admin.ai.model.fallback')}</p>
      </CardBody>
    </Card>
  );
}

function FeaturesCard({
  settings,
  pending,
  onChange,
}: {
  settings: AiSettingsDto;
  pending: boolean;
  onChange: (feature: AiFeature, on: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader title={t('admin.ai.features.title')} description={t('admin.ai.features.hint')} />
      <ul className="divide-y divide-border">
        {AI_FEATURES.map((feature) => (
          <li key={feature} className="flex items-start justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">{t(`ai.feature.${feature}.label`)}</p>
              <p className="mt-0.5 text-xs text-muted">{t(`ai.feature.${feature}.description`)}</p>
            </div>
            <Switch
              checked={settings.features[feature]}
              disabled={pending}
              label={t(`ai.feature.${feature}.label`)}
              onCheckedChange={(on) => onChange(feature, on)}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tabular"
      />
    </Field>
  );
}

/** A number within the API's range (ai 5.1), else null. */
function parseLimit(value: string, min: number, max: number, integer: boolean): number | null {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n) || n < min || n > max) return null;
  if (integer && !Number.isInteger(n)) return null;
  return n;
}

function LimitsCard({ settings }: { settings: AiSettingsDto }) {
  const { t } = useI18n();
  const save = useSaveAiSettings();
  const [draft, setDraft] = useState(() => ({
    budgetUsd: String(settings.budgetUsd),
    warnPercent: String(settings.warnPercent),
    dailyOrgLimit: String(settings.dailyOrgLimit),
    dailyUserLimit: String(settings.dailyUserLimit),
  }));
  const parsed = {
    budgetUsd: parseLimit(draft.budgetUsd, 0, 100_000, false),
    warnPercent: parseLimit(draft.warnPercent, 10, 99, true),
    dailyOrgLimit: parseLimit(draft.dailyOrgLimit, 1, 10_000, true),
    dailyUserLimit: parseLimit(draft.dailyUserLimit, 1, 10_000, true),
  };
  const valid = Object.values(parsed).every((v) => v !== null);
  const { budget } = settings;
  const set = (field: keyof typeof draft) => (value: string) => setDraft((d) => ({ ...d, [field]: value }));

  return (
    <Card>
      <CardHeader title={t('admin.ai.limits.title')} />
      <CardBody className="space-y-4">
        <div className="space-y-1.5">
          <UsageBar value={budget.percent} />
          <p className="text-sm text-muted">
            {t('admin.ai.limits.spent', {
              spent: usd(budget.spentMicros),
              budget: usd(budget.budgetMicros),
              percent: budget.percent,
            })}
          </p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            save.mutate({
              ...settingsInput(settings),
              budgetUsd: parsed.budgetUsd!,
              warnPercent: parsed.warnPercent!,
              dailyOrgLimit: parsed.dailyOrgLimit!,
              dailyUserLimit: parsed.dailyUserLimit!,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="ai-budget"
              label={t('admin.ai.limits.budget')}
              value={draft.budgetUsd}
              onChange={set('budgetUsd')}
              min={0}
              max={100_000}
              step={0.01}
            />
            <NumberField
              id="ai-warn"
              label={t('admin.ai.limits.warn')}
              value={draft.warnPercent}
              onChange={set('warnPercent')}
              min={10}
              max={99}
            />
            <NumberField
              id="ai-daily-org"
              label={t('admin.ai.limits.dailyOrg')}
              value={draft.dailyOrgLimit}
              onChange={set('dailyOrgLimit')}
              min={1}
              max={10_000}
            />
            <NumberField
              id="ai-daily-user"
              label={t('admin.ai.limits.dailyUser')}
              value={draft.dailyUserLimit}
              onChange={set('dailyUserLimit')}
              min={1}
              max={10_000}
            />
          </div>
          <p className="text-xs text-muted">{t('admin.ai.limits.fixed')}</p>
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="primary" disabled={!valid} loading={save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function NoticeCard({
  settings,
  pending,
  onCheck,
}: {
  settings: AiSettingsDto;
  pending: boolean;
  onCheck: () => void;
}) {
  const { t, locale } = useI18n();
  const { checkedAt, checkedBy } = settings.notice;
  return (
    <Card className="lg:col-span-2">
      <CardHeader title={t('admin.ai.notice.title')} description={t('admin.ai.notice.hint')} />
      <CardBody className="space-y-4">
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-2 px-4 py-3">
          <p className="mb-2 text-sm font-semibold text-text">{t('ai.notice.title')}</p>
          <AiText text={t('ai.notice.text')} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={NOTICE_LINK}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-text shadow-card hover:bg-surface-3"
          >
            {t('admin.ai.notice.edit')}
          </Link>
          <Button size="sm" loading={pending} onClick={onCheck}>
            {t('admin.ai.notice.check')}
          </Button>
          <span className="text-sm text-muted">
            {checkedAt
              ? t('admin.ai.notice.checked', {
                  date: formatDate(checkedAt, locale),
                  name: checkedBy?.name ?? '–',
                })
              : t('admin.ai.notice.unchecked')}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

// --- Usage -------------------------------------------------------------------------

/** The current month in Europe/Zurich (the API's month) and the 12 before it, newest first. */
export function usageMonths(now: Date = new Date()): string[] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  let year = Number(parts.find((p) => p.type === 'year')!.value);
  let month = Number(parts.find((p) => p.type === 'month')!.value);
  const out: string[] = [];
  for (let i = 0; i < 13; i++) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

function monthLabel(month: string, locale: Locale): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 font-display text-lg font-semibold text-text tabular">{value}</p>
    </Card>
  );
}

function TotalsCells({ row }: { row: AiUsageTotalsDto }) {
  const { locale } = useI18n();
  return (
    <>
      <TD className="text-right tabular">{formatNumber(row.requests, locale)}</TD>
      <TD className="text-right whitespace-nowrap tabular">{usd(row.costMicros)}</TD>
      <TD className="hidden text-right tabular sm:table-cell">{formatNumber(row.inputTokens, locale)}</TD>
      <TD className="hidden text-right tabular sm:table-cell">{formatNumber(row.outputTokens, locale)}</TD>
    </>
  );
}

function TotalsHead({ first, extra }: { first: string; extra?: ReactNode }) {
  const { t } = useI18n();
  return (
    <THead>
      <tr>
        <TH>{first}</TH>
        {extra}
        <TH className="text-right">{t('admin.ai.usage.requests')}</TH>
        <TH className="text-right">{t('admin.ai.usage.cost')}</TH>
        <TH className="hidden text-right sm:table-cell">{t('admin.ai.usage.tokensIn')}</TH>
        <TH className="hidden text-right sm:table-cell">{t('admin.ai.usage.tokensOut')}</TH>
      </tr>
    </THead>
  );
}

function UsageTab() {
  const { t, locale } = useI18n();
  const months = usageMonths();
  const [month, setMonth] = useState(months[0]!);
  const usage = useAiUsage(month);
  const data = usage.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="ai-usage-month" className="text-sm font-medium text-text">
          {t('admin.ai.usage.month')}
        </label>
        <Select
          id="ai-usage-month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-auto"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, locale)}
            </option>
          ))}
        </Select>
      </div>
      {usage.isPending ? (
        <LoadingBlock rows={4} />
      ) : usage.isError ? (
        <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
      ) : data!.totals.requests === 0 ? (
        <Card>
          <EmptyState icon={<Sparkles className="size-6" />} title={t('admin.ai.usage.empty')} />
        </Card>
      ) : (
        <div className={cn('space-y-6', usage.isFetching && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label={t('admin.ai.usage.requests')} value={formatNumber(data!.totals.requests, locale)} />
            <Tile label={t('admin.ai.usage.cost')} value={usd(data!.totals.costMicros)} />
            <Tile
              label={t('admin.ai.usage.tokensIn')}
              value={formatNumber(data!.totals.inputTokens, locale)}
            />
            <Tile
              label={t('admin.ai.usage.tokensOut')}
              value={formatNumber(data!.totals.outputTokens, locale)}
            />
            <Tile
              label={t('admin.ai.usage.cacheRead')}
              value={formatNumber(data!.totals.cacheReadTokens, locale)}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('admin.ai.usage.byFeature')} />
              <Table>
                <TotalsHead first={t('admin.ai.errors.col.feature')} />
                <TBody>
                  {data!.byFeature.map((row) => (
                    <tr key={row.feature}>
                      <TD>{t(`ai.feature.${row.feature}.label`)}</TD>
                      <TotalsCells row={row} />
                    </tr>
                  ))}
                </TBody>
              </Table>
            </Card>
            <Card>
              <CardHeader title={t('admin.ai.usage.byModel')} />
              <Table>
                <TotalsHead first={t('admin.ai.errors.col.model')} />
                <TBody>
                  {data!.byModel.map((row) => (
                    <tr key={row.model}>
                      <TD className="whitespace-nowrap">{modelLabel(row.model)}</TD>
                      <TotalsCells row={row} />
                    </tr>
                  ))}
                </TBody>
              </Table>
            </Card>
          </div>
          <Card>
            <CardHeader title={t('admin.ai.usage.byOrg')} />
            <Table>
              <TotalsHead
                first={t('admin.ai.errors.col.org')}
                extra={<TH className="text-right">{t('admin.ai.usage.staff')}</TH>}
              />
              <TBody>
                {data!.byOrg.map((row) => (
                  <tr key={row.org?.id ?? 'platform'}>
                    <TD className="min-w-[10rem] break-words">
                      {row.org ? (
                        <Link
                          to={`/admin/customers/${row.org.id}`}
                          className="font-medium text-text hover:text-primary-text"
                        >
                          {row.org.name}
                        </Link>
                      ) : (
                        <span className="text-muted">{t('admin.ai.usage.platform')}</span>
                      )}
                    </TD>
                    <TD className="text-right tabular">{formatNumber(row.staffRequests, locale)}</TD>
                    <TotalsCells row={row} />
                  </tr>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader title={t('admin.ai.usage.byDay')} />
            <Table>
              <TotalsHead first={t('admin.ai.usage.date')} />
              <TBody>
                {data!.byDay.map((row) => (
                  <tr key={row.date}>
                    <TD className="whitespace-nowrap tabular">
                      {formatDate(`${row.date}T12:00:00Z`, locale, false)}
                    </TD>
                    <TotalsCells row={row} />
                  </tr>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}

// --- Errors ------------------------------------------------------------------------

const ERROR_STATUSES: AiUsageStatus[] = ['refusal', 'incomplete', 'error', 'stale'];

function ErrorsTab() {
  const { t } = useI18n();
  const [params, setParams] = useState<AiErrorsParams>({ page: 1 });
  const errors = useAiErrors(params);
  const update = (change: Partial<AiErrorsParams>) => setParams((p) => ({ ...p, ...change, page: 1 }));
  return (
    <Card>
      <div className="grid grid-cols-1 gap-2 border-b border-border px-4 py-3 sm:grid-cols-3 lg:flex">
        <Select
          aria-label={t('admin.ai.errors.col.feature')}
          value={params.feature ?? ''}
          onChange={(e) => update({ feature: (e.target.value || undefined) as AiFeature | undefined })}
          className="lg:w-auto"
        >
          <option value="">{t('admin.ai.errors.allFeatures')}</option>
          {AI_FEATURES.map((f) => (
            <option key={f} value={f}>
              {t(`ai.feature.${f}.label`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('admin.ai.errors.col.status')}
          value={params.status ?? ''}
          onChange={(e) => update({ status: (e.target.value || undefined) as AiUsageStatus | undefined })}
          className="lg:w-auto"
        >
          <option value="">{t('admin.ai.errors.allStatuses')}</option>
          {ERROR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`admin.ai.usageStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('admin.ai.errors.col.reason')}
          value={params.source ?? ''}
          onChange={(e) =>
            update({ source: (e.target.value || undefined) as 'api' | 'internal' | undefined })
          }
          className="lg:w-auto"
        >
          <option value="">{t('admin.ai.errors.allSources')}</option>
          <option value="api">{t('admin.ai.reason.api')}</option>
          <option value="internal">{t('admin.ai.reason.internal')}</option>
        </Select>
      </div>
      {errors.isPending ? (
        <LoadingBlock rows={5} />
      ) : errors.isError ? (
        <div className="p-5">
          <ErrorState error={errors.error} onRetry={() => void errors.refetch()} />
        </div>
      ) : errors.data.items.length === 0 ? (
        <EmptyState title={t('admin.ai.errors.empty')} />
      ) : (
        <div className={cn(errors.isFetching && 'opacity-60')}>
          <ErrorsTable items={errors.data.items} />
          <ErrorCards items={errors.data.items} />
        </div>
      )}
      {errors.data && (
        <Pager
          page={errors.data.page}
          perPage={errors.data.perPage}
          total={errors.data.total}
          onChange={(page) => setParams((p) => ({ ...p, page }))}
        />
      )}
      <p className="border-t border-border px-5 py-3 text-xs text-muted">{t('admin.ai.errors.retention')}</p>
    </Card>
  );
}

function errorReason(t: TFunction, row: AiErrorDto): string {
  if (row.errorReason) return reasonText(t, row.errorReason);
  return row.errorCode ?? '–';
}

function ErrorsTable({ items }: { items: AiErrorDto[] }) {
  const { t, locale } = useI18n();
  return (
    <div className="hidden md:block">
      <Table>
        <THead>
          <tr>
            <TH>{t('admin.ai.errors.col.time')}</TH>
            <TH>{t('admin.ai.errors.col.feature')}</TH>
            <TH>{t('admin.ai.errors.col.org')}</TH>
            <TH>{t('admin.ai.errors.col.user')}</TH>
            <TH>{t('admin.ai.errors.col.model')}</TH>
            <TH>{t('admin.ai.errors.col.status')}</TH>
            <TH>{t('admin.ai.errors.col.reason')}</TH>
            <TH>{t('admin.ai.errors.col.message')}</TH>
            <TH>{t('admin.ai.errors.col.requestId')}</TH>
          </tr>
        </THead>
        <TBody>
          {items.map((row) => (
            <tr key={row.id} className="align-top">
              <TD className="whitespace-nowrap tabular">{formatDate(row.createdAt, locale)}</TD>
              <TD>{t(`ai.feature.${row.feature}.label`)}</TD>
              <TD className="break-words">{row.org?.name ?? '–'}</TD>
              <TD className="break-words">{row.user?.name ?? '–'}</TD>
              <TD className="whitespace-nowrap">{modelLabel(row.servedModel ?? row.model)}</TD>
              <TD>
                <Badge tone={row.status === 'refusal' ? 'warning' : 'danger'}>
                  {t(`admin.ai.usageStatus.${row.status}`)}
                </Badge>
              </TD>
              <TD className="min-w-[8rem]">{errorReason(t, row)}</TD>
              <TD className="max-w-[24rem]">
                {row.errorMessage ? <Mono className="break-all">{row.errorMessage}</Mono> : '–'}
              </TD>
              <TD>
                {row.requestId ? (
                  <span className="flex items-center gap-1">
                    <Mono className="break-all">{row.requestId}</Mono>
                    <CopyButton value={row.requestId} />
                  </span>
                ) : (
                  '–'
                )}
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/** Below md each row is a card (ai 12.2), so nothing scrolls sideways at 390 px. */
function ErrorCards({ items }: { items: AiErrorDto[] }) {
  const { t, locale } = useI18n();
  return (
    <ul className="divide-y divide-border md:hidden">
      {items.map((row) => (
        <li key={row.id} className="space-y-1.5 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={row.status === 'refusal' ? 'warning' : 'danger'}>
              {t(`admin.ai.usageStatus.${row.status}`)}
            </Badge>
            <span className="font-medium text-text">{t(`ai.feature.${row.feature}.label`)}</span>
            <span className="text-xs text-muted tabular">{formatDate(row.createdAt, locale)}</span>
          </div>
          <p className="text-muted break-words">
            {[row.org?.name, row.user?.name, modelLabel(row.servedModel ?? row.model)]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="text-text">{errorReason(t, row)}</p>
          {row.errorMessage && <Mono className="block break-all text-muted">{row.errorMessage}</Mono>}
          {row.requestId && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Mono className="break-all">{row.requestId}</Mono>
              <CopyButton value={row.requestId} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
