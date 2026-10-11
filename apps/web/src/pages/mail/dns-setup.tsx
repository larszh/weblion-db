import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, KeyRound, ListPlus } from 'lucide-react';
import {
  MAIL_DKIM_KEY_SIZES,
  MAIL_DEFAULT_DKIM_KEY_SIZE,
  type MailDkimKeySize,
  type MailDnsApplyResult,
  type MailDnsRecordDto,
  type MailDnsSetupDto,
  type MailDnsStatus,
  type MailDomainDetailDto,
} from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useDomains } from '@/lib/api/hosting';
import { useApplyMailDns, useCreateDkim, useMailDns } from '@/lib/api/mail';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  ErrorState,
  Field,
  LoadingBlock,
  Mono,
  Notice,
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { ProviderBadge } from '@/components/server-bits';
import { mailDnsApplyOutcome, type MailDnsApplyOutcome } from './dns-apply';

/**
 * DNS tab of a mail domain: the records Mailcow needs, compared with the panel's DNS zone of
 * the same name, the DKIM key, and "add missing records". Conflicting records are shown, never
 * changed.
 */

const STATUS_TONE: Record<MailDnsStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  missing: 'danger',
  conflict: 'warning',
  unknown: 'neutral',
};

const APPLY_TONE: Record<MailDnsApplyOutcome, 'success' | 'warning' | 'danger' | 'info'> = {
  added: 'success',
  partial: 'warning',
  failed: 'danger',
  nothing: 'info',
};

