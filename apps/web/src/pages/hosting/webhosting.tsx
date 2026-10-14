import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, EyeOff, Globe, KeyRound, Layers, Mail, Plus, ServerOff } from 'lucide-react';
import type {
  WebsiteAllowanceDto,
  WebsiteServerOptions,
  WebspaceDetailDto,
  WebspaceDto,
} from '@weblion/shared';
import { errorMessage } from '@/lib/api';
import { formatBytes, formatDate, formatMemoryMb, formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useRevealWebspaceCredentials, useWebspace, useWebspaces } from '@/lib/api/hosting';
import { useWebsiteOptions } from '@/lib/api/websites';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Tooltip } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';
import { Flag, ProviderBadge } from '@/components/server-bits';
import { DetailError, ExpiryText, ModuleOffState, PanelLink, resourceItems, safePanelUrl } from './bits';
import { WebsiteView } from './website';
import {
  CertificateText,
  InstanceLocation,
  WebsiteAllowanceFigures,
  WebsiteStatusBadges,
  WebsiteTypeBadge,
  allowanceRoom,
  websiteUrl,
  websiteUsageBytes,
  websitesFirst,
} from './website-bits';
import { CreateWebsiteDialog } from './website-dialogs';

/** Revealed credentials disappear again after this time. */
const REVEAL_MS = 3 * 60_000;

// --- List ----------------------------------------------------------------------------

/**
 * Websites (CloudPanel) and web spaces (Plesk) of the organization. Websites come first; the
 * allowance decides whether and what the organization may create.
 */
export function WebspacesPage() {
  const { t } = useI18n();
  const { org, can, hasModule } = useOrg();
  const webspaces = useWebspaces(org.id);
  const moduleOn = hasModule('webhosting');
  const options = useWebsiteOptions(org.id, moduleOn && can('webspace:read'));
  // The dialog gets the allowance and options it was opened with: a refresh of the options
  // (after creating, they count one more website) must not close it with the passwords in it.
  const [creating, setCreating] = useState<{
    allowance: WebsiteAllowanceDto;
    options: WebsiteServerOptions;
  } | null>(null);

  const allowance = options.data?.allowance ?? null;
  const serverOptions = options.data?.options ?? null;
  const canCreate = can('webspace:write') && !!allowance && !!serverOptions && serverOptions.types.length > 0;
  const full = !!allowance && allowanceRoom(allowance).sites === 0;
  const createBlocked = full ? t('websites.list.full') : null;
  const items = websitesFirst(webspaces.data ?? []);
  const openCreate = () => allowance && serverOptions && setCreating({ allowance, options: serverOptions });

  const createButton = canCreate ? (
    <Button
      variant="primary"
      icon={<Plus className="size-4" />}
      disabled={!!createBlocked}
      title={createBlocked ?? undefined}
      onClick={openCreate}
    >
      {t('websites.list.create')}
    </Button>
  ) : allowance && options.data?.optionsError && can('webspace:write') ? (
    <Tooltip content={options.data.optionsError}>
      <span className="inline-flex items-center gap-1.5 text-sm text-muted">
        <ServerOff className="size-4" aria-hidden /> {t('websites.list.serverDown')}
      </span>
    </Tooltip>
  ) : null;

  let body;
  if (webspaces.isPending) {
    body = (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-60 rounded-xl" />
        ))}
      </div>
    );
  } else if (webspaces.isError) {
    body = <ErrorState error={webspaces.error} onRetry={() => void webspaces.refetch()} />;
  } else if (items.length === 0) {
    body = (
      <Card>
        {!moduleOn ? (
          <ModuleOffState module="webhosting" />
        ) : allowance ? (
          <EmptyState
            icon={<Globe className="size-6" />}
            title={t('websites.list.empty')}
            description={t('websites.list.emptyText')}
            action={
              canCreate && !createBlocked ? (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                  {t('websites.list.create')}
                </Button>
              ) : undefined
            }
          />
        ) : options.isPending && can('webspace:read') ? (
          <LoadingBlock rows={2} />
        ) : (
          <EmptyState
            icon={<Layers className="size-6" />}
            title={t('websites.list.noAllowance')}
            description={
              org.parent
                ? t('websites.list.noAllowanceReseller', { reseller: org.parent.name })
                : t('websites.list.noAllowanceText')
            }
          />
        )}
      </Card>
    );
  } else {
    body = (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((w) =>
          w.kind === 'website' ? (
            <WebsiteCard key={w.id} website={w} />
          ) : (
            <WebspaceCard key={w.id} webspace={w} />
          ),
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('nav.webhosting')}
        description={t('websites.list.subtitle')}
        actions={createButton}
      />
      {!moduleOn && items.length > 0 && (
        <Notice tone="warning" className="mb-4">
          {t('hosting.moduleOff.staff')}
        </Notice>
      )}
      {options.isError && (
        <Notice tone="warning" className="mb-4" title={t('websites.list.optionsError')}>
          <span className="block break-words">{errorMessage(options.error)}</span>
        </Notice>
      )}
      {allowance && (
        <Card className="mb-4">
          <CardBody>
            <WebsiteAllowanceFigures allowance={allowance} />
          </CardBody>
        </Card>
      )}
      {body}
      {creating && (
        <CreateWebsiteDialog
          orgId={org.id}
          allowance={creating.allowance}
          options={creating.options}
          onClose={() => setCreating(null)}
        />
      )}
    </>
  );
}

