import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Cpu,
  Database,
  Eraser,
  Globe,
  HardDrive,
  KeyRound,
  ListTree,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react';
import {
  wwwCounterpart,
  type Permission,
  type WebsiteDatabaseDto,
  type WebspaceDetailDto,
} from '@weblion/shared';
import { formatBytes, formatDate, formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useMe } from '@/lib/queries';
import { hostingKeys } from '@/lib/api/hosting';
import { useWebsiteDnsCheck, useWebsiteOptions } from '@/lib/api/websites';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuSeparator, Tooltip } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingBlock,
  Mono,
  Notice,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ProviderBadge } from '@/components/server-bits';
import { PanelLink } from './bits';
import {
  CertificateText,
  CopyValue,
  DnsCheckTable,
  ExpectedDnsTable,
  InstanceLocation,
  WebsiteStatusBadges,
  WebsiteTypeBadge,
  allowanceRoom,
  asciiDomain,
  certificateState,
  sftpUrl,
  sshCommand,
  sshTunnelCommand,
  usageText,
  websiteTypeLabel,
  websiteUrl,
} from './website-bits';
import {
  CertificateDialog,
  CreateDatabaseDialog,
  DatabasePasswordDialog,
  DeleteDatabaseDialog,
  DeleteWebsiteDialog,
  ForgetWebsiteDialog,
  SitePasswordDialog,
} from './website-dialogs';

/**
 * One website (/o/:slug/webhosting/:webspaceId, kind "website"): access, runtime, certificate,
 * DNS, databases, usage and the danger zone. Changes need an active website that the server
 * still lists; the API refuses everything else, so the buttons explain why they are off.
 */

type ViewDialog =
  | { kind: 'password' }
  | { kind: 'certificate' }
  | { kind: 'delete' }
  | { kind: 'forget' }
  | { kind: 'createDatabase' }
  | { kind: 'databasePassword'; database: WebsiteDatabaseDto }
  | { kind: 'deleteDatabase'; database: WebsiteDatabaseDto };

/** While the server creates or deletes, the page asks again this often. */
const BUSY_REFRESH_MS = 15_000;

