import { useState } from 'react';
import { toast } from 'sonner';
import {
  Inbox,
  KeyRound,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Trash2,
} from 'lucide-react';
import {
  MAILBOX_STATES,
  isMailLocalPart,
  type MailDomainDetailDto,
  type MailboxDto,
  type MailboxState,
} from '@weblion/shared';
import { formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import {
  useCreateMailbox,
  useDeleteMailbox,
  useMailboxes,
  useSetMailboxPassword,
  useUpdateMailbox,
  type MailboxPatchInput,
} from '@/lib/api/mail';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import {
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import {
  MailPasswordDialog,
  MailboxStateBadge,
  MailboxUsage,
  PasswordChoice,
  passwordReady,
  useMailError,
  SizeInput,
  type PasswordMode,
  type ShownMailPassword,
} from './bits';
import { MIB, formatMailSize, fromBytes, toMib, type SizeValue } from './units';

/** Mailboxes tab of a mail domain: list, create, change, new password, delete. */

const NAME_PATTERN = /^[^<>]*$/;
const NAME_MAX = 255;

/** Storage of the domain that is not handed out to a mailbox yet, bytes. */
const freeBytes = (domain: MailDomainDetailDto) =>
  domain.limits && domain.usage ? Math.max(0, domain.limits.quotaBytes - domain.usage.allocatedBytes) : null;

export function MailboxesTab({ domain }: { domain: MailDomainDetailDto }) {
  const { t, locale } = useI18n();
  const mailboxes = useMailboxes(domain.id);
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<ShownMailPassword | null>(null);
  const [q, setQ] = useState('');
  const canWrite = domain.permissions.includes('mail:write');
  const { limits, usage } = domain;
  const free = freeBytes(domain);
  // The API checks the same before asking Mailcow; the button says why it is off.
  const createBlocked =
    limits && usage && usage.mailboxes >= limits.maxMailboxes
      ? t('mail.mailbox.limitReached', { max: limits.maxMailboxes })
      : free !== null && free < MIB
        ? t('mail.mailbox.noStorage')
        : domain.missingSince
          ? t('mail.missing.title')
          : null;

  const all = mailboxes.data ?? [];
  const searchable = all.length > 8;
  const needle = searchable ? q.trim().toLowerCase() : '';
  const list = all.filter(
    (m) => !needle || m.address.includes(needle) || m.name?.toLowerCase().includes(needle),
  );
  const withActions = canWrite || domain.permissions.includes('mail:password');

  return (
    <div className="space-y-4">
      {canWrite && createBlocked && <Notice tone="info">{createBlocked}</Notice>}
      <Card>
        <CardHeader
          title={t('mail.mailbox.title')}
          description={
            limits && usage
              ? t('mail.mailbox.countText', {
                  n: usage.mailboxes,
                  max: limits.maxMailboxes,
                  free: formatMailSize(free, locale),
                })
              : t('mail.mailbox.text')
          }
          actions={
            <>
              {searchable && (
                <div className="relative w-56 max-w-full">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t('mail.mailbox.search')}
                    className="h-8 pl-9"
                    aria-label={t('mail.mailbox.search')}
                  />
                </div>
              )}
              {canWrite && (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Plus className="size-4" />}
                  disabled={!!createBlocked}
                  title={createBlocked ?? undefined}
                  onClick={() => setCreating(true)}
                >
                  {t('mail.mailbox.create')}
                </Button>
              )}
            </>
          }
        />
        {mailboxes.isPending ? (
          <LoadingBlock rows={3} />
        ) : mailboxes.isError ? (
          <div className="p-5">
            <ErrorState error={mailboxes.error} onRetry={() => void mailboxes.refetch()} />
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title={t('mail.mailbox.empty')}
            description={t('mail.mailbox.emptyText')}
          />
        ) : list.length === 0 ? (
          <EmptyState icon={<Search className="size-6" />} title={t('hosting.noMatch')} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('mail.col.address')}</TH>
                <TH className="hidden md:table-cell">{t('mail.col.name')}</TH>
                <TH className="hidden sm:table-cell">{t('mail.col.storage')}</TH>
                <TH className="hidden sm:table-cell">{t('mail.col.status')}</TH>
                <TH className="hidden lg:table-cell">{t('mail.col.lastLogin')}</TH>
                {withActions && <TH />}
              </tr>
            </THead>
            <TBody>
              {list.map((m) => (
                <TR key={m.address}>
                  <TD className="max-w-[280px]">
                    <span className="inline-flex max-w-full items-center gap-1">
                      <Mono className="truncate font-medium text-text">{m.address}</Mono>
                      <CopyButton value={m.address} />
                    </span>
                    {/* Name, usage and status move below the address on narrow screens. */}
                    {m.name && <div className="truncate text-xs text-muted md:hidden">{m.name}</div>}
                    <div className="mt-1.5 space-y-1.5 sm:hidden">
                      <MailboxUsage
                        usedBytes={m.usedBytes}
                        quotaBytes={m.quotaBytes}
                        className="max-w-[220px]"
                      />
                      <MailboxStateBadge state={m.state} />
                    </div>
                  </TD>
                  <TD className="hidden max-w-[220px] md:table-cell">
                    <span className="block truncate">{m.name ?? <span className="text-subtle">–</span>}</span>
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <MailboxUsage usedBytes={m.usedBytes} quotaBytes={m.quotaBytes} />
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <MailboxStateBadge state={m.state} />
                  </TD>
                  <TD className="hidden text-sm whitespace-nowrap lg:table-cell">
                    {m.lastLoginAt ? (
                      formatRelative(m.lastLoginAt, locale)
                    ) : (
                      <span className="text-subtle">{t('mail.mailbox.never')}</span>
                    )}
                  </TD>
                  {withActions && (
                    <TD className="w-12 text-right">
                      <MailboxActions domain={domain} mailbox={m} onPassword={setShown} />
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {creating && (
        <CreateMailboxDialog
          domain={domain}
          mailboxes={all}
          onClose={() => setCreating(false)}
          onPassword={setShown}
        />
      )}
      <MailPasswordDialog shown={shown} onClose={() => setShown(null)} />
    </div>
  );
}

/** Error of a size field against the domain's limits, null when it fits. */
function sizeError(
  t: ReturnType<typeof useI18n>['t'],
  locale: ReturnType<typeof useI18n>['locale'],
  domain: MailDomainDetailDto,
  size: SizeValue,
  mib: number | null,
  currentBytes = 0,
): string | null {
  if (size.value.trim() === '') return null;
  if (mib === null) return t('mail.units.invalid');
  const limits = domain.limits;
  const free = freeBytes(domain);
  const bytes = mib * MIB;
  if (limits && bytes > limits.maxMailboxQuotaBytes) {
    return t('mail.mailbox.sizeTooLarge', { max: formatMailSize(limits.maxMailboxQuotaBytes, locale) });
  }
  // Only a size above what the mailbox has now needs room in the domain (as in the API).
  if (free !== null && bytes > currentBytes && bytes - currentBytes > free) {
    return t('mail.mailbox.sizeNoSpace', { free: formatMailSize(free + currentBytes, locale) });
  }
  return null;
}

function nameError(t: ReturnType<typeof useI18n>['t'], name: string): string | null {
  if (name.trim().length > NAME_MAX) return t('mail.mailbox.nameTooLong', { max: NAME_MAX });
  if (!NAME_PATTERN.test(name)) return t('mail.mailbox.nameInvalid');
  return null;
}

// --- Create ----------------------------------------------------------------------------

function CreateMailboxDialog({
  domain,
  mailboxes,
  onClose,
  onPassword,
}: {
  domain: MailDomainDetailDto;
  mailboxes: MailboxDto[];
  onClose: () => void;
  onPassword: (shown: ShownMailPassword) => void;
}) {
  const { t, locale } = useI18n();
  const mailError = useMailError();
  const limits = domain.limits;
  const free = freeBytes(domain);
  const [localPart, setLocalPart] = useState('');
  const [name, setName] = useState('');
  const [size, setSize] = useState<SizeValue>(
    limits ? fromBytes(limits.defaultMailboxQuotaBytes) : { value: '', unit: 'GB' },
  );
  const [mode, setMode] = useState<PasswordMode>('generate');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const policy = domain.passwordPolicy;
  const create = useCreateMailbox(domain.id, {
    success: (r) => t('mail.mailbox.created', { address: r.mailbox.address }),
    onSuccess: (r) => {
      onClose();
      if (r.password) {
        onPassword({
          title: t('mail.mailbox.createdTitle'),
          address: r.mailbox.address,
          password: r.password,
          mailHost: domain.clientSettings?.mailHost ?? null,
        });
      }
    },
    error: mailError,
  });

  const address = `${localPart || '…'}@${domain.asciiName}`;
  const localError = !localPart
    ? null
    : !isMailLocalPart(localPart)
      ? t('mail.mailbox.localInvalid')
      : mailboxes.some((m) => m.address === `${localPart}@${domain.asciiName}`)
        ? t('mail.mailbox.taken')
        : null;
  const mib = toMib(size.value, size.unit);
  const sizeIssue =
    size.value.trim() === '' ? t('mail.units.required') : sizeError(t, locale, domain, size, mib);
  const nameIssue = nameError(t, name);
  const blocked =
    !localPart ||
    !!localError ||
    mib === null ||
    !!sizeIssue ||
    !!nameIssue ||
    !passwordReady(mode, password, repeat, policy);

  const submit = () => {
    if (blocked || mib === null || create.isPending) return;
    create.mutate({
      localPart,
      name: name.trim() || null,
      quotaMb: mib,
      ...(mode === 'choose' ? { password } : {}),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('mail.mailbox.createTitle')}
      description={t('mail.mailbox.createText', { domain: domain.name })}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={blocked} loading={create.isPending} onClick={submit}>
            {t('mail.mailbox.create')}
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
          label={t('mail.col.address')}
          htmlFor="mb-local"
          error={localError}
          hint={
            <>
              {t('mail.mailbox.addressPreview')} <Mono className="text-text">{address}</Mono>
              <span className="mt-0.5 block">{t('mail.mailbox.localHint')}</span>
            </>
          }
        >
          <div className="flex h-9 w-full items-center overflow-hidden rounded-lg border border-border-strong bg-surface focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
            <input
              id="mb-local"
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value.toLowerCase().replace(/\s+/g, ''))}
              placeholder={t('mail.mailbox.localPlaceholder')}
              className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-text placeholder:text-subtle focus:outline-none"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={64}
              autoFocus
              aria-invalid={!!localError}
            />
            <span className="max-w-[55%] shrink-0 truncate border-l border-border bg-surface-2 px-3 py-2 font-mono text-sm text-muted">
              @{domain.asciiName}
            </span>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('mail.col.name')} hint={t('common.optional')} error={nameIssue} htmlFor="mb-name">
            <Input
              id="mb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('mail.mailbox.namePlaceholder')}
              maxLength={NAME_MAX}
            />
          </Field>
          <Field
            label={t('mail.mailbox.size')}
            htmlFor="mb-size"
            error={sizeIssue}
            hint={
              limits && free !== null
                ? t('mail.mailbox.sizeHint', {
                    max: formatMailSize(limits.maxMailboxQuotaBytes, locale),
                    free: formatMailSize(free, locale),
                  })
                : undefined
            }
          >
            <SizeInput id="mb-size" size={size} onChange={setSize} invalid={!!sizeIssue} />
          </Field>
        </div>
        <PasswordChoice
          mode={mode}
          onMode={setMode}
          password={password}
          onPassword={setPassword}
          repeat={repeat}
          onRepeat={setRepeat}
          policy={policy}
        />
        <button type="submit" className="sr-only" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// --- Edit ------------------------------------------------------------------------------

function EditMailboxDialog({
  domain,
  mailbox,
  onClose,
}: {
  domain: MailDomainDetailDto;
  mailbox: MailboxDto;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const mailError = useMailError();
  const unlimited = mailbox.quotaBytes === 0;
  const [name, setName] = useState(mailbox.name ?? '');
  const [size, setSize] = useState<SizeValue>(
    unlimited ? { value: '', unit: 'GB' } : fromBytes(mailbox.quotaBytes),
  );
  const [state, setState] = useState<MailboxState>(mailbox.state);
  const update = useUpdateMailbox(domain.id, {
    success: (m) => t('mail.mailbox.updated', { address: m.address }),
    onSuccess: onClose,
    error: mailError,
  });

  const mib = toMib(size.value, size.unit);
  const nextBytes = mib === null ? null : mib * MIB;
  const sizeIssue =
    size.value.trim() === ''
      ? unlimited
        ? null
        : t('mail.units.required')
      : sizeError(t, locale, domain, size, mib, mailbox.quotaBytes);
  // Mailcow keeps the old name when it gets an empty one: a name can be replaced, not removed.
  const nameIssue = mailbox.name && !name.trim() ? t('mail.mailbox.nameRequired') : nameError(t, name);
  const belowUsage = nextBytes !== null && nextBytes < mailbox.usedBytes;

  const patch: MailboxPatchInput = {};
  if (name.trim() && name.trim() !== (mailbox.name ?? '')) patch.name = name.trim();
  if (mib !== null && nextBytes !== mailbox.quotaBytes) patch.quotaMb = mib;
  if (state !== mailbox.state) patch.state = state;
  const changed = Object.keys(patch).length > 0;
  const blocked = !changed || !!sizeIssue || !!nameIssue;

  const submit = () => {
    if (blocked || update.isPending) return;
    update.mutate({ address: mailbox.address, patch });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('mail.mailbox.editTitle', { address: mailbox.address })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={blocked} loading={update.isPending} onClick={submit}>
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
        <Field
          label={t('mail.col.name')}
          htmlFor="me-name"
          error={nameIssue}
          hint={mailbox.name ? t('mail.mailbox.nameHint') : t('common.optional')}
        >
          <Input id="me-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} />
        </Field>
        <Field
          label={t('mail.mailbox.size')}
          htmlFor="me-size"
          error={sizeIssue}
          hint={
            <>
              {unlimited && <span className="block">{t('mail.mailbox.sizeUnlimited')}</span>}
              {domain.limits && (
                <span className="block">
                  {t('mail.mailbox.sizeHint', {
                    max: formatMailSize(domain.limits.maxMailboxQuotaBytes, locale),
                    free: formatMailSize(freeBytes(domain), locale),
                  })}
                </span>
              )}
              <span className="block">
                {t('mail.mailbox.sizeUsed', { used: formatMailSize(mailbox.usedBytes, locale) })}
              </span>
            </>
          }
        >
          <SizeInput
            id="me-size"
            size={size}
            onChange={setSize}
            invalid={!!sizeIssue}
            placeholder={unlimited ? '∞' : undefined}
          />
        </Field>
        {belowUsage && (
          <Notice tone="warning" title={t('mail.mailbox.belowUsageTitle')}>
            {t('mail.mailbox.belowUsage', { used: formatMailSize(mailbox.usedBytes, locale) })}
          </Notice>
        )}
        <Field label={t('mail.col.status')} htmlFor="me-state" hint={t(`mail.state.${state}.hint`)}>
          <Select id="me-state" value={state} onChange={(e) => setState(e.target.value as MailboxState)}>
            {MAILBOX_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`mail.state.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <button type="submit" className="sr-only" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// --- Password --------------------------------------------------------------------------

/**
 * New password, generated or chosen. The mutation belongs to the row (MailboxActions), so a
 * generated password still reaches the user; the dialog cannot be closed while it runs.
 */
function MailboxPasswordDialog({
  domain,
  mailbox,
  mutation: setPasswordMutation,
  onClose,
  onPassword,
}: {
  domain: MailDomainDetailDto;
  mailbox: MailboxDto;
  mutation: ReturnType<typeof useSetMailboxPassword>;
  onClose: () => void;
  onPassword: (shown: ShownMailPassword) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<PasswordMode>('generate');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const policy = domain.passwordPolicy;
  const ready = passwordReady(mode, password, repeat, policy);

  const submit = () => {
    if (!ready || setPasswordMutation.isPending) return;
    setPasswordMutation.mutate(
      { address: mailbox.address, ...(mode === 'choose' ? { password } : {}) },
      {
        onSuccess: (r) => {
          onClose();
          // The generated password lives on in the dialog only, not in the mutation cache.
          setPasswordMutation.reset();
          if (r.password) {
            onPassword({
              title: t('mail.password.newTitle'),
              address: mailbox.address,
              password: r.password,
              mailHost: domain.clientSettings?.mailHost ?? null,
            });
          } else {
            toast.success(t('mail.password.changed', { address: mailbox.address }));
          }
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !setPasswordMutation.isPending && onClose()}
      title={t('mail.password.title', { address: mailbox.address })}
      description={t('mail.password.text')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={setPasswordMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            loading={setPasswordMutation.isPending}
            onClick={submit}
          >
            {t('mail.password.set')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <PasswordChoice
          mode={mode}
          onMode={setMode}
          password={password}
          onPassword={setPassword}
          repeat={repeat}
          onRepeat={setRepeat}
          policy={policy}
        />
        <button type="submit" className="sr-only" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// --- Row actions -----------------------------------------------------------------------

type Pending = 'edit' | 'password' | 'delete' | { state: MailboxState } | null;

/** The actions menu of one mailbox. Only what the user may do on this domain is offered. */
function MailboxActions({
  domain,
  mailbox,
  onPassword,
}: {
  domain: MailDomainDetailDto;
  mailbox: MailboxDto;
  onPassword: (shown: ShownMailPassword) => void;
}) {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState<Pending>(null);
  const canWrite = domain.permissions.includes('mail:write');
  const canPassword = domain.permissions.includes('mail:password');
  const close = () => setPending(null);
  const mailError = useMailError();
  const setState = useUpdateMailbox(domain.id, {
    success: (m) => t(`mail.mailbox.stateDone.${m.state}`, { address: m.address }),
    onSuccess: close,
    error: mailError,
  });
  const remove = useDeleteMailbox(domain.id, (address) => t('mail.mailbox.deleted', { address }), close);
  const setPassword = useSetMailboxPassword(domain.id);
  if (!canWrite && !canPassword) return null;
  const target = typeof pending === 'object' && pending ? pending.state : null;

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
          <MenuItem icon={<Pencil />} onSelect={() => setPending('edit')}>
            {t('common.edit')}
          </MenuItem>
        )}
        {canPassword && (
          <MenuItem icon={<KeyRound />} onSelect={() => setPending('password')}>
            {t('mail.password.action')}
          </MenuItem>
        )}
        {canWrite && mailbox.state === 'active' && (
          <MenuItem
            icon={<Lock />}
            onSelect={() => setPending({ state: 'login_disabled' })}
            hint={t('mail.state.login_disabled.hint')}
          >
            {t('mail.mailbox.lockLogin')}
          </MenuItem>
        )}
        {canWrite && mailbox.state === 'login_disabled' && (
          <MenuItem icon={<LockOpen />} onSelect={() => setPending({ state: 'active' })}>
            {t('mail.mailbox.allowLogin')}
          </MenuItem>
        )}
        {canWrite && mailbox.state !== 'inactive' && (
          <MenuItem
            icon={<PowerOff />}
            onSelect={() => setPending({ state: 'inactive' })}
            hint={t('mail.state.inactive.hint')}
          >
            {t('mail.mailbox.deactivate')}
          </MenuItem>
        )}
        {canWrite && mailbox.state === 'inactive' && (
          <MenuItem icon={<Power />} onSelect={() => setPending({ state: 'active' })}>
            {t('mail.mailbox.activate')}
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

      {pending === 'edit' && <EditMailboxDialog domain={domain} mailbox={mailbox} onClose={close} />}
      {pending === 'password' && (
        <MailboxPasswordDialog
          domain={domain}
          mailbox={mailbox}
          mutation={setPassword}
          onClose={close}
          onPassword={onPassword}
        />
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && close()}
        title={target ? t(`mail.mailbox.stateTitle.${target}`, { address: mailbox.address }) : ''}
        description={target ? t(`mail.state.${target}.hint`) : undefined}
        confirmLabel={target ? t(`mail.mailbox.stateConfirm.${target}`) : ''}
        danger={target !== 'active'}
        loading={setState.isPending}
        onConfirm={() => target && setState.mutate({ address: mailbox.address, patch: { state: target } })}
      />

      <ConfirmDialog
        open={pending === 'delete'}
        onOpenChange={(o) => !o && close()}
        title={t('mail.mailbox.deleteTitle', { address: mailbox.address })}
        confirmLabel={t('mail.mailbox.deleteConfirm')}
        confirmText={mailbox.address}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(mailbox.address)}
      >
        <Notice tone="danger" className="mb-4" title={t('mail.mailbox.deleteWarningTitle')}>
          {t('mail.mailbox.deleteText', { used: formatMailSize(mailbox.usedBytes, locale) })}
        </Notice>
      </ConfirmDialog>
    </>
  );
}
