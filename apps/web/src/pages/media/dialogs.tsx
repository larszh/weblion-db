import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, KeyRound, MoreHorizontal, Power, PowerOff, Sparkles, Trash2 } from 'lucide-react';
import {
  MEDIA_BITRATE_PRESETS_MBIT,
  MEDIA_GENERATED_PASSWORD_LENGTH,
  MEDIA_MAX_ACCOUNTS,
  MEDIA_MAX_BITRATE_MBIT,
  MEDIA_PASSWORD_MAX,
  MEDIA_PASSWORD_MIN,
  isMediaAccountName,
  mediaPasswordIssues,
  mediaUsername,
  type MediaAccountDto,
  type MediaAllowanceDto,
  type MediaLibraryRef,
  type MediaLoginDto,
  type MediaPolicyApplyResult,
} from '@weblion/shared';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import {
  useCreateMediaAccount,
  useDeleteMediaAccount,
  useSetMediaPassword,
  useUpdateMediaAccount,
  type ResellerMediaAllowanceInput,
} from '@/lib/api/media';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuSeparator, Switch } from '@/components/ui/menu';
import {
  Badge,
  CopyButton,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  Select,
} from '@/components/ui/primitives';
import { safePanelUrl } from '@/pages/hosting/bits';
import {
  bitrateChoiceOf,
  groupPassword,
  parseCount,
  readBitrate,
  usernamePreview,
  type BitrateChoice,
} from './bits';

/** Dialogs of the streaming pages: create, password, enable/disable, delete, allowance fields. */

// --- Password shown once -------------------------------------------------------------

export interface ShownMediaPassword {
  title: string;
  username: string;
  password: string;
  loginUrl: string | null;
}

/**
 * A generated password with the login name and the server address. Shown once in groups of
 * four for reading it out; the copy button copies it without the spaces. Never stored.
 */
export function MediaPasswordDialog({
  shown,
  onClose,
}: {
  shown: ShownMediaPassword | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const url = safePanelUrl(shown?.loginUrl);
  return (
    <Dialog
      open={!!shown}
      onOpenChange={(o) => !o && onClose()}
      title={shown?.title ?? t('media.password.newTitle')}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common.done')}
        </Button>
      }
    >
      {shown && (
        <div className="space-y-3">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">{t('media.col.login')}</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <Mono className="truncate text-text">{shown.username}</Mono>
                <CopyButton value={shown.username} label={t('media.copyLogin')} />
              </dd>
            </div>
            {url && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t('media.login.address')}</dt>
                <dd className="flex min-w-0 items-center gap-1">
                  <Mono className="truncate text-text">{url}</Mono>
                  <CopyButton value={url} label={t('media.login.copyAddress')} />
                </dd>
              </div>
            )}
          </dl>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
            <Mono className="text-base tracking-wide break-all text-text">
              {groupPassword(shown.password)}
            </Mono>
            <CopyButton value={shown.password} label={t('media.password.copy')} />
          </div>
          <p className="text-xs text-muted">{t('media.password.groups')}</p>
          <Notice tone="warning">{t('media.password.once')}</Notice>
        </div>
      )}
    </Dialog>
  );
}

// --- Generated or chosen password ----------------------------------------------------

type PasswordMode = 'generate' | 'choose';

function passwordError(t: TFunction, password: string): string | null {
  if (!password) return null;
  const issues = mediaPasswordIssues(password);
  if (issues.includes('length')) return t('media.password.issue.length', { min: MEDIA_PASSWORD_MIN });
  if (issues.includes('tooLong')) return t('media.password.issue.tooLong', { max: MEDIA_PASSWORD_MAX });
  if (issues.includes('characters')) return t('media.password.issue.characters');
  return null;
}

function ChoiceOption({
  name,
  value,
  current,
  onChange,
  icon,
  title,
  text,
}: {
  name: string;
  value: PasswordMode;
  current: PasswordMode;
  onChange: (value: PasswordMode) => void;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  const active = value === current;
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
        active
          ? 'border-brand-blue bg-primary-soft text-primary-text'
          : 'border-border-strong text-text hover:bg-surface-3',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={active}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className={cn('mt-0.5 block text-xs', active ? 'opacity-90' : 'text-muted')}>{text}</span>
      </span>
    </label>
  );
}

