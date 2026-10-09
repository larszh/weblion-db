import { useState, type ReactNode } from 'react';
import { KeyRound, Mail, MoreHorizontal, Pencil, Power, PowerOff, Trash2 } from 'lucide-react';
import { CLOUD_ACCOUNT_NAME_PATTERN, type CloudAccountDto, type CloudAllowanceDto } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import {
  useCreateCloudAccount,
  useDeleteCloudAccount,
  useResendCloudInvite,
  useResetCloudPassword,
  useUpdateCloudAccount,
  type CloudAccountPatch,
} from '@/lib/api/cloud';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { CopyButton, Field, Input, Mono, Notice } from '@/components/ui/primitives';
import { NewPasswordDialog } from '@/pages/servers/password-dialog';
import { safePanelUrl } from '@/pages/hosting/bits';
import { GIB, MAX_USERNAME_LENGTH, countedBytes, formatQuota, freeGb, parseGb } from './bits';

/** Dialogs of the cloud storage page: create, edit, password, enable/disable, delete. */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Password shown once -------------------------------------------------------------

export interface ShownPassword {
  title: string;
  username: string;
  password: string;
  loginUrl: string | null;
}

/** A generated password with the login name and where to log in. Never stored by the console. */
export function CloudPasswordDialog({
  shown,
  onClose,
}: {
  shown: ShownPassword | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const url = safePanelUrl(shown?.loginUrl);
  return (
    <NewPasswordDialog result={shown} onClose={onClose} title={shown?.title}>
      {shown && (
        <dl className="mb-3 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t('storage.col.login')}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <Mono className="truncate text-text">{shown.username}</Mono>
              <CopyButton value={shown.username} />
            </dd>
          </div>
          {url && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">{t('storage.loginAt')}</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-mono text-[12.5px] text-primary-text hover:underline"
                >
                  {url}
                </a>
                <CopyButton value={url} />
              </dd>
            </div>
          )}
        </dl>
      )}
    </NewPasswordDialog>
  );
}

// --- Create --------------------------------------------------------------------------

type Delivery = 'password' | 'invite';

