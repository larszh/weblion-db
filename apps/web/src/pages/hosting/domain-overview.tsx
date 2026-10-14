import { useState, type FormEvent } from 'react';
import { CalendarPlus, EyeOff, KeyRound, Pencil, Plus, RotateCw, X } from 'lucide-react';
import type { DomainDetailDto, DomainRegistrant, ProviderType } from '@weblion/shared';
import { formatDate, formatRelative } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import type { TranslationKey } from '@/i18n/de';
import {
  isAuthcodePending,
  useRevealAuthcode,
  useSetDomainLock,
  useSetNameservers,
  type DomainActionResult,
} from '@/lib/api/hosting';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  Input,
  KeyValue,
  Mono,
  Notice,
} from '@/components/ui/primitives';
import { RelatedMonitorsCard } from '@/pages/monitoring/related';
import { AutoRenewBadge, DomainStatusBadge, ExpiryText, LockBadge } from './bits';
import {
  ActionResultNotice,
  AutoRenewDialog,
  RenewDialog,
  useCanRenew,
  withProviderRef,
  type RenewalTarget,
} from './domain-actions';
import { NAMESERVERS_MAX, NAMESERVERS_MIN, nameserverIssue, normalizeNameserver } from './dns-format';
import { DnsZoneLine, ZoneOverview } from './domain-zone';
import { DnsMoveCard, DnsMoveDialog, useCanMoveDns } from './dns-move';

/**
 * "Übersicht" tab of a domain: registrar facts, name servers, transfer and renewal. DNS zones
 * (Cloudflare) have an overview of their own.
 */
export function DomainOverview({ domain }: { domain: DomainDetailDto }) {
  const canRenew = useCanRenew();
  const canMove = useCanMoveDns();
  // Kept here, not in the card: the dialog shows the result even when the card goes away.
  const [moving, setMoving] = useState(false);
  if (domain.kind === 'zone') {
    return (
      <div className="space-y-6">
        <ZoneOverview domain={domain} />
        <RelatedMonitorsCard kind="domain" id={domain.id} />
      </div>
    );
  }

  const caps = domain.capabilities;
  const registrant = domain.info?.registrant;
  const showTransfer = caps.includes('lock') || caps.includes('authcode');
  const showRenewal = canRenew && (caps.includes('autoRenew') || caps.includes('renew'));
  const showMove = canMove && !domain.missingSince && !domain.dnsZone?.active;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <DetailsCard domain={domain} />
      <NameserverCard domain={domain} />
      {showTransfer && <TransferCard domain={domain} />}
      {registrant && <RegistrantCard registrant={registrant} />}
      {showRenewal && <RenewalCard domain={domain} />}
      {showMove && <DnsMoveCard onStart={() => setMoving(true)} />}
      {moving && <DnsMoveDialog domain={domain} onClose={() => setMoving(false)} />}
      <div className="lg:col-span-3 empty:hidden">
        <RelatedMonitorsCard kind="domain" id={domain.id} />
      </div>
    </div>
  );
}

/** Registrars report "none", "basic", "pro" and the like. */
function privacyLabel(t: TFunction, value: string): string {
  if (/^(none|off|no|false|0)$/i.test(value)) return t('hosting.domain.privacyNone');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function DetailsCard({ domain }: { domain: DomainDetailDto }) {
  const { t, locale } = useI18n();
  const info = domain.info;
  const terminated = info?.terminated ?? false;
  const autoRenew = info?.autoRenew ?? domain.autoRenew;

  return (
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
              value: <ExpiryText expiresAt={info?.expiresAt ?? domain.expiresAt} autoRenew={autoRenew} />,
            },
            { label: t('hosting.col.autoRenew'), value: <AutoRenewBadge value={autoRenew} /> },
            ...(info?.locked !== undefined && info.locked !== null
              ? [{ label: t('hosting.lock.title'), value: <LockBadge locked={info.locked} /> }]
              : []),
            ...(info?.privacy
              ? [{ label: t('hosting.domain.privacy'), value: privacyLabel(t, info.privacy) }]
              : []),
            ...(info?.dnssec !== undefined && info.dnssec !== null
              ? [
                  {
                    label: 'DNSSEC',
                    value: info.dnssec ? (
                      <Badge tone="success">{t('hosting.domain.dnssecOn')}</Badge>
                    ) : (
                      <span className="text-muted">{t('hosting.domain.dnssecOff')}</span>
                    ),
                  },
                ]
              : []),
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
  );
}

