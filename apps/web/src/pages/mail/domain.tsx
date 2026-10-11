import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AtSign, ChevronLeft, Forward, Inbox, LayoutGrid, ListTree, Mail, Server } from 'lucide-react';
import type { MailDomainDetailDto } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useMailDomain } from '@/lib/api/mail';
import { LoadingBlock, Mono, Notice } from '@/components/ui/primitives';
import { MailDetailError, MailDomainStatusBadge, MailServer } from './bits';
import { MailOverview } from './overview';
import { MailboxesTab } from './mailboxes';
import { AliasesTab } from './aliases';
import { MailDnsSetup } from './dns-setup';

/** One mail domain (/o/:slug/mail/:mailDomainId), read live from Mailcow. */
export function MailDomainDetailPage() {
  const { t } = useI18n();
  const { mailDomainId } = useParams();
  const { base } = useOrg();
  const domain = useMailDomain(mailDomainId);

  return (
    <>
      <Link
        to={`${base}/mail`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.mail')}
      </Link>
      {domain.isPending ? (
        <LoadingBlock rows={6} />
      ) : domain.isError || !domain.data ? (
        <MailDetailError error={domain.error} onRetry={() => void domain.refetch()} />
      ) : (
        <MailDomainView domain={domain.data} />
      )}
    </>
  );
}

type MailTab = 'overview' | 'mailboxes' | 'aliases' | 'dns';

function MailDomainView({ domain }: { domain: MailDomainDetailDto }) {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const mailHost = domain.clientSettings?.mailHost ?? null;
  // Relay domains pass mail on: Mailcow has no mailboxes or aliases for them in the panel.
  const tabs: { value: MailTab; label: string; icon: ReactNode }[] = [
    { value: 'overview', label: t('mail.tab.overview'), icon: <LayoutGrid className="size-4" /> },
    ...(domain.relay
      ? []
      : [
          { value: 'mailboxes' as const, label: t('mail.tab.mailboxes'), icon: <Inbox className="size-4" /> },
          { value: 'aliases' as const, label: t('mail.tab.aliases'), icon: <Forward className="size-4" /> },
        ]),
    { value: 'dns', label: t('mail.tab.dns'), icon: <ListTree className="size-4" /> },
  ];
  const tabParam = params.get('tab');
  const tab: MailTab = tabs.find((x) => x.value === tabParam)?.value ?? 'overview';

  const select = (value: MailTab) => {
    const next = new URLSearchParams(params);
    if (value === 'overview') next.delete('tab');
    else next.set('tab', value);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <Mail className="size-5 text-muted" aria-hidden />
          <h1 className="font-display truncate text-2xl font-semibold tracking-tight text-text">
            {domain.name}
          </h1>
          <MailDomainStatusBadge domain={domain} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
          {domain.asciiName !== domain.name && (
            <span className="inline-flex items-center gap-1.5">
              <AtSign className="size-3.5" aria-hidden />
              <Mono>{domain.asciiName}</Mono>
            </span>
          )}
          <MailServer location={domain.location} title={domain.provider.name} />
          {mailHost && (
            <span className="inline-flex items-center gap-1.5" title={t('mail.client.mailHost')}>
              <Server className="size-3.5" aria-hidden />
              <Mono>{mailHost}</Mono>
            </span>
          )}
        </div>
      </div>

      {domain.liveError && (
        <Notice tone="warning" title={t('mail.liveError.title')}>
          {t('mail.liveError.text', { provider: domain.provider.name })}
          <span className="mt-1 block font-mono text-xs break-words">{domain.liveError}</span>
        </Notice>
      )}
      {domain.missingSince && (
        <Notice tone="danger" title={t('mail.missing.title')}>
          {t('mail.missing.text', { date: formatDate(domain.missingSince, locale) })}
        </Notice>
      )}
      {domain.relay && (
        <Notice tone="info" title={t('mail.relay.title')}>
          {t('mail.relay.text')}
        </Notice>
      )}

      <div className="overflow-x-auto border-b border-border">
        <nav className="-mb-px flex min-w-max gap-1" aria-label={t('mail.tab.label')}>
          {tabs.map(({ value, label, icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => select(value)}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                tab === value
                  ? 'border-brand-blue text-primary-text'
                  : 'border-transparent text-muted hover:border-border-strong hover:text-text',
              )}
              aria-current={tab === value ? 'page' : undefined}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'mailboxes' ? (
        <MailboxesTab domain={domain} />
      ) : tab === 'aliases' ? (
        <AliasesTab domain={domain} />
      ) : tab === 'dns' ? (
        <MailDnsSetup domain={domain} />
      ) : (
        <MailOverview domain={domain} />
      )}
    </div>
  );
}
