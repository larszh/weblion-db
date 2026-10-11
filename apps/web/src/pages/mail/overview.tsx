import type { ReactNode } from 'react';
import type { MailDomainDetailDto, MailServerEndpoint } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  Mono,
  Notice,
  UsageBar,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { PanelLink, safePanelUrl } from '@/pages/hosting/bits';
import { allocatedPercent, countOf, rateLimitText } from './bits';
import { formatMailSize } from './units';

/** Overview tab of a mail domain: its limits and how mail programs connect. */
export function MailOverview({ domain }: { domain: MailDomainDetailDto }) {
  return (
    <div className="grid gap-6 2xl:grid-cols-2">
      <LimitsCard domain={domain} />
      <ClientSettingsCard domain={domain} />
    </div>
  );
}

function LimitsCard({ domain }: { domain: MailDomainDetailDto }) {
  const { t, locale } = useI18n();
  const { limits, usage } = domain;
  return (
    <Card>
      <CardHeader title={t('mail.limits.title')} description={t('mail.limits.text')} />
      {!limits || !usage ? (
        <CardBody>
          <p className="text-sm text-muted">{t('mail.limits.none')}</p>
        </CardBody>
      ) : (
        <CardBody className="space-y-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Figure
              label={t('mail.limits.mailboxes')}
              value={countOf(t, locale, usage.mailboxes, limits.maxMailboxes)}
            />
            <Figure
              label={t('mail.limits.aliases')}
              value={countOf(t, locale, usage.aliases, limits.maxAliases)}
            />
            <Figure label={t('mail.limits.used')} value={formatMailSize(usage.usedBytes, locale)} />
          </dl>
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-muted">{t('mail.limits.storage')}</span>
              <span className="font-medium text-text tabular">
                {t('mail.limits.storageValue', {
                  allocated: formatMailSize(usage.allocatedBytes, locale),
                  quota: formatMailSize(limits.quotaBytes, locale),
                })}
              </span>
            </div>
            <UsageBar value={allocatedPercent(limits, usage)} className="mt-2 h-2" />
            <p className="mt-1.5 text-xs text-muted">{t('mail.limits.storageHint')}</p>
          </div>
          <dl className="divide-y divide-border border-t border-border">
            <Row
              label={t('mail.limits.defaultSize')}
              value={formatMailSize(limits.defaultMailboxQuotaBytes, locale)}
            />
            <Row
              label={t('mail.limits.maxSize')}
              value={formatMailSize(limits.maxMailboxQuotaBytes, locale)}
            />
            <Row label={t('mail.limits.rateLimit')} value={rateLimitText(t, locale, limits.rateLimit)} />
            <Row
              label={t('mail.limits.active')}
              value={
                domain.active ? (
                  <Badge tone="success">{t('mail.limits.activeYes')}</Badge>
                ) : (
                  <Badge tone="neutral">{t('mail.limits.activeNo')}</Badge>
                )
              }
            />
          </dl>
        </CardBody>
      )}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-lg font-semibold text-text tabular">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(140px,50%)_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-text tabular">{value}</dd>
    </div>
  );
}

const PROTOCOLS = ['imap', 'smtp', 'pop3'] as const;

function ClientSettingsCard({ domain }: { domain: MailDomainDetailDto }) {
  const { t } = useI18n();
  const settings = domain.clientSettings;
  const webmail = safePanelUrl(settings?.webmailUrl);
  return (
    <Card>
      <CardHeader
        title={t('mail.client.title')}
        description={t('mail.client.text')}
        actions={
          webmail && (
            <PanelLink href={webmail} variant="secondary" size="sm">
              {t('mail.client.webmail')}
            </PanelLink>
          )
        }
      />
      {!settings ? (
        <CardBody>
          <p className="text-sm text-muted">{t('mail.client.none')}</p>
        </CardBody>
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>{t('mail.client.protocol')}</TH>
                <TH>{t('mail.client.server')}</TH>
                <TH>{t('mail.client.port')}</TH>
                <TH>{t('mail.client.security')}</TH>
              </tr>
            </THead>
            <TBody>
              {PROTOCOLS.flatMap((protocol) =>
                settings[protocol].map((endpoint, i) => (
                  <EndpointRow
                    key={`${protocol}-${endpoint.port}`}
                    label={i === 0 ? t(`mail.client.${protocol}`) : null}
                    endpoint={endpoint}
                    preferred={i === 0 && settings[protocol].length > 1}
                  />
                )),
              )}
            </TBody>
          </Table>
          <CardBody className="space-y-2 border-t border-border">
            <Notice tone="info">{t('mail.client.username')}</Notice>
            <p className="text-xs text-muted">{t('mail.client.smtpAuth')}</p>
          </CardBody>
        </>
      )}
    </Card>
  );
}

function EndpointRow({
  label,
  endpoint,
  preferred,
}: {
  label: string | null;
  endpoint: MailServerEndpoint;
  preferred: boolean;
}) {
  const { t } = useI18n();
  return (
    <tr>
      <TD className="font-medium whitespace-nowrap">{label}</TD>
      <TD>
        <span className="inline-flex max-w-full items-center gap-1">
          <Mono className="truncate">{endpoint.host}</Mono>
          <CopyButton value={endpoint.host} />
        </span>
      </TD>
      <TD>
        <span className="inline-flex items-center gap-1 tabular">
          <Mono>{endpoint.port}</Mono>
          <CopyButton value={String(endpoint.port)} />
        </span>
      </TD>
      <TD className="whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          {endpoint.security === 'ssl' ? t('mail.client.ssl') : t('mail.client.starttls')}
          {preferred && <Badge tone="primary">{t('mail.client.preferred')}</Badge>}
        </span>
      </TD>
    </tr>
  );
}
