import { AlertTriangle, Cable } from 'lucide-react';
import type { PhoneSystemDto, PhoneTrunk } from '@weblion/shared';
import { formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { usePhoneTrunks } from '@/lib/api/phone';
import { Tooltip } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Mono,
  Notice,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

/** Trunks tab: the SIP lines of the phone system, read only. Never shows credentials. */
export function TrunksTab({ system }: { system: PhoneSystemDto }) {
  const { t, locale } = useI18n();
  const trunks = usePhoneTrunks(system.id);
  const list = trunks.data ?? [];

  return (
    <div className="space-y-4">
      <Notice tone="info">{t('phone.trunk.note')}</Notice>
      <Card>
        <CardHeader title={t('phone.trunk.title')} description={t('phone.trunk.text')} />
        {trunks.isPending ? (
          <LoadingBlock rows={2} />
        ) : trunks.isError ? (
          <div className="p-5">
            <ErrorState error={trunks.error} onRetry={() => void trunks.refetch()} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Cable className="size-6" />}
            title={t('phone.trunk.none')}
            description={t('phone.trunk.noneText')}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('phone.trunk.col.number')}</TH>
                <TH>{t('phone.trunk.col.name')}</TH>
                <TH className="hidden lg:table-cell">{t('phone.trunk.col.host')}</TH>
                <TH>{t('phone.trunk.col.status')}</TH>
                <TH className="hidden md:table-cell">{t('phone.trunk.col.direction')}</TH>
                <TH className="hidden md:table-cell">{t('phone.trunk.col.externalNumber')}</TH>
                <TH className="hidden sm:table-cell">{t('phone.trunk.col.dids')}</TH>
                <TH className="hidden 2xl:table-cell">{t('phone.trunk.col.calls')}</TH>
              </tr>
            </THead>
            <TBody>
              {list.map((trunk) => (
                <TR key={trunk.id}>
                  <TD className="align-top whitespace-nowrap">
                    <Mono className="font-medium text-text">{trunk.number}</Mono>
                  </TD>
                  <TD className="max-w-[320px] align-top md:min-w-[220px]">
                    <span className="block truncate font-medium text-text">
                      {trunk.name ?? <span className="text-subtle">–</span>}
                    </span>
                    {trunk.host && (
                      <Mono className="block truncate text-xs text-muted lg:hidden">{trunk.host}</Mono>
                    )}
                    {trunk.configurationIssue && (
                      <span className="mt-1 flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                        <span className="break-words">
                          {t('phone.trunk.issue', { issue: trunk.configurationIssue })}
                        </span>
                      </span>
                    )}
                  </TD>
                  <TD className="hidden max-w-[220px] align-top lg:table-cell">
                    {trunk.host ? (
                      <Mono className="block truncate">{trunk.host}</Mono>
                    ) : (
                      <span className="text-subtle">–</span>
                    )}
                  </TD>
                  <TD className="align-top">
                    <TrunkStatus trunk={trunk} />
                  </TD>
                  <TD className="hidden align-top whitespace-nowrap md:table-cell">
                    {trunk.direction ? (
                      t(`phone.direction.${trunk.direction}`)
                    ) : (
                      <span className="text-subtle">–</span>
                    )}
                  </TD>
                  <TD className="hidden align-top whitespace-nowrap md:table-cell">
                    {trunk.externalNumber ? (
                      <Mono>{trunk.externalNumber}</Mono>
                    ) : (
                      <span className="text-subtle">–</span>
                    )}
                  </TD>
                  <TD className="hidden align-top tabular sm:table-cell">
                    {formatNumber(trunk.didCount, locale)}
                  </TD>
                  <TD className="hidden align-top tabular 2xl:table-cell">
                    {trunk.simultaneousCalls !== null ? (
                      formatNumber(trunk.simultaneousCalls, locale)
                    ) : (
                      <span className="text-subtle">–</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/** Online or offline; the PBX's configuration problem on hover. */
function TrunkStatus({ trunk }: { trunk: PhoneTrunk }) {
  const { t } = useI18n();
  if (trunk.online === null) return <span className="text-subtle">–</span>;
  const badge = (
    <Badge tone={trunk.online ? 'success' : 'danger'}>
      {trunk.online ? t('phone.trunk.online') : t('phone.trunk.offline')}
    </Badge>
  );
  if (!trunk.configurationIssue) return badge;
  return (
    <Tooltip content={trunk.configurationIssue}>
      <span tabIndex={0}>{badge}</span>
    </Tooltip>
  );
}
