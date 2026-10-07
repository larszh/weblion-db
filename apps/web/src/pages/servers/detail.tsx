import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ChevronLeft, Lock, Monitor } from 'lucide-react';
import type { Capability, Permission } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useServer } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import { CopyButton, ErrorState, LoadingBlock, Mono, Spinner } from '@/components/ui/primitives';
import { Flag, KindIcon, LabelChips, ProviderBadge, SpecsLine, StatusLabel } from '@/components/server-bits';
import { Tooltip } from '@/components/ui/menu';
import { primaryIp } from '@/components/server-table';
import { ServerProvider, useServerContext } from './context';
import { PowerControl, PowerTab } from './power';
import { OverviewTab } from './tabs/overview';
import { GraphsTab } from './tabs/graphs';
import { BackupsTab } from './tabs/backups';
import { SnapshotsTab } from './tabs/snapshots';
import { NetworkTab } from './tabs/network';
import { FirewallTab } from './tabs/firewall';
import { IsoTab } from './tabs/iso';
import { RescaleTab } from './tabs/rescale';
import { RebuildTab } from './tabs/rebuild';
import { ActivityTab } from './tabs/activity';
import { SettingsTab } from './tabs/settings';
import { DeleteTab } from './tabs/delete';

// noVNC is large, only load it when somebody opens a console.
const ConsoleDialog = lazy(() => import('./console').then((m) => ({ default: m.ConsoleDialog })));

interface TabDef {
  path: string;
  label: TranslationKey;
  element: ReactNode;
  capability?: Capability;
  permission?: Permission;
  anyPermission?: Permission[];
  danger?: boolean;
}

const TABS: TabDef[] = [
  { path: '', label: 'tab.overview', element: <OverviewTab /> },
  {
    path: 'graphs',
    label: 'tab.graphs',
    element: <GraphsTab />,
    capability: 'metrics',
    permission: 'server:metrics',
  },
  {
    path: 'backups',
    label: 'tab.backups',
    element: <BackupsTab />,
    capability: 'backups',
    permission: 'server:backup:read',
  },
  {
    path: 'snapshots',
    label: 'tab.snapshots',
    element: <SnapshotsTab />,
    capability: 'snapshots',
    permission: 'server:snapshot:read',
  },
  { path: 'networking', label: 'tab.networking', element: <NetworkTab />, permission: 'server:network:read' },
  {
    path: 'firewall',
    label: 'tab.firewall',
    element: <FirewallTab />,
    capability: 'firewall',
    permission: 'server:firewall:read',
  },
  {
    path: 'power',
    label: 'tab.power',
    element: <PowerTab />,
    capability: 'power',
    permission: 'server:power',
  },
  { path: 'iso', label: 'tab.iso', element: <IsoTab />, capability: 'iso', permission: 'server:iso' },
  {
    path: 'rescale',
    label: 'tab.rescale',
    element: <RescaleTab />,
    capability: 'rescale',
    permission: 'server:rescale',
  },
  {
    path: 'rebuild',
    label: 'tab.rebuild',
    element: <RebuildTab />,
    capability: 'rebuild',
    permission: 'server:rebuild',
  },
  { path: 'activity', label: 'tab.activity', element: <ActivityTab />, permission: 'server:task:read' },
  {
    path: 'settings',
    label: 'tab.settings',
    element: <SettingsTab />,
    anyPermission: [
      'server:rename',
      'server:labels',
      'server:protection',
      'server:move',
      'server:config:read',
    ],
  },
  {
    path: 'delete',
    label: 'tab.delete',
    element: <DeleteTab />,
    capability: 'delete',
    permission: 'server:delete',
    danger: true,
  },
];

function visibleTabs(can: (p: Permission) => boolean, has: (c: Capability) => boolean) {
  return TABS.filter(
    (tab) =>
      (!tab.capability || has(tab.capability)) &&
      (!tab.permission || can(tab.permission)) &&
      (!tab.anyPermission || tab.anyPermission.some(can)),
  );
}

function ServerHeader() {
  const t = useT();
  const { server, allowed } = useServerContext();
  const [consoleOpen, setConsoleOpen] = useState(false);
  const ipv4 = primaryIp(server);
  const ipv6 = primaryIp(server, 6);

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <KindIcon kind={server.kind} className="size-5" />
            <h1 className="font-display truncate text-2xl font-semibold tracking-tight text-text">
              {server.name}
            </h1>
            <StatusLabel status={server.status} />
            {(server.protection.delete || server.protection.rebuild) && (
              <Tooltip content={t('server.protected')}>
                <Lock className="size-4 text-warning" />
              </Tooltip>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
            {ipv4 && (
              <span className="inline-flex items-center gap-1">
                <Mono className="text-text">{ipv4}</Mono>
                <CopyButton value={ipv4} />
              </span>
            )}
            {ipv6 && (
              <span className="hidden items-center gap-1 md:inline-flex">
                <Mono>{ipv6}</Mono>
                <CopyButton value={ipv6} />
              </span>
            )}
            <span className="inline-flex items-center gap-2">
              <Flag country={server.location.country} />
              {server.location.city ?? server.location.label}
            </span>
            <ProviderBadge type={server.provider.type} name={server.provider.name} />
            <SpecsLine specs={server.specs} />
          </div>
          <LabelChips labels={server.labels} max={8} className="mt-2" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allowed('console', 'server:console') && (
            <Button
              icon={<Monitor className="size-4" />}
              onClick={() => setConsoleOpen(true)}
              disabled={server.status !== 'running'}
            >
              {t('server.console')}
            </Button>
          )}
          <PowerControl />
        </div>
      </div>
      {consoleOpen && (
        <Suspense fallback={<Spinner />}>
          <ConsoleDialog open={consoleOpen} onOpenChange={setConsoleOpen} server={server} />
        </Suspense>
      )}
    </div>
  );
}

function TabNav() {
  const t = useT();
  const { can, has, server } = useServerContext();
  const { base } = useOrg();
  const root = `${base}/servers/${server.id}`;
  return (
    <div className="mb-6 overflow-x-auto border-b border-border">
      <nav className="-mb-px flex min-w-max gap-1" aria-label={t('tab.label')}>
        {visibleTabs(can, has).map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path ? `${root}/${tab.path}` : root}
            end={tab.path === ''}
            className={({ isActive }) =>
              cn(
                'border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                isActive
                  ? tab.danger
                    ? 'border-danger text-danger'
                    : 'border-brand-blue text-primary-text'
                  : 'border-transparent text-muted hover:border-border-strong hover:text-text',
              )
            }
          >
            {t(tab.label)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function ServerTabs() {
  const { can, has } = useServerContext();
  return (
    <Routes>
      {visibleTabs(can, has).map((tab) =>
        tab.path === '' ? (
          <Route key="index" index element={tab.element} />
        ) : (
          <Route key={tab.path} path={tab.path} element={tab.element} />
        ),
      )}
      <Route path="*" element={<Navigate to=".." replace />} />
    </Routes>
  );
}

export function ServerDetailPage() {
  const t = useT();
  const { serverId } = useParams();
  const { base } = useOrg();
  const server = useServer(serverId);

  return (
    <>
      <Link
        to={`${base}/servers`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.servers')}
      </Link>
      {server.isPending ? (
        <LoadingBlock rows={6} />
      ) : server.isError || !server.data ? (
        <ErrorState error={server.error} onRetry={() => void server.refetch()} />
      ) : (
        <ServerProvider server={server.data}>
          <ServerHeader />
          <TabNav />
          <ServerTabs />
        </ServerProvider>
      )}
    </>
  );
}
