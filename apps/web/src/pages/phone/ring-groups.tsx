import { useState } from 'react';
import { PhoneForwarded, Plus, X } from 'lucide-react';
import type { PhoneRingGroup, PhoneSystemDto } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { usePhoneRingGroups, usePhoneUsers } from '@/lib/api/phone';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Mono,
  Notice,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { memberLabel } from './bits';
import { AddRingGroupMemberDialog, RemoveRingGroupMemberDialog } from './dialogs';

/**
 * Ring groups tab: members in ring order, add and remove members. Strategies, times and new
 * groups are set up in the 3CX web client.
 */

type Pending =
  { kind: 'add'; group: PhoneRingGroup } | { kind: 'remove'; group: PhoneRingGroup; number: string } | null;

export function RingGroupsTab({ system }: { system: PhoneSystemDto }) {
  const { t } = useI18n();
  const groups = usePhoneRingGroups(system.id);
  const canEdit =
    system.permissions.includes('phone:write') && system.capabilities.includes('ringGroupMembers');
  // Users name the members and are the ones that can join; the same list as the users tab.
  const users = usePhoneUsers(system.id, system.capabilities.includes('users'));
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);
  const list = groups.data ?? [];

  return (
    <div className="space-y-4">
      <Notice tone="info">{t('phone.ringGroup.note')}</Notice>
      <Card>
        <CardHeader title={t('phone.ringGroup.title')} description={t('phone.ringGroup.text')} />
        {groups.isPending ? (
          <LoadingBlock rows={3} />
        ) : groups.isError ? (
          <div className="p-5">
            <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<PhoneForwarded className="size-6" />}
            title={t('phone.ringGroup.none')}
            description={t('phone.ringGroup.noneText')}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('phone.ringGroup.col.number')}</TH>
                <TH>{t('phone.ringGroup.col.name')}</TH>
                <TH className="hidden md:table-cell">{t('phone.ringGroup.col.strategy')}</TH>
                <TH className="hidden md:table-cell">{t('phone.ringGroup.col.ringTime')}</TH>
                <TH>{t('phone.ringGroup.col.members')}</TH>
              </tr>
            </THead>
            <TBody>
              {list.map((g) => (
                <TR key={g.id}>
                  <TD className="align-top whitespace-nowrap">
                    <Mono className="font-medium text-text">{g.number}</Mono>
                  </TD>
                  <TD className="align-top">
                    <span className="font-medium text-text">
                      {g.name ?? <span className="text-subtle">–</span>}
                    </span>
                    {/* Strategy and time move below the name on narrow screens. */}
                    <div className="mt-0.5 text-xs text-muted md:hidden">
                      {[
                        g.strategy ? t(`phone.strategy.${g.strategy}`) : null,
                        g.ringTimeSeconds !== null
                          ? t('phone.ringGroup.seconds', { n: g.ringTimeSeconds })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </TD>
                  <TD className="hidden align-top whitespace-nowrap md:table-cell">
                    {g.strategy ? t(`phone.strategy.${g.strategy}`) : <span className="text-subtle">–</span>}
                  </TD>
                  <TD className="hidden align-top whitespace-nowrap tabular md:table-cell">
                    {g.ringTimeSeconds !== null ? (
                      t('phone.ringGroup.seconds', { n: g.ringTimeSeconds })
                    ) : (
                      <span className="text-subtle">–</span>
                    )}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {g.members.length === 0 && (
                        <span className="text-sm text-subtle">{t('phone.ringGroup.noMembers')}</span>
                      )}
                      {g.members.map((m) => {
                        const label = memberLabel(m, users.data?.users);
                        return (
                          <span
                            key={m.number}
                            className="inline-flex items-center gap-1 rounded-md bg-surface-3 py-0.5 pr-1 pl-2 text-xs font-medium text-text"
                          >
                            {label}
                            {canEdit && (
                              <button
                                type="button"
                                className="rounded p-0.5 text-subtle hover:bg-surface hover:text-danger"
                                onClick={() => setPending({ kind: 'remove', group: g, number: m.number })}
                                aria-label={t('phone.ringGroup.removeMember', { member: label })}
                                title={t('phone.ringGroup.removeMember', { member: label })}
                              >
                                <X className="size-3" />
                              </button>
                            )}
                          </span>
                        );
                      })}
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Plus className="size-3.5" />}
                          className="h-7"
                          // The dialog offers the users that are not members yet.
                          disabled={!users.data}
                          onClick={() => setPending({ kind: 'add', group: g })}
                        >
                          {t('phone.ringGroup.addMember')}
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {pending?.kind === 'add' && users.data && (
        <AddRingGroupMemberDialog
          key={pending.group.id}
          system={system}
          group={pending.group}
          users={users.data.users}
          onClose={close}
        />
      )}
      {pending?.kind === 'remove' && (
        <RemoveRingGroupMemberDialog
          key={`${pending.group.id}-${pending.number}`}
          system={system}
          group={pending.group}
          number={pending.number}
          users={users.data?.users}
          onClose={close}
        />
      )}
    </div>
  );
}
