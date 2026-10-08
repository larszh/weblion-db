import { useState } from 'react';
import { MailPlus, ShieldCheck, Trash2, UserMinus, Users } from 'lucide-react';
import { ORG_ROLES, type InvitationDto, type MemberDto, type OrgRole } from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { formatRelative } from '@/lib/format';
import { qk, useApiMutation, useInvitations, useMe, useMembers, usePolicies } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  Badge,
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
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';

function RoleHelp() {
  const { t } = useI18n();
  return (
    <ul className="space-y-1.5 text-sm">
      {ORG_ROLES.map((r) => (
        <li key={r}>
          <span className="font-medium text-text">{t(`role.${r}` as TranslationKey)}</span>
          <span className="text-muted"> · {t(`role.${r}.hint` as TranslationKey)}</span>
        </li>
      ))}
    </ul>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { org } = useOrg();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [created, setCreated] = useState<InvitationDto | null>(null);
  const invite = useApiMutation(
    () => api.post<InvitationDto>(`/orgs/${org.id}/invitations`, { email, role }),
    {
      invalidate: [qk.invitations(org.id)],
      onSuccess: (inv) => setCreated(inv),
    },
  );
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setCreated(null);
      setEmail('');
      setRole('member');
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('members.invite')}
      description={created ? undefined : t('members.inviteText')}
      size="md"
      footer={
        created ? (
          <Button variant="primary" onClick={() => close(false)}>
            {t('common.done')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!email}
              loading={invite.isPending}
              onClick={() => invite.mutate(undefined)}
            >
              {t('members.sendInvite')}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3">
          <Notice tone="success" title={t('members.inviteCreated')}>
            {t('members.inviteLinkText', { email: created.email })}
          </Notice>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
            <Mono className="min-w-0 flex-1 truncate">{created.link}</Mono>
            <CopyButton value={created.link ?? ''} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('login.email')} htmlFor="inv-email">
            <Input
              id="inv-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label={t('members.role')} htmlFor="inv-role">
            <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}` as TranslationKey)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="rounded-lg bg-surface-2 p-3">
            <RoleHelp />
          </div>
        </div>
      )}
    </Dialog>
  );
}

function PoliciesDialog({ member, onClose }: { member: MemberDto | null; onClose: () => void }) {
  const { t } = useI18n();
  const { org } = useOrg();
  const policies = usePolicies(org.id, !!member);
  const [selected, setSelected] = useState<string[] | null>(null);
  const current = selected ?? member?.policies.map((p) => p.id) ?? [];
  const save = useApiMutation(
    () => api.patch(`/orgs/${org.id}/members/${member!.membershipId}`, { policyIds: current }),
    {
      success: t('common.saved'),
      invalidate: [qk.members(org.id)],
      onSuccess: () => {
        setSelected(null);
        onClose();
      },
    },
  );
  return (
    <Dialog
      open={!!member}
      onOpenChange={(o) => {
        if (!o) {
          setSelected(null);
          onClose();
        }
      }}
      title={t('members.policiesFor', { name: member?.name ?? '' })}
      description={t('members.policiesText')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {policies.isPending ? (
        <LoadingBlock rows={2} />
      ) : policies.data?.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-6" />} title={t('policies.empty')} className="py-8" />
      ) : (
        <div className="space-y-2">
          {policies.data?.map((p) => (
            <label
              key={p.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2"
            >
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[var(--primary)]"
                checked={current.includes(p.id)}
                onChange={(e) =>
                  setSelected(e.target.checked ? [...current, p.id] : current.filter((id) => id !== p.id))
                }
              />
              <span>
                <span className="block text-sm font-medium">{p.name}</span>
                {p.description && <span className="block text-xs text-muted">{p.description}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </Dialog>
  );
}

export function MembersPage() {
  const { t, locale } = useI18n();
  const { org, can } = useOrg();
  const me = useMe();
  const members = useMembers(org.id);
  const invitations = useInvitations(org.id);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const [policiesFor, setPoliciesFor] = useState<MemberDto | null>(null);

  const changeRole = useApiMutation(
    ({ member, role }: { member: MemberDto; role: OrgRole }) =>
      api.patch(`/orgs/${org.id}/members/${member.membershipId}`, { role }),
    { success: t('members.roleChanged'), invalidate: [qk.members(org.id)] },
  );
  const remove = useApiMutation((m: MemberDto) => api.del(`/orgs/${org.id}/members/${m.membershipId}`), {
    success: t('members.removed'),
    invalidate: [qk.members(org.id)],
    onSuccess: () => setRemoving(null),
  });
  const revoke = useApiMutation((id: string) => api.del(`/orgs/${org.id}/invitations/${id}`), {
    success: t('members.inviteRevoked'),
    invalidate: [qk.invitations(org.id)],
  });

  return (
    <>
      <PageHeader
        title={t('nav.members')}
        description={t('members.subtitle')}
        actions={
          can('member:invite') && (
            <Button
              variant="primary"
              icon={<MailPlus className="size-4" />}
              onClick={() => setInviting(true)}
            >
              {t('members.invite')}
            </Button>
          )
        }
      />
      <div className="space-y-6">
        <Card>
          {members.isPending ? (
            <LoadingBlock />
          ) : members.isError ? (
            <div className="p-5">
              <ErrorState error={members.error} />
            </div>
          ) : members.data.length === 0 ? (
            <EmptyState icon={<Users className="size-6" />} title={t('members.empty')} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>{t('members.name')}</TH>
                  <TH>{t('members.role')}</TH>
                  <TH className="hidden md:table-cell">{t('nav.policies')}</TH>
                  <TH className="hidden lg:table-cell">{t('members.lastLogin')}</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {members.data.map((m) => {
                  const self = m.userId === me.data?.user.id;
                  return (
                    <tr key={m.membershipId}>
                      <TD>
                        <div className="font-medium">
                          {m.name}{' '}
                          {self && (
                            <span className="text-xs font-normal text-muted">({t('members.you')})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted">
                          {m.email}
                          {m.mfaEnabled && <Badge tone="success">2FA</Badge>}
                        </div>
                      </TD>
                      <TD>
                        {can('member:update') && !self ? (
                          <Select
                            value={m.role}
                            className="h-8 w-auto"
                            onChange={(e) =>
                              changeRole.mutate({ member: m, role: e.target.value as OrgRole })
                            }
                            aria-label={t('members.role')}
                          >
                            {ORG_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {t(`role.${r}` as TranslationKey)}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Badge tone={m.role === 'owner' ? 'primary' : 'neutral'}>
                            {t(`role.${m.role}` as TranslationKey)}
                          </Badge>
                        )}
                      </TD>
                      <TD className="hidden md:table-cell">
                        <div className="flex flex-wrap items-center gap-1">
                          {m.policies.map((p) => (
                            <Badge key={p.id} tone="info">
                              {p.name}
                            </Badge>
                          ))}
                          {can('member:update') && (
                            <Button size="sm" variant="ghost" onClick={() => setPoliciesFor(m)}>
                              {m.policies.length ? t('common.edit') : t('members.attachPolicy')}
                            </Button>
                          )}
                        </div>
                      </TD>
                      <TD className="hidden text-muted lg:table-cell">
                        {formatRelative(m.lastLoginAt, locale)}
                      </TD>
                      <TD className="text-right">
                        {(can('member:remove') || self) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setRemoving(m)}
                            aria-label={self ? t('members.leave') : t('members.remove')}
                          >
                            <UserMinus className="size-4" />
                          </Button>
                        )}
                      </TD>
                    </tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>

        {invitations.data && invitations.data.length > 0 && (
          <Card>
            <CardHeader title={t('members.pending')} />
            <Table>
              <TBody>
                {invitations.data.map((inv) => (
                  <tr key={inv.id}>
                    <TD className="font-medium">{inv.email}</TD>
                    <TD>
                      <Badge>{t(`role.${inv.role}` as TranslationKey)}</Badge>
                    </TD>
                    <TD className="hidden text-muted md:table-cell">
                      {t('members.expires', { when: formatRelative(inv.expiresAt, locale) })}
                    </TD>
                    <TD className="text-right">
                      {can('member:invite') && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => revoke.mutate(inv.id)}
                          aria-label={t('members.revoke')}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </div>

      <InviteDialog open={inviting} onOpenChange={setInviting} />
      <PoliciesDialog member={policiesFor} onClose={() => setPoliciesFor(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={
          removing?.userId === me.data?.user.id
            ? t('members.leaveTitle', { org: org.name })
            : t('members.removeTitle', { name: removing?.name ?? '' })
        }
        confirmLabel={removing?.userId === me.data?.user.id ? t('members.leave') : t('members.remove')}
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </>
  );
}
