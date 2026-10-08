import { useState } from 'react';
import { Plus, Shield, Trash2 } from 'lucide-react';
import type { FirewallRule } from '@weblion/shared';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { qk, useApiMutation, useFirewall } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
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
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { useServerContext } from '../context';

type Draft = Omit<FirewallRule, 'pos'>;
/** Proxmox only takes ports together with one of these protocols. */
const hasPorts = (protocol: string | null | undefined) => protocol === 'tcp' || protocol === 'udp';
const EMPTY: Draft = {
  direction: 'in',
  action: 'ACCEPT',
  enabled: true,
  protocol: 'tcp',
  dport: '',
  source: '',
  comment: '',
};

export function FirewallTab() {
  const t = useT();
  const { server, can } = useServerContext();
  const firewall = useFirewall(server.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const keys = [qk.serverSub(server.id, 'firewall')];
  const canWrite = can('server:firewall:write');

  const toggle = useApiMutation(
    (enabled: boolean) => api.post(`/servers/${server.id}/firewall/enabled`, { enabled }),
    {
      success: (_r, enabled) => (enabled ? t('firewall.enabled') : t('firewall.disabled')),
      invalidate: keys,
    },
  );
  const add = useApiMutation(
    (rule: Draft) =>
      api.post(`/servers/${server.id}/firewall/rules`, {
        ...rule,
        protocol: rule.protocol || null,
        dport: rule.dport || null,
        source: rule.source || null,
        comment: rule.comment || null,
      }),
    { success: t('firewall.ruleAdded'), invalidate: keys, onSuccess: () => setDraft(null) },
  );
  const remove = useApiMutation((pos: number) => api.del(`/servers/${server.id}/firewall/rules/${pos}`), {
    success: t('firewall.ruleDeleted'),
    invalidate: keys,
  });

  if (firewall.isPending) return <LoadingBlock />;
  if (firewall.isError) return <ErrorState error={firewall.error} onRetry={() => void firewall.refetch()} />;
  const fw = firewall.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('tab.firewall')}
          description={t('firewall.policy', { in: fw.policyIn ?? '–', out: fw.policyOut ?? '–' })}
          actions={
            <>
              <label className="flex items-center gap-2 text-sm">
                {fw.enabled ? t('firewall.on') : t('firewall.off')}
                <Switch
                  checked={fw.enabled}
                  onCheckedChange={(v) => toggle.mutate(v)}
                  disabled={!canWrite || toggle.isPending}
                  label={t('tab.firewall')}
                />
              </label>
              {canWrite && (
                <Button
                  variant="primary"
                  icon={<Plus className="size-4" />}
                  onClick={() => setDraft({ ...EMPTY })}
                >
                  {t('firewall.addRule')}
                </Button>
              )}
            </>
          }
        />
        {!fw.enabled && (
          <div className="px-5 pt-4">
            <Notice tone="warning">{t('firewall.offHint')}</Notice>
          </div>
        )}
        {fw.rules.length === 0 ? (
          <EmptyState icon={<Shield className="size-6" />} title={t('firewall.empty')} />
        ) : (
          <Table className="mt-2">
            <THead>
              <tr>
                <TH>#</TH>
                <TH>{t('firewall.direction')}</TH>
                <TH>{t('firewall.action')}</TH>
                <TH>{t('firewall.protocol')}</TH>
                <TH>{t('firewall.port')}</TH>
                <TH className="hidden md:table-cell">{t('firewall.source')}</TH>
                <TH className="hidden lg:table-cell">{t('firewall.comment')}</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {fw.rules.map((r) => (
                <tr key={r.pos} className={r.enabled ? '' : 'opacity-50'}>
                  <TD className="text-muted tabular">{r.pos}</TD>
                  <TD>
                    <Badge tone="neutral">
                      {r.direction === 'in' ? t('firewall.inbound') : t('firewall.outbound')}
                    </Badge>
                  </TD>
                  <TD>
                    <Badge tone={r.action === 'ACCEPT' ? 'success' : 'danger'}>{r.action}</Badge>
                  </TD>
                  <TD>{r.protocol ?? t('firewall.any')}</TD>
                  <TD>
                    <Mono>{r.dport || t('firewall.any')}</Mono>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <Mono className="text-muted">{r.source || t('firewall.any')}</Mono>
                  </TD>
                  <TD className="hidden max-w-[220px] truncate text-muted lg:table-cell">
                    {r.comment ?? ''}
                  </TD>
                  <TD className="text-right">
                    {canWrite && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => remove.mutate(r.pos)}
                        aria-label={t('common.delete')}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={!!draft}
        onOpenChange={(o) => !o && setDraft(null)}
        title={t('firewall.addRule')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={add.isPending} onClick={() => draft && add.mutate(draft)}>
              {t('firewall.addRule')}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('firewall.direction')} htmlFor="fw-dir">
              <Select
                id="fw-dir"
                value={draft.direction}
                onChange={(e) => setDraft({ ...draft, direction: e.target.value as 'in' | 'out' })}
              >
                <option value="in">{t('firewall.inbound')}</option>
                <option value="out">{t('firewall.outbound')}</option>
              </Select>
            </Field>
            <Field label={t('firewall.action')} htmlFor="fw-action">
              <Select
                id="fw-action"
                value={draft.action}
                onChange={(e) => setDraft({ ...draft, action: e.target.value as Draft['action'] })}
              >
                <option value="ACCEPT">ACCEPT</option>
                <option value="DROP">DROP</option>
                <option value="REJECT">REJECT</option>
              </Select>
            </Field>
            <Field label={t('firewall.protocol')} htmlFor="fw-proto">
              <Select
                id="fw-proto"
                value={draft.protocol ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    protocol: e.target.value,
                    dport: hasPorts(e.target.value) ? draft.dport : '',
                  })
                }
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
                <option value="">{t('firewall.any')}</option>
              </Select>
            </Field>
            <Field
              label={t('firewall.port')}
              hint={hasPorts(draft.protocol) ? t('firewall.portHint') : t('firewall.portNeedsProtocol')}
              htmlFor="fw-port"
            >
              <Input
                id="fw-port"
                value={draft.dport ?? ''}
                onChange={(e) => setDraft({ ...draft, dport: e.target.value })}
                placeholder={hasPorts(draft.protocol) ? '22,80,443' : t('firewall.any')}
                disabled={!hasPorts(draft.protocol)}
                className="font-mono"
              />
            </Field>
            <Field
              label={t('firewall.source')}
              hint={t('firewall.sourceHint')}
              htmlFor="fw-src"
              className="sm:col-span-2"
            >
              <Input
                id="fw-src"
                value={draft.source ?? ''}
                onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                placeholder="203.0.113.0/24"
                className="font-mono"
              />
            </Field>
            <Field label={t('firewall.comment')} htmlFor="fw-comment" className="sm:col-span-2">
              <Input
                id="fw-comment"
                value={draft.comment ?? ''}
                onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
                maxLength={200}
              />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
