import { Link } from 'react-router-dom';
import { Phone } from 'lucide-react';
import type { PhoneSystemDto } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useOrgPhoneSystems } from '@/lib/api/phone';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';
import { ModuleOffState, PanelLink, safePanelUrl } from '@/pages/hosting/bits';
import {
  CallsMeter,
  EditionLabel,
  LicenseText,
  PhoneStatusBadge,
  TrunksFigure,
  UsersFigure,
  reasonText,
  reasonTone,
  sortReasons,
} from './bits';

/** Phone systems of the organization (/o/:slug/phone), one card per site. */
export function PhonePage() {
  const { t, locale } = useI18n();
  const { org, can, hasModule } = useOrg();
  const moduleOn = hasModule('phone');
  const canRead = can('phone:read');
  const systems = useOrgPhoneSystems(org.id, canRead);
  const list = systems.data ?? [];
  const lastSync = list
    .map((s) => s.lastSyncedAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);

  let body;
  if (!canRead || (!moduleOn && systems.isError)) {
    body = (
      <Card>{moduleOn ? <EmptyState title={t('phone.noAccess')} /> : <ModuleOffState module="phone" />}</Card>
    );
  } else if (systems.isPending) {
    body = <LoadingBlock rows={4} />;
  } else if (systems.isError) {
    body = <ErrorState error={systems.error} onRetry={() => void systems.refetch()} />;
  } else if (list.length === 0) {
    body = (
      <Card>
        {moduleOn ? (
          <EmptyState
            icon={<Phone className="size-6" />}
            title={t('phone.none.title')}
            description={
              org.parent ? t('phone.none.textReseller', { reseller: org.parent.name }) : t('phone.none.text')
            }
          />
        ) : (
          <ModuleOffState module="phone" />
        )}
      </Card>
    );
  } else {
    body = (
      <>
        {!moduleOn && (
          <Notice tone="warning" className="mb-4">
            {t('hosting.moduleOff.staff')}
          </Notice>
        )}
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((s) => (
            <PhoneSystemCard key={s.id} system={s} />
          ))}
        </div>
        {lastSync && (
          <p className="mt-3 text-xs text-muted">
            {t('phone.lastSync', { when: formatRelative(lastSync, locale) })}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('nav.phone')} description={t('phone.subtitle')} />
      {body}
    </>
  );
}

/** One site: name and address, status, calls, users, trunks, license, and the 3CX web client. */
function PhoneSystemCard({ system }: { system: PhoneSystemDto }) {
  const { t } = useI18n();
  const { base } = useOrg();
  const info = system.info;
  const webClient = safePanelUrl(system.webClientUrl);
  // The most serious reason explains the badge; the page lists all of them.
  const worst = sortReasons(system.statusReasons)[0];
  return (
    <Card className="flex flex-col">
      {/* The card opens the phone system; the web client link sits outside the link. */}
      <Link
        to={`${base}/phone/${system.id}`}
        className="block flex-1 rounded-t-xl px-5 py-4 transition-colors hover:bg-surface-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Phone className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="truncate text-[15px] font-semibold text-text">{system.name}</span>
            </div>
            {info?.fqdn && info.fqdn !== system.name && (
              <Mono className="mt-0.5 block truncate text-muted">{info.fqdn}</Mono>
            )}
          </div>
          <PhoneStatusBadge status={system.status} missing={system.missingSince} className="justify-end" />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-muted">{t('phone.card.calls')}</dt>
            <dd className="mt-0.5">
              <CallsMeter info={info} className="min-w-0" />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">{t('phone.card.users')}</dt>
            <dd className="mt-0.5">
              <UsersFigure info={info} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">{t('phone.card.trunks')}</dt>
            <dd className="mt-0.5">
              <TrunksFigure info={info} />
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {info?.edition && <EditionLabel edition={info.edition} />}
          {info?.licenseExpiresAt && <LicenseText expiresAt={info.licenseExpiresAt} />}
        </div>
        {worst && (
          <p className={cn('mt-2 text-xs', reasonTone(worst) === 'danger' ? 'text-danger' : 'text-warning')}>
            {reasonText(t, worst)}
          </p>
        )}
      </Link>
      {webClient && (
        <div className="border-t border-border px-5 py-3">
          <PanelLink href={webClient} variant="secondary" size="sm">
            {t('phone.open')}
          </PanelLink>
        </div>
      )}
    </Card>
  );
}