export function CreateAccountDialog({
  orgId,
  orgSlug,
  allowance,
  accounts,
  onClose,
  onPassword,
}: {
  orgId: string;
  orgSlug: string;
  allowance: CloudAllowanceDto;
  accounts: CloudAccountDto[];
  onClose: () => void;
  onPassword: (shown: ShownPassword) => void;
}) {
  const { t, locale } = useI18n();
  const free = freeGb(allowance);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [quota, setQuota] = useState(String(Math.max(1, Math.min(10, free))));
  const [delivery, setDelivery] = useState<Delivery>('password');
  const create = useCreateCloudAccount(orgId, {
    success: (r) =>
      r.password
        ? t('storage.created', { username: r.account.username })
        : t('storage.createdInvite', { email: r.account.email ?? email }),
    onSuccess: (r) => {
      onClose();
      if (r.password) {
        onPassword({
          title: t('storage.createdTitle'),
          username: r.account.username,
          password: r.password,
          loginUrl: r.account.loginUrl ?? allowance.provider?.url ?? null,
        });
      }
    },
  });

  const username = `${name || '…'}@${orgSlug}`;
  const nameError = !name
    ? null
    : !CLOUD_ACCOUNT_NAME_PATTERN.test(name)
      ? t('storage.name.invalid')
      : `${name}@${orgSlug}`.length > MAX_USERNAME_LENGTH
        ? t('storage.name.tooLong', { max: MAX_USERNAME_LENGTH })
        : accounts.some((a) => a.username === `${name}@${orgSlug}`)
          ? t('storage.name.taken')
          : null;
  const quotaGb = parseGb(quota);
  const quotaError =
    quota.trim() === ''
      ? null
      : quotaGb === null
        ? t('storage.quota.invalid')
        : quotaGb > free
          ? t('storage.quota.tooLarge', { max: formatQuota(free * GIB, locale) })
          : null;
  const emailError = email && !EMAIL_PATTERN.test(email.trim()) ? t('storage.email.invalid') : null;
  const inviteBlocked = delivery === 'invite' && !email.trim();
  const blocked = !name || !!nameError || quotaGb === null || !!quotaError || !!emailError || inviteBlocked;

  const submit = () => {
    if (blocked || quotaGb === null || create.isPending) return;
    create.mutate({
      name,
      quotaGb,
      invite: delivery === 'invite',
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('storage.createTitle')}
      description={t('storage.createText')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={blocked} loading={create.isPending} onClick={submit}>
            {t('storage.create')}
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
          label={t('storage.name')}
          htmlFor="cl-name"
          error={nameError}
          hint={
            <>
              {t('storage.name.preview')} <Mono className="text-text">{username}</Mono>
              <span className="mt-0.5 block">{t('storage.name.hint')}</span>
            </>
          }
        >
          <div className="flex h-9 w-full items-center overflow-hidden rounded-lg border border-border-strong bg-surface focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
            <input
              id="cl-name"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, ''))}
              placeholder={t('storage.name.placeholder')}
              className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-text placeholder:text-subtle focus:outline-none"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={32}
              autoFocus
              aria-invalid={!!nameError}
            />
            <span className="shrink-0 border-l border-border bg-surface-2 px-3 py-2 font-mono text-sm text-muted">
              @{orgSlug}
            </span>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('storage.displayName')} hint={t('common.optional')} htmlFor="cl-display">
            <Input
              id="cl-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('storage.displayName.placeholder')}
              maxLength={64}
            />
          </Field>
          <Field
            label={t('storage.email')}
            hint={delivery === 'invite' ? t('storage.email.required') : t('common.optional')}
            error={emailError}
            htmlFor="cl-email"
          >
            <Input
              id="cl-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="anna@example.com"
              maxLength={200}
            />
          </Field>
        </div>
        <Field
          label={t('storage.quota')}
          htmlFor="cl-quota"
          error={quotaError}
          hint={t('storage.quota.freeHint', { free: formatQuota(free * GIB, locale) })}
        >
          <div className="flex items-center gap-2">
            <Input
              id="cl-quota"
              type="number"
              inputMode="numeric"
              min={1}
              max={free}
              step={1}
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              className="w-32 tabular"
            />
            <span className="text-sm text-muted">GB</span>
          </div>
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-[13px] font-medium text-text">{t('storage.delivery')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <DeliveryOption
              value="password"
              current={delivery}
              onChange={setDelivery}
              icon={<KeyRound className="size-4" />}
              title={t('storage.delivery.password')}
              text={t('storage.delivery.passwordText')}
            />
            <DeliveryOption
              value="invite"
              current={delivery}
              onChange={setDelivery}
              icon={<Mail className="size-4" />}
              title={t('storage.delivery.invite')}
              text={t('storage.delivery.inviteText')}
            />
          </div>
        </fieldset>
        {inviteBlocked && <Notice tone="info">{t('storage.delivery.needsEmail')}</Notice>}
        {/* Enter submits the form. */}
        <button type="submit" className="sr-only" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

