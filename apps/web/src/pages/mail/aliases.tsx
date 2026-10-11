import { useId, useState } from 'react';
import { Forward, MoreHorizontal, Pencil, Plus, Power, PowerOff, Search, Trash2 } from 'lucide-react';
import {
  MAIL_MAX_ALIAS_TARGETS,
  isMailLocalPart,
  type MailAliasDto,
  type MailDomainDetailDto,
} from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import {
  useCreateMailAlias,
  useDeleteMailAlias,
  useMailAliases,
  useMailboxes,
  useUpdateMailAlias,
  type MailAliasPatchInput,
} from '@/lib/api/mail';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuSeparator, Switch } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  Textarea,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { useMailError } from './bits';

/** Aliases tab of a mail domain: forwarding addresses and the catch-all. */

/** The address rules of the API (zod's email check), so the dialog flags what it would refuse. */
const EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** Targets from the text field: one per line or separated by commas, lower-cased, without duplicates. */
export function parseTargets(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const value = part.trim().toLowerCase();
    if (value) seen.add(value);
  }
  return [...seen];
}

const sameTargets = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export function AliasesTab({ domain }: { domain: MailDomainDetailDto }) {
  const { t } = useI18n();
  const aliases = useMailAliases(domain.id);
  const [editing, setEditing] = useState<MailAliasDto | 'new' | null>(null);
  const [q, setQ] = useState('');
  const canWrite = domain.permissions.includes('mail:write');
  const { limits, usage } = domain;
  const createBlocked =
    limits && usage && usage.aliases >= limits.maxAliases
      ? t('mail.alias.limitReached', { max: limits.maxAliases })
      : domain.missingSince
        ? t('mail.missing.title')
        : null;

  const all = aliases.data ?? [];
  const searchable = all.length > 8;
  const needle = searchable ? q.trim().toLowerCase() : '';
  const list = all.filter(
    (a) => !needle || a.address.includes(needle) || a.targets.some((x) => x.includes(needle)),
  );

  return (
    <div className="space-y-4">
      {canWrite && createBlocked && <Notice tone="info">{createBlocked}</Notice>}
      <Card>
        <CardHeader
          title={t('mail.alias.title')}
          description={
            limits && usage
              ? t('mail.alias.countText', { n: usage.aliases, max: limits.maxAliases })
              : t('mail.alias.text')
          }
          actions={
            <>
              {searchable && (
                <div className="relative w-56 max-w-full">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t('mail.alias.search')}
                    className="h-8 pl-9"
                    aria-label={t('mail.alias.search')}
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
                  onClick={() => setEditing('new')}
                >
                  {t('mail.alias.create')}
                </Button>
              )}
            </>
          }
        />
        {aliases.isPending ? (
          <LoadingBlock rows={3} />
        ) : aliases.isError ? (
          <div className="p-5">
            <ErrorState error={aliases.error} onRetry={() => void aliases.refetch()} />
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Forward className="size-6" />}
            title={t('mail.alias.empty')}
            description={t('mail.alias.emptyText')}
          />
        ) : list.length === 0 ? (
          <EmptyState icon={<Search className="size-6" />} title={t('hosting.noMatch')} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('mail.col.address')}</TH>
                <TH>{t('mail.col.targets')}</TH>
                <TH className="hidden sm:table-cell">{t('mail.col.status')}</TH>
                {canWrite && <TH />}
              </tr>
            </THead>
            <TBody>
              {list.map((a) => (
                <TR key={a.id}>
                  <TD className="max-w-[280px] align-top">
                    {a.catchAll ? (
                      <>
                        <span className="block font-medium text-text">{t('mail.alias.catchAll')}</span>
                        <Mono className="text-xs text-muted">{a.address}</Mono>
                      </>
                    ) : (
                      <Mono className="block truncate font-medium text-text">{a.address}</Mono>
                    )}
                    <div className="mt-1 sm:hidden">
                      <AliasStatus alias={a} />
                    </div>
                  </TD>
                  <TD className="align-top">
                    <AliasTargets alias={a} />
                  </TD>
                  <TD className="hidden align-top sm:table-cell">
                    <AliasStatus alias={a} />
                  </TD>
                  {canWrite && (
                    <TD className="w-12 text-right align-top">
                      <AliasActions domain={domain} alias={a} onEdit={() => setEditing(a)} />
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {editing && (
        <AliasDialog
          key={editing === 'new' ? 'new' : editing.id}
          domain={domain}
          alias={editing === 'new' ? null : editing}
          aliases={all}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AliasStatus({ alias }: { alias: MailAliasDto }) {
  const { t } = useI18n();
  return alias.active ? (
    <Badge tone="success">{t('mail.alias.active')}</Badge>
  ) : (
    <Badge tone="neutral">{t('mail.alias.inactive')}</Badge>
  );
}

function AliasTargets({ alias }: { alias: MailAliasDto }) {
  const { t } = useI18n();
  if (alias.special) {
    return (
      <Badge tone="warning" title={t(`mail.alias.special.${alias.special}.hint`)}>
        {t(`mail.alias.special.${alias.special}`)}
      </Badge>
    );
  }
  return (
    <ul className="space-y-0.5">
      {alias.targets.map((target) => (
        <li key={target}>
          <Mono className="break-all text-text">{target}</Mono>
        </li>
      ))}
    </ul>
  );
}

// --- Create and edit -------------------------------------------------------------------

type Kind = 'address' | 'catchAll';

function AliasDialog({
  domain,
  alias,
  aliases,
  onClose,
}: {
  domain: MailDomainDetailDto;
  alias: MailAliasDto | null;
  aliases: MailAliasDto[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const mailError = useMailError();
  const mailboxes = useMailboxes(domain.id);
  const editing = alias !== null;
  const special = alias?.special ?? null;
  const hasCatchAll = aliases.some((a) => a.catchAll);
  const [kind, setKind] = useState<Kind>(alias?.catchAll ? 'catchAll' : 'address');
  const [localPart, setLocalPart] = useState('');
  const [targetText, setTargetText] = useState(alias ? alias.targets.join('\n') : '');
  const [pick, setPick] = useState('');
  const [active, setActive] = useState(alias?.active ?? true);
  const create = useCreateMailAlias(domain.id, {
    success: (a) => t('mail.alias.created', { address: a.address }),
    onSuccess: onClose,
    error: mailError,
  });
  const update = useUpdateMailAlias(domain.id, {
    success: (a) => t('mail.alias.updated', { address: a.address }),
    onSuccess: onClose,
    error: mailError,
  });

  const address = editing
    ? alias.address
    : kind === 'catchAll'
      ? `@${domain.asciiName}`
      : `${localPart || '…'}@${domain.asciiName}`;
  const localError =
    editing || kind === 'catchAll' || !localPart
      ? null
      : !isMailLocalPart(localPart)
        ? t('mail.mailbox.localInvalid')
        : aliases.some((a) => a.address === `${localPart}@${domain.asciiName}`) ||
            (mailboxes.data ?? []).some((m) => m.address === `${localPart}@${domain.asciiName}`)
          ? t('mail.alias.taken')
          : null;
  const targets = parseTargets(targetText);
  const invalid = targets.filter((x) => !EMAIL.test(x));
  const self = targets.includes(address);
  const targetError = special
    ? null
    : targets.length === 0
      ? targetText.trim()
        ? t('mail.alias.targetsRequired')
        : null
      : targets.length > MAIL_MAX_ALIAS_TARGETS
        ? t('mail.alias.targetsTooMany', { max: MAIL_MAX_ALIAS_TARGETS })
        : invalid.length > 0
          ? t('mail.alias.targetsInvalid', { list: invalid.join(', ') })
          : self
            ? t('mail.alias.targetsSelf')
            : null;
  const external = targets.filter((x) => EMAIL.test(x) && !x.endsWith(`@${domain.asciiName}`));

  const patch: MailAliasPatchInput = {};
  if (editing && !special && !sameTargets(targets, alias.targets)) patch.targets = targets;
  if (editing && active !== alias.active) patch.active = active;
  const blocked = editing
    ? Object.keys(patch).length === 0 || !!targetError
    : (kind === 'address' && (!localPart || !!localError)) ||
      (kind === 'catchAll' && hasCatchAll) ||
      targets.length === 0 ||
      !!targetError;
  const pending = create.isPending || update.isPending;

  const submit = () => {
    if (blocked || pending) return;
    if (editing) update.mutate({ aliasId: alias.id, patch });
    else create.mutate({ localPart: kind === 'catchAll' ? null : localPart, targets, active });
  };

  const addPick = () => {
    const value = pick.trim().toLowerCase();
    if (!value) return;
    if (!targets.includes(value)) setTargetText((text) => (text.trim() ? `${text.trim()}\n${value}` : value));
    setPick('');
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={editing ? t('mail.alias.editTitle', { address: alias.address }) : t('mail.alias.createTitle')}
      description={editing ? undefined : t('mail.alias.createText', { domain: domain.name })}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={blocked} loading={pending} onClick={submit}>
            {editing ? t('common.save') : t('mail.alias.create')}
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
        {!editing && (
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-text">{t('mail.alias.kind')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['address', 'catchAll'] as const).map((value) => {
                const disabled = value === 'catchAll' && hasCatchAll;
                return (
                  <label
                    key={value}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                      disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                      kind === value
                        ? 'border-brand-blue bg-primary-soft text-primary-text'
                        : 'border-border-strong text-text hover:bg-surface-3',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-kind`}
                      value={value}
                      checked={kind === value}
                      disabled={disabled}
                      onChange={() => setKind(value)}
                      className="mt-1 size-4 accent-[var(--primary)]"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{t(`mail.alias.kind.${value}`)}</span>
                      <span className="mt-0.5 block text-xs opacity-90">
                        {disabled ? t('mail.alias.catchAllExists') : t(`mail.alias.kind.${value}Text`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {!editing && kind === 'address' && (
          <Field
            label={t('mail.col.address')}
            htmlFor={`${id}-local`}
            error={localError}
            hint={
              <>
                {t('mail.mailbox.addressPreview')} <Mono className="text-text">{address}</Mono>
              </>
            }
          >
            <div className="flex h-9 w-full items-center overflow-hidden rounded-lg border border-border-strong bg-surface focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
              <input
                id={`${id}-local`}
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                placeholder={t('mail.alias.localPlaceholder')}
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
        )}
        {kind === 'catchAll' && (
          <Notice tone="warning" title={t('mail.alias.catchAllTitle')}>
            {t('mail.alias.catchAllHint', { domain: domain.asciiName })}
          </Notice>
        )}

        {special ? (
          <Notice tone="info" title={t(`mail.alias.special.${special}`)}>
            {t('mail.alias.specialReadOnly')}
          </Notice>
        ) : (
          <div className="space-y-2">
            <Field
              label={t('mail.col.targets')}
              htmlFor={`${id}-targets`}
              error={targetError}
              hint={t('mail.alias.targetsHint', { max: MAIL_MAX_ALIAS_TARGETS })}
            >
              <Textarea
                id={`${id}-targets`}
                rows={4}
                value={targetText}
                onChange={(e) => setTargetText(e.target.value)}
                placeholder={`anna@${domain.asciiName}`}
                className="font-mono text-[12.5px]"
                spellCheck={false}
                autoCapitalize="none"
                aria-invalid={!!targetError}
              />
            </Field>
            <div className="flex items-center gap-2">
              <Input
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPick();
                  }
                }}
                list={`${id}-mailboxes`}
                placeholder={t('mail.alias.pickPlaceholder')}
                aria-label={t('mail.alias.pick')}
                className="h-8 font-mono text-[12.5px]"
                autoComplete="off"
              />
              <datalist id={`${id}-mailboxes`}>
                {(mailboxes.data ?? []).map((m) => (
                  <option key={m.address} value={m.address}>
                    {m.name ?? undefined}
                  </option>
                ))}
              </datalist>
              <Button size="sm" onClick={addPick} disabled={!pick.trim()}>
                {t('common.add')}
              </Button>
            </div>
            {external.length > 0 && !targetError && (
              <p className="text-xs text-muted">{t('mail.alias.external', { n: external.length })}</p>
            )}
          </div>
        )}

        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium text-text">{t('mail.alias.activeLabel')}</span>
            <span className="block text-xs text-muted">{t('mail.alias.activeHint')}</span>
          </span>
          <Switch checked={active} onCheckedChange={setActive} label={t('mail.alias.activeLabel')} />
        </label>
        <button type="submit" className="sr-only" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// --- Row actions -----------------------------------------------------------------------

function AliasActions({
  domain,
  alias,
  onEdit,
}: {
  domain: MailDomainDetailDto;
  alias: MailAliasDto;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const mailError = useMailError();
  const [pending, setPending] = useState<'toggle' | 'delete' | null>(null);
  const close = () => setPending(null);
  const toggle = useUpdateMailAlias(domain.id, {
    success: (a) =>
      a.active
        ? t('mail.alias.activated', { address: a.address })
        : t('mail.alias.deactivated', { address: a.address }),
    onSuccess: close,
    error: mailError,
  });
  const remove = useDeleteMailAlias(domain.id, (a) => t('mail.alias.deleted', { address: a.address }), close);
  const label = alias.catchAll ? t('mail.alias.catchAll') : alias.address;

  return (
    <>
      <Menu
        trigger={
          <Button size="icon" variant="ghost" aria-label={t('common.actions')} title={t('common.actions')}>
            <MoreHorizontal className="size-4" />
          </Button>
        }
      >
        <MenuItem icon={<Pencil />} onSelect={onEdit}>
          {t('common.edit')}
        </MenuItem>
        <MenuItem icon={alias.active ? <PowerOff /> : <Power />} onSelect={() => setPending('toggle')}>
          {alias.active ? t('mail.alias.deactivate') : t('mail.alias.activate')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Trash2 />} danger onSelect={() => setPending('delete')}>
          {t('common.delete')}
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={pending === 'toggle'}
        onOpenChange={(o) => !o && close()}
        title={
          alias.active
            ? t('mail.alias.deactivateTitle', { address: label })
            : t('mail.alias.activateTitle', { address: label })
        }
        description={alias.active ? t('mail.alias.deactivateText') : t('mail.alias.activateText')}
        confirmLabel={alias.active ? t('mail.alias.deactivate') : t('mail.alias.activate')}
        danger={alias.active}
        loading={toggle.isPending}
        onConfirm={() => toggle.mutate({ aliasId: alias.id, patch: { active: !alias.active } })}
      />

      <ConfirmDialog
        open={pending === 'delete'}
        onOpenChange={(o) => !o && close()}
        title={t('mail.alias.deleteTitle', { address: label })}
        description={t('mail.alias.deleteText')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(alias)}
      />
    </>
  );
}
