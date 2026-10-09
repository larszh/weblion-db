import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Globe, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { DNS_RECORD_TYPES, type DnsRecord, type DnsRecordType, type DomainDetailDto } from '@weblion/shared';
import { ApiError } from '@/lib/api';
import { useI18n, type TFunction } from '@/lib/i18n';
import type { TranslationKey } from '@/i18n/de';
import { useDnsMutations, useDnsRecords } from '@/lib/api/hosting';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Tooltip } from '@/components/ui/menu';
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
import { DEFAULT_TTL, RECORD_NAME, TTL_OPTIONS, dataIssue, relativeName } from './dns-format';

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
  const canWrite = domain.permissions.includes('domain:dns:write');
  const providerDns = domain.info?.providerDns;
  // The provider refuses changes to a zone it does not serve (Joker answers 422).
  const writable = canWrite && domain.dnsWritable && providerDns !== false;
  const withTtl = domain.capabilities.includes('dnsTtl');
  const nameservers = domain.info?.nameservers ?? [];
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
      {providerDns === false && !unsupported && (
        <div className="border-b border-border px-5 py-3">
          <Notice tone="warning" title={t('hosting.dns.externalTitle')}>
            {t('hosting.dns.externalText', { provider: domain.provider.name })}
            {nameservers.length > 0 && (
              <span className="mt-1 block">
                {t('hosting.dns.externalNameservers')}{' '}
                <Mono className="break-all">{nameservers.join(', ')}</Mono>
              </span>
            )}
          </Notice>
        </div>
      )}
      {!writable && providerDns !== false && !unsupported && (
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
                </TD>
                <TD className="hidden whitespace-nowrap text-muted md:table-cell">
                  {r.ttl === null ? (
                    '–'
                  ) : (
                    <span title={t('hosting.dns.ttl.seconds', { n: r.ttl })}>{ttlText(t, r.ttl)}</span>
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
          withTtl={withTtl}
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
  );
}

function DnsRecordDialog({
  zone,
  record,
  types,
  withTtl,
  mutations,
  onClose,
}: {
  zone: string;
  record: DnsRecord | null;
  /** Types the provider accepts (DomainDetailDto.dnsRecordTypes). */
  types: DnsRecordType[];
  /** The provider takes a TTL per record (capability "dnsTtl"). */
  withTtl: boolean;
  mutations: ReturnType<typeof useDnsMutations>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const offered = types as readonly string[];
  const [type, setType] = useState<string>(record?.type ?? (offered.includes('A') ? 'A' : (types[0] ?? 'A')));
  const [name, setName] = useState(record ? (APEX.has(record.name) ? '@' : record.name) : '');
  const [data, setData] = useState(record?.data ?? '');
  const initialTtl = record?.ttl ?? DEFAULT_TTL;
  const [ttl, setTtl] = useState(initialTtl);
  const [touched, setTouched] = useState(false);
  const pending = mutations.add.isPending || mutations.update.isPending;

  const relName = relativeName(name, zone);
  const value = data.trim();
  const nameInvalid = !RECORD_NAME.test(relName);
  const issue = dataIssue(type, value);
  // A CNAME next to the zone's SOA and NS records is invalid DNS, ALIAS covers that case.
  const cnameApex = type === 'CNAME' && relName === '@';
  const supported = offered.includes(type);
  const valid = !!value && !nameInvalid && !issue && !cnameApex && supported;
  const known = (DNS_RECORD_TYPES as readonly string[]).includes(type);
  const hintKey = (known ? `hosting.dns.hint.${type}` : 'hosting.dns.hint.other') as TranslationKey;
  const placeholderKey = (known ? `hosting.dns.ph.${type}` : 'hosting.dns.ph.other') as TranslationKey;
  // Keep an unusual TTL of an existing record (e.g. 0 or 7200) selectable.
  const ttlOptions = [...new Set<number>([...TTL_OPTIONS, initialTtl])].sort((a, b) => a - b);

  const nameHint = () => {
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
      mutations.add.mutate(
        { type: type as DnsRecordType, name: relName, data: value, ...(withTtl ? { ttl } : {}) },
        { onSuccess: onClose },
      );
      return;
    }
    const patch: { type?: DnsRecordType; name?: string; data?: string; ttl?: number } = {};
    if (type !== record.type) patch.type = type as DnsRecordType;
    if (relName !== (APEX.has(record.name) ? '@' : record.name)) patch.name = relName;
    if (value !== record.data) patch.data = value;
    // Left out, the provider keeps the record's TTL.
    if (withTtl && ttl !== initialTtl) patch.ttl = ttl;
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
            <Select id="dns-type" value={type} onChange={(e) => setType(e.target.value)}>
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
              <Select id="dns-ttl" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                {ttlOptions.map((s) => (
                  <option key={s} value={s}>
                    {ttlText(t, s)}
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
        <p className="text-xs text-muted">{t('hosting.dns.propagation')}</p>
      </form>
    </Dialog>
  );
}