// --- Name servers --------------------------------------------------------------------

/** One-click name server sets per registrar. */
const NAMESERVER_PRESETS: Partial<
  Record<ProviderType, { label: TranslationKey; hint: TranslationKey; nameservers: string[] }>
> = {
  joker: {
    label: 'hosting.ns.presetJoker',
    hint: 'hosting.ns.presetJokerHint',
    nameservers: ['a.ns.joker.com', 'b.ns.joker.com', 'c.ns.joker.com'],
  },
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

interface NameserverPreset {
  label: string;
  hint: string;
  nameservers: string[];
}

/**
 * The name servers of a DNS zone of the same name (e.g. at Cloudflare) first, then the
 * registrar's own set.
 */
function nameserverPresets(t: TFunction, domain: DomainDetailDto): NameserverPreset[] {
  const presets: NameserverPreset[] = [];
  const zone = domain.dnsZone;
  const zoneNameservers = [...new Set((zone?.nameservers ?? []).map(normalizeNameserver).filter(Boolean))];
  if (zone && zoneNameservers.length >= NAMESERVERS_MIN) {
    const nameservers = zoneNameservers.slice(0, NAMESERVERS_MAX);
    presets.push({
      label: t('hosting.dnsZone.preset', { provider: zone.provider.name }),
      hint: t('hosting.dnsZone.presetHint', { list: nameservers.join(', '), provider: zone.provider.name }),
      nameservers,
    });
  }
  const registrar = NAMESERVER_PRESETS[domain.provider.type];
  if (registrar) {
    presets.push({ label: t(registrar.label), hint: t(registrar.hint), nameservers: registrar.nameservers });
  }
  return presets;
}

function NameserverCard({ domain }: { domain: DomainDetailDto }) {
  const { t } = useI18n();
  const nameservers = domain.info?.nameservers ?? [];
  const providerDns = domain.info?.providerDns;
  const canChange =
    domain.capabilities.includes('nameservers') && domain.permissions.includes('domain:manage');
  const [editing, setEditing] = useState(false);
  const [submitted, setSubmitted] = useState<{ result: DomainActionResult; nameservers: string[] } | null>(
    null,
  );

  return (
    <Card>
      <CardHeader
        title={t('hosting.domain.nameservers')}
        description={t('hosting.domain.nameserversText')}
        actions={
          canChange && (
            <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
              {t('hosting.ns.change')}
            </Button>
          )
        }
      />
      <CardBody className="py-2">
        {submitted && (
          <ActionResultNotice
            className="my-2"
            title={t('hosting.ns.submitted')}
            result={submitted.result}
            provider={domain.provider.name}
          >
            {t('hosting.ns.pending', { list: submitted.nameservers.join(', ') })}
          </ActionResultNotice>
        )}
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
        {nameservers.length > 0 && providerDns !== undefined && providerDns !== null && (
          <p className="border-t border-border pt-2.5 pb-1 text-xs text-muted">
            {providerDns
              ? t('hosting.ns.atProvider', { provider: domain.provider.name })
              : t('hosting.ns.external', { provider: domain.provider.name })}
          </p>
        )}
        {domain.dnsZone && <DnsZoneLine zone={domain.dnsZone} />}
      </CardBody>
      {editing && (
        <NameserverDialog
          domain={domain}
          onClose={() => setEditing(false)}
          onSubmitted={(result, list) => setSubmitted({ result, nameservers: list })}
        />
      )}
    </Card>
  );
}

function NameserverDialog({
  domain,
  onClose,
  onSubmitted,
}: {
  domain: DomainDetailDto;
  onClose: () => void;
  onSubmitted: (result: DomainActionResult, nameservers: string[]) => void;
}) {
  const { t } = useI18n();
  const current = (domain.info?.nameservers ?? []).map(normalizeNameserver);
  const [rows, setRows] = useState<string[]>(() => {
    const initial = current.slice(0, NAMESERVERS_MAX);
    while (initial.length < NAMESERVERS_MIN) initial.push('');
    return initial;
  });
  const [touched, setTouched] = useState(false);
  const presets = nameserverPresets(t, domain);
  const save = useSetNameservers(domain.id, {
    success: (r) => withProviderRef(t, t('hosting.ns.submitted'), r),
    onSuccess: (r, list) => {
      onSubmitted(r, list);
      onClose();
    },
  });

  const list = rows.map(normalizeNameserver);
  const filled = list.filter(Boolean);
  const issues = list.map((_, i) => nameserverIssue(list, i));
  const countOk = filled.length >= NAMESERVERS_MIN && filled.length <= NAMESERVERS_MAX;
  const valid = countOk && issues.every((issue) => !issue);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    if (sameList(filled, current)) return onClose();
    save.mutate(filled);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hosting.ns.change')}
      description={t('hosting.ns.dialogText', { name: domain.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="ns-form"
            variant="primary"
            loading={save.isPending}
            disabled={filled.length === 0}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="ns-form" onSubmit={submit} className="space-y-4">
        {presets.map((preset) => (
          <div
            key={preset.label}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text">{preset.label}</p>
              <p className="text-xs break-words text-muted">{preset.hint}</p>
            </div>
            <Button
              size="sm"
              onClick={() => setRows([...preset.nameservers])}
              disabled={sameList(filled, preset.nameservers)}
            >
              {t('hosting.ns.usePreset')}
            </Button>
          </div>
        ))}
        <div className="space-y-2">
          {rows.map((value, i) => {
            const issue = touched ? issues[i] : null;
            return (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-right text-xs text-subtle tabular">{i + 1}</span>
                  <Input
                    value={value}
                    onChange={(e) => setRows(rows.map((r, j) => (j === i ? e.target.value : r)))}
                    onBlur={() => setTouched(true)}
                    placeholder={`ns${i + 1}.example.ch`}
                    className="font-mono"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={t('hosting.ns.label', { n: i + 1 })}
                    aria-invalid={!!issue}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    disabled={rows.length <= NAMESERVERS_MIN}
                    aria-label={t('common.remove')}
                    title={t('common.remove')}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                {issue && <p className="mt-1 pl-7 text-xs text-danger">{t(issue)}</p>}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            onClick={() => setRows([...rows, ''])}
            disabled={rows.length >= NAMESERVERS_MAX}
          >
            {t('hosting.ns.add')}
          </Button>
          <span className={touched && !countOk ? 'text-xs text-danger' : 'text-xs text-muted'}>
            {t('hosting.ns.count', { min: NAMESERVERS_MIN, max: NAMESERVERS_MAX })}
          </span>
        </div>
        <Notice tone="warning">{t('hosting.ns.warning')}</Notice>
        <p className="text-xs text-muted">{t('hosting.ns.processing')}</p>
      </form>
    </Dialog>
  );
}

// --- Transfer: lock and auth code ----------------------------------------------------

function TransferCard({ domain }: { domain: DomainDetailDto }) {
  const { t } = useI18n();
  const caps = domain.capabilities;
  const hasLock = caps.includes('lock');
  const hasAuthcode = caps.includes('authcode');
  const canManage = domain.permissions.includes('domain:manage');
  const locked = domain.info?.locked ?? null;
  /** Requested lock state while the confirmation is open. */
  const [target, setTarget] = useState<boolean | null>(null);
  const [done, setDone] = useState<{ locked: boolean; result: DomainActionResult } | null>(null);
  const lock = useSetDomainLock(domain.id, {
    success: (r, v) =>
      withProviderRef(t, v ? t('hosting.lock.lockedToast') : t('hosting.lock.unlockedToast'), r),
    onSuccess: (r, v) => {
      setDone({ locked: v, result: r });
      setTarget(null);
    },
  });

  return (
    <Card>
      <CardHeader
        title={t('hosting.authcode.title')}
        description={hasLock ? t('hosting.transfer.text') : t('hosting.authcode.text')}
      />
      <CardBody className="space-y-4">
        {hasLock && (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{t('hosting.lock.title')}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {locked === true
                    ? t('hosting.lock.onText')
                    : locked === false
                      ? t('hosting.lock.offText')
                      : t('hosting.lock.unknownText')}
                </p>
              </div>
              {canManage ? (
                <Switch
                  checked={locked === true}
                  onCheckedChange={setTarget}
                  disabled={lock.isPending}
                  label={t('hosting.lock.title')}
                />
              ) : (
                <LockBadge locked={locked} />
              )}
            </div>
            {done && (
              <ActionResultNotice
                title={done.locked ? t('hosting.lock.lockedToast') : t('hosting.lock.unlockedToast')}
                result={done.result}
                provider={domain.provider.name}
              >
                {t('hosting.lock.processing')}
              </ActionResultNotice>
            )}
          </div>
        )}
        {hasLock && hasAuthcode && <div className="-mx-5 border-t border-border" />}
        {hasAuthcode && <AuthcodeSection domain={domain} locked={hasLock ? locked : null} />}
      </CardBody>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={
          target
            ? t('hosting.lock.lockTitle', { name: domain.name })
            : t('hosting.lock.unlockTitle', { name: domain.name })
        }
        description={target ? t('hosting.lock.lockText') : t('hosting.lock.unlockText')}
        confirmLabel={target ? t('hosting.lock.lock') : t('hosting.lock.unlock')}
        danger={target === false}
        loading={lock.isPending}
        onConfirm={() => target !== null && lock.mutate(target)}
      />
    </Card>
  );
}

function AuthcodeSection({ domain, locked }: { domain: DomainDetailDto; locked: boolean | null }) {
  const { t } = useI18n();
  const allowed = domain.permissions.includes('domain:authcode');
  const [confirming, setConfirming] = useState(false);
  const reveal = useRevealAuthcode(domain.id);
  const shown = reveal.data;
  // The registrar is still creating the code: asking again polls the same request.
  const pending = !shown && isAuthcodePending(reveal.error);

  return (
    <div className="space-y-3">
      {shown ? (
        shown.authcode ? (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <Mono className="min-w-0 flex-1 break-all text-text">{shown.authcode}</Mono>
              <CopyButton value={shown.authcode} label={t('hosting.authcode.copy')} />
            </div>
            <p className="text-xs text-muted">{t('hosting.authcode.shownHint')}</p>
            {locked === true && <p className="text-xs text-warning">{t('hosting.authcode.lockedHint')}</p>}
          </>
        ) : (
          <Notice tone="info">{t('hosting.authcode.none')}</Notice>
        )
      ) : pending ? (
        <Notice tone="info" title={t('hosting.authcode.pendingTitle')}>
          {t('hosting.authcode.pending')}
        </Notice>
      ) : allowed ? (
        <div className="space-y-1">
          <p className="text-sm text-muted">{t('hosting.authcode.auditHint')}</p>
          {domain.provider.type === 'joker' && (
            <p className="text-xs text-muted">{t('hosting.authcode.newCode')}</p>
          )}
        </div>
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
        ) : pending ? (
          <Button
            size="sm"
            icon={<RotateCw className="size-3.5" />}
            loading={reveal.isPending}
            onClick={() => reveal.mutate()}
          >
            {t('hosting.authcode.retry')}
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
    </div>
  );
}

// --- Registrant ----------------------------------------------------------------------

function RegistrantCard({ registrant }: { registrant: DomainRegistrant }) {
  const { t } = useI18n();
  const items = [
    registrant.name && { label: t('hosting.registrant.name'), value: registrant.name },
    registrant.organization && {
      label: t('hosting.registrant.organization'),
      value: registrant.organization,
    },
    registrant.email && {
      label: t('hosting.registrant.email'),
      value: (
        <span className="inline-flex max-w-full items-center gap-1">
          <span className="min-w-0 truncate">{registrant.email}</span>
          <CopyButton value={registrant.email} />
        </span>
      ),
    },
  ].filter((item) => !!item);

  return (
    <Card>
      <CardHeader title={t('hosting.registrant.title')} description={t('hosting.registrant.text')} />
      <CardBody className="py-1">
        {items.length > 0 ? (
          <KeyValue items={items} />
        ) : (
          <p className="py-3 text-sm text-muted">{t('hosting.registrant.none')}</p>
        )}
      </CardBody>
    </Card>
  );
}

// --- Renewal (platform staff) --------------------------------------------------------

function RenewalCard({ domain }: { domain: DomainDetailDto }) {
  const { t, locale } = useI18n();
  const caps = domain.capabilities;
  const autoRenew = domain.info?.autoRenew ?? domain.autoRenew;
  const expiresAt = domain.info?.expiresAt ?? domain.expiresAt;
  const [autoTarget, setAutoTarget] = useState<boolean | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [done, setDone] = useState<{ title: string; result: DomainActionResult } | null>(null);
  const target: RenewalTarget = { id: domain.id, name: domain.name, expiresAt, provider: domain.provider };

  return (
    <Card>
      <CardHeader
        title={t('hosting.renewal.title')}
        description={t('hosting.renewal.text')}
        actions={<Badge tone="info">{t('hosting.renewal.staffOnly')}</Badge>}
      />
      <CardBody className="space-y-4">
        {caps.includes('autoRenew') && (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">{t('hosting.col.autoRenew')}</p>
              <p className="mt-0.5 text-xs text-muted">
                {autoRenew === true
                  ? t('hosting.renewal.autoOnText')
                  : autoRenew === false
                    ? t('hosting.renewal.autoOffText')
                    : t('hosting.renewal.autoUnknownText')}
              </p>
            </div>
            <Switch
              checked={autoRenew === true}
              onCheckedChange={setAutoTarget}
              label={t('hosting.col.autoRenew')}
            />
          </div>
        )}
        {caps.includes('renew') && (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">{t('hosting.renewal.manual')}</p>
              <p className="mt-0.5 text-xs text-muted">
                {t('hosting.renewal.expiresOn', { date: formatDate(expiresAt, locale, false) })}
              </p>
            </div>
            <Button size="sm" icon={<CalendarPlus className="size-3.5" />} onClick={() => setRenewing(true)}>
              {t('hosting.renewal.renew')}
            </Button>
          </div>
        )}
        {done && (
          <ActionResultNotice title={done.title} result={done.result} provider={domain.provider.name} />
        )}
      </CardBody>
      {autoTarget !== null && (
        <AutoRenewDialog
          domain={target}
          enabled={autoTarget}
          onClose={() => setAutoTarget(null)}
          onDone={(result) =>
            setDone({
              title: autoTarget
                ? t('hosting.renewal.enabledToast', { name: domain.name })
                : t('hosting.renewal.disabledToast', { name: domain.name }),
              result,
            })
          }
        />
      )}
      {renewing && (
        <RenewDialog
          domain={target}
          onClose={() => setRenewing(false)}
          onDone={(result) =>
            setDone({ title: t('hosting.renewal.renewedToast', { name: domain.name }), result })
          }
        />
      )}
    </Card>
  );
}