function DeliveryOption({
  value,
  current,
  onChange,
  icon,
  title,
  text,
}: {
  value: Delivery;
  current: Delivery;
  onChange: (value: Delivery) => void;
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
        name="cloud-delivery"
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

// --- Edit ----------------------------------------------------------------------------

/** Most that fits for this account: what is free plus what it counts with already. */
function maxQuotaBytes(account: CloudAccountDto, allowance: CloudAllowanceDto | null): number | null {
  if (!allowance) return null;
  return Math.max(0, allowance.quotaBytes - allowance.allocatedBytes) + countedBytes(account);
}

export function EditAccountDialog({
  account,
  allowance,
  onClose,
}: {
  account: CloudAccountDto;
  allowance: CloudAllowanceDto | null;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const currentGb =
    account.quotaBytes !== null && account.quotaBytes % GIB === 0 ? account.quotaBytes / GIB : null;
  const [displayName, setDisplayName] = useState(account.displayName ?? '');
  const [email, setEmail] = useState(account.email ?? '');
  const [quota, setQuota] = useState(currentGb !== null ? String(currentGb) : '');
  const update = useUpdateCloudAccount({
    success: (a) => t('storage.updated', { username: a.username }),
    onSuccess: onClose,
  });

  const maxBytes = maxQuotaBytes(account, allowance);
  const counted = countedBytes(account);
  const quotaGb = quota.trim() === '' ? null : parseGb(quota);
  const quotaBytes = quotaGb === null ? null : quotaGb * GIB;
  // Only a quota above what the account counts with needs room in the allowance (as in the API).
  const quotaError =
    quota.trim() !== '' && quotaGb === null
      ? t('storage.quota.invalid')
      : quotaBytes !== null && maxBytes !== null && quotaBytes > counted && quotaBytes > maxBytes
        ? t('storage.quota.tooLarge', { max: formatQuota(Math.floor(maxBytes / GIB) * GIB, locale) })
        : null;
  const belowUsage = quotaBytes !== null && account.usedBytes !== null && quotaBytes < account.usedBytes;
  const emailError = email.trim() && !EMAIL_PATTERN.test(email.trim()) ? t('storage.email.invalid') : null;

  const patch: CloudAccountPatch = {};
  if (displayName.trim() !== (account.displayName ?? '')) patch.displayName = displayName.trim() || null;
  if (email.trim() !== (account.email ?? '')) patch.email = email.trim() || null;
  if (quotaGb !== null && quotaBytes !== account.quotaBytes) patch.quotaGb = quotaGb;
  const changed = Object.keys(patch).length > 0;

  const submit = () => {
    if (!changed || quotaError || emailError || update.isPending) return;
    update.mutate({ id: account.id, patch });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('storage.editTitle', { username: account.username })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!changed || !!quotaError || !!emailError}
            loading={update.isPending}
            onClick={submit}
          >
            {t('common.save')}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('storage.displayName')} htmlFor="ce-display">
            <Input
              id="ce-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
            />
          </Field>
          <Field label={t('storage.email')} error={emailError} htmlFor="ce-email">
            <Input
              id="ce-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
            />
          </Field>
        </div>
        <Field
          label={t('storage.quota')}
          htmlFor="ce-quota"
          error={quotaError}
          hint={
            <>
              {account.quotaBytes === null ? (
                <span className="block">{t('storage.quota.currentUnlimited')}</span>
              ) : currentGb === null ? (
                <span className="block">
                  {t('storage.quota.current', { quota: formatQuota(account.quotaBytes, locale) })}
                </span>
              ) : null}
              {allowance && maxBytes !== null && (
                <span className="block">
                  {t('storage.quota.maxHint', {
                    max: formatQuota(Math.floor(Math.max(maxBytes, counted) / GIB) * GIB, locale),
                    free: formatQuota(freeGb(allowance) * GIB, locale),
                  })}
                </span>
              )}
              {account.usedBytes !== null && (
                <span className="block">
                  {t('storage.quota.used', { used: formatBytes(account.usedBytes) })}
                </span>
              )}
            </>
          }
        >
          <div className="flex items-center gap-2">
            <Input
              id="ce-quota"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              placeholder={account.quotaBytes === null ? '∞' : undefined}
              className="w-32 tabular"
            />
            <span className="text-sm text-muted">GB</span>
          </div>
        </Field>
        {belowUsage && account.usedBytes !== null && (
          <Notice tone="warning" title={t('storage.quota.belowUsageTitle')}>
            {t('storage.quota.belowUsage', { used: formatBytes(account.usedBytes) })}
          </Notice>
        )}
        {patch.email !== undefined && patch.email !== null && (
          <p className="text-xs text-muted">{t('storage.email.changeHint')}</p>
        )}
        <button type="submit" className="sr-only" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// --- Row actions ---------------------------------------------------------------------

type Pending = 'edit' | 'toggle' | 'password' | 'delete' | null;

/**
 * The actions menu of one account, with its dialogs. Only actions the user may perform on
 * this account (its `permissions`) are offered.
 */
export function AccountActions({
  account,
  allowance,
  onPassword,
}: {
  account: CloudAccountDto;
  allowance: CloudAllowanceDto | null;
  onPassword: (shown: ShownPassword) => void;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState<Pending>(null);
  const canWrite = account.permissions.includes('cloud:write');
  const canPassword = account.permissions.includes('cloud:password');
  const close = () => setPending(null);
  const toggle = useUpdateCloudAccount({
    success: (a) =>
      a.enabled
        ? t('storage.enabledToast', { username: a.username })
        : t('storage.disabledToast', { username: a.username }),
    onSuccess: close,
  });
  const password = useResetCloudPassword();
  const invite = useResendCloudInvite((a) => t('storage.invitedToast', { email: a.email ?? '' }));
  const remove = useDeleteCloudAccount((a) => t('storage.deletedToast', { username: a.username }), close);

  if (!canWrite && !canPassword) return null;
  const missing = !!account.missingSince;

  return (
    <>
      <Menu
        trigger={
          <Button size="icon" variant="ghost" aria-label={t('common.actions')} title={t('common.actions')}>
            <MoreHorizontal className="size-4" />
          </Button>
        }
      >
        {canWrite && (
          <MenuItem icon={<Pencil />} onSelect={() => setPending('edit')} disabled={missing}>
            {t('common.edit')}
          </MenuItem>
        )}
        {canWrite && (
          <MenuItem
            icon={account.enabled ? <PowerOff /> : <Power />}
            onSelect={() => setPending('toggle')}
            disabled={missing}
          >
            {account.enabled ? t('storage.disable') : t('storage.enable')}
          </MenuItem>
        )}
        {canPassword && (
          <MenuItem icon={<KeyRound />} onSelect={() => setPending('password')} disabled={missing}>
            {t('storage.resetPassword')}
          </MenuItem>
        )}
        {canWrite && account.email && (
          <MenuItem
            icon={<Mail />}
            onSelect={() => invite.mutate(account)}
            disabled={missing || invite.isPending}
            hint={account.email}
          >
            {t('storage.resendInvite')}
          </MenuItem>
        )}
        {canWrite && (
          <>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={() => setPending('delete')}>
              {t('common.delete')}
            </MenuItem>
          </>
        )}
      </Menu>

      {pending === 'edit' && <EditAccountDialog account={account} allowance={allowance} onClose={close} />}

      <ConfirmDialog
        open={pending === 'toggle'}
        onOpenChange={(o) => !o && close()}
        title={
          account.enabled
            ? t('storage.disableTitle', { username: account.username })
            : t('storage.enableTitle', { username: account.username })
        }
        description={account.enabled ? t('storage.disableText') : t('storage.enableText')}
        confirmLabel={account.enabled ? t('storage.disable') : t('storage.enable')}
        danger={account.enabled}
        loading={toggle.isPending}
        onConfirm={() => toggle.mutate({ id: account.id, patch: { enabled: !account.enabled } })}
      />

      <ConfirmDialog
        open={pending === 'password'}
        onOpenChange={(o) => !o && close()}
        title={t('storage.passwordTitle', { username: account.username })}
        description={t('storage.passwordText')}
        confirmLabel={t('storage.resetPassword')}
        loading={password.isPending}
        onConfirm={() =>
          password.mutate(account.id, {
            onSuccess: (r) => {
              close();
              password.reset();
              onPassword({
                title: t('storage.passwordNewTitle'),
                username: account.username,
                password: r.password,
                loginUrl: account.loginUrl,
              });
            },
          })
        }
      />

      <ConfirmDialog
        open={pending === 'delete'}
        onOpenChange={(o) => !o && close()}
        title={t('storage.deleteTitle', { username: account.username })}
        confirmLabel={t('storage.deleteConfirm')}
        confirmText={account.username}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(account)}
      >
        <Notice tone="danger" className="mb-4" title={t('storage.deleteWarningTitle')}>
          {t('storage.deleteWarning', {
            used: account.usedBytes === null ? '–' : formatBytes(account.usedBytes),
          })}
        </Notice>
      </ConfirmDialog>
    </>
  );
}
