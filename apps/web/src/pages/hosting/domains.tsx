import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  EyeOff,
  Globe,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { DNS_RECORD_TYPES, type DnsRecord, type DnsRecordType, type DomainDetailDto } from '@weblion/shared';
import { ApiError } from '@/lib/api';
import { formatDate, formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import type { TranslationKey } from '@/i18n/de';
import { useDnsMutations, useDnsRecords, useDomain, useDomains, useRevealAuthcode } from '@/lib/api/hosting';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KeyValue,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Flag, ProviderBadge } from '@/components/server-bits';
import { AutoRenewBadge, DetailError, DomainStatusBadge, ExpiryText, ModuleOffState } from './bits';

// --- List ----------------------------------------------------------------------------

export function DomainsPage() {
  const { t } = useI18n();
  const { org, base, hasModule } = useOrg();
  const navigate = useNavigate();
  const domains = useDomains(org.id);
  const [q, setQ] = useState('');
  const moduleOn = hasModule('dns');
  const needle = q.trim().toLowerCase();
  const list = (domains.data ?? []).filter((d) => !needle || d.name.toLowerCase().includes(needle));

  return (
    <>
      <PageHeader title={t('nav.domains')} description={t('hosting.domains.subtitle')} />
      {!moduleOn && !!domains.data?.length && (
        <Notice tone="warning" className="mb-4">
          {t('hosting.moduleOff.staff')}
        </Notice>
      )}
      <Card>
        {domains.isPending ? (
          <LoadingBlock />
        ) : domains.isError ? (
          <div className="p-5">
            <ErrorState error={domains.error} onRetry={() => void domains.refetch()} />
          </div>
        ) : domains.data.length === 0 ? (
          moduleOn ? (
            <EmptyState
              icon={<Globe className="size-6" />}
              title={t('hosting.domains.empty')}
              description={t('hosting.domains.emptyText')}
            />
          ) : (
            <ModuleOffState module="dns" />
          )
        ) : (
          <>
            {domains.data.length > 5 && (
              <div className="border-b border-border px-4 py-3">
                <div className="relative max-w-sm">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t('hosting.domains.search')}
                    className="pl-9"
                    aria-label={t('hosting.domains.search')}
                  />
                </div>
              </div>
            )}
            {list.length === 0 ? (
              <EmptyState icon={<Search className="size-6" />} title={t('hosting.noMatch')} />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>{t('hosting.col.domain')}</TH>
                    <TH>{t('hosting.col.status')}</TH>
                    <TH>{t('hosting.col.expires')}</TH>
                    <TH className="hidden sm:table-cell">{t('hosting.col.autoRenew')}</TH>
                    <TH className="hidden md:table-cell">{t('hosting.col.location')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {list.map((d) => (
                    <TR key={d.id} onClick={() => navigate(`${base}/domains/${d.id}`)}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <Globe className="size-4 shrink-0 text-muted" aria-hidden />
                          <div className="min-w-0">
                            <Link
                              to={`${base}/domains/${d.id}`}
                              className="block truncate font-medium text-text hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {d.name}
                            </Link>
                            <ProviderBadge type={d.provider.type} name={d.provider.name} className="mt-0.5" />
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <DomainStatusBadge domain={d} />
                      </TD>
                      <TD className="whitespace-nowrap">
                        <ExpiryText expiresAt={d.expiresAt} autoRenew={d.autoRenew} />
                      </TD>
                      <TD className="hidden sm:table-cell">
                        <AutoRenewBadge value={d.autoRenew} />
                      </TD>
                      <TD className="hidden md:table-cell">
                        <span className="inline-flex items-center gap-2 text-sm">
                          <Flag country={d.location.country} />
                          <span className="truncate">{d.location.city ?? d.location.label}</span>
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </Card>
    </>
  );
}

// --- Detail --------------------------------------------------------------------------

export function DomainDetailPage() {
  const { t } = useI18n();
  const { domainId } = useParams();
  const { base } = useOrg();
  const domain = useDomain(domainId);

  return (
    <>
      <Link
        to={`${base}/domains`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.domains')}
      </Link>
      {domain.isPending ? (
        <LoadingBlock rows={6} />
      ) : domain.isError || !domain.data ? (
        <DetailError kind="domain" error={domain.error} onRetry={() => void domain.refetch()} />
      ) : (
        <DomainView domain={domain.data} />
      )}
    </>
  );
}

function DomainView({ domain }: { domain: DomainDetailDto }) {
  const { t, locale } = useI18n();
  const info = domain.info;
  const terminated = info?.terminated ?? false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Globe className="size-5 text-muted" aria-hidden />
            <h1 className="font-display truncate text-2xl font-semibold tracking-tight text-text">
              {domain.name}
            </h1>
            <DomainStatusBadge domain={domain} terminated={terminated} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              {t('hosting.col.expires')}:
              <ExpiryText
                expiresAt={info?.expiresAt ?? domain.expiresAt}
                autoRenew={domain.autoRenew}
                className="text-text"
              />
            </span>
            <AutoRenewBadge value={info?.autoRenew ?? domain.autoRenew} long />
            <span className="inline-flex items-center gap-2">
              <Flag country={domain.location.country} />
              {domain.location.city ?? domain.location.label}
            </span>
            <ProviderBadge type={domain.provider.type} name={domain.provider.name} />
          </div>
        </div>
      </div>

      {domain.liveError && (
        <Notice tone="warning" title={t('hosting.liveError.title')}>
          {t('hosting.liveError.text', { provider: domain.provider.name })}
          <span className="mt-1 block font-mono text-xs break-words">{domain.liveError}</span>
        </Notice>
      )}
      {domain.missingSince && (
        <Notice tone="danger" title={t('hosting.missing.title')}>
          {t('hosting.missing.domain', { date: formatDate(domain.missingSince, locale) })}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('hosting.domain.details')} />
          <CardBody className="py-1">
            <KeyValue
              items={[
                {
                  label: t('hosting.col.status'),
                  value: <DomainStatusBadge domain={domain} terminated={terminated} />,
                },
                {
                  label: t('hosting.domain.created'),
                  value: formatDate(info?.createdAt ?? null, locale, false),
                },
                {
                  label: t('hosting.col.expires'),
                  value: (
                    <ExpiryText
                      expiresAt={info?.expiresAt ?? domain.expiresAt}
                      autoRenew={domain.autoRenew}
                    />
                  ),
                },
                {
                  label: t('hosting.col.autoRenew'),
                  value: <AutoRenewBadge value={info?.autoRenew ?? domain.autoRenew} />,
                },
                ...(info?.handle
                  ? [{ label: t('hosting.domain.handle'), value: <Mono>{info.handle}</Mono> }]
                  : []),
                {
                  label: t('hosting.lastSync'),
                  value: domain.lastSyncedAt ? formatRelative(domain.lastSyncedAt, locale) : '–',
                },
              ]}
            />
          </CardBody>
        </Card>
        <NameserverCard nameservers={info?.nameservers ?? []} />
        <AuthcodeCard domain={domain} />
      </div>

      <DnsCard domain={domain} />
    </div>
  );
}

function NameserverCard({ nameservers }: { nameservers: string[] }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader title={t('hosting.domain.nameservers')} description={t('hosting.domain.nameserversText')} />
      <CardBody className="py-2">
        {nameservers.length === 0 ? (
          <p className="py-2 text-sm text-muted">{t('hosting.domain.noNameservers')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {nameservers.map((ns) => (
              <li key={ns} className="flex items-center gap-2 py-2.5">
                <Mono className="min-w-0 flex-1 truncate text-text">{ns}</Mono>
                <CopyButton value={ns} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function AuthcodeCard({ domain }: { domain: DomainDetailDto }) {
  const { t } = useI18n();
  const allowed = domain.permissions.includes('domain:authcode');
  const [confirming, setConfirming] = useState(false);
  const reveal = useRevealAuthcode(domain.id);
  const shown = reveal.data;

  return (
    <Card>
      <CardHeader title={t('hosting.authcode.title')} description={t('hosting.authcode.text')} />
      <CardBody className="space-y-3">
        {shown ? (
          shown.authcode ? (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <Mono className="min-w-0 flex-1 break-all text-text">{shown.authcode}</Mono>
                <CopyButton value={shown.authcode} label={t('hosting.authcode.copy')} />
              </div>
              <p className="text-xs text-muted">{t('hosting.authcode.shownHint')}</p>
            </>
          ) : (
            <Notice tone="info">{t('hosting.authcode.none')}</Notice>
          )
        ) : allowed ? (
          <p className="text-sm text-muted">{t('hosting.authcode.auditHint')}</p>
        ) : (
          <p className="text-sm text-muted">{t('hosting.authcode.noPermission')}</p>
        )}
        {allowed &&
          (shown ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<EyeOff className="size-3.5" />}
              onClick={() => reveal.reset()}
            >
              {t('common.hide')}
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<KeyRound className="size-3.5" />}
              loading={reveal.isPending}
              onClick={() => setConfirming(true)}
            >
              {t('hosting.authcode.show')}
            </Button>
          ))}
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('hosting.authcode.confirmTitle', { name: domain.name })}
        description={t('hosting.authcode.confirmText')}
        confirmLabel={t('hosting.authcode.show')}
        danger={false}
        loading={reveal.isPending}
        onConfirm={() => reveal.mutate(undefined, { onSettled: () => setConfirming(false) })}
      />
    </Card>
  );
}

// --- DNS -----------------------------------------------------------------------------

const APEX = new Set(['', '@']);
const TYPE_RANK = new Map<string, number>(DNS_RECORD_TYPES.map((type, i) => [type, i]));
/** Types whose values tend to be long (keys, hashes, free text). */
const LONG_VALUE_TYPES = new Set(['TXT', 'CAA', 'TLSA', 'DS', 'DNSKEY']);

const LABEL = '[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?';
const HOSTNAME = new RegExp(`^(?=.{1,253}\\.?$)(${LABEL}\\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?\\.?$`, 'i');
const RECORD_NAME = new RegExp(`^(|@|\\*|(\\*\\.)?${LABEL}(\\.${LABEL})*)$`, 'i');
const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^[0-9a-f:.]+$/i;

/** Mirrors the API checks so typos show up before the request. The API stays the authority. */
function dataIssue(type: string, data: string): TranslationKey | null {
  if (!data) return null;
  switch (type) {
    case 'A':
      return IPV4.test(data) ? null : 'hosting.dns.invalid.ipv4';
    case 'AAAA':
      return data.includes(':') && IPV6.test(data) ? null : 'hosting.dns.invalid.ipv6';
    case 'CNAME':
    case 'ALIAS':
    case 'NS':
      return HOSTNAME.test(data) ? null : 'hosting.dns.invalid.host';
    case 'MX': {
      const match = /^(\d{1,5})\s+(\S+)$/.exec(data);
      return match && Number(match[1]) <= 65535 && HOSTNAME.test(match[2]!) ? null : 'hosting.dns.invalid.mx';
    }
    default:
      return null;
  }
}

/** Accepts "www", "@", "" and also full names like "www.example.ch", returns the relative name. */
function relativeName(input: string, zone: string): string {
  let name = input.trim().toLowerCase().replace(/\.$/, '');
  if (name === zone) return '@';
  if (name.endsWith(`.${zone}`)) name = name.slice(0, -(zone.length + 1));
  return name === '' ? '@' : name;
}

/** In tables the name stays on one line (the table scrolls), elsewhere it may wrap. */
function RecordName({ name, zone, wrap }: { name: string; zone: string; wrap?: boolean }) {
  if (APEX.has(name)) return <Mono className={wrap ? 'break-all text-text' : 'text-text'}>{zone}</Mono>;
  return (
    <Mono className={wrap ? 'break-all' : 'whitespace-nowrap'}>
      <span className="text-text">{name}</span>
      <span className="text-subtle">.{zone}</span>
    </Mono>
  );
}

type SortKey = 'type' | 'name';

function compareRecords(a: DnsRecord, b: DnsRecord, key: SortKey): number {
  const rank = (r: DnsRecord) => TYPE_RANK.get(r.type) ?? 999;
  const name = (r: DnsRecord) => (APEX.has(r.name) ? '' : r.name);
  const byType = rank(a) - rank(b) || a.type.localeCompare(b.type);
  const byName = name(a).localeCompare(name(b));
  return (key === 'type' ? byType || byName : byName || byType) || a.data.localeCompare(b.data);
}

function DnsCard({ domain }: { domain: DomainDetailDto }) {
  const { t } = useI18n();
  const records = useDnsRecords(domain.id);
  const canWrite = domain.permissions.includes('domain:dns:write');
  const writable = canWrite && domain.dnsWritable;
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'type', dir: 1 });
  const [editing, setEditing] = useState<DnsRecord | 'new' | null>(null);
  const [deleting, setDeleting] = useState<DnsRecord | null>(null);
  const mutations = useDnsMutations(domain.id, {
    added: t('hosting.dns.added'),
    updated: t('hosting.dns.updated'),
    deleted: t('hosting.dns.deleted'),
  });

  const types = useMemo(
    () =>
      [...new Set((records.data ?? []).map((r) => r.type))].sort(
        (a, b) => (TYPE_RANK.get(a) ?? 999) - (TYPE_RANK.get(b) ?? 999),
      ),
    [records.data],
  );
  const rows = useMemo(
    () =>
      (records.data ?? [])
        .filter((r) => !typeFilter || r.type === typeFilter)
        .sort((a, b) => compareRecords(a, b, sort.key) * sort.dir),
    [records.data, typeFilter, sort],
  );
  const unsupported = records.error instanceof ApiError && records.error.code === 'unsupported';

  const sortHeader = (key: SortKey, label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 tracking-wide uppercase hover:text-text"
      onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))}
    >
      {label}
      {sort.key === key &&
        (sort.dir === 1 ? (
          <ArrowDown className="size-3" aria-hidden />
        ) : (
          <ArrowUp className="size-3" aria-hidden />
        ))}
    </button>
  );

  return (
    <Card>
      <CardHeader
        title={t('hosting.dns.title')}
        description={
          records.data
            ? t('hosting.dns.subtitle', { zone: domain.name, count: records.data.length })
            : t('hosting.dns.subtitleZone', { zone: domain.name })
        }
        actions={
          <>
            {types.length > 1 && (
              <Select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-8 w-auto"
                aria-label={t('hosting.dns.filterType')}
              >
                <option value="">{t('hosting.dns.allTypes')}</option>
                {types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            )}
            {writable && (
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="size-3.5" />}
                onClick={() => setEditing('new')}
              >
                {t('hosting.dns.add')}
              </Button>
            )}
          </>
        }
      />
      {!writable && !unsupported && (
        <div className="border-b border-border px-5 py-3">
          <Notice tone="info">
            {!canWrite
              ? t('hosting.dns.noPermission')
              : domain.provider.type === 'fire24'
                ? t('hosting.dns.needsPlus')
                : t('hosting.dns.notSupported')}
          </Notice>
        </div>
      )}
      {records.isPending ? (
        <LoadingBlock rows={4} />
      ) : unsupported ? (
        <EmptyState icon={<Globe className="size-6" />} title={t('hosting.dns.unavailable')} />
      ) : records.isError ? (
        <div className="p-5">
          <ErrorState error={records.error} onRetry={() => void records.refetch()} />
        </div>
      ) : records.data.length === 0 ? (
        <EmptyState
          icon={<Globe className="size-6" />}
          title={t('hosting.dns.empty')}
          description={writable ? t('hosting.dns.emptyText') : undefined}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH className="w-24">{sortHeader('type', t('hosting.dns.type'))}</TH>
              <TH>{sortHeader('name', t('hosting.dns.name'))}</TH>
              <TH>{t('hosting.dns.data')}</TH>
              <TH className="hidden md:table-cell">TTL</TH>
              {writable && <TH />}
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <tr key={r.id || `${r.type}-${r.name}-${r.data}`}>
                <TD>
                  <Badge tone="primary" className="font-mono">
                    {r.type}
                  </Badge>
                </TD>
                <TD>
                  <RecordName name={r.name} zone={domain.name} />
                </TD>
                <TD className="min-w-[220px]">
                  <div className="flex max-w-[34rem] items-start gap-1">
                    <Mono className="min-w-0 break-all text-text">{r.data}</Mono>
                    <CopyButton value={r.data} className="-mt-0.5" />
                  </div>
                </TD>
                <TD className="hidden whitespace-nowrap text-muted md:table-cell">
                  {r.ttl === null ? '–' : `${r.ttl} s`}
                </TD>
                {writable && (
                  <TD className="text-right whitespace-nowrap">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditing(r)}
                      disabled={!r.id}
                      aria-label={t('common.edit')}
                      title={t('common.edit')}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleting(r)}
                      disabled={!r.id}
                      aria-label={t('common.delete')}
                      title={t('common.delete')}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TD>
                )}
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      {editing && (
        <DnsRecordDialog
          key={editing === 'new' ? 'new' : editing.id}
          zone={domain.name}
          record={editing === 'new' ? null : editing}
          mutations={mutations}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('hosting.dns.deleteTitle')}
        description={t('hosting.dns.deleteText')}
        confirmLabel={t('common.delete')}
        loading={mutations.remove.isPending}
        onConfirm={() =>
          deleting && mutations.remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      >
        {deleting && (
          <div className="mb-1 space-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone="primary" className="font-mono">
                {deleting.type}
              </Badge>
              <RecordName name={deleting.name} zone={domain.name} wrap />
            </div>
            <Mono className="block break-all text-muted">{deleting.data}</Mono>
          </div>
        )}
      </ConfirmDialog>
    </Card>
  );
}

function DnsRecordDialog({
  zone,
  record,
  mutations,
  onClose,
}: {
  zone: string;
  record: DnsRecord | null;
  mutations: ReturnType<typeof useDnsMutations>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<string>(record?.type ?? 'A');
  const [name, setName] = useState(record ? (APEX.has(record.name) ? '@' : record.name) : '');
  const [data, setData] = useState(record?.data ?? '');
  const [touched, setTouched] = useState(false);
  const pending = mutations.add.isPending || mutations.update.isPending;

  const relName = relativeName(name, zone);
  const value = data.trim();
  const nameInvalid = !RECORD_NAME.test(relName);
  const issue = dataIssue(type, value);
  // A CNAME next to the zone's SOA and NS records is invalid DNS, ALIAS covers that case.
  const cnameApex = type === 'CNAME' && relName === '@';
  const valid = !!value && !nameInvalid && !issue && !cnameApex;
  const known = (DNS_RECORD_TYPES as readonly string[]).includes(type);
  const hintKey = (known ? `hosting.dns.hint.${type}` : 'hosting.dns.hint.other') as TranslationKey;
  const placeholderKey = (known ? `hosting.dns.ph.${type}` : 'hosting.dns.ph.other') as TranslationKey;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || !known) return;
    if (!record) {
      mutations.add.mutate(
        { type: type as DnsRecordType, name: relName, data: value },
        { onSuccess: onClose },
      );
      return;
    }
    const patch: { type?: DnsRecordType; name?: string; data?: string } = {};
    if (type !== record.type) patch.type = type as DnsRecordType;
    if (relName !== (APEX.has(record.name) ? '@' : record.name)) patch.name = relName;
    if (value !== record.data) patch.data = value;
    if (Object.keys(patch).length === 0) return onClose();
    mutations.update.mutate({ recordId: record.id, patch }, { onSuccess: onClose });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={record ? t('hosting.dns.editTitle') : t('hosting.dns.addTitle')}
      description={t('hosting.dns.dialogText', { zone })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="dns-record-form"
            variant="primary"
            loading={pending}
            disabled={!value || !known}
          >
            {record ? t('common.save') : t('hosting.dns.add')}
          </Button>
        </>
      }
    >
      <form id="dns-record-form" onSubmit={submit} className="space-y-4">
        <Field label={t('hosting.dns.type')} htmlFor="dns-type">
          <Select id="dns-type" value={type} onChange={(e) => setType(e.target.value)}>
            {!known && <option value={type}>{type}</option>}
            {DNS_RECORD_TYPES.map((rt) => (
              <option key={rt} value={rt}>
                {rt}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('hosting.dns.name')}
          htmlFor="dns-name"
          hint={
            name.trim() && !nameInvalid
              ? t('hosting.dns.nameResult', { fqdn: relName === '@' ? zone : `${relName}.${zone}` })
              : t('hosting.dns.nameHint')
          }
          error={
            touched && nameInvalid
              ? t('hosting.dns.invalid.name')
              : cnameApex
                ? t('hosting.dns.cnameApex')
                : undefined
          }
        >
          <div className="flex items-stretch">
            <Input
              id="dns-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="@"
              className="min-w-0 flex-1 rounded-r-none font-mono"
              autoComplete="off"
              spellCheck={false}
              autoFocus={!record}
            />
            <span
              className="inline-flex max-w-[55%] shrink-0 items-center truncate rounded-r-lg border border-l-0 border-border-strong bg-surface-2 px-2.5 font-mono text-[12.5px] text-muted"
              title={`.${zone}`}
            >
              .{zone}
            </span>
          </div>
        </Field>
        <Field
          label={t('hosting.dns.data')}
          htmlFor="dns-data"
          hint={t(hintKey)}
          error={touched && issue ? t(issue) : undefined}
        >
          {LONG_VALUE_TYPES.has(type) ? (
            <Textarea
              id="dns-data"
              rows={3}
              value={data}
              onChange={(e) => setData(e.target.value.replace(/[\r\n]+/g, ' '))}
              onBlur={() => setTouched(true)}
              placeholder={t(placeholderKey)}
              className="font-mono text-[12.5px]"
              spellCheck={false}
            />
          ) : (
            <Input
              id="dns-data"
              value={data}
              onChange={(e) => setData(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={t(placeholderKey)}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
        <p className="text-xs text-muted">{t('hosting.dns.propagation')}</p>
      </form>
    </Dialog>
  );
}
