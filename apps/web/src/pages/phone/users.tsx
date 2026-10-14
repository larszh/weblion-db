import { useState } from 'react';
import { Mail, MoreHorizontal, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import type { PhoneSystemDto, PhoneUserDto } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/queries';
import { usePhoneUsers } from '@/lib/api/phone';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuSeparator, Tooltip } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Mono,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { canDeletePhoneUser, matchesPhoneUser, phoneUserName, RegisteredDot } from './bits';
import {
  CreatePhoneUserDialog,
  DeletePhoneUserDialog,
  EditPhoneUserDialog,
  WelcomeMailDialog,
} from './dialogs';

/** Users tab of a phone system: the PBX's users with their extensions, create, change, delete. */

type Pending =
  | { kind: 'edit'; user: PhoneUserDto }
  | { kind: 'delete'; user: PhoneUserDto }
  | { kind: 'welcome'; user: PhoneUserDto }
  | null;

export function UsersTab({ system }: { system: PhoneSystemDto }) {
  const { t } = useI18n();
  const me = useMe();
  const platform = me.data?.platformPermissions ?? [];
  const users = usePhoneUsers(system.id);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);

  const canWrite = system.permissions.includes('phone:write') && system.capabilities.includes('users');
  const canWelcome =
    system.permissions.includes('phone:credentials') && system.capabilities.includes('welcomeMail');
  const data = users.data;
  const all = data?.users ?? [];
  const list = all.filter((u) => matchesPhoneUser(u, q));
  // The API refuses the same; the button says why it is off.
  const limitReached =
    !!data && data.maxUsers !== null && data.usersCount !== null && data.usersCount >= data.maxUsers;
  const showActions = canWrite || canWelcome;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('phone.user.title')}
          description={
            data && data.usersCount !== null
              ? data.maxUsers !== null
                ? t('phone.user.countMax', { n: data.usersCount, max: data.maxUsers })
                : t('phone.user.count', { n: data.usersCount })
              : t('phone.user.text')
          }
          actions={
            canWrite &&
            (limitReached ? (
              <Tooltip content={t('phone.user.limitReached')}>
                {/* A disabled button gets no pointer events; the span carries the tooltip. */}
                <span tabIndex={0}>
                  <Button size="sm" variant="primary" icon={<Plus className="size-4" />} disabled>
                    {t('phone.user.create')}
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="size-4" />}
                disabled={!data || !!system.missingSince}
                onClick={() => setCreating(true)}
              >
                {t('phone.user.create')}
              </Button>
            ))
          }
        />
        {all.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('phone.user.search')}
                className="pl-9"
                aria-label={t('phone.user.search')}
              />
            </div>
          </div>
        )}
        {users.isPending ? (
          <LoadingBlock rows={4} />
        ) : users.isError ? (
          <div className="p-5">
            <ErrorState error={users.error} onRetry={() => void users.refetch()} />
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title={t('phone.user.none')}
            description={canWrite ? t('phone.user.noneText') : undefined}
          />
        ) : list.length === 0 ? (
          <EmptyState icon={<Search className="size-6" />} title={t('hosting.noMatch')} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('phone.user.col.number')}</TH>
                <TH>{t('phone.user.col.name')}</TH>
                <TH className="hidden md:table-cell">{t('phone.user.col.email')}</TH>
                <TH className="hidden xl:table-cell">{t('phone.user.col.mobile')}</TH>
                <TH className="hidden 2xl:table-cell">{t('phone.user.col.outboundCallerId')}</TH>
                <TH className="hidden sm:table-cell">{t('phone.user.col.status')}</TH>
                <TH className="hidden lg:table-cell">{t('phone.user.col.role')}</TH>
                {showActions && <TH />}
              </tr>
            </THead>
            <TBody>
              {list.map((u) => (
                <TR key={u.id}>
                  <TD className="whitespace-nowrap">
                    <Mono className="font-medium text-text">{u.number}</Mono>
                  </TD>
                  <TD className="max-w-[260px]">
                    <span className="block truncate font-medium text-text">{phoneUserName(u)}</span>
                    {/* E-mail, status and role move below the name on narrow screens. */}
                    {u.email && (
                      <span className="block truncate text-xs text-muted md:hidden">{u.email}</span>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 lg:hidden">
                      <span className="sm:hidden">
                        <RegisteredDot registered={u.registered} />
                      </span>
                      <RoleBadges user={u} />
                    </div>
                  </TD>
                  <TD className="hidden max-w-[260px] md:table-cell">
                    <span className="block truncate">
                      {u.email ?? <span className="text-subtle">–</span>}
                    </span>
                  </TD>
                  <TD className="hidden whitespace-nowrap xl:table-cell">
                    {u.mobile ? <Mono>{u.mobile}</Mono> : <span className="text-subtle">–</span>}
                  </TD>
                  <TD className="hidden whitespace-nowrap 2xl:table-cell">
                    {u.outboundCallerId ? (
                      <Mono>{u.outboundCallerId}</Mono>
                    ) : (
                      <span className="text-subtle">–</span>
                    )}
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RegisteredDot registered={u.registered} />
                      {u.enabled === false && <Badge tone="neutral">{t('phone.user.disabled')}</Badge>}
                    </div>
                  </TD>
                  <TD className="hidden lg:table-cell">
                    <RoleBadges user={u} empty />
                  </TD>
                  {showActions && (
                    <TD className="w-12 text-right">
                      <UserMenu
                        user={u}
                        canWrite={canWrite}
                        canWelcome={canWelcome}
                        canDelete={canWrite && canDeletePhoneUser(u, system.permissions, platform)}
                        onPending={setPending}
                      />
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {data && all.some((u) => u.protected) && canWrite && (
        <p className="text-xs text-muted">{t('phone.user.protectedHint')}</p>
      )}

      {creating && <CreatePhoneUserDialog system={system} list={data} onClose={() => setCreating(false)} />}
      {pending?.kind === 'edit' && (
        <EditPhoneUserDialog
          key={pending.user.id}
          system={system}
          user={pending.user}
          numberLength={data?.numberLength ?? system.info?.numberLength ?? null}
          onClose={close}
        />
      )}
      {pending?.kind === 'delete' && (
        <DeletePhoneUserDialog key={pending.user.id} system={system} user={pending.user} onClose={close} />
      )}
      {pending?.kind === 'welcome' && (
        <WelcomeMailDialog key={pending.user.id} system={system} user={pending.user} onClose={close} />
      )}
    </div>
  );
}

/** "Administrator" for admins of the PBX, "System" for fax servers and other non-people. */
function RoleBadges({ user, empty }: { user: PhoneUserDto; empty?: boolean }) {
  const { t } = useI18n();
  if (!user.admin && !user.system) return empty ? <span className="text-subtle">–</span> : null;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {user.admin && <Badge tone="primary">{t('phone.user.admin')}</Badge>}
      {user.system && <Badge tone="info">{t('phone.user.system')}</Badge>}
    </span>
  );
}

function UserMenu({
  user,
  canWrite,
  canWelcome,
  canDelete,
  onPending,
}: {
  user: PhoneUserDto;
  canWrite: boolean;
  canWelcome: boolean;
  canDelete: boolean;
  onPending: (pending: Pending) => void;
}) {
  const { t } = useI18n();
  if (!canWrite && !canWelcome) return null;
  return (
    <Menu
      trigger={
        <Button size="icon" variant="ghost" aria-label={t('common.actions')} title={t('common.actions')}>
          <MoreHorizontal className="size-4" />
        </Button>
      }
    >
      {canWrite && (
        <MenuItem icon={<Pencil />} onSelect={() => onPending({ kind: 'edit', user })}>
          {t('common.edit')}
        </MenuItem>
      )}
      {canWelcome && (
        <MenuItem
          icon={<Mail />}
          disabled={!user.email}
          hint={user.email ? user.email : t('phone.user.welcomeNoEmail')}
          onSelect={() => onPending({ kind: 'welcome', user })}
        >
          {t('phone.user.welcome')}
        </MenuItem>
      )}
      {canDelete && (
        <>
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} danger onSelect={() => onPending({ kind: 'delete', user })}>
            {t('common.delete')}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
