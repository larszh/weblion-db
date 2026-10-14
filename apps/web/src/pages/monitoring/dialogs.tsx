import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import {
  MONITOR_HOST_MAX,
  MONITOR_KEYWORD_MAX,
  MONITOR_KINDS,
  MONITOR_NAME_MAX,
  MONITOR_URL_MAX,
  type MonitorAllowanceDto,
  type MonitorConfig,
  type MonitorDto,
  type MonitorKind,
} from '@weblion/shared';
import type { TranslationKey } from '@/i18n/de';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import {
  useCreateMonitor,
  useDeleteMonitor,
  useMonitor,
  usePauseMonitor,
  useResumeMonitor,
  useUpdateMonitor,
} from '@/lib/api/monitoring';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, Switch } from '@/components/ui/menu';
import { Field, Input, LoadingBlock, Notice, Select } from '@/components/ui/primitives';
import {
  createMonitorBody,
  emptyMonitorForm,
  errorDetail,
  errorPath,
  intervalChoices,
  intervalLabel,
  isWebKind,
  monitorErrorText,
  monitorFormFrom,
  monitorFormIssues,
  monitorPatch,
  type MonitorFormField,
  type MonitorFormState,
} from './bits';

/** Dialogs of the monitoring pages: create and edit, pause, delete, and the row actions. */

const FORM_FIELDS: readonly MonitorFormField[] = [
  'name',
  'url',
  'hostname',
  'port',
  'keyword',
  'intervalSeconds',
  'acceptedStatusCodes',
];

const asFormField = (path: string | null): MonitorFormField | null =>
  FORM_FIELDS.find((f) => f === path) ?? null;

// --- Create and edit ---------------------------------------------------------------------

/** A new monitor on the organization's allowance. */
export function CreateMonitorDialog({
  orgId,
  allowance,
  onClose,
  onCreated,
}: {
  orgId: string;
  allowance: MonitorAllowanceDto;
  onClose: () => void;
  onCreated?: (monitor: MonitorDto) => void;
}) {
  const { t } = useI18n();
  const [serverError, setServerError] = useState<{ field: MonitorFormField; message: string } | null>(null);
  const create = useCreateMonitor(orgId, {
    success: (m) => t('uptime.toast.created', { name: m.name }),
    onSuccess: (m) => {
      onCreated?.(m);
      onClose();
    },
    // Field errors show at the field, everything else as a toast.
    error: (err) => {
      const field = asFormField(errorPath(err));
      if (field) {
        setServerError({ field, message: errorDetail(err) ?? monitorErrorText(t, err) });
        return null;
      }
      return monitorErrorText(t, err);
    },
  });
  const initial = emptyMonitorForm(allowance.minIntervalSeconds);
  return (
    <MonitorFormDialog
      title={t('uptime.form.createTitle')}
      description={t('uptime.form.createText')}
      submitLabel={t('uptime.create')}
      initial={initial}
      kindEditable
      targetEditable
      minIntervalSeconds={allowance.minIntervalSeconds}
      serverError={serverError}
      onClearServerError={() => setServerError(null)}
      pending={create.isPending}
      onSubmit={(form) => {
        setServerError(null);
        create.mutate(createMonitorBody(form));
      }}
      onClose={onClose}
    />
  );
}

/**
 * Changes a console monitor. The configuration comes live from Uptime Kuma; while it cannot be
 * read, only the name and the interval change.
 */
export function EditMonitorDialog({
  monitor,
  minIntervalSeconds,
  onClose,
}: {
  monitor: MonitorDto;
  minIntervalSeconds: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const live = useMonitor(monitor.id);
  if (live.isPending) {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('uptime.form.editTitle', { name: monitor.name })}
      >
        <LoadingBlock rows={4} />
      </Dialog>
    );
  }
  return (
    <EditMonitorForm
      monitor={live.data ?? monitor}
      config={live.data?.config ?? null}
      minIntervalSeconds={minIntervalSeconds}
      onClose={onClose}
    />
  );
}

