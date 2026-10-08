import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, EyeOff, KeyRound, Layers, Mail } from 'lucide-react';
import type { WebspaceDetailDto, WebspaceDto } from '@weblion/shared';
import { formatDate, formatMemoryMb, formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useRevealWebspaceCredentials, useWebspace, useWebspaces } from '@/lib/api/hosting';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
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

/** Revealed credentials disappear again after this time. */
const REVEAL_MS = 3 * 60_000;

// --- List ----------------------------------------------------------------------------

export function WebspacesPage() {
  const { t } = useI18n();
  const { org, hasModule } = useOrg();
  const webspaces = useWebspaces(org.id);
  const moduleOn = hasModule('webhosting');

  return (
    <>
      <PageHeader title={t('nav.webhosting')} description={t('hosting.webspaces.subtitle')} />
      {!moduleOn && !!webspaces.data?.length && (
        <Notice tone="warning" className="mb-4">
          {t('hosting.moduleOff.staff')}
        </Notice>
      )}
      {webspaces.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-60 rounded-xl" />
          ))}
        </div>
      ) : webspaces.isError ? (
        <ErrorState error={webspaces.error} onRetry={() => void webspaces.refetch()} />
      ) : webspaces.data.length === 0 ? (
        <Card>
          {moduleOn ? (
            <EmptyState
              icon={<Layers className="size-6" />}
              title={t('hosting.webspaces.empty')}
              description={t('hosting.webspaces.emptyText')}
            />
          ) : (
            <ModuleOffState module="webhosting" />
          )}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {webspaces.data.map((w) => (
            <WebspaceCard key={w.id} webspace={w} />
          ))}
        </div>
      )}
    </>
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
      {webspace.isPending ? (
        <LoadingBlock rows={6} />
      ) : webspace.isError || !webspace.data ? (
        <DetailError kind="webspace" error={webspace.error} onRetry={() => void webspace.refetch()} />
      ) : (
        <WebspaceView webspace={webspace.data} />
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