export function WebsiteView({ website }: { website: WebspaceDetailDto }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { org, base, hasModule } = useOrg();
  const me = useMe();
  const [dialog, setDialog] = useState<ViewDialog | null>(null);
  const can = (permission: Permission) => website.permissions.includes(permission);
  const staffCanForget =
    (me.data?.platformPermissions ?? []).includes('platform:website:write') &&
    (!website.org || !!website.missingSince);
  const active = website.status === 'active' && !website.missingSince;
  const inactiveReason = active
    ? null
    : website.missingSince
      ? t('websites.detail.offMissing')
      : website.status === 'error'
        ? t('websites.detail.offError')
        : t('websites.detail.offBusy');
  // Like the API: active websites, and for platform staff also those whose last change failed.
  // A website the server no longer lists is removed from the console instead (forget).
  const deleteBlocked =
    active || (website.status === 'error' && !website.missingSince && org.access === 'staff')
      ? null
      : inactiveReason;
  const site = website.site;
  const ascii = asciiDomain(website.name);
  const ip = website.resources?.ipAddress ?? null;

  // The server finishes creating or deleting on its own; the sync or the answer changes the status.
  const busy = website.status === 'creating' || website.status === 'deleting';
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => void qc.invalidateQueries({ queryKey: hostingKeys.webspace(website.id) }),
      BUSY_REFRESH_MS,
    );
    return () => clearInterval(timer);
  }, [busy, qc, website.id]);

  const close = () => setDialog(null);
  const menu: ReactNode[] = [];
  if (can('webspace:credentials')) {
    menu.push(
      <MenuItem
        key="password"
        icon={<KeyRound />}
        disabled={!active}
        hint={inactiveReason ?? undefined}
        onSelect={() => setDialog({ kind: 'password' })}
      >
        {t('websites.access.newPassword')}
      </MenuItem>,
    );
  }
  if (can('webspace:write')) {
    menu.push(
      <MenuItem
        key="certificate"
        icon={<ShieldCheck />}
        disabled={!active}
        hint={inactiveReason ?? undefined}
        onSelect={() => setDialog({ kind: 'certificate' })}
      >
        {t('websites.ssl.issueShort')}
      </MenuItem>,
    );
  }
  if (staffCanForget || can('webspace:delete')) {
    if (menu.length > 0) menu.push(<MenuSeparator key="sep" />);
    if (staffCanForget) {
      menu.push(
        <MenuItem key="forget" icon={<Eraser />} onSelect={() => setDialog({ kind: 'forget' })}>
          {t('websites.admin.forget')}
        </MenuItem>,
      );
    }
    if (can('webspace:delete')) {
      menu.push(
        <MenuItem
          key="delete"
          icon={<Trash2 />}
          danger
          disabled={!!deleteBlocked}
          hint={deleteBlocked ?? undefined}
          onSelect={() => setDialog({ kind: 'delete' })}
        >
          {t('websites.delete.action')}
        </MenuItem>,
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Globe className="size-5 text-muted" aria-hidden />
            <h1 className="font-display truncate text-2xl font-semibold tracking-tight text-text">
              {website.name}
            </h1>
            <WebsiteStatusBadges website={website} />
            <WebsiteTypeBadge site={site} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
            {ascii !== website.name && <Mono>{ascii}</Mono>}
            <InstanceLocation location={website.location} />
            <ProviderBadge type={website.provider.type} name={website.provider.name} />
            {ip && (
              <span className="inline-flex items-center gap-1">
                <Mono className="text-text">{ip}</Mono>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PanelLink href={websiteUrl(website.name)} variant="secondary">
            {t('websites.detail.open')}
          </PanelLink>
          {menu.length > 0 && (
            <Menu
              trigger={
                <Button variant="ghost" size="icon" aria-label={t('common.actions')}>
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            >
              {menu}
            </Menu>
          )}
        </div>
      </div>

      <WebsiteNotices
        website={website}
        canReset={can('webspace:credentials') && active}
        onReset={() => setDialog({ kind: 'password' })}
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <AccessCard
          website={website}
          canReset={can('webspace:credentials')}
          inactiveReason={inactiveReason}
          onReset={() => setDialog({ kind: 'password' })}
        />
        <div className="space-y-6">
          <RuntimeCard website={website} />
          <CertificateCard
            website={website}
            canIssue={can('webspace:write')}
            inactiveReason={inactiveReason}
            onIssue={() => setDialog({ kind: 'certificate' })}
          />
        </div>
      </div>

      <DnsCard website={website} base={base} />

      <DatabasesCard
        website={website}
        orgId={org.id}
        limited={org.access !== 'staff'}
        inactiveReason={inactiveReason}
        onCreate={() => setDialog({ kind: 'createDatabase' })}
        onPassword={(database) => setDialog({ kind: 'databasePassword', database })}
        onDelete={(database) => setDialog({ kind: 'deleteDatabase', database })}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <UsageCard website={website} />
        <Card>
          <CardHeader title={<CardTitle icon={<Archive />}>{t('websites.backup.title')}</CardTitle>} />
          <CardBody className="text-sm text-muted">{t('websites.backup.text')}</CardBody>
        </Card>
        <Card>
          <CardHeader title={<CardTitle icon={<Mail />}>{t('websites.mail.title')}</CardTitle>} />
          <CardBody className="space-y-2 text-sm text-muted">
            <p>{t('websites.mail.text', { domain: website.name })}</p>
            <p>{t('websites.mail.smtp')}</p>
            {hasModule('mail') && (
              <Link
                to={`${base}/mail`}
                className="inline-block font-medium text-primary-text hover:underline"
              >
                {t('websites.mail.link')}
              </Link>
            )}
          </CardBody>
        </Card>
      </div>

      {(can('webspace:delete') || staffCanForget) && (
        <Card className="border-danger/40">
          <CardHeader title={t('websites.delete.zone')} description={t('websites.delete.zoneText')} />
          <CardBody className="flex flex-wrap items-center gap-3">
            {can('webspace:delete') && deleteBlocked && (
              <p className="w-full text-xs text-muted">{deleteBlocked}</p>
            )}
            {can('webspace:delete') && (
              <Button
                variant="danger-soft"
                icon={<Trash2 className="size-4" />}
                disabled={!!deleteBlocked}
                title={deleteBlocked ?? undefined}
                onClick={() => setDialog({ kind: 'delete' })}
              >
                {t('websites.delete.action')}
              </Button>
            )}
            {staffCanForget && (
              <Button
                variant="outline"
                icon={<Eraser className="size-4" />}
                onClick={() => setDialog({ kind: 'forget' })}
              >
                {t('websites.admin.forget')}
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      <p className="text-xs text-muted">
        {t('websites.detail.synced', {
          when: website.lastSyncedAt ? formatRelative(website.lastSyncedAt, locale) : '–',
          created: formatDate(site?.createdAt ?? website.createdAt, locale, false),
        })}
      </p>

      {dialog?.kind === 'password' && <SitePasswordDialog website={website} onClose={close} />}
      {dialog?.kind === 'certificate' && <CertificateDialog website={website} onClose={close} />}
      {dialog?.kind === 'createDatabase' && <CreateDatabaseDialog website={website} onClose={close} />}
      {dialog?.kind === 'databasePassword' && (
        <DatabasePasswordDialog website={website} database={dialog.database} onClose={close} />
      )}
      {dialog?.kind === 'deleteDatabase' && (
        <DeleteDatabaseDialog website={website} database={dialog.database} onClose={close} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteWebsiteDialog
          website={website}
          onClose={close}
          onDeleted={() => navigate(`${base}/webhosting`, { replace: true })}
        />
      )}
      {dialog?.kind === 'forget' && (
        <ForgetWebsiteDialog
          website={website}
          onClose={close}
          onDone={() =>
            navigate(website.org ? `${base}/webhosting` : '/admin/hosting?tab=webspaces', { replace: true })
          }
        />
      )}
    </div>
  );
}

function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-muted [&>svg]:size-4" aria-hidden>
        {icon}
      </span>
      {children}
    </span>
  );
}

/** Live error, lost credentials, unfinished changes, missing on the server. */
function WebsiteNotices({
  website,
  canReset,
  onReset,
}: {
  website: WebspaceDetailDto;
  canReset: boolean;
  onReset: () => void;
}) {
  const { t, locale } = useI18n();
  return (
    <>
      {website.liveError && (
        <Notice tone="warning" title={t('hosting.liveError.title')}>
          {t('hosting.liveError.text', { provider: website.provider.name })}
          <span className="mt-1 block font-mono text-xs break-words">{website.liveError}</span>
        </Notice>
      )}
      {website.missingSince && (
        <Notice tone="danger" title={t('websites.detail.missingTitle')}>
          {t('websites.detail.missingText', { date: formatDate(website.missingSince, locale) })}
        </Notice>
      )}
      {website.status === 'creating' && (
        <Notice
          tone="info"
          icon={<RefreshCw className="size-4 animate-spin" />}
          title={t('websites.status.creating')}
        >
          {t('websites.detail.creatingText')}
        </Notice>
      )}
      {website.status === 'deleting' && (
        <Notice
          tone="info"
          icon={<RefreshCw className="size-4 animate-spin" />}
          title={t('websites.status.deleting')}
        >
          {t('websites.detail.deletingText')}
        </Notice>
      )}
      {website.status === 'error' && (
        <Notice tone="danger" title={t('websites.detail.errorTitle')}>
          {t('websites.detail.errorText')}
        </Notice>
      )}
      {website.credentialsPending && website.status !== 'error' && (
        <Notice tone="warning" title={t('websites.detail.credentialsPendingTitle')}>
          {t('websites.detail.credentialsPending')}
          {canReset && (
            <Button
              size="sm"
              className="mt-2 block"
              icon={<KeyRound className="size-3.5" />}
              onClick={onReset}
            >
              {t('websites.access.newPassword')}
            </Button>
          )}
        </Notice>
      )}
    </>
  );
}

function AccessCard({
  website,
  canReset,
  inactiveReason,
  onReset,
}: {
  website: WebspaceDetailDto;
  canReset: boolean;
  inactiveReason: string | null;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const access = website.access;
  const site = website.site;
  const username = access?.username ?? site?.siteUser ?? null;
  return (
    <Card>
      <CardHeader
        title={<CardTitle icon={<Terminal />}>{t('websites.access.title')}</CardTitle>}
        description={t('websites.access.text')}
        actions={
          canReset && (
            <Tooltip content={inactiveReason ?? t('websites.access.newPasswordHint')}>
              <span>
                <Button
                  size="sm"
                  icon={<KeyRound className="size-3.5" />}
                  disabled={!!inactiveReason}
                  onClick={onReset}
                >
                  {t('websites.access.newPassword')}
                </Button>
              </span>
            </Tooltip>
          )
        }
      />
      <CardBody className="py-1">
        <KeyValue
          items={[
            { label: t('websites.access.host'), value: <CopyValue value={access?.host} /> },
            { label: t('websites.access.port'), value: access ? <Mono>{access.port}</Mono> : '–' },
            { label: t('websites.access.username'), value: <CopyValue value={username} /> },
            {
              label: t('websites.access.home'),
              value: <CopyValue value={access?.homeDirectory ?? site?.homeDirectory} />,
            },
            {
              label: t('websites.access.webRoot'),
              value: <CopyValue value={access?.webRoot ?? site?.webRoot} />,
            },
          ]}
        />
      </CardBody>
      {access && (
        <CardBody className="space-y-2 border-t border-border text-xs text-muted">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{t('websites.creds.sftpLink')}</span>
            <a
              href={sftpUrl(access.username, access.host, access.port)}
              className="font-mono text-[12.5px] break-all text-primary-text hover:underline"
            >
              {sftpUrl(access.username, access.host, access.port)}
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{t('websites.creds.sshLine')}</span>
            <CopyValue value={sshCommand(access.username, access.host, access.port)} />
          </div>
        </CardBody>
      )}
      <CardBody className="border-t border-border text-sm text-muted">
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('websites.access.helpUpload')}</li>
          <li>
            {t('websites.access.helpCron')} <Mono className="text-text">crontab -e</Mono>
          </li>
          <li>
            {t('websites.access.helpLogs')} <Mono className="text-text">~/logs</Mono>
          </li>
          <li>{t('websites.access.helpPassword')}</li>
        </ul>
      </CardBody>
    </Card>
  );
}

function RuntimeCard({ website }: { website: WebspaceDetailDto }) {
  const { t } = useI18n();
  const site = website.site;
  const items: { label: ReactNode; value: ReactNode }[] = site
    ? [
        { label: t('websites.runtime.type'), value: websiteTypeLabel(t, site) },
        ...(site.type === 'php'
          ? [
              { label: t('websites.runtime.php'), value: site.phpVersion ? `PHP ${site.phpVersion}` : '–' },
              { label: t('websites.runtime.application'), value: site.application ?? '–' },
            ]
          : []),
        ...(site.type === 'nodejs'
          ? [
              {
                label: t('websites.runtime.nodejs'),
                value: site.nodejsVersion ? `Node.js ${site.nodejsVersion}` : '–',
              },
              {
                label: t('websites.runtime.appPort'),
                value: site.appPort ? <CopyValue value={String(site.appPort)} /> : '–',
              },
            ]
          : []),
      ]
    : [];
  return (
    <Card>
      <CardHeader title={<CardTitle icon={<Cpu />}>{t('websites.runtime.title')}</CardTitle>} />
      <CardBody className="py-1">
        {site ? (
          <KeyValue items={items} />
        ) : (
          <p className="py-3 text-sm text-muted">{t('websites.detail.noFacts')}</p>
        )}
      </CardBody>
      <CardBody className="border-t border-border text-sm text-muted">
        {site?.type === 'nodejs'
          ? t('websites.runtime.nodejsHint', { port: site.appPort ?? '–' })
          : site?.type === 'static'
            ? t('websites.runtime.staticHint')
            : t('websites.runtime.phpHint')}
      </CardBody>
    </Card>
  );
}

function CertificateCard({
  website,
  canIssue,
  inactiveReason,
  onIssue,
}: {
  website: WebspaceDetailDto;
  canIssue: boolean;
  inactiveReason: string | null;
  onIssue: () => void;
}) {
  const { t, locale } = useI18n();
  const cert = website.site?.certificate ?? null;
  const state = certificateState(cert);
  const reissue = state.kind === 'letsEncrypt' || state.kind === 'other';
  return (
    <Card>
      <CardHeader
        title={<CardTitle icon={<ShieldCheck />}>{t('websites.ssl.title')}</CardTitle>}
        actions={
          canIssue && (
            <Tooltip content={inactiveReason ?? t('websites.ssl.issueHint')}>
              <span>
                <Button
                  size="sm"
                  variant={state.level === 'ok' ? 'secondary' : 'primary'}
                  icon={<ShieldCheck className="size-3.5" />}
                  disabled={!!inactiveReason}
                  onClick={onIssue}
                >
                  {reissue ? t('websites.ssl.reissue') : t('websites.ssl.issue')}
                </Button>
              </span>
            </Tooltip>
          )
        }
      />
      <CardBody className="py-1">
        <KeyValue
          items={[
            { label: t('websites.ssl.state'), value: <CertificateText certificate={cert} icon /> },
            { label: t('websites.ssl.expires'), value: formatDate(state.expiresAt, locale, false) },
            {
              label: t('websites.ssl.covers'),
              value: (
                <Mono>
                  {asciiDomain(website.name)}, {wwwCounterpart(asciiDomain(website.name))}
                </Mono>
              ),
            },
          ]}
        />
      </CardBody>
      <CardBody className="border-t border-border text-sm text-muted">{t('websites.ssl.renewal')}</CardBody>
    </Card>
  );
}

/** Expected records and what public DNS answers; read only when the user asks for it. */
function DnsCard({ website, base }: { website: WebspaceDetailDto; base: string }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const dns = useWebsiteDnsCheck(website.id, open);
  const check = dns.data;
  return (
    <Card>
      <CardHeader
        title={<CardTitle icon={<ListTree />}>{t('websites.dns.title')}</CardTitle>}
        description={t('websites.dns.text')}
        actions={
          <Button
            size="sm"
            icon={<RefreshCw className="size-3.5" />}
            loading={open && dns.isFetching}
            onClick={() => (open ? void dns.refetch() : setOpen(true))}
          >
            {open ? t('websites.dns.recheck') : t('websites.dns.check')}
          </Button>
        }
      />
      {!open ? (
        <CardBody className="text-sm text-muted">{t('websites.dns.hint')}</CardBody>
      ) : dns.isPending ? (
        <LoadingBlock rows={2} />
      ) : dns.isError ? (
        <div className="p-5">
          <ErrorState error={dns.error} onRetry={() => void dns.refetch()} />
        </div>
      ) : check ? (
        <>
          <div className="border-b border-border">
            <ExpectedDnsTable check={check} />
          </div>
          <CardBody className="space-y-3">
            <p className="text-sm font-medium text-text">{t('websites.dns.answers')}</p>
            <div className="overflow-hidden rounded-lg border border-border">
              <DnsCheckTable check={check} />
            </div>
            <p className="text-xs text-muted">
              {check.ready ? t('websites.dns.readyText') : t('websites.dns.notReadyText')}{' '}
              {t('websites.dns.checkedAt', { when: formatRelative(check.checkedAt, locale) })}
            </p>
            {check.panelDomain && (
              <Link
                to={`${base}/domains/${check.panelDomain.id}`}
                className="inline-block text-sm font-medium text-primary-text hover:underline"
              >
                {t('websites.dns.toDomain', { domain: check.panelDomain.name })}
              </Link>
            )}
          </CardBody>
        </>
      ) : null}
    </Card>
  );
}

function DatabasesCard({
  website,
  orgId,
  limited,
  inactiveReason,
  onCreate,
  onPassword,
  onDelete,
}: {
  website: WebspaceDetailDto;
  orgId: string;
  /** Customers and resellers create within the allowance; platform staff do not. */
  limited: boolean;
  inactiveReason: string | null;
  onCreate: () => void;
  onPassword: (database: WebsiteDatabaseDto) => void;
  onDelete: (database: WebsiteDatabaseDto) => void;
}) {
  const { t } = useI18n();
  const canWrite = website.permissions.includes('webspace:write');
  const canCredentials = website.permissions.includes('webspace:credentials');
  const options = useWebsiteOptions(orgId, canWrite && limited && !!website.org);
  const allowance = options.data?.allowance ?? null;
  const full = limited && !!allowance && allowanceRoom(allowance).databases === 0;
  const createBlocked = inactiveReason ?? (full ? t('websites.db.full') : null);
  const access = website.access;
  const username = access?.username ?? website.site?.siteUser ?? 'user';
  const host = access?.host ?? 'host';

  return (
    <Card>
      <CardHeader
        title={<CardTitle icon={<Database />}>{t('websites.db.title')}</CardTitle>}
        description={t('websites.db.text')}
        actions={
          canWrite && (
            <Tooltip content={createBlocked ?? t('websites.db.createHint')}>
              <span>
                <Button
                  size="sm"
                  icon={<Plus className="size-4" />}
                  disabled={!!createBlocked}
                  onClick={onCreate}
                >
                  {t('websites.db.create')}
                </Button>
              </span>
            </Tooltip>
          )
        }
      />
      {website.databases.length === 0 ? (
        <EmptyState className="py-8" icon={<Database className="size-6" />} title={t('websites.db.empty')} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{t('websites.db.name')}</TH>
              <TH className="hidden sm:table-cell">{t('websites.db.user')}</TH>
              <TH className="hidden md:table-cell">{t('websites.db.size')}</TH>
              <TH>{t('websites.db.statusCol')}</TH>
              {(canWrite || canCredentials) && <TH />}
            </tr>
          </THead>
          <TBody>
            {website.databases.map((d) => {
              const dbActive = d.status === 'active' && !d.missingSince && !inactiveReason;
              return (
                <TR key={d.id}>
                  <TD>
                    <CopyValue value={d.name} />
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <Mono>{d.userName ?? d.name}</Mono>
                  </TD>
                  <TD className="hidden text-sm whitespace-nowrap md:table-cell">
                    {formatBytes(d.sizeBytes)}
                  </TD>
                  <TD>
                    {d.missingSince ? (
                      <Badge tone="danger">{t('websites.status.missing')}</Badge>
                    ) : d.status === 'active' ? (
                      <Badge tone="success">{t('websites.status.active')}</Badge>
                    ) : (
                      <Badge tone={d.status === 'error' ? 'danger' : 'warning'}>
                        {t(`websites.status.${d.status}`)}
                      </Badge>
                    )}
                  </TD>
                  {(canWrite || canCredentials) && (
                    <TD className="text-right">
                      <Menu
                        trigger={
                          <Button variant="ghost" size="icon" aria-label={t('common.actions')}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        }
                      >
                        {canCredentials && (
                          <MenuItem icon={<KeyRound />} disabled={!dbActive} onSelect={() => onPassword(d)}>
                            {t('websites.db.newPassword')}
                          </MenuItem>
                        )}
                        {canWrite && (
                          <MenuItem
                            icon={<Trash2 />}
                            danger
                            disabled={!!inactiveReason || d.status === 'creating' || d.status === 'deleting'}
                            onSelect={() => onDelete(d)}
                          >
                            {t('websites.db.delete')}
                          </MenuItem>
                        )}
                      </Menu>
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      <CardBody className="space-y-2 border-t border-border text-sm text-muted">
        <p>{t('websites.db.connect')}</p>
        <p>{t('websites.db.noPhpMyAdmin')}</p>
        <CopyValue value={sshTunnelCommand(username, host, access?.port ?? 22)} />
      </CardBody>
    </Card>
  );
}

function UsageCard({ website }: { website: WebspaceDetailDto }) {
  const { t, locale } = useI18n();
  const site = website.site;
  return (
    <Card>
      <CardHeader title={<CardTitle icon={<HardDrive />}>{t('websites.usage.title')}</CardTitle>} />
      <CardBody className="space-y-3 text-sm">
        {site ? (
          <>
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted">{t('websites.usage.files')}</dt>
                <dd className="mt-0.5 font-semibold text-text tabular">{formatBytes(site.diskBytes)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('websites.usage.databases')}</dt>
                <dd className="mt-0.5 font-semibold text-text tabular">{formatBytes(site.databaseBytes)}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted">{usageText(t, locale, site)}</p>
          </>
        ) : (
          <p className="text-muted">{t('websites.usage.notMeasured')}</p>
        )}
        <p className="text-xs text-muted">{t('websites.usage.fairUse')}</p>
      </CardBody>
    </Card>
  );
}