export function MailDnsSetup({ domain }: { domain: MailDomainDetailDto }) {
  const { t } = useI18n();
  const dns = useMailDns(domain.id);
  const [result, setResult] = useState<MailDnsApplyResult | null>(null);

  if (dns.isPending) return <LoadingBlock rows={6} />;
  if (dns.isError) return <ErrorState error={dns.error} onRetry={() => void dns.refetch()} />;
  const setup = dns.data;

  return (
    <div className="space-y-6">
      <ZoneNotices setup={setup} />
      {result && <ApplyResult result={result} onClose={() => setResult(null)} />}
      <DkimCard domain={domain} setup={setup} />
      <RecordsCard domain={domain} setup={setup} onApplied={setResult} />
      <Card>
        <CardHeader title={t('mail.dns.explain.title')} />
        <CardBody>
          <dl className="space-y-2.5 text-sm">
            {(['mx', 'spf', 'dkim', 'dmarc', 'autodiscover'] as const).map((key) => (
              <div key={key} className="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-3">
                <dt className="font-medium text-text">{t(`mail.dns.explain.${key}.label`)}</dt>
                <dd className="text-muted">{t(`mail.dns.explain.${key}`)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted">{t('mail.dns.explain.conflicts')}</p>
        </CardBody>
      </Card>
    </div>
  );
}

function ZoneNotices({ setup }: { setup: MailDnsSetupDto }) {
  const { t } = useI18n();
  const zone = setup.zone;
  if (!zone) return <Notice tone="info">{t('mail.dns.noZone')}</Notice>;
  return (
    <div className="space-y-3">
      {zone.error && (
        <Notice tone="warning" title={t('mail.dns.zoneError')}>
          <span className="font-mono text-xs break-words">{zone.error}</span>
        </Notice>
      )}
      {zone.live === false && (
        <Notice tone="warning" title={t('mail.dns.notLiveTitle')}>
          {t('mail.dns.notLive', { domain: zone.name, provider: zone.provider.name })}
        </Notice>
      )}
      {!zone.writable && (
        <Notice tone="info">{t('mail.dns.notWritable', { provider: zone.provider.name })}</Notice>
      )}
      {zone.writable && !zone.canEdit && <Notice tone="info">{t('mail.dns.noPermission')}</Notice>}
    </div>
  );
}

function ApplyResult({ result, onClose }: { result: MailDnsApplyResult; onClose: () => void }) {
  const { t } = useI18n();
  const outcome = mailDnsApplyOutcome(result);
  return (
    <Notice tone={APPLY_TONE[outcome]} title={t(`mail.dns.applied.title.${outcome}`)}>
      <div className="space-y-1.5">
        {result.added.length > 0 && (
          <p>
            {t('mail.dns.applied.added', {
              list: result.added.map((k) => t(`mail.dns.key.${k}`)).join(', '),
            })}
          </p>
        )}
        {result.added.length === 0 && result.failed.length === 0 && <p>{t('mail.dns.applied.nothing')}</p>}
        {result.skipped.length > 0 && (
          <ul className="list-inside list-disc">
            {result.skipped.map((s) => (
              <li key={s.key}>
                {t(`mail.dns.key.${s.key}`)}: {t(`mail.dns.skip.${s.reason}`)}
              </li>
            ))}
          </ul>
        )}
        {result.failed.length > 0 && (
          <ul className="list-inside list-disc">
            {result.failed.map((f) => (
              <li key={f.key}>
                {t('mail.dns.applied.failed', { key: t(`mail.dns.key.${f.key}`) })}{' '}
                <span className="font-mono text-xs break-words">{f.error}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="text-xs font-medium underline underline-offset-2" onClick={onClose}>
          {t('common.hide')}
        </button>
      </div>
    </Notice>
  );
}

function DkimCard({ domain, setup }: { domain: MailDomainDetailDto; setup: MailDnsSetupDto }) {
  const { t } = useI18n();
  const canWrite = domain.permissions.includes('mail:write');
  const [keySize, setKeySize] = useState<MailDkimKeySize>(MAIL_DEFAULT_DKIM_KEY_SIZE);
  const create = useCreateDkim(domain.id, t('mail.dns.dkimCreated'));
  const { dkim } = setup;
  return (
    <Card>
      <CardHeader title={t('mail.dns.dkimTitle')} description={t('mail.dns.dkimText')} />
      <CardBody>
        {dkim.present === null ? (
          // Mailcow could not be asked: the domain may well have a key, so none is offered.
          <Notice tone="warning">{t('mail.dns.dkimUnreadable')}</Notice>
        ) : dkim.present ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">{t('mail.dns.dkimSelector')}</dt>
              <dd className="mt-0.5">
                <Mono className="text-text">{dkim.selector}</Mono>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('mail.dns.dkimLength')}</dt>
              <dd className="mt-0.5 text-sm text-text tabular">
                {dkim.keyLength ? t('mail.dns.dkimBits', { n: dkim.keyLength }) : '–'}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">{t('mail.dns.dkimMissing')}</p>
            {canWrite && (
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t('mail.dns.dkimLength')} htmlFor="dkim-size" hint={t('mail.dns.dkimSizeHint')}>
                  <Select
                    id="dkim-size"
                    value={keySize}
                    onChange={(e) => setKeySize(Number(e.target.value) as MailDkimKeySize)}
                    className="w-40"
                  >
                    {MAIL_DKIM_KEY_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {t('mail.dns.dkimBits', { n: size })}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  variant="primary"
                  icon={<KeyRound className="size-4" />}
                  loading={create.isPending}
                  onClick={() => create.mutate(keySize)}
                  className="mb-[22px]"
                >
                  {t('mail.dns.dkimCreate')}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RecordsCard({
  domain,
  setup,
  onApplied,
}: {
  domain: MailDomainDetailDto;
  setup: MailDnsSetupDto;
  onApplied: (result: MailDnsApplyResult) => void;
}) {
  const { t } = useI18n();
  const { org, base, can, hasModule } = useOrg();
  const [confirming, setConfirming] = useState(false);
  const zone = setup.zone;
  const addable = setup.records.filter((r) => r.addable);
  const apply = useApplyMailDns(domain.id, {
    success: (r) =>
      r.failed.length === 0 && r.added.length > 0 ? t('mail.dns.applied.toast', { n: r.added.length }) : null,
    onSuccess: (r) => {
      setConfirming(false);
      onApplied(r);
    },
  });
  // The link to the zone only makes sense when the domain belongs to this organization.
  const orgDomains = useDomains(org.id, !!zone && hasModule('dns') && can('domain:read'));
  const zoneHere = !!zone && (orgDomains.data ?? []).some((d) => d.id === zone.domainId);

  return (
    <Card>
      <CardHeader
        title={t('mail.dns.recordsTitle')}
        description={
          zone ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {t('mail.dns.recordsZone', { domain: zone.name })}
              <ProviderBadge type={zone.provider.type} name={zone.provider.name} />
            </span>
          ) : (
            t('mail.dns.recordsText', { host: setup.mailHost })
          )
        }
        actions={
          <>
            {zoneHere && zone && (
              <Link
                to={`${base}/domains/${zone.domainId}?tab=dns`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-primary-text hover:bg-surface-3"
              >
                {t('mail.dns.toZone')} <ArrowRight className="size-3.5" />
              </Link>
            )}
            {addable.length > 0 && (
              <Button
                size="sm"
                variant="primary"
                icon={<ListPlus className="size-4" />}
                onClick={() => setConfirming(true)}
              >
                {t('mail.dns.apply', { n: addable.length })}
              </Button>
            )}
          </>
        }
      />
      <Table>
        <THead>
          <tr>
            <TH>{t('mail.dns.col.status')}</TH>
            <TH>{t('mail.dns.col.type')}</TH>
            <TH>{t('mail.dns.col.name')}</TH>
            <TH>{t('mail.dns.col.value')}</TH>
          </tr>
        </THead>
        <TBody>
          {setup.records.map((r) => (
            <RecordRow key={r.key} record={r} dkimUnread={setup.dkim.present === null} />
          ))}
        </TBody>
      </Table>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('mail.dns.applyTitle')}
        description={
          zone ? t('mail.dns.applyText', { domain: zone.name, provider: zone.provider.name }) : undefined
        }
        confirmLabel={t('mail.dns.applyConfirm', { n: addable.length })}
        danger={false}
        loading={apply.isPending}
        onConfirm={() => apply.mutate(addable.map((r) => r.key))}
      >
        <ul className="space-y-2 text-sm">
          {addable.map((r) => (
            <li key={r.key} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge tone="primary">{r.type}</Badge>
                <Mono className="text-text">{r.name}</Mono>
              </div>
              <Mono className="mt-1 block text-xs break-all text-muted">{r.data}</Mono>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </Card>
  );
}

function RecordRow({ record: r, dkimUnread }: { record: MailDnsRecordDto; dkimUnread: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <tr className="align-top">
      <TD className="whitespace-nowrap">
        <div className="flex flex-col items-start gap-1">
          <Badge tone={STATUS_TONE[r.status]}>{t(`mail.dns.status.${r.status}`)}</Badge>
          <Badge tone={r.required ? 'primary' : 'neutral'} className="px-1.5 text-[11px]">
            {r.required ? t('mail.dns.required') : t('mail.dns.recommended')}
          </Badge>
        </div>
      </TD>
      <TD>
        <div className="text-sm font-medium text-text">{t(`mail.dns.key.${r.key}`)}</div>
        <Badge tone="primary" className="mt-1 font-mono">
          {r.type}
        </Badge>
      </TD>
      <TD className="max-w-[240px]">
        <Mono className="block break-all text-text">{r.name}</Mono>
        <span className="mt-0.5 inline-flex max-w-full items-center gap-1">
          <Mono className="truncate text-xs text-muted">{r.fqdn}</Mono>
          <CopyButton value={r.fqdn} />
        </span>
      </TD>
      <TD className="min-w-[240px]">
        {r.data ? (
          <div className="flex max-w-[34rem] items-start gap-1">
            <Mono className="min-w-0 break-all text-text">{r.data}</Mono>
            <CopyButton value={r.data} className="-mt-0.5" />
          </div>
        ) : (
          <span className="text-sm text-muted">
            {r.key === 'dkim' && dkimUnread ? t('mail.dns.dkimUnreadableShort') : t('mail.dns.noKeyYet')}
          </span>
        )}
        {r.hint && <p className="mt-1 max-w-[34rem] text-xs text-warning">{t(`mail.dns.hint.${r.hint}`)}</p>}
        {r.found.length > 0 && r.status !== 'ok' && (
          <div className="mt-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-text"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {t('mail.dns.found', { n: r.found.length })}
            </button>
            {open && (
              <ul className="mt-1 space-y-1">
                {r.found.map((value, i) => (
                  <li key={i} className="max-w-[34rem]">
                    <Mono className="block text-xs break-all text-muted">{value}</Mono>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </TD>
    </tr>
  );
}
