import { useState } from 'react';
import { KeyRound, MoreHorizontal, Search, ShieldOff, UserPlus } from 'lucide-react';
import type { UserDto } from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatRelative } from '@/lib/format';
import { qk, useAdminOrgs, useAdminUsers, useApiMutation, useMe, type AdminUser } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import {
  Badge,
  Card,
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
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';

function PasswordResult({ value, onClose }: { value: string | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={!!value}
      onOpenChange={(o) => !o && onClose()}
      title={t('users.initialPassword')}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common.done')}
        </Button>
      }
    >
      <Notice tone="warning">{t('users.initialPasswordText')}</Notice>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
        <Mono className="flex-1 text-base">{value}</Mono>
        <CopyButton value={value ?? ''} />
      </div>
    </Dialog>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onPassword,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPassword: (p: string) => void;
}) {
  const { t } = useI18n();
  const orgs = useAdminOrgs();
  const me = useMe();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [platformRole, setPlatformRole] = useState('');
  const [orgId, setOrgId] = useState('');
  const [orgRole, setOrgRole] = useState('member');
  const create = useApiMutation(
    () =>
      api.post<{ user: UserDto; initialPassword: string }>('/admin/users', {
        email,
        name,
        platformRole: platformRole || null,
        orgId: orgId || undefined,
        orgRole: orgId ? orgRole : undefined,
      }),
    {
      invalidate: [qk.admin('users')],
      onSuccess: (res) => {
        onOpenChange(false);
        setEmail('');
        setName('');
        onPassword(res.initialPassword);
      },
    },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('users.create')}
      description={t('users.createText')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!email || !name}
            loading={create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('invite.name')} htmlFor="u-name">
          <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('login.email')} htmlFor="u-email">
          <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('users.organization')} htmlFor="u-org">
          <Select id="u-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">–</option>
            {orgs.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('members.role')} htmlFor="u-orgrole">
          <Select
            id="u-orgrole"
            value={orgRole}
            onChange={(e) => setOrgRole(e.target.value)}
            disabled={!orgId}
          >
            {['owner', 'admin', 'member', 'restricted', 'viewer', 'billing'].map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}` as TranslationKey)}
              </option>
            ))}
          </Select>
        </Field>
        {me.data?.user.platformRole === 'superadmin' && (
          <Field
            label={t('users.platformRole')}
            hint={t('users.platformRoleHint')}
            htmlFor="u-prole"
            className="sm:col-span-2"
          >
            <Select id="u-prole" value={platformRole} onChange={(e) => setPlatformRole(e.target.value)}>
              <option value="">{t('users.noPlatformRole')}</option>
              <option value="support">{t('platformRole.support')}</option>
              <option value="superadmin">{t('platformRole.superadmin')}</option>
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}

export function UsersPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const [q, setQ] = useState('');
  const users = useAdminUsers(q || undefined);
  const [creating, setCreating] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const isSuper = me.data?.user.platformRole === 'superadmin';
  const keys = [qk.admin('users')];

  const update = useApiMutation(
    ({ id, body }: { id: string; body: object }) => api.patch(`/admin/users/${id}`, body),
    {
      success: t('common.saved'),
      invalidate: keys,
    },
  );
  const resetPw = useApiMutation(
    (id: string) => api.post<{ initialPassword: string }>(`/admin/users/${id}/reset-password`),
    {
      invalidate: keys,
      onSuccess: (r) => setPassword(r.initialPassword),
    },
  );
  const resetMfa = useApiMutation((id: string) => api.post(`/admin/users/${id}/reset-mfa`), {
    success: t('users.mfaReset'),
    invalidate: keys,
  });

  return (
    <>
      <PageHeader
        title={t('nav.admin.users')}
        description={t('users.subtitle')}
        actions={
          <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
            {t('users.create')}
          </Button>
        }
      />
      <Card>
        <div className="border-b border-border px-4 py-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('common.search')}
              className="pl-9"
            />
          </div>
        </div>
        {users.isPending ? (
          <LoadingBlock />
        ) : users.isError ? (
          <div className="p-5">
            <ErrorState error={users.error} />
          </div>
        ) : users.data.length === 0 ? (
          <EmptyState title={t('users.empty')} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('members.name')}</TH>
                <TH>{t('users.organizations')}</TH>
                <TH>{t('users.platformRole')}</TH>
                <TH className="hidden lg:table-cell">{t('members.lastLogin')}</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {users.data.map((u: AdminUser) => (
                <tr key={u.id} className={u.status === 'disabled' ? 'opacity-50' : ''}>
                  <TD>
                    <div className="font-medium">{u.name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      {u.email}
                      {u.mfaEnabled && <Badge tone="success">2FA</Badge>}
                      {u.status === 'disabled' && <Badge tone="danger">{t('users.disabled')}</Badge>}
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {u.memberships.map((m) => (
                        <Badge key={m.orgId} tone="neutral">
                          {m.orgName} · {t(`role.${m.role}` as TranslationKey)}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TD>
                    {u.platformRole ? (
                      <Badge tone="primary">{t(`platformRole.${u.platformRole}` as TranslationKey)}</Badge>
                    ) : (
                      <span className="text-subtle">–</span>
                    )}
                  </TD>
                  <TD className="hidden text-muted lg:table-cell">{formatRelative(u.lastLoginAt, locale)}</TD>
                  <TD className="text-right">
                    <Menu
                      trigger={
                        <Button size="icon" variant="ghost" aria-label={t('common.actions')}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      }
                    >
                      <MenuItem icon={<KeyRound />} onSelect={() => resetPw.mutate(u.id)}>
                        {t('users.resetPassword')}
                      </MenuItem>
                      <MenuItem
                        icon={<ShieldOff />}
                        disabled={!u.mfaEnabled}
                        onSelect={() => resetMfa.mutate(u.id)}
                      >
                        {t('users.resetMfa')}
                      </MenuItem>
                      {isSuper && (
                        <>
                          <MenuSeparator />
                          {(['superadmin', 'support', null] as const).map((role) => (
                            <MenuItem
                              key={String(role)}
                              disabled={u.platformRole === role}
                              onSelect={() => update.mutate({ id: u.id, body: { platformRole: role } })}
                            >
                              {role
                                ? t('users.makeRole', { role: t(`platformRole.${role}` as TranslationKey) })
                                : t('users.removePlatformRole')}
                            </MenuItem>
                          ))}
                        </>
                      )}
                      <MenuSeparator />
                      <MenuItem
                        danger={u.status === 'active'}
                        disabled={u.id === me.data?.user.id}
                        onSelect={() =>
                          update.mutate({
                            id: u.id,
                            body: { status: u.status === 'active' ? 'disabled' : 'active' },
                          })
                        }
                      >
                        {u.status === 'active' ? t('users.disable') : t('users.enable')}
                      </MenuItem>
                    </Menu>
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <CreateUserDialog open={creating} onOpenChange={setCreating} onPassword={setPassword} />
      <PasswordResult value={password} onClose={() => setPassword(null)} />
    </>
  );
}
