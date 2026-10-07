import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ServerDto } from '@weblion/shared';
import { useT } from '@/lib/i18n';
import { formatPercent } from '@/lib/format';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { CopyButton, Mono, UsageBar } from '@/components/ui/primitives';
import { Flag, KindIcon, LabelChips, ProviderBadge, SpecsLine, StatusDot } from './server-bits';
import { Tooltip } from './ui/menu';
import type { TranslationKey } from '@/i18n/de';

export function primaryIp(server: ServerDto, version: 4 | 6 = 4): string | null {
  return server.ips.find((ip) => ip.version === version)?.address ?? null;
}

export function ServerTable({
  servers,
  showProject = true,
  showOrg = false,
  linkFor,
  actions,
}: {
  servers: ServerDto[];
  showProject?: boolean;
  showOrg?: boolean;
  linkFor?: (server: ServerDto) => string | null;
  actions?: (server: ServerDto) => ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <Table>
      <THead>
        <tr>
          <TH>{t('servers.col.name')}</TH>
          <TH>{t('servers.col.ip')}</TH>
          <TH className="hidden md:table-cell">{t('servers.col.location')}</TH>
          <TH className="hidden xl:table-cell">{t('servers.col.specs')}</TH>
          <TH className="hidden lg:table-cell">{t('servers.col.cpu')}</TH>
          {showOrg && <TH>{t('servers.col.customer')}</TH>}
          {showProject && <TH className="hidden md:table-cell">{t('servers.col.project')}</TH>}
          {actions && <TH className="text-right" />}
        </tr>
      </THead>
      <TBody>
        {servers.map((s) => {
          const ip = primaryIp(s) ?? primaryIp(s, 6);
          const link = linkFor?.(s) ?? null;
          return (
            <TR key={s.id} onClick={link ? () => navigate(link) : undefined}>
              <TD>
                <div className="flex items-center gap-3">
                  <Tooltip content={t(`status.${s.status}` as TranslationKey)}>
                    <span className="inline-flex">
                      <StatusDot status={s.status} />
                    </span>
                  </Tooltip>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <KindIcon kind={s.kind} className="size-3.5" />
                      <span className="truncate font-medium text-text">{s.name}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <ProviderBadge type={s.provider.type} name={s.provider.name} />
                      <span className="truncate text-xs text-subtle">{s.os ?? '–'}</span>
                    </div>
                    <LabelChips labels={s.labels} max={3} className="mt-1" />
                  </div>
                </div>
              </TD>
              <TD>
                {ip ? (
                  <span className="inline-flex items-center gap-1">
                    <Mono>{ip}</Mono>
                    <CopyButton value={ip} />
                  </span>
                ) : (
                  <span className="text-subtle">–</span>
                )}
              </TD>
              <TD className="hidden md:table-cell">
                <span className="inline-flex items-center gap-2 text-sm">
                  <Flag country={s.location.country} />
                  <span className="truncate">{s.location.city ?? s.location.label}</span>
                </span>
              </TD>
              <TD className="hidden xl:table-cell">
                <SpecsLine specs={s.specs} />
              </TD>
              <TD className="hidden w-36 lg:table-cell">
                {s.usage?.cpuPercent !== undefined && s.status === 'running' ? (
                  <div className="space-y-1">
                    <span className="text-xs text-muted tabular">{formatPercent(s.usage.cpuPercent)}</span>
                    <UsageBar value={s.usage.cpuPercent} />
                  </div>
                ) : (
                  <span className="text-subtle">–</span>
                )}
              </TD>
              {showOrg && (
                <TD className="text-sm">
                  {s.org?.name ?? <span className="text-warning">{t('servers.unassigned')}</span>}
                </TD>
              )}
              {showProject && (
                <TD className="hidden text-sm text-muted md:table-cell">{s.project?.name ?? '–'}</TD>
              )}
              {actions && (
                <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                  {actions(s)}
                </TD>
              )}
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
