import { ExternalLink, Tv } from 'lucide-react';
import type { MediaLoginDto } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { Card, CardBody, CardHeader, CopyButton, Mono } from '@/components/ui/primitives';
import { safePanelUrl } from '@/pages/hosting/bits';

/** Where the Jellyfin apps for every platform are listed (not part of the server). */
const JELLYFIN_DOWNLOADS = 'https://jellyfin.org/downloads';

/**
 * How users sign in on the organization's instance: the server address, three steps, Quick
 * Connect for TVs (when the instance has it on) and the apps.
 */
export function MediaLoginCard({ login }: { login: MediaLoginDto }) {
  const { t } = useI18n();
  const url = safePanelUrl(login.url);
  const steps = [
    t('media.login.step1'),
    t('media.login.step2'),
    <>
      {t('media.login.step3')} {t('media.login.codeHint')}{' '}
      {/* The code stays in one piece: a line break after the dash would read as part of the name. */}
      <Mono className="whitespace-nowrap text-text">-{login.accountCode}</Mono>.
    </>,
  ];
  return (
    <Card>
      <CardHeader title={t('media.login.title')} description={t('media.login.text')} />
      <CardBody className="space-y-4">
        <div>
          <p className="text-xs text-muted">{t('media.login.address')}</p>
          {url ? (
            <div className="mt-1 flex min-w-0 items-center gap-1 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <Mono className="min-w-0 flex-1 truncate text-sm text-text">{url}</Mono>
              <CopyButton value={url} label={t('media.login.copyAddress')} />
            </div>
          ) : (
            <p className="mt-1 text-sm text-subtle">–</p>
          )}
          {login.serverName && (
            <p className="mt-1 text-xs text-muted">
              {t('media.login.serverName', { name: login.serverName })}
            </p>
          )}
        </div>
        <ol className="space-y-2 text-sm text-text">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-text">
                {i + 1}
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
        {login.quickConnect && (
          <div className="rounded-lg border border-border px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-text">
              <Tv className="size-4 text-muted" aria-hidden /> {t('media.login.tv')}
            </p>
            <p className="mt-1 text-sm text-muted">{t('media.login.quickConnect')}</p>
          </div>
        )}
        <div className="text-sm text-muted">
          <p>{t('media.login.apps')}</p>
          <a
            href={JELLYFIN_DOWNLOADS}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-medium text-primary-text hover:underline"
          >
            {t('media.login.allApps')} <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
        <p className="border-t border-border pt-3 text-xs text-muted">{t('media.login.privacy')}</p>
      </CardBody>
    </Card>
  );
}
