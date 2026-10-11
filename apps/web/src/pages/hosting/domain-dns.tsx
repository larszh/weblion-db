import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Cloud,
  CloudOff,
  Globe,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  DNS_RECORD_TYPES,
  DNS_TTL_AUTO,
  type DnsRecord,
  type DnsRecordType,
  type DomainDetailDto,
} from '@weblion/shared';
import { ApiError } from '@/lib/api';
import { useI18n, type TFunction } from '@/lib/i18n';
import type { TranslationKey } from '@/i18n/de';
import { useDnsMutations, useDnsRecords } from '@/lib/api/hosting';
import { useToggleProxy } from '@/lib/api/zones';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Switch, Tooltip } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import {
  RECORD_NAME,
  TTL_OPTIONS,
  TTL_OPTIONS_AUTO,
  dataIssue,
  defaultTtl,
  formProxied,
  formTtl,
  isProxiable,
  newRecordInput,
  recordPatch,
  relativeName,
  type RecordForm,
  type RecordFormOptions,
} from './dns-format';
import { linkedStatus } from './bits';
import { DnsElsewhereCard, zoneState } from './domain-zone';

/** "DNS" tab of a domain: the zone at the provider, edited record by record. */

const APEX = new Set(['', '@']);
const TYPE_RANK = new Map<string, number>(DNS_RECORD_TYPES.map((type, i) => [type, i]));
/** Types whose values tend to be long (keys, hashes, free text). */
const LONG_VALUE_TYPES = new Set(['TXT', 'CAA', 'TLSA', 'DS', 'DNSKEY', 'NAPTR']);

/** Web and mail forwards (Joker URL, FRAME, MAILFW) read better spelled out. */
const TYPE_LABELS: Partial<Record<string, TranslationKey>> = {
  HTTP_REDIRECT: 'hosting.dns.typeLabel.HTTP_REDIRECT',
  HTTP_FRAME: 'hosting.dns.typeLabel.HTTP_FRAME',
  MAILFW: 'hosting.dns.typeLabel.MAILFW',
};

export function recordTypeLabel(t: TFunction, type: string): string {
  const key = TYPE_LABELS[type];
  return key ? t(key) : type;
}

function TypeBadge({ type }: { type: string }) {
  const { t } = useI18n();
  const label = TYPE_LABELS[type];
  return (
    <Badge tone="primary" className={label ? undefined : 'font-mono'} title={label ? type : undefined}>
      {label ? t(label) : type}
    </Badge>
  );
}

/** "1 Stunde" rather than "3600 s" where the value is a whole unit. */
function ttlText(t: TFunction, seconds: number): string {
  const units: [number, TranslationKey, TranslationKey][] = [
    [86_400, 'hosting.dns.ttl.day', 'hosting.dns.ttl.days'],
    [3_600, 'hosting.dns.ttl.hour', 'hosting.dns.ttl.hours'],
    [60, 'hosting.dns.ttl.minute', 'hosting.dns.ttl.minutes'],
  ];
  for (const [size, one, many] of units) {
    if (seconds > 0 && seconds % size === 0) {
      const n = seconds / size;
      return n === 1 ? t(one) : t(many, { n });
    }
  }
  return t('hosting.dns.ttl.seconds', { n: seconds });
}

/** TTL for display; `auto` when the provider reads 1 as "automatic" (capability "dnsTtlAuto"). */
export function ttlLabel(t: TFunction, seconds: number, auto: boolean): string {
  return auto && seconds === DNS_TTL_AUTO ? t('hosting.dns.ttlAuto') : ttlText(t, seconds);
}

const fqdn = (name: string, zone: string) => (APEX.has(name) ? zone : `${name}.${zone}`);

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