/** "Passwort erzeugen (empfohlen)" or "Eigenes Passwort" with its input. */
function PasswordChoice({
  id,
  mode,
  onMode,
  password,
  onPassword,
}: {
  id: string;
  mode: PasswordMode;
  onMode: (mode: PasswordMode) => void;
  password: string;
  onPassword: (password: string) => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const error = passwordError(t, password);
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1.5 text-[13px] font-medium text-text">{t('media.password.label')}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <ChoiceOption
          name={`${id}-mode`}
          value="generate"
          current={mode}
          onChange={onMode}
          icon={<Sparkles className="size-4" />}
          title={t('media.password.generate')}
          text={t('media.password.generateText', { n: MEDIA_GENERATED_PASSWORD_LENGTH })}
        />
        <ChoiceOption
          name={`${id}-mode`}
          value="choose"
          current={mode}
          onChange={onMode}
          icon={<KeyRound className="size-4" />}
          title={t('media.password.choose')}
          text={t('media.password.chooseText', { min: MEDIA_PASSWORD_MIN })}
        />
      </div>
      {mode === 'choose' && (
        <Field label={t('media.password.input')} htmlFor={`${id}-password`} error={error}>
          <div className="relative">
            <Input
              id={`${id}-password`}
              type={visible ? 'text' : 'password'}
              value={password}
              onChange={(e) => onPassword(e.target.value)}
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={MEDIA_PASSWORD_MAX + 1}
              className="pr-10 font-mono"
              aria-invalid={!!error}
              autoFocus
            />
            <button
              type="button"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-subtle hover:bg-surface-3 hover:text-text"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? t('media.password.hide') : t('media.password.show')}
              title={visible ? t('media.password.hide') : t('media.password.show')}
            >
              {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
      )}
    </fieldset>
  );
}

/** Whether a password choice can be sent: generated always, a chosen one when it fits the rules. */
const passwordReady = (mode: PasswordMode, password: string) =>
  mode === 'generate' || (password !== '' && mediaPasswordIssues(password).length === 0);

// --- Create --------------------------------------------------------------------------

export function CreateMediaAccountDialog({
  orgId,
  allowance,
  login,
  accounts,
  onClose,
  onPassword,
}: {
  orgId: string;
  allowance: MediaAllowanceDto;
  login: MediaLoginDto | null;
  accounts: MediaAccountDto[];
  onClose: () => void;
  onPassword: (shown: ShownMediaPassword) => void;
}) {
  const { t } = useI18n();
  const code = allowance.accountCode;
  const [name, setName] = useState('');
  const [mode, setMode] = useState<PasswordMode>('generate');
  const [password, setPassword] = useState('');
  const create = useCreateMediaAccount(orgId, {
    // A generated password opens its dialog; a chosen one only needs a confirmation.
    success: (r) => (r.password ? null : t('media.created', { username: r.account.username })),
    onSuccess: (r) => {
      onClose();
      if (r.password) {
        onPassword({
          title: t('media.createdTitle'),
          username: r.account.username,
          password: r.password,
          loginUrl: r.account.loginUrl ?? login?.url ?? allowance.provider?.url ?? null,
        });
      }
    },
  });

  const nameError = !name
    ? null
    : !isMediaAccountName(name)
      ? t('media.name.invalid')
      : accounts.some((a) => a.username.toLowerCase() === mediaUsername(name, code))
        ? t('media.name.taken')
        : null;
  const blocked = !name || !!nameError || !passwordReady(mode, password);

  const submit = () => {
    if (blocked || create.isPending) return;
    create.mutate({ name, ...(mode === 'choose' ? { password } : {}) });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('media.createTitle')}
      description={t('media.createText')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={blocked} loading={create.isPending} onClick={submit}>
            {t('media.create')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label={t('media.name')}
          htmlFor="md-name"
          error={nameError}
          hint={
            <>
              {t('media.name.preview')} <Mono className="text-text">{usernamePreview(name, code)}</Mono>
              <span className="mt-0.5 block">{t('media.name.hint')}</span>
            </>
          }
        >
          <div className="flex h-9 w-full items-center overflow-hidden rounded-lg border border-border-strong bg-surface focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
            <input
              id="md-name"
              value={name}
              // Lower case while typing: the API takes lower case only, Jellyfin ignores the case anyway.
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, ''))}
              placeholder={t('media.name.placeholder')}
              className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-text placeholder:text-subtle focus:outline-none"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={20}
              autoFocus
              aria-invalid={!!nameError}
            />
            <span className="shrink-0 border-l border-border bg-surface-2 px-3 py-2 font-mono text-sm text-muted">
              -{code}
            </span>
          </div>
        </Field>
        <PasswordChoice id="md" mode={mode} onMode={setMode} password={password} onPassword={setPassword} />
        {/* Enter submits the form. */}
        <button type="submit" className="sr-only" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// --- New password --------------------------------------------------------------------

/** Sets a new password (generated or chosen). Jellyfin signs out every device of the user. */
export function SetMediaPasswordDialog({
  account,
  onClose,
  onPassword,
}: {
  account: MediaAccountDto;
  onClose: () => void;
  onPassword: (shown: ShownMediaPassword) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<PasswordMode>('generate');
  const [password, setPassword] = useState('');
  const set = useSetMediaPassword();
  const close = () => {
    // Forget the answer (and with it a generated password) together with the dialog.
    set.reset();
    onClose();
  };
  const blocked = !passwordReady(mode, password);
  const submit = () => {
    if (blocked || set.isPending) return;
    set.mutate(
      { id: account.id, ...(mode === 'choose' ? { password } : {}) },
      {
        onSuccess: (r) => {
          close();
          if (r.password) {
            onPassword({
              title: t('media.password.newTitle'),
              username: account.username,
              password: r.password,
              loginUrl: account.loginUrl,
            });
          } else {
            toast.success(t('media.password.setToast', { username: account.username }));
          }
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={t('media.password.title', { username: account.username })}
      description={t('media.password.text')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={blocked} loading={set.isPending} onClick={submit}>
            {t('media.password.set')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <PasswordChoice id="mp" mode={mode} onMode={setMode} password={password} onPassword={setPassword} />
        <button type="submit" className="sr-only" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// --- Delete --------------------------------------------------------------------------

/** Deleting removes watch history, favorites and playlists at Jellyfin: confirmed with the login name. */
export function DeleteMediaAccountDialog({
  account,
  open,
  onClose,
}: {
  account: MediaAccountDto;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const remove = useDeleteMediaAccount((a) => t('media.deletedToast', { username: a.username }), onClose);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('media.deleteTitle', { username: account.username })}
      confirmLabel={t('media.deleteConfirm')}
      confirmText={account.username}
      loading={remove.isPending}
      onConfirm={() => remove.mutate(account)}
    >
      {account.missingSince ? (
        <Notice tone="info" className="mb-4">
          {t('media.deleteMissing')}
        </Notice>
      ) : (
        <Notice tone="danger" className="mb-4" title={t('media.deleteWarningTitle')}>
          {t('media.deleteWarning')}
        </Notice>
      )}
    </ConfirmDialog>
  );
}

// --- Row actions ---------------------------------------------------------------------

type Pending = 'toggle' | 'password' | 'delete' | null;

/**
 * The actions menu of one account, with its dialogs. Only actions the user may perform on this
 * account (its `permissions`) are offered; an account gone at Jellyfin can only be deleted.
 * `before`: further menu items in front (the admin page's assign and repair).
 */
export function MediaAccountActions({
  account,
  onPassword,
  allowPassword = true,
  before,
}: {
  account: MediaAccountDto;
  onPassword: (shown: ShownMediaPassword) => void;
  allowPassword?: boolean;
  before?: ReactNode;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);
  const missing = !!account.missingSince;
  const canWrite = account.permissions.includes('media:write');
  const canPassword = allowPassword && !missing && account.permissions.includes('media:password');
  const canToggle = canWrite && !missing;
  const toggle = useUpdateMediaAccount({
    success: (a, enabled) =>
      enabled
        ? t('media.enabledToast', { username: a.username })
        : t('media.disabledToast', { username: a.username }),
    onSuccess: close,
  });

  if (!before && !canWrite && !canPassword) return null;

  return (
    <>
      <Menu
        trigger={
          <Button size="icon" variant="ghost" aria-label={t('common.actions')} title={t('common.actions')}>
            <MoreHorizontal className="size-4" />
          </Button>
        }
      >
        {before}
        {canPassword && (
          <MenuItem icon={<KeyRound />} onSelect={() => setPending('password')}>
            {t('media.password.action')}
          </MenuItem>
        )}
        {canToggle && (
          <MenuItem
            icon={account.enabled ? <PowerOff /> : <Power />}
            onSelect={() => setPending('toggle')}
            hint={
              !account.enabled && account.issues.includes('locked_out')
                ? t('media.enableLockedHint')
                : undefined
            }
          >
            {account.enabled ? t('media.disable') : t('media.enable')}
          </MenuItem>
        )}
        {canWrite && (
          <>
            {(before || canPassword || canToggle) && <MenuSeparator />}
            <MenuItem icon={<Trash2 />} danger onSelect={() => setPending('delete')}>
              {t('common.delete')}
            </MenuItem>
          </>
        )}
      </Menu>

      {pending === 'password' && (
        <SetMediaPasswordDialog account={account} onClose={close} onPassword={onPassword} />
      )}

      <ConfirmDialog
        open={pending === 'toggle'}
        onOpenChange={(o) => !o && close()}
        title={
          account.enabled
            ? t('media.disableTitle', { username: account.username })
            : t('media.enableTitle', { username: account.username })
        }
        description={account.enabled ? t('media.disableText') : t('media.enableText')}
        confirmLabel={account.enabled ? t('media.disable') : t('media.enable')}
        danger={account.enabled}
        loading={toggle.isPending}
        onConfirm={() => toggle.mutate({ id: account.id, enabled: !account.enabled })}
      />

      <DeleteMediaAccountDialog account={account} open={pending === 'delete'} onClose={close} />
    </>
  );
}

// --- Allowance fields (admin and reseller dialogs) -----------------------------------

/** Accounts whose policy could not be written after a change (the sync tries again). */
export function PolicyFailures({
  failed,
  onDismiss,
}: {
  failed: MediaPolicyApplyResult['failed'];
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <Notice tone="warning" title={t('media.allowance.policyFailed')}>
      <ul className="mt-1 space-y-0.5">
        {failed.map((f) => (
          <li key={f.accountId} className="break-words">
            <Mono>{f.username}</Mono>: {f.error}
          </li>
        ))}
      </ul>
      <button type="button" className="mt-1.5 font-medium underline underline-offset-2" onClick={onDismiss}>
        {t('common.hide')}
      </button>
    </Notice>
  );
}

export interface MediaAccessForm {
  maxAccounts: string;
  libraryIds: string[];
  maxStreams: string;
  downloads: boolean;
  bitrate: BitrateChoice;
  bitrateCustom: string;
}

/** What an allowance dialog may grant. */
export interface MediaAccessLimits {
  /** Library ids that can be granted: the instance's, or a reseller's own. */
  libraryIds: string[];
  /** Accounts the organization has already. */
  minAccounts: number;
  /** What a reseller has left for this customer; null: up to MEDIA_MAX_ACCOUNTS. */
  maxAccounts: number | null;
  maxStreams: number;
  /** Whether downloads may be switched on (a reseller's customer only when the reseller has them). */
  downloads: boolean;
  /** A reseller's own bitrate limit: its customers get at most that, never the server's setting. */
  bitrateCap: number | null;
}

export function mediaAccessFormFrom(
  current: Pick<
    MediaAllowanceDto,
    'maxAccounts' | 'libraries' | 'maxStreams' | 'downloads' | 'remoteBitrateMbit'
  > | null,
  defaults: { maxAccounts: number; maxStreams: number; remoteBitrateMbit: number | null },
): MediaAccessForm {
  const mbit = current ? current.remoteBitrateMbit : defaults.remoteBitrateMbit;
  return {
    maxAccounts: String(current?.maxAccounts ?? defaults.maxAccounts),
    libraryIds: current?.libraries.map((l) => l.id) ?? [],
    maxStreams: String(current?.maxStreams ?? defaults.maxStreams),
    downloads: current?.downloads ?? false,
    bitrate: bitrateChoiceOf(mbit, MEDIA_BITRATE_PRESETS_MBIT),
    bitrateCustom: mbit === null ? '' : String(mbit),
  };
}

export type MediaAccessErrors = Record<
  'maxAccounts' | 'libraries' | 'maxStreams' | 'downloads' | 'bitrate',
  string | null
>;

/** The body of an allowance (null while something is wrong) and the error of each field. */
export function readMediaAccessForm(
  t: TFunction,
  form: MediaAccessForm,
  limits: MediaAccessLimits,
): { body: ResellerMediaAllowanceInput | null; errors: MediaAccessErrors } {
  const maxAccounts = parseCount(form.maxAccounts);
  const accountsCap = limits.maxAccounts ?? MEDIA_MAX_ACCOUNTS;
  const libraryIds = form.libraryIds.filter((id) => limits.libraryIds.includes(id));
  const maxStreams = parseCount(form.maxStreams);
  const bitrate = readBitrate(form.bitrate, form.bitrateCustom, limits.bitrateCap);
  const errors: MediaAccessErrors = {
    maxAccounts:
      maxAccounts === null
        ? t('media.allowance.maxInvalid')
        : maxAccounts < limits.minAccounts
          ? t('media.allowance.maxBelowAccounts', { n: limits.minAccounts })
          : maxAccounts > accountsCap
            ? limits.maxAccounts === null
              ? t('media.allowance.maxTooHigh', { n: MEDIA_MAX_ACCOUNTS })
              : t('media.reseller.maxTooHigh', { n: Math.max(0, accountsCap) })
            : null,
    libraries: libraryIds.length === 0 ? t('media.allowance.librariesNone') : null,
    maxStreams:
      maxStreams === null || maxStreams > limits.maxStreams
        ? t('media.allowance.streamsInvalid', { max: limits.maxStreams })
        : null,
    downloads: form.downloads && !limits.downloads ? t('media.reseller.noDownloads') : null,
    bitrate:
      bitrate.issue === 'invalid'
        ? t('media.allowance.bitrateInvalid', { max: MEDIA_MAX_BITRATE_MBIT })
        : bitrate.issue === 'tooHigh'
          ? t('media.reseller.bitrateTooHigh', { max: limits.bitrateCap ?? 0 })
          : bitrate.issue === 'serverNotAllowed'
            ? t('media.reseller.bitrateRequired', { max: limits.bitrateCap ?? 0 })
            : null,
  };
  const ok = Object.values(errors).every((e) => e === null);
  return {
    body:
      ok && maxAccounts !== null && maxStreams !== null
        ? {
            maxAccounts,
            libraryIds,
            maxStreams,
            downloads: form.downloads,
            remoteBitrateMbit: bitrate.value,
          }
        : null,
    errors,
  };
}

/**
 * Accounts, libraries, streams, downloads and the bitrate outside the server's network.
 * `libraries`: what can be granted (gone ones are shown struck through and can only be
 * removed); `outside`: ids beyond a reseller's allowance (marked); `gone`: granted libraries the
 * instance no longer has (they are dropped on saving).
 */
export function MediaAccessFields({
  id,
  form,
  onChange,
  errors,
  limits,
  libraries,
  librariesPending = false,
  librariesError = null,
  onRetryLibraries,
  outside,
  gone = [],
  accountsHint,
}: {
  id: string;
  form: MediaAccessForm;
  onChange: (form: MediaAccessForm) => void;
  errors: MediaAccessErrors;
  limits: MediaAccessLimits;
  libraries: MediaLibraryRef[];
  librariesPending?: boolean;
  librariesError?: unknown;
  onRetryLibraries?: () => void;
  outside?: Set<string>;
  gone?: MediaLibraryRef[];
  accountsHint?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const set = (patch: Partial<MediaAccessForm>) => onChange({ ...form, ...patch });
  const toggleLibrary = (libraryId: string, on: boolean) =>
    set({
      libraryIds: on ? [...form.libraryIds, libraryId] : form.libraryIds.filter((l) => l !== libraryId),
    });
  const rate = (mbit: number) => `${formatNumber(mbit, locale)} Mbit/s`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('media.allowance.maxAccounts')}
          htmlFor={`${id}-max`}
          error={errors.maxAccounts}
          hint={accountsHint}
        >
          <Input
            id={`${id}-max`}
            type="number"
            inputMode="numeric"
            min={Math.max(1, limits.minAccounts)}
            max={limits.maxAccounts ?? MEDIA_MAX_ACCOUNTS}
            step={1}
            value={form.maxAccounts}
            onChange={(e) => set({ maxAccounts: e.target.value })}
            className="tabular"
          />
        </Field>
        <Field
          label={t('media.allowance.streams')}
          htmlFor={`${id}-streams`}
          error={errors.maxStreams}
          hint={t('media.allowance.streamsHint')}
        >
          <Input
            id={`${id}-streams`}
            type="number"
            inputMode="numeric"
            min={1}
            max={limits.maxStreams}
            step={1}
            value={form.maxStreams}
            onChange={(e) => set({ maxStreams: e.target.value })}
            className="tabular"
          />
        </Field>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-[13px] font-medium text-text">{t('media.allowance.libraries')}</legend>
        {librariesError ? (
          <ErrorState error={librariesError} onRetry={onRetryLibraries} />
        ) : librariesPending ? (
          <LoadingBlock rows={2} />
        ) : libraries.length === 0 ? (
          <Notice tone="warning">{t('media.allowance.librariesEmpty')}</Notice>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {libraries.map((library) => {
              const checked = form.libraryIds.includes(library.id);
              // A library gone from the instance can still be removed, never granted again.
              const disabled = !!library.missing && !checked;
              return (
                <label
                  key={library.id}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm',
                    disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-surface-2',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => toggleLibrary(library.id, e.target.checked)}
                  />
                  <span className={cn('min-w-0 flex-1 truncate', library.missing && 'line-through')}>
                    {library.name}
                  </span>
                  {library.missing && <Badge tone="danger">{t('media.library.missingShort')}</Badge>}
                  {outside?.has(library.id) && (
                    <Badge tone="warning">{t('media.allowance.outsideParent')}</Badge>
                  )}
                </label>
              );
            })}
          </div>
        )}
        {gone.length > 0 && (
          <p className="text-xs text-warning">
            {t('media.allowance.librariesGone', { names: gone.map((l) => l.name).join(', ') })}
          </p>
        )}
        {errors.libraries && !librariesPending && !librariesError && libraries.length > 0 && (
          <p className="text-xs text-danger">{errors.libraries}</p>
        )}
      </fieldset>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{t('media.allowance.downloads')}</p>
          <p className="text-xs text-muted">
            {limits.downloads ? t('media.allowance.downloadsHint') : t('media.reseller.downloadsOff')}
          </p>
          {errors.downloads && <p className="mt-1 text-xs text-danger">{errors.downloads}</p>}
        </div>
        <Switch
          checked={form.downloads}
          onCheckedChange={(on) => set({ downloads: on })}
          disabled={!limits.downloads && !form.downloads}
          label={t('media.allowance.downloads')}
        />
      </div>

      <Field
        label={t('media.allowance.bitrate')}
        htmlFor={`${id}-bitrate`}
        error={errors.bitrate}
        hint={
          limits.bitrateCap === null
            ? t('media.allowance.bitrateHint')
            : t('media.reseller.bitrateHint', { max: rate(limits.bitrateCap) })
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select
            id={`${id}-bitrate`}
            value={form.bitrate}
            onChange={(e) => {
              const bitrate = e.target.value as BitrateChoice;
              set({
                bitrate,
                ...(bitrate === 'custom' && !form.bitrateCustom ? { bitrateCustom: '10' } : {}),
              });
            }}
            className="w-auto min-w-[200px]"
          >
            <option value="server" disabled={limits.bitrateCap !== null && form.bitrate !== 'server'}>
              {t('media.allowance.serverBitrate')}
            </option>
            {MEDIA_BITRATE_PRESETS_MBIT.map((mbit) => (
              <option
                key={mbit}
                value={String(mbit)}
                disabled={
                  limits.bitrateCap !== null && mbit > limits.bitrateCap && form.bitrate !== String(mbit)
                }
              >
                {t('media.figure.bitrateUpTo', { rate: rate(mbit) })}
              </option>
            ))}
            <option value="custom">{t('media.allowance.bitrateCustom')}</option>
          </Select>
          {form.bitrate === 'custom' && (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={limits.bitrateCap ?? MEDIA_MAX_BITRATE_MBIT}
                step={1}
                value={form.bitrateCustom}
                onChange={(e) => set({ bitrateCustom: e.target.value })}
                className="w-28 tabular"
                aria-label={t('media.allowance.bitrateCustom')}
              />
              <span className="text-sm text-muted">Mbit/s</span>
            </div>
          )}
        </div>
      </Field>
    </div>
  );
}
