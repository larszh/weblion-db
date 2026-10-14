import { Link } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useOptionalOrg } from '@/lib/org-context';
import { useRelatedMonitors } from '@/lib/api/monitoring';
import { Card, CardHeader } from '@/components/ui/primitives';
import { MonitorStatusBadge, formatResponse, formatUptime } from './bits';

/**
 * Monitors of the same organization that target a server (its IP addresses and rDNS names) or a
 * domain (the name or one of its subdomains), with status, uptime and response time. Rendered on
 * the server overview tab and the domain overview; shows nothing unless the organization has the
 * "monitoring" module, the user has monitor:read and a monitor matches.
 */
export function RelatedMonitorsCard({ kind, id }: { kind: 'server' | 'domain'; id: string }) {
  const { t, locale } = useI18n();
  const orgCtx = useOptionalOrg();
  const enabled = !!orgCtx && orgCtx.hasModule('monitoring') && orgCtx.can('monitor:read');
  const related = useRelatedMonitors(kind, id, enabled);
  const monitors = related.data ?? [];
  if (!enabled || !orgCtx || monitors.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title={t('uptime.related.title')}
        description={kind === 'server' ? t('uptime.related.server') : t('uptime.related.domain')}
        actions={
          <Link
            to={`${orgCtx.base}/monitoring`}
            className="text-sm font-medium text-primary-text hover:underline"
          >
            {t('uptime.related.all')}
          </Link>
        }
      />
      <ul className="divide-y divide-border">
        {monitors.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
            <MonitorStatusBadge status={m.status} className="w-28 shrink-0" />
            <div className="min-w-0 flex-1">
              <Link
                to={`${orgCtx.base}/monitoring/${m.id}`}
                className="block truncate text-sm font-medium text-text hover:underline"
              >
                {m.name}
              </Link>
              {m.target && <div className="truncate font-mono text-xs text-muted">{m.target}</div>}
            </div>
            <div className="text-right text-xs text-muted tabular">
              <div>
                {t('uptime.uptime24h')}{' '}
                <span className="font-medium text-text">{formatUptime(m.facts?.uptime24h, locale)}</span>
              </div>
              <div>{formatResponse(m.facts?.responseMs, locale)}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