export function DomainDns({ domain }: { domain: DomainDetailDto }) {
  const { t } = useI18n();
  const records = useDnsRecords(domain.id);
  const caps = domain.capabilities;
  const isZone = domain.kind === 'zone';
  const canWrite = domain.permissions.includes('domain:dns:write');
  const providerDns = domain.info?.providerDns;
  // The provider refuses changes to a zone it does not serve (Joker answers 422). A DNS zone
  // takes changes before it is active, so a pending zone can be prepared.
  const writable = canWrite && domain.dnsWritable && (providerDns !== false || isZone);
  const options: RecordFormOptions = {
    withTtl: caps.includes('dnsTtl'),
    ttlAuto: caps.includes('dnsTtlAuto'),
    withProxy: caps.includes('dnsProxy'),
  };
  const nameservers = domain.info?.nameservers ?? [];
  const provider = domain.provider.name;
  const zoneStatus = isZone ? zoneState(domain) : null;
  // A registration with a zone of the same name (e.g. at Cloudflare). Its DNS lives there when
  // the registrar does not serve it, or, should the registrar not say, when the zone is active.
  const dnsZone = isZone ? null : domain.dnsZone;
  const elsewhere =
    !!dnsZone && (providerDns === false || ((providerDns ?? null) === null && dnsZone.active === true));
  const toggle = useToggleProxy(domain.id, {
    success: (v) =>
      v.proxied
        ? t('hosting.dns.proxy.toggledOn', { name: v.name })
        : t('hosting.dns.proxy.toggledOff', { name: v.name }),
  });
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
    <>
      {elsewhere && dnsZone && <DnsElsewhereCard domain={domain} zone={dnsZone} />}
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
                      {recordTypeLabel(t, type)}
                    </option>
                  ))}
                </Select>
              )}
              {writable && domain.dnsRecordTypes.length > 0 && (
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
        {/* The card above explains a registration whose DNS is in a zone of the same name. */}
        {providerDns === false && !isZone && !elsewhere && !unsupported && (
          <div className="border-b border-border px-5 py-3">
            <Notice tone="warning" title={t('hosting.dns.externalTitle')}>
              {t('hosting.dns.externalText', { provider })}
              {nameservers.length > 0 && (
                <span className="mt-1 block">
                  {t('hosting.dns.externalNameservers')}{' '}
                  <Mono className="break-all">{nameservers.join(', ')}</Mono>
                </span>
              )}
            </Notice>
          </div>
        )}
        {dnsZone && !elsewhere && (
          <div className="border-b border-border px-5 py-3">
            <Notice tone="info">
              {t('hosting.dnsZone.prepared', {
                provider: dnsZone.provider.name,
                status: linkedStatus(t, dnsZone).label,
              })}
            </Notice>
          </div>
        )}
        {(zoneStatus === 'pending' || zoneStatus === 'initializing') && (
          <div className="border-b border-border px-5 py-3">
            <Notice tone="warning" title={t('hosting.zone.dnsPendingTitle')}>
              {t('hosting.zone.dnsPendingText', { provider })}
            </Notice>
          </div>
        )}
        {zoneStatus === 'moved' && (
          <div className="border-b border-border px-5 py-3">
            <Notice tone="danger">{t('hosting.zone.movedText', { provider })}</Notice>
          </div>
        )}
        {!writable && (providerDns !== false || isZone) && !unsupported && (
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
                {options.withProxy && <TH>{t('hosting.dns.proxy.column')}</TH>}
                <TH className="hidden md:table-cell">{t('hosting.dns.ttl')}</TH>
                {writable && <TH />}
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <tr key={r.id || `${r.type}-${r.name}-${r.data}`}>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1">
                      <TypeBadge type={r.type} />
                      {r.readOnly && (
                        <Tooltip content={t('hosting.dns.readOnlyHint')}>
                          <span tabIndex={0} className="inline-flex">
                            <Badge tone="neutral">
                              <Lock className="size-3" aria-hidden />
                              {t('hosting.dns.readOnly')}
                            </Badge>
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <RecordName name={r.name} zone={domain.name} />
                  </TD>
                  <TD className="min-w-[220px]">
                    <div className="flex max-w-[34rem] items-start gap-1">
                      <Mono className="min-w-0 break-all text-text">{r.data}</Mono>
                      <CopyButton value={r.data} className="-mt-0.5" />
                    </div>
                    {r.comment && (
                      <p className="mt-0.5 flex max-w-[34rem] items-start gap-1.5 text-xs text-muted">
                        <MessageSquare
                          className="mt-0.5 size-3 shrink-0"
                          aria-label={t('hosting.dns.comment')}
                        />
                        <span className="min-w-0 break-words" title={t('hosting.dns.comment')}>
                          {r.comment}
                        </span>
                      </p>
                    )}
                  </TD>
                  {options.withProxy && (
                    <TD className="whitespace-nowrap">
                      <ProxyCell
                        record={r}
                        provider={provider}
                        // Read-only records cannot be changed at all, the proxy flag included.
                        editable={writable && !r.readOnly && !!r.id}
                        pending={toggle.isPending && toggle.variables?.recordId === r.id}
                        onToggle={() =>
                          toggle.mutate({
                            recordId: r.id,
                            proxied: !r.proxied,
                            name: fqdn(r.name, domain.name),
                          })
                        }
                      />
                    </TD>
                  )}
                  <TD className="hidden whitespace-nowrap text-muted md:table-cell">
                    {r.ttl === null ? (
                      '–'
                    ) : (
                      <span
                        title={
                          options.ttlAuto && r.ttl === DNS_TTL_AUTO
                            ? undefined
                            : t('hosting.dns.ttl.seconds', { n: r.ttl })
                        }
                      >
                        {ttlLabel(t, r.ttl, options.ttlAuto)}
                      </span>
                    )}
                  </TD>
                  {writable && (
                    <TD className="text-right whitespace-nowrap">
                      {!r.readOnly && (
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
                      )}
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
            types={domain.dnsRecordTypes}
            options={options}
            flattening={caps.includes('cnameFlattening')}
            provider={provider}
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
                <TypeBadge type={deleting.type} />
                <RecordName name={deleting.name} zone={domain.name} wrap />
              </div>
              <Mono className="block break-all text-muted">{deleting.data}</Mono>
            </div>
          )}
        </ConfirmDialog>
      </Card>
    </>
  );
}

/**
 * Proxy state of one record (Cloudflare's orange cloud). Records the provider cannot proxy
 * show a dash; others a button that switches the proxy, or the state with a hint when the
 * user may not change it.
 */
function ProxyCell({
  record,
  provider,
  editable,
  pending,
  onToggle,
}: {
  record: DnsRecord;
  provider: string;
  editable: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const on = record.proxied === true;
  if (!on && record.proxiable !== true) {
    return (
      <span className="text-subtle" title={t('hosting.dns.proxy.notProxiable')}>
        –
      </span>
    );
  }
  const hint = on ? t('hosting.dns.proxy.onHint', { provider }) : t('hosting.dns.proxy.offHint');
  const content = (
    <>
      {on ? (
        <Cloud className="size-4 shrink-0 fill-current text-[#f38020]" aria-hidden />
      ) : (
        <CloudOff className="size-4 shrink-0 text-subtle" aria-hidden />
      )}
      <span className={on ? 'text-text' : 'text-muted'}>
        {on ? t('hosting.dns.proxy.on') : t('hosting.dns.proxy.off')}
      </span>
    </>
  );
  return (
    <Tooltip content={hint}>
      {editable ? (
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          aria-pressed={on}
          aria-label={on ? t('hosting.dns.proxy.turnOff') : t('hosting.dns.proxy.turnOn')}
          className="-mx-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-surface-3 disabled:cursor-wait disabled:opacity-50"
        >
          {content}
        </button>
      ) : (
        <span tabIndex={0} className="inline-flex items-center gap-1.5 text-xs">
          {content}
        </span>
      )}
    </Tooltip>
  );
}

function DnsRecordDialog({
  zone,
  record,
  types,
  options,
  flattening,
  provider,
  mutations,
  onClose,
}: {
  zone: string;
  record: DnsRecord | null;
  /** Types the provider accepts (DomainDetailDto.dnsRecordTypes). */
  types: DnsRecordType[];
  /** TTL per record, automatic TTL and proxy (capabilities "dnsTtl", "dnsTtlAuto", "dnsProxy"). */
  options: RecordFormOptions;
  /** The provider allows a CNAME at the apex (capability "cnameFlattening"). */
  flattening: boolean;
  provider: string;
  mutations: ReturnType<typeof useDnsMutations>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const offered = types as readonly string[];
  const { withTtl, withProxy } = options;
  const [type, setType] = useState<string>(record?.type ?? (offered.includes('A') ? 'A' : (types[0] ?? 'A')));
  const [name, setName] = useState(record ? (APEX.has(record.name) ? '@' : record.name) : '');
  const [data, setData] = useState(record?.data ?? '');
  const initialTtl = record?.ttl ?? defaultTtl(options);
  const [ttl, setTtl] = useState(initialTtl);
  const [proxied, setProxied] = useState(record?.proxied === true);
  const [touched, setTouched] = useState(false);
  const pending = mutations.add.isPending || mutations.update.isPending;

  const relName = relativeName(name, zone);
  const value = data.trim();
  const form: RecordForm = { type, name: relName, data: value, ttl, proxied };
  const proxyOn = formProxied(form, options);
  // The provider said so for this very record; a new value may change its mind.
  const notProxiable =
    !!record && record.proxiable === false && type === record.type && value === record.data;
  const nameInvalid = !RECORD_NAME.test(relName);
  const issue = dataIssue(type, value);
  // A CNAME next to the zone's SOA and NS records is invalid DNS, ALIAS covers that case.
  // Providers with CNAME flattening (Cloudflare) answer with the target's addresses instead.
  const apexCname = type === 'CNAME' && relName === '@';
  const cnameApex = apexCname && !flattening;
  const supported = offered.includes(type);
  const valid = !!value && !nameInvalid && !issue && !cnameApex && supported;
  const known = (DNS_RECORD_TYPES as readonly string[]).includes(type);
  const hintKey = (known ? `hosting.dns.hint.${type}` : 'hosting.dns.hint.other') as TranslationKey;
  const placeholderKey = (known ? `hosting.dns.ph.${type}` : 'hosting.dns.ph.other') as TranslationKey;
  // Keep an unusual TTL of an existing record (e.g. 0 or 7200) selectable.
  const ttlOptions = [
    ...new Set<number>([...(options.ttlAuto ? TTL_OPTIONS_AUTO : TTL_OPTIONS), initialTtl]),
  ].sort((a, b) => a - b);
  const ttlAutoLabel = options.ttlAuto || withProxy;

  const changeType = (next: string) => {
    setType(next);
    // Only A, AAAA and CNAME can go through the proxy.
    if (!isProxiable(next)) setProxied(false);
  };

  const nameHint = () => {
    if (apexCname && flattening && !nameInvalid) return t('hosting.dns.cnameFlattening', { provider });
    if (!name.trim() || nameInvalid) {
      return type === 'MAILFW' ? t('hosting.dns.nameHintMailfw', { zone }) : t('hosting.dns.nameHint');
    }
    if (type === 'MAILFW' && relName !== '@' && relName !== '*') {
      return t('hosting.dns.mailfwResult', { address: `${relName}@${zone}` });
    }
    return t('hosting.dns.nameResult', { fqdn: relName === '@' ? zone : `${relName}.${zone}` });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    if (!record) {
      mutations.add.mutate(newRecordInput(form, options), { onSuccess: onClose });
      return;
    }
    // Only what changed. Left out, the provider keeps the record's TTL and proxy flag.
    const patch = recordPatch(record, form, options);
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
            disabled={!value || !supported}
          >
            {record ? t('common.save') : t('hosting.dns.add')}
          </Button>
        </>
      }
    >
      <form id="dns-record-form" onSubmit={submit} className="space-y-4">
        <div className={withTtl ? 'grid gap-4 sm:grid-cols-[1fr_180px]' : undefined}>
          <Field
            label={t('hosting.dns.type')}
            htmlFor="dns-type"
            error={supported ? undefined : t('hosting.dns.typeUnsupported')}
          >
            <Select id="dns-type" value={type} onChange={(e) => changeType(e.target.value)}>
              {!supported && <option value={type}>{recordTypeLabel(t, type)}</option>}
              {types.map((rt) => (
                <option key={rt} value={rt}>
                  {recordTypeLabel(t, rt)}
                </option>
              ))}
            </Select>
          </Field>
          {withTtl && (
            <Field label={t('hosting.dns.ttl')} htmlFor="dns-ttl">
              {/* Proxied records always have the automatic TTL. */}
              <Select
                id="dns-ttl"
                value={formTtl(form, options)}
                onChange={(e) => setTtl(Number(e.target.value))}
                disabled={proxyOn}
              >
                {(proxyOn ? [DNS_TTL_AUTO] : ttlOptions).map((s) => (
                  <option key={s} value={s}>
                    {ttlLabel(t, s, ttlAutoLabel)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field
          label={t('hosting.dns.name')}
          htmlFor="dns-name"
          hint={nameHint()}
          error={
            touched && nameInvalid
              ? t('hosting.dns.invalid.name')
              : cnameApex
                ? offered.includes('ALIAS')
                  ? t('hosting.dns.cnameApex')
                  : t('hosting.dns.cnameApexNoAlias')
                : undefined
          }
        >
          <div className="flex items-stretch">
            <Input
              id="dns-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={type === 'MAILFW' ? 'info' : '@'}
              className="min-w-0 flex-1 rounded-r-none font-mono"
              autoComplete="off"
              spellCheck={false}
              autoFocus={!record}
            />
            <span
              className="inline-flex max-w-[55%] shrink-0 items-center truncate rounded-r-lg border border-l-0 border-border-strong bg-surface-2 px-2.5 font-mono text-[12.5px] text-muted"
              title={type === 'MAILFW' ? `@${zone}` : `.${zone}`}
            >
              {type === 'MAILFW' ? '@' : '.'}
              {zone}
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
        {withProxy && isProxiable(type) && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">{t('hosting.dns.proxy.label')}</p>
              <p className="mt-0.5 text-xs text-muted">
                {notProxiable ? t('hosting.dns.proxy.notProxiable') : t('hosting.dns.proxy.hint')}
              </p>
            </div>
            <Switch
              checked={proxied}
              onCheckedChange={setProxied}
              // Switching it off stays possible, should the provider ever disagree.
              disabled={notProxiable && !proxied}
              label={t('hosting.dns.proxy.label')}
            />
          </div>
        )}
        <p className="text-xs text-muted">{t('hosting.dns.propagation')}</p>
      </form>
    </Dialog>
  );
}