/**
 * The edit form of a loaded monitor. What it started with stays fixed while the dialog is open:
 * the detail query refreshes every minute, and a patch against a newer state would send back
 * values the user never saw.
 */
function EditMonitorForm({
  monitor,
  config,
  minIntervalSeconds,
  onClose,
}: {
  monitor: MonitorDto;
  config: MonitorConfig | null;
  minIntervalSeconds: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [start] = useState(() => ({
    initial: monitorFormFrom(monitor, config),
    targetEditable: config !== null,
  }));
  const [serverError, setServerError] = useState<{ field: MonitorFormField; message: string } | null>(null);
  const update = useUpdateMonitor({
    success: (m) => t('uptime.toast.updated', { name: m.name }),
    onSuccess: onClose,
    error: (err) => {
      const field = asFormField(errorPath(err));
      if (field) {
        setServerError({ field, message: errorDetail(err) ?? monitorErrorText(t, err) });
        return null;
      }
      return monitorErrorText(t, err);
    },
  });
  const { initial, targetEditable } = start;
  return (
    <MonitorFormDialog
      title={t('uptime.form.editTitle', { name: monitor.name })}
      submitLabel={t('common.save')}
      initial={initial}
      kindEditable={false}
      targetEditable={targetEditable}
      notice={!targetEditable ? <Notice tone="warning">{t('uptime.form.configUnavailable')}</Notice> : null}
      minIntervalSeconds={minIntervalSeconds}
      serverError={serverError}
      onClearServerError={() => setServerError(null)}
      pending={update.isPending}
      onSubmit={(form) => {
        setServerError(null);
        const patch = monitorPatch(initial, form, targetEditable);
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        update.mutate({ id: monitor.id, patch });
      }}
      onClose={onClose}
    />
  );
}

const KIND_LABEL: Record<MonitorKind, TranslationKey> = {
  http: 'uptime.kind.http',
  keyword: 'uptime.kind.keyword',
  ping: 'uptime.kind.ping',
  port: 'uptime.kind.port',
};

const KIND_HINT: Record<MonitorKind, TranslationKey> = {
  http: 'uptime.form.kindHint.http',
  keyword: 'uptime.form.kindHint.keyword',
  ping: 'uptime.form.kindHint.ping',
  port: 'uptime.form.kindHint.port',
};

function MonitorFormDialog({
  title,
  description,
  submitLabel,
  initial,
  kindEditable,
  targetEditable,
  notice,
  minIntervalSeconds,
  serverError,
  onClearServerError,
  pending,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  initial: MonitorFormState;
  kindEditable: boolean;
  targetEditable: boolean;
  notice?: ReactNode;
  minIntervalSeconds: number;
  serverError: { field: MonitorFormField; message: string } | null;
  onClearServerError: () => void;
  pending: boolean;
  onSubmit: (form: MonitorFormState) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const issues = monitorFormIssues(t, form, targetEditable);
  const web = isWebKind(form.kind);
  const choices = intervalChoices(minIntervalSeconds, initial.intervalSeconds);
  // Field errors show once the user tried to save, or as soon as a field holds something.
  const errorOf = (field: MonitorFormField, filled: boolean) =>
    serverError?.field === field ? serverError.message : touched || filled ? issues[field] : undefined;
  const set = <K extends keyof MonitorFormState>(key: K, value: MonitorFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    onClearServerError();
  };
  const invalid = Object.keys(issues).length > 0;
  // A server error on a field hidden in the collapsed section opens it.
  const advancedOpen = advanced || serverError?.field === 'acceptedStatusCodes';
  const submit = () => {
    setTouched(true);
    if (invalid) {
      if (issues.acceptedStatusCodes) setAdvanced(true);
      return;
    }
    onSubmit(form);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) submit();
        }}
      >
        {notice}
        {kindEditable && (
          <div className="space-y-1.5">
            <span className="block text-[13px] font-medium text-text">{t('uptime.form.kind')}</span>
            <div
              className="inline-flex flex-wrap rounded-lg border border-border bg-surface p-0.5 shadow-card"
              role="group"
              aria-label={t('uptime.form.kind')}
            >
              {MONITOR_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => set('kind', kind)}
                  aria-pressed={form.kind === kind}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    form.kind === kind ? 'bg-primary text-white' : 'text-muted hover:text-text',
                  )}
                >
                  {t(KIND_LABEL[kind])}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">{t(KIND_HINT[form.kind])}</p>
          </div>
        )}
        <Field label={t('uptime.form.name')} htmlFor="mf-name" error={errorOf('name', false)}>
          <Input
            id="mf-name"
            value={form.name}
            maxLength={MONITOR_NAME_MAX}
            onChange={(e) => set('name', e.target.value)}
            placeholder={t('uptime.form.namePlaceholder')}
            autoFocus
          />
        </Field>
        {web ? (
          <Field
            label={t('uptime.form.url')}
            htmlFor="mf-url"
            error={errorOf('url', form.url !== initial.url)}
            hint={t('uptime.form.urlHint')}
          >
            <Input
              id="mf-url"
              value={form.url}
              maxLength={MONITOR_URL_MAX}
              disabled={!targetEditable}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://www.example.ch"
              className="font-mono"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        ) : (
          <div className={cn('grid gap-4', form.kind === 'port' && 'sm:grid-cols-[1fr_120px]')}>
            <Field
              label={t('uptime.form.hostname')}
              htmlFor="mf-host"
              error={errorOf('hostname', form.hostname !== initial.hostname)}
              hint={t('uptime.form.publicOnly')}
            >
              <Input
                id="mf-host"
                value={form.hostname}
                maxLength={MONITOR_HOST_MAX}
                disabled={!targetEditable}
                onChange={(e) => set('hostname', e.target.value)}
                placeholder="mail.example.ch"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {form.kind === 'port' && (
              <Field
                label={t('uptime.form.port')}
                htmlFor="mf-port"
                error={errorOf('port', form.port !== initial.port)}
              >
                <Input
                  id="mf-port"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={65535}
                  value={form.port}
                  disabled={!targetEditable}
                  onChange={(e) => set('port', e.target.value)}
                  placeholder="443"
                  className="tabular"
                />
              </Field>
            )}
          </div>
        )}
        {form.kind === 'keyword' && (
          <div className="space-y-2">
            <Field
              label={t('uptime.form.keyword')}
              htmlFor="mf-keyword"
              error={errorOf('keyword', form.keyword !== initial.keyword)}
              hint={t('uptime.form.keywordHint')}
            >
              <Input
                id="mf-keyword"
                value={form.keyword}
                maxLength={MONITOR_KEYWORD_MAX}
                disabled={!targetEditable}
                onChange={(e) => set('keyword', e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <Switch
                checked={form.invertKeyword}
                disabled={!targetEditable}
                onCheckedChange={(v) => set('invertKeyword', v)}
                label={t('uptime.form.invertKeyword')}
              />
              {t('uptime.form.invertKeyword')}
            </label>
          </div>
        )}
        <Field
          label={t('uptime.form.interval')}
          htmlFor="mf-interval"
          error={serverError?.field === 'intervalSeconds' ? serverError.message : undefined}
          hint={t('uptime.form.intervalHint', { min: intervalLabel(t, minIntervalSeconds) })}
        >
          <Select
            id="mf-interval"
            value={String(form.intervalSeconds)}
            onChange={(e) => set('intervalSeconds', Number(e.target.value))}
          >
            {choices.map((s) => (
              <option key={s} value={s}>
                {intervalLabel(t, s)}
              </option>
            ))}
          </Select>
        </Field>
        {web && (
          <div className="rounded-lg border border-border">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-text hover:bg-surface-2"
              aria-expanded={advancedOpen}
              onClick={() => setAdvanced((v) => !v)}
            >
              {advancedOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {t('uptime.form.advanced')}
            </button>
            {advancedOpen && (
              <div className="space-y-4 border-t border-border px-3 py-3">
                <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
                  <Field label={t('uptime.form.method')} htmlFor="mf-method">
                    <Select
                      id="mf-method"
                      value={form.method}
                      disabled={!targetEditable}
                      onChange={(e) => set('method', e.target.value === 'HEAD' ? 'HEAD' : 'GET')}
                    >
                      <option value="GET">GET</option>
                      <option value="HEAD">HEAD</option>
                    </Select>
                  </Field>
                  <Field
                    label={t('uptime.form.statusCodes')}
                    htmlFor="mf-codes"
                    error={errorOf('acceptedStatusCodes', form.statusCodes !== initial.statusCodes)}
                    hint={t('uptime.form.statusCodesHint')}
                  >
                    <Input
                      id="mf-codes"
                      value={form.statusCodes}
                      disabled={!targetEditable}
                      onChange={(e) => set('statusCodes', e.target.value)}
                      className="font-mono"
                      spellCheck={false}
                    />
                  </Field>
                </div>
                <label className="flex items-start gap-3 text-sm">
                  <Switch
                    checked={form.ignoreTls}
                    disabled={!targetEditable}
                    onCheckedChange={(v) => set('ignoreTls', v)}
                    label={t('uptime.form.ignoreTls')}
                  />
                  <span>
                    <span className="block">{t('uptime.form.ignoreTls')}</span>
                    <span className="block text-xs text-muted">{t('uptime.form.ignoreTlsHint')}</span>
                  </span>
                </label>
              </div>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}

// --- Pause and delete --------------------------------------------------------------------

/** Pausing stops the checks (and their notifications) until the monitor is resumed. */
export function PauseMonitorDialog({ monitor, onClose }: { monitor: MonitorDto; onClose: () => void }) {
  const { t } = useI18n();
  const pause = usePauseMonitor({
    success: (m) => t('uptime.toast.paused', { name: m.name }),
    onSuccess: onClose,
    error: (err) => monitorErrorText(t, err),
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('uptime.pause.title', { name: monitor.name })}
      description={t('uptime.pause.text')}
      confirmLabel={t('uptime.pause.confirm')}
      danger={false}
      loading={pause.isPending}
      onConfirm={() => pause.mutate(monitor)}
    />
  );
}

/**
 * Deletes a console monitor with its history in Uptime Kuma, confirmed by typing its name. A row
 * that is missing in Uptime Kuma is only removed from the console.
 */
export function DeleteMonitorDialog({
  monitor,
  onClose,
  onDeleted,
}: {
  monitor: MonitorDto;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const remove = useDeleteMonitor({
    success: (_r, m) => t('uptime.toast.deleted', { name: m.name }),
    onSuccess: () => {
      onDeleted?.();
      onClose();
    },
    error: (err) => monitorErrorText(t, err),
  });
  const onlyRow = monitor.origin !== 'console' || !!monitor.missingSince;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('uptime.delete.title', { name: monitor.name })}
      description={onlyRow ? t('uptime.delete.textMissing') : t('uptime.delete.text')}
      confirmLabel={t('common.delete')}
      confirmText={monitor.name}
      loading={remove.isPending}
      onConfirm={() => remove.mutate(monitor)}
    />
  );
}

// --- Actions -----------------------------------------------------------------------------

/** The actions with a dialog. */
export type MonitorAction = 'edit' | 'pause' | 'delete';
type Pending = MonitorAction | null;

/** Which actions the user may take on a monitor (the API's permissions already say where they work). */
export function monitorActions(monitor: Pick<MonitorDto, 'permissions' | 'active' | 'status'>) {
  const write = monitor.permissions.includes('monitor:write');
  const paused = monitor.active === false || monitor.status === 'paused';
  return {
    edit: write,
    pause: write && !paused,
    resume: write && paused,
    delete: monitor.permissions.includes('monitor:delete'),
  };
}

function useMonitorActionState(monitor: MonitorDto) {
  const { t } = useI18n();
  const [pending, setPending] = useState<Pending>(null);
  const resume = useResumeMonitor({
    success: (m) => t('uptime.toast.resumed', { name: m.name }),
    error: (err) => monitorErrorText(t, err),
  });
  return { pending, setPending, resume, close: () => setPending(null), monitor };
}

/** The dialog of one action on a monitor. */
export function MonitorActionDialog({
  action,
  monitor,
  minIntervalSeconds,
  onClose,
  onDeleted,
}: {
  action: MonitorAction;
  monitor: MonitorDto;
  minIntervalSeconds: number;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  if (action === 'edit') {
    return <EditMonitorDialog monitor={monitor} minIntervalSeconds={minIntervalSeconds} onClose={onClose} />;
  }
  if (action === 'pause') return <PauseMonitorDialog monitor={monitor} onClose={onClose} />;
  return <DeleteMonitorDialog monitor={monitor} onClose={onClose} onDeleted={onDeleted} />;
}

/**
 * The row menu of the list: edit, pause or resume, delete, each only where the user may. The list
 * shows the dialogs (`onAction`): a refresh that filters the row out must not close them.
 */
export function MonitorActionsMenu({
  monitor,
  onAction,
}: {
  monitor: MonitorDto;
  onAction: (action: MonitorAction) => void;
}) {
  const { t } = useI18n();
  const state = useMonitorActionState(monitor);
  const can = monitorActions(monitor);
  if (!can.edit && !can.delete) return null;
  return (
    <>
      <Menu
        trigger={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.actions')}
            loading={state.resume.isPending}
            icon={state.resume.isPending ? undefined : <MoreHorizontal className="size-4" />}
          />
        }
      >
        {can.edit && (
          <MenuItem icon={<Pencil />} onSelect={() => onAction('edit')}>
            {t('common.edit')}
          </MenuItem>
        )}
        {can.pause && (
          <MenuItem icon={<Pause />} onSelect={() => onAction('pause')}>
            {t('uptime.pause.action')}
          </MenuItem>
        )}
        {can.resume && (
          <MenuItem icon={<Play />} onSelect={() => state.resume.mutate(monitor)}>
            {t('uptime.resume.action')}
          </MenuItem>
        )}
        {can.delete && (
          <MenuItem icon={<Trash2 />} danger onSelect={() => onAction('delete')}>
            {t('common.delete')}
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

/** The same actions as buttons, for the header of the detail page. */
export function MonitorActionButtons({
  monitor,
  minIntervalSeconds,
  onDeleted,
}: {
  monitor: MonitorDto;
  minIntervalSeconds: number;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const state = useMonitorActionState(monitor);
  const can = monitorActions(monitor);
  return (
    <>
      {can.edit && (
        <Button icon={<Pencil className="size-4" />} onClick={() => state.setPending('edit')}>
          {t('common.edit')}
        </Button>
      )}
      {can.pause && (
        <Button icon={<Pause className="size-4" />} onClick={() => state.setPending('pause')}>
          {t('uptime.pause.action')}
        </Button>
      )}
      {can.resume && (
        <Button
          icon={<Play className="size-4" />}
          loading={state.resume.isPending}
          onClick={() => state.resume.mutate(monitor)}
        >
          {t('uptime.resume.action')}
        </Button>
      )}
      {can.delete && (
        <Button
          variant="danger-soft"
          icon={<Trash2 className="size-4" />}
          onClick={() => state.setPending('delete')}
        >
          {t('common.delete')}
        </Button>
      )}
      {state.pending && (
        <MonitorActionDialog
          action={state.pending}
          monitor={monitor}
          minIntervalSeconds={minIntervalSeconds}
          onClose={state.close}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