/** One website: type, certificate, databases, usage. */
function WebsiteCard({ website }: { website: WebspaceDto }) {
  const { t, locale } = useI18n();
  const { base } = useOrg();
  const link = `${base}/webhosting/${website.id}`;
  const site = website.site;
  const usage = site ? websiteUsageBytes(site) : null;
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <Link to={link} className="flex items-center gap-2 hover:underline">
            <Globe className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="truncate text-[15px] font-semibold text-text">{website.name}</span>
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
            <WebsiteTypeBadge site={site} />
            <InstanceLocation location={website.location} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <WebsiteStatusBadges website={website} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 px-5 pt-4 pb-4">
        <div className="col-span-2 min-w-0">
          <dt className="truncate text-xs text-muted">{t('websites.ssl.title')}</dt>
          <dd className="mt-0.5 text-sm">
            <CertificateText certificate={site?.certificate ?? null} icon />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted">{t('websites.db.title')}</dt>
          <dd className="mt-0.5 truncate text-sm font-semibold text-text tabular">
            {site ? site.databases : '–'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted">{t('websites.usage.title')}</dt>
          <dd className="mt-0.5 min-w-0 text-sm text-text">
            {site && usage !== null ? (
              <>
                <span className="block truncate font-semibold tabular">{formatBytes(usage)}</span>
                {site.usageMeasuredAt && (
                  <span className="block truncate text-xs text-muted">
                    {t('websites.usage.measuredAt', { when: formatRelative(site.usageMeasuredAt, locale) })}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted">{site ? t('websites.usage.notMeasured') : '–'}</span>
            )}
          </dd>
        </div>
      </dl>
      {website.credentialsPending && (
        <p className="px-5 pb-4 text-xs font-medium text-warning">{t('websites.list.credentialsPending')}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        {website.status === 'active' && !website.missingSince && (
          <PanelLink href={websiteUrl(website.name)} size="sm" variant="secondary">
            {t('websites.detail.open')}
          </PanelLink>
        )}
        <Link
          to={link}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-primary-text hover:bg-surface-3"
        >
          {t('common.details')}
        </Link>
      </div>
    </Card>
  );
}

function WebspaceCard({ webspace }: { webspace: WebspaceDto }) {
  const { t, locale } = useI18n();
  const { base } = useOrg();
  const link = `${base}/webhosting/${webspace.id}`;
  const panel = safePanelUrl(webspace.panelUrl);
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <Link to={link} className="flex items-center gap-2 hover:underline">
            <Layers className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="truncate text-[15px] font-semibold text-text">{webspace.name}</span>
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
            <ProviderBadge type={webspace.provider.type} name={webspace.provider.name} />
            <Flag country={webspace.location.country} />
            <span className="truncate">{webspace.location.city ?? webspace.location.label}</span>
          </div>
        </div>
        {webspace.missingSince && <Badge tone="danger">{t('hosting.status.missing')}</Badge>}
      </div>
      <div className="px-5 pt-4 text-[11px] font-semibold tracking-wider text-subtle uppercase">
        {t('hosting.res.included')}
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-3 px-5 pt-2 pb-4">
        {resourceItems(t, locale, webspace.resources).map((r) => (
          <div key={r.key} className="min-w-0">
            <dt className="truncate text-xs text-muted">{r.label}</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-text tabular">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="px-5 pb-4 text-xs text-muted">
        {t('hosting.col.expires')}: <ExpiryText expiresAt={webspace.expiresAt} />
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        {panel && (
          <PanelLink href={panel} size="sm" variant="secondary">
            {t('hosting.webspace.openPanel')}
          </PanelLink>
        )}
        <Link
          to={link}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-primary-text hover:bg-surface-3"
        >
          {t('common.details')}
        </Link>
      </div>
    </Card>
  );
}

// --- Detail --------------------------------------------------------------------------

export function WebspaceDetailPage() {
  const { t } = useI18n();
  const { webspaceId } = useParams();
  const { base } = useOrg();
  const webspace = useWebspace(webspaceId);

  return (
    <>
      <Link
        to={`${base}/webhosting`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.webhosting')}
      </Link>
      {webspace.data ? (
        // A failed background refresh keeps the view: it holds open dialogs, among them
        // passwords that are shown only once.
        <>
          {webspace.isError && (
            <Notice tone="warning" title={t('websites.detail.refreshError')} className="mb-4">
              <span className="block break-words">{errorMessage(webspace.error)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                loading={webspace.isFetching}
                onClick={() => void webspace.refetch()}
              >
                {t('common.retry')}
              </Button>
            </Notice>
          )}
          {webspace.data.kind === 'website' ? (
            <WebsiteView website={webspace.data} />
          ) : (
            <WebspaceView webspace={webspace.data} />
          )}
        </>
      ) : webspace.isPending ? (
        <LoadingBlock rows={6} />
      ) : (
        <DetailError kind="webspace" error={webspace.error} onRetry={() => void webspace.refetch()} />
      )}
    </>
  );
}

function WebspaceView({ webspace }: { webspace: WebspaceDetailDto }) {
  const { t, locale } = useI18n();
  const info = webspace.info;
  const resources = info?.resources ?? webspace.resources;
  const panel = safePanelUrl(info?.panelUrl ?? webspace.panelUrl);
  const expiresAt = info?.expiresAt ?? webspace.expiresAt;
  const ip = resources?.ipAddress ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Layers className="size-5 text-muted" aria-hidden />
            <h1 className="font-display truncate text-2xl font-semibold tracking-tight text-text">
              {webspace.name}
            </h1>
            {webspace.missingSince && <Badge tone="danger">{t('hosting.status.missing')}</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
            {ip && (
              <span className="inline-flex items-center gap-1">
                <Mono className="text-text">{ip}</Mono>
                <CopyButton value={ip} />
              </span>
            )}
            <span className="inline-flex items-center gap-2">
              <Flag country={webspace.location.country} />
              {webspace.location.city ?? webspace.location.label}
            </span>
            <ProviderBadge type={webspace.provider.type} name={webspace.provider.name} />
            <span className="inline-flex items-center gap-1.5">
              {t('hosting.col.expires')}: <ExpiryText expiresAt={expiresAt} className="text-text" />
            </span>
          </div>
        </div>
        {panel && <PanelLink href={panel}>{t('hosting.webspace.openPanel')}</PanelLink>}
      </div>

      {webspace.liveError && (
        <Notice tone="warning" title={t('hosting.liveError.title')}>
          {t('hosting.liveError.text', { provider: webspace.provider.name })}
          <span className="mt-1 block font-mono text-xs break-words">{webspace.liveError}</span>
        </Notice>
      )}
      {webspace.missingSince && (
        <Notice tone="danger" title={t('hosting.missing.title')}>
          {t('hosting.missing.webspace', { date: formatDate(webspace.missingSince, locale) })}
        </Notice>
      )}

      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-text">{t('hosting.res.included')}</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {resourceItems(t, locale, resources).map((r) => (
            <Card key={r.key} className="p-4">
              <div className="text-sm text-muted">{r.label}</div>
              <div className="mt-1.5 text-xl font-semibold text-text tabular">{r.value}</div>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('hosting.webspace.details')} />
          <CardBody className="py-1">
            <KeyValue
              items={[
                {
                  label: t('hosting.webspace.username'),
                  value: info?.username ? <Mono>{info.username}</Mono> : '–',
                },
                { label: t('hosting.webspace.contact'), value: info?.email ?? '–' },
                { label: t('hosting.webspace.ip'), value: ip ? <Mono>{ip}</Mono> : '–' },
                {
                  label: t('hosting.webspace.memoryLimit'),
                  value: formatMemoryMb(resources?.memoryLimitMb ?? null),
                },
                {
                  label: t('hosting.webspace.panel'),
                  value: panel ? (
                    <a
                      href={panel}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-primary-text hover:underline"
                    >
                      {panel}
                    </a>
                  ) : (
                    '–'
                  ),
                },
                { label: t('hosting.col.expires'), value: <ExpiryText expiresAt={expiresAt} /> },
                {
                  label: t('hosting.lastSync'),
                  value: webspace.lastSyncedAt ? formatRelative(webspace.lastSyncedAt, locale) : '–',
                },
              ]}
            />
          </CardBody>
        </Card>
        <CredentialsCard webspace={webspace} />
      </div>

      {panel && resources?.emails !== 0 && <MailHintsCard panelUrl={panel} />}
    </div>
  );
}

function CredentialsCard({ webspace }: { webspace: WebspaceDetailDto }) {
  const { t } = useI18n();
  const allowed = webspace.permissions.includes('webspace:credentials');
  const [confirming, setConfirming] = useState(false);
  const reveal = useRevealWebspaceCredentials(webspace.id);
  const creds = reveal.data;
  const { reset } = reveal;

  // Do not leave passwords on screen when somebody walks away.
  useEffect(() => {
    if (!creds) return;
    const timer = setTimeout(reset, REVEAL_MS);
    return () => clearTimeout(timer);
  }, [creds, reset]);

  const secret = (value: string | null) =>
    value ? (
      <span className="inline-flex max-w-full items-start gap-1">
        <Mono className="min-w-0 break-all text-text">{value}</Mono>
        <CopyButton value={value} className="-mt-0.5" />
      </span>
    ) : (
      '–'
    );
  const panel = safePanelUrl(creds?.panelUrl);

  return (
    <Card>
      <CardHeader title={t('hosting.creds.title')} description={t('hosting.creds.text')} />
      <CardBody className="space-y-3">
        {creds ? (
          <>
            <KeyValue
              className="-mt-2.5"
              items={[
                {
                  label: t('hosting.webspace.panel'),
                  value: panel ? (
                    <span className="inline-flex max-w-full items-start gap-1">
                      <a
                        href={panel}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 break-all text-primary-text hover:underline"
                      >
                        {panel}
                      </a>
                      <CopyButton value={panel} className="-mt-0.5" />
                    </span>
                  ) : (
                    '–'
                  ),
                },
                { label: t('hosting.webspace.username'), value: secret(creds.username) },
                {
                  label: t('hosting.creds.password'),
                  value: creds.password ? (
                    secret(creds.password)
                  ) : (
                    <span className="text-muted">{t('hosting.creds.noPassword')}</span>
                  ),
                },
                ...(creds.email
                  ? [{ label: t('hosting.webspace.contact'), value: secret(creds.email) }]
                  : []),
              ]}
            />
            <p className="text-xs text-muted">{t('hosting.creds.shownHint')}</p>
          </>
        ) : allowed ? (
          <p className="text-sm text-muted">{t('hosting.creds.auditHint')}</p>
        ) : (
          <p className="text-sm text-muted">{t('hosting.creds.noPermission')}</p>
        )}
        {allowed &&
          (creds ? (
            <Button size="sm" variant="ghost" icon={<EyeOff className="size-3.5" />} onClick={() => reset()}>
              {t('common.hide')}
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<KeyRound className="size-3.5" />}
              loading={reveal.isPending}
              onClick={() => setConfirming(true)}
            >
              {t('hosting.creds.show')}
            </Button>
          ))}
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('hosting.creds.confirmTitle')}
        description={t('hosting.creds.confirmText')}
        confirmLabel={t('hosting.creds.show')}
        danger={false}
        loading={reveal.isPending}
        onConfirm={() => reveal.mutate(undefined, { onSettled: () => setConfirming(false) })}
      />
    </Card>
  );
}

/**
 * Plesk serves IMAP and SMTP on its host name with a valid certificate, so the panel host
 * is a safe default for mail clients. Ports are the Plesk defaults.
 */
function MailHintsCard({ panelUrl }: { panelUrl: string }) {
  const { t } = useI18n();
  let host: string;
  try {
    host = new URL(panelUrl).hostname;
  } catch {
    return null;
  }
  const server = (
    <span className="inline-flex items-center gap-1">
      <Mono className="text-text">{host}</Mono>
      <CopyButton value={host} />
    </span>
  );
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Mail className="size-4 text-muted" aria-hidden />
            {t('hosting.mail.title')}
          </span>
        }
        description={t('hosting.mail.text')}
      />
      <CardBody className="grid gap-6 py-2 md:grid-cols-2">
        <div>
          <h4 className="pt-2 text-sm font-semibold text-text">{t('hosting.mail.incoming')}</h4>
          <KeyValue
            items={[
              { label: t('hosting.mail.server'), value: server },
              { label: t('hosting.mail.port'), value: t('hosting.mail.imapPort') },
            ]}
          />
        </div>
        <div>
          <h4 className="pt-2 text-sm font-semibold text-text">{t('hosting.mail.outgoing')}</h4>
          <KeyValue
            items={[
              { label: t('hosting.mail.server'), value: server },
              { label: t('hosting.mail.port'), value: t('hosting.mail.smtpPort') },
            ]}
          />
        </div>
      </CardBody>
      <CardBody className="border-t border-border text-sm text-muted">
        <p>{t('hosting.mail.login')}</p>
        <p className="mt-1">{t('hosting.mail.alternative')}</p>
      </CardBody>
    </Card>
  );
}
