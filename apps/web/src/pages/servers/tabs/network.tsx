import { useState } from 'react';
import { Pencil, ShieldCheck } from 'lucide-react';
import type { DdosSettings, IpAddress } from '@weblion/shared';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { qk, useApiMutation, useServerNetwork } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
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
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { useServerContext } from '../context';

export function NetworkTab() {
  const t = useT();
  const { server, can, has } = useServerContext();
  const network = useServerNetwork(server.id);
  const [editing, setEditing] = useState<IpAddress | null>(null);
  const [hostname, setHostname] = useState('');
  const [ddosEdit, setDdosEdit] = useState<DdosSettings | null>(null);
  const canEdit = can('server:network:update');

  const rdns = useApiMutation(
    () => api.post(`/servers/${server.id}/rdns`, { ip: editing!.address, hostname }),
    {
      success: t('network.rdnsSaved'),
      invalidate: [qk.serverSub(server.id, 'network'), qk.server(server.id)],
      onSuccess: () => setEditing(null),
    },
  );
  const ddos = useApiMutation((s: DdosSettings) => api.post(`/servers/${server.id}/ddos`, s), {
    success: t('common.saved'),
    invalidate: [qk.serverSub(server.id, 'network')],
    onSuccess: () => setDdosEdit(null),
  });

  const ips = network.data?.ips ?? server.ips;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('network.ips')} description={t('network.ipsText')} />
        {ips.length === 0 ? (
          <EmptyState title={t('overview.noIps')} description={t('network.agentHint')} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('network.address')}</TH>
                <TH>{t('network.rdns')}</TH>
                <TH className="hidden md:table-cell">{t('network.gateway')}</TH>
                <TH className="hidden lg:table-cell">{t('network.interface')}</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {ips.map((ip) => (
                <tr key={ip.address}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Badge tone={ip.version === 4 ? 'primary' : 'info'}>IPv{ip.version}</Badge>
                      <Mono className="text-text">{ip.address}</Mono>
                      <CopyButton value={ip.address} />
                    </div>
                  </TD>
                  <TD className="text-muted">{ip.rdns ?? '–'}</TD>
                  <TD className="hidden md:table-cell">
                    <Mono className="text-muted">{ip.gateway ?? '–'}</Mono>
                  </TD>
                  <TD className="hidden lg:table-cell text-muted">
                    {ip.interface ?? '–'}
                    {ip.mac && <Mono className="ml-2 text-subtle">{ip.mac}</Mono>}
                  </TD>
                  <TD className="text-right">
                    {canEdit && has('rdns') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Pencil className="size-3.5" />}
                        onClick={() => {
                          setEditing(ip);
                          setHostname(ip.rdns ?? '');
                        }}
                      >
                        rDNS
                      </Button>
                    )}
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {has('ddos') && (
        <Card>
          <CardHeader title={t('network.ddos')} description={t('network.ddosText')} />
          {network.isPending ? (
            <LoadingBlock rows={1} />
          ) : network.isError ? (
            <div className="p-5">
              <ErrorState error={network.error} />
            </div>
          ) : (network.data?.ddos.length ?? 0) === 0 ? (
            <EmptyState icon={<ShieldCheck className="size-6" />} title={t('network.ddosNone')} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>IP</TH>
                  <TH>Layer 4</TH>
                  <TH>Layer 7</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {network.data!.ddos.map((d) => (
                  <tr key={d.ip}>
                    <TD>
                      <Mono>{d.ip}</Mono>
                    </TD>
                    <TD>{d.layer4 ?? '–'}</TD>
                    <TD>{d.layer7 ?? '–'}</TD>
                    <TD className="text-right">
                      {canEdit && (
                        <Button size="sm" variant="ghost" onClick={() => setDdosEdit({ ...d })}>
                          {t('common.edit')}
                        </Button>
                      )}
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={t('network.rdnsTitle', { ip: editing?.address ?? '' })}
        description={t('network.rdnsText')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!hostname}
              loading={rdns.isPending}
              onClick={() => rdns.mutate(undefined)}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Field label={t('network.hostname')} htmlFor="rdns">
          <Input
            id="rdns"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="server.example.ch"
            className="font-mono"
            autoFocus
          />
        </Field>
      </Dialog>

      <Dialog
        open={!!ddosEdit}
        onOpenChange={(o) => !o && setDdosEdit(null)}
        title={t('network.ddos')}
        description={ddosEdit?.ip}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDdosEdit(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={ddos.isPending}
              onClick={() => ddosEdit && ddos.mutate(ddosEdit)}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        {ddosEdit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Layer 4" htmlFor="l4">
              <Select
                id="l4"
                value={ddosEdit.layer4 ?? ''}
                onChange={(e) => setDdosEdit({ ...ddosEdit, layer4: e.target.value })}
              >
                <option value="dynamic">dynamic</option>
                <option value="permanent">permanent</option>
              </Select>
            </Field>
            <Field label="Layer 7" htmlFor="l7">
              <Select
                id="l7"
                value={ddosEdit.layer7 ?? ''}
                onChange={(e) => setDdosEdit({ ...ddosEdit, layer7: e.target.value })}
              >
                <option value="on">on</option>
                <option value="off">off</option>
              </Select>
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
