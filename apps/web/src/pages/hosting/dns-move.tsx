import { useState, type ReactNode } from 'react';
import { ArrowRight, ArrowRightLeft, CircleAlert, CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import type { DnsMoveRecord, DnsMoveResult, DnsMoveSkipReason, DnsMoveSkipped } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/queries';
import { useDnsMove, useDnsMovePreview } from '@/lib/api/zones';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  LoadingBlock,
  Mono,
  Notice,
  Select,
} from '@/components/ui/primitives';
import { DomainStatusBadge, linkedStatus } from './bits';
import { recordTypeLabel, ttlLabel } from './domain-dns';
import { ButtonLink, CopyAllButton, NameserverList } from './domain-zone';

/**
 * "Move DNS to Cloudflare" (platform staff, permission platform:domain:move, interactive
 * session): create or reuse the zone, copy the registrar's records, switch the name servers
 * only when every record was copied. The API reports each step, partial failures included.
 */

/** Checked again by the API (permission and interactive session). */
export function useCanMoveDns(): boolean {
  const me = useMe();
  return !!me.data?.platformPermissions.includes('platform:domain:move');
}

/** On the overview of a registration whose DNS is not at an active zone yet. */
export function DnsMoveCard({ onStart }: { onStart: () => void }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader
        title={t('hosting.dnsMove.cardTitle')}
        actions={<Badge tone="info">{t('hosting.renewal.staffOnly')}</Badge>}
      />
      <CardBody className="space-y-3">
        <p className="text-sm text-muted">{t('hosting.dnsMove.cardText')}</p>
        <Button size="sm" icon={<ArrowRightLeft className="size-3.5" />} onClick={onStart}>
          {t('hosting.dnsMove.action')}
        </Button>
      </CardBody>
    </Card>
  );
}

/** What the dialog needs to know about the registration (DomainDto or DomainDetailDto). */
export interface DnsMoveSource {
  id: string;
  name: string;
  provider: { name: string };
}

export function DnsMoveDialog({ domain, onClose }: { domain: DnsMoveSource; onClose: () => void }) {
  const { t } = useI18n();
  /** Unset: the API plans for the first connection that can create zones. */
  const [targetId, setTargetId] = useState<string | undefined>();
  const [importChoice, setImportChoice] = useState(true);
  const [nsChoice, setNsChoice] = useState(false);
  const [result, setResult] = useState<DnsMoveResult | null>(null);
  // No new plan once the move ran: the result replaces it.
  const preview = useDnsMovePreview(domain.id, targetId, !result);
  const move = useDnsMove(domain.id, { onSuccess: setResult });

  const plan = preview.data;
  // While another target is planned the previous plan stays visible, but cannot be started.
  const planReady = !!plan && !preview.isPlaceholderData && !preview.isFetching;
  const tooMany = !!plan && plan.records.length > plan.maxRecords;
  const importAvailable = !!plan && plan.recordsAvailable && !plan.recordsError && !tooMany;
  const importRecords = importAvailable && importChoice;
  const nsBlocked = !plan?.canSetNameservers
    ? t('hosting.dnsMove.ns.unsupported')
    : !importRecords
      ? t('hosting.dnsMove.ns.requiresImport')
      : null;
  const setNameservers = nsBlocked === null && nsChoice;
  const canStart = planReady && plan.targets.length > 0 && !!plan.targetProviderId;

  const start = () => {
    if (!canStart || !plan.targetProviderId) return;
    move.mutate({ targetProviderId: plan.targetProviderId, importRecords, setNameservers });
  };

  const zonePath = result
    ? result.zone.org
      ? `/o/${result.zone.org.slug}/domains/${result.zone.id}`
      : `/admin/hosting?provider=${result.zone.provider.id}`
    : null;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={result ? t('hosting.dnsMove.result.title') : t('hosting.dnsMove.title', { name: domain.name })}
      description={result ? undefined : t('hosting.dnsMove.intro')}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
            {zonePath && (
              <ButtonLink
                to={zonePath}
                variant="primary"
                icon={<ArrowRight className="size-3.5" />}
                onClick={onClose}
              >
                {t('hosting.dnsMove.result.openZone')}
              </ButtonLink>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              icon={<ArrowRightLeft className="size-4" />}
              disabled={!canStart}
              loading={move.isPending}
              onClick={start}
            >
              {t('hosting.dnsMove.submit')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <DnsMoveResultView result={result} registrar={domain.provider.name} />
      ) : preview.isError ? (
        <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
      ) : !plan ? (
        <LoadingBlock rows={4} />
      ) : (
        <div className={cn('space-y-4', !planReady && 'opacity-60')} aria-busy={!planReady}>
          {plan.targets.length === 0 ? (
            <Notice tone="warning">{t('hosting.dnsMove.noTargets')}</Notice>
          ) : plan.targets.length > 1 ? (
            <Field label={t('hosting.dnsMove.target')} htmlFor="dns-move-target">
              <Select
                id="dns-move-target"
                value={targetId ?? plan.targetProviderId ?? ''}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={move.isPending}
              >
                {plan.targets.map((target) => (
                  <option key={target.providerId} value={target.providerId}>
                    {target.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-muted">
              {t('hosting.dnsMove.target')}: <span className="text-text">{plan.targets[0]!.name}</span>
            </p>
          )}
          {plan.existingZone && (
            <Notice tone="info">
              {t('hosting.dnsMove.existingZone', {
                name: plan.domain.name,
                provider: plan.existingZone.provider.name,
                status: linkedStatus(t, plan.existingZone).label,
              })}{' '}
              {t('hosting.dnsMove.import.zoneNotEmpty')}
            </Notice>
          )}

          <div className="space-y-2">
            <Choice
              checked={importRecords}
              onChange={setImportChoice}
              disabled={!importAvailable || move.isPending}
              label={t('hosting.dnsMove.import.label', { n: plan.records.length })}
              hint={
                !plan.recordsAvailable ? (
                  t('hosting.dnsMove.import.unavailable')
                ) : plan.recordsError ? (
                  <>
                    {t('hosting.dnsMove.import.error')}{' '}
                    <Mono className="break-words">{plan.recordsError}</Mono>
                  </>
                ) : tooMany ? (
                  t('hosting.dnsMove.import.tooMany', { max: plan.maxRecords })
                ) : (
                  t('hosting.dnsMove.import.hint')
                )
              }
            />
            {plan.recordsAvailable && !plan.recordsError && (
              <RecordPlan records={plan.records} skipped={plan.skipped} />
            )}
          </div>

          <Choice
            checked={setNameservers}
            onChange={setNsChoice}
            disabled={nsBlocked !== null || move.isPending}
            label={t('hosting.dnsMove.ns.label')}
            hint={nsBlocked ?? t('hosting.dnsMove.ns.hint')}
          />

          <Notice tone="warning">{t('hosting.dnsMove.warning')}</Notice>
        </div>
      )}
    </Dialog>
  );
}

/** A checkbox with its explanation, like the module choice of the assign dialog. */
function Choice({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
  label: string;
  hint: ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border px-3 py-2.5',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-surface-2',
      )}
    >
      <input
        type="checkbox"
        className="mt-1 size-4 accent-[var(--primary)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={cn('min-w-0', disabled && 'opacity-70')}>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

function RecordLine({
  type,
  name,
  data,
  note,
}: {
  type: string;
  name: string;
  data: string;
  note?: ReactNode;
}) {
  const { t } = useI18n();
  const label = recordTypeLabel(t, type);
  return (
    <li className="flex items-start gap-2 py-1.5 text-xs">
      <span className="min-w-[4.5rem] shrink-0">
        <Badge tone="primary" className={label === type ? 'font-mono' : undefined} title={type}>
          {label}
        </Badge>
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <Mono className="block break-all text-text">{name || '@'}</Mono>
        <Mono className="block break-all text-muted">{data}</Mono>
        {note && <span className="block text-muted">{note}</span>}
      </span>
    </li>
  );
}

function PlanSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text select-none">
        {title}
      </summary>
      <ul className="max-h-60 divide-y divide-border overflow-y-auto border-t border-border px-3">
        {children}
      </ul>
    </details>
  );
}

/** What the move copies, what it adjusts on the way and what it leaves behind. */
function RecordPlan({ records, skipped }: { records: DnsMoveRecord[]; skipped: DnsMoveSkipped[] }) {
  const { t } = useI18n();
  const converted = records.filter((r) => r.convertedFrom !== undefined || r.ttlFrom !== undefined);
  const ttl = (value: number | null) => (value === null ? '–' : ttlLabel(t, value, true));
  const reasons: Record<DnsMoveSkipReason, string> = {
    type: t('hosting.dnsMove.skipped.reason.type'),
    readOnly: t('hosting.dnsMove.skipped.reason.readOnly'),
    apexNs: t('hosting.dnsMove.skipped.reason.apexNs'),
  };
  return (
    <div className="space-y-2">
      {records.length > 0 && (
        <PlanSection title={t('hosting.dnsMove.planned', { n: records.length })}>
          {records.map((r, i) => (
            <RecordLine key={i} type={r.type} name={r.name} data={r.data} note={ttl(r.ttl)} />
          ))}
        </PlanSection>
      )}
      {converted.length > 0 && (
        <PlanSection title={t('hosting.dnsMove.converted', { n: converted.length })}>
          {converted.map((r, i) => (
            <RecordLine
              key={i}
              type={r.type}
              name={r.name}
              data={r.data}
              note={[
                r.convertedFrom !== undefined &&
                  t('hosting.dnsMove.convertedType', { from: r.convertedFrom, to: r.type }),
                r.ttlFrom !== undefined &&
                  t('hosting.dnsMove.ttlChanged', { from: ttl(r.ttlFrom), to: ttl(r.ttl) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </PlanSection>
      )}
      {skipped.length > 0 && (
        <PlanSection title={t('hosting.dnsMove.skipped.title', { n: skipped.length })}>
          {skipped.map((r, i) => (
            <RecordLine key={i} type={r.type} name={r.name} data={r.data} note={reasons[r.reason]} />
          ))}
        </PlanSection>
      )}
    </div>
  );
}

type StepTone = 'success' | 'warning' | 'neutral' | 'danger';

const STEP_ICON: Record<StepTone, ReactNode> = {
  success: <CircleCheck className="size-5 text-success" aria-hidden />,
  warning: <CircleAlert className="size-5 text-warning" aria-hidden />,
  neutral: <CircleMinus className="size-5 text-subtle" aria-hidden />,
  danger: <CircleX className="size-5 text-danger" aria-hidden />,
};

function Step({ tone, title, children }: { tone: StepTone; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      <span className="shrink-0">{STEP_ICON[tone]}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-text">{title}</p>
        {children}
      </div>
    </li>
  );
}

const IMPORT_TONE: Record<DnsMoveResult['import']['status'], StepTone> = {
  done: 'success',
  partial: 'warning',
  skipped: 'neutral',
  failed: 'danger',
};

const NS_TONE: Record<DnsMoveResult['nameservers']['status'], StepTone> = {
  done: 'success',
  skipped: 'neutral',
  failed: 'danger',
  manual: 'warning',
};

/** One row per step: zone, record copy, name servers. */
function DnsMoveResultView({ result, registrar }: { result: DnsMoveResult; registrar: string }) {
  const { t } = useI18n();
  const { zone, import: copy, nameservers: ns } = result;
  const nsToSet = ns.nameservers.length > 0 ? ns.nameservers : zone.nameservers;

  return (
    <ul className="-my-3 divide-y divide-border">
      <Step
        tone="success"
        title={
          result.zoneCreated
            ? t('hosting.dnsMove.result.zoneCreated')
            : t('hosting.dnsMove.result.zoneReused')
        }
      >
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Mono className="text-text">{zone.name}</Mono>
          <span>{zone.provider.name}</span>
          <DomainStatusBadge domain={{ status: zone.status, missingSince: null }} kind={zone.kind} />
        </p>
        {zone.nameservers.length > 0 && (
          <div>
            <NameserverList nameservers={zone.nameservers} />
            {zone.nameservers.length > 1 && <CopyAllButton values={zone.nameservers} />}
          </div>
        )}
      </Step>

      <Step
        tone={IMPORT_TONE[copy.status]}
        title={t(`hosting.dnsMove.result.import.${copy.status}`, {
          n: copy.copied,
          failed: copy.failed.length,
        })}
      >
        {copy.reason && (
          <p className="text-sm text-muted">{t(`hosting.dnsMove.result.import.reason.${copy.reason}`)}</p>
        )}
        {copy.failed.length > 0 && (
          <ul className="space-y-1 text-xs">
            {copy.failed.map((f, i) => (
              <li key={i} className="break-words">
                <Mono className="text-text">
                  {f.type} {f.name || '@'}
                </Mono>
                : <span className="text-danger">{f.error}</span>
              </li>
            ))}
          </ul>
        )}
        {copy.skipped.length > 0 && (
          <p className="text-xs text-muted">
            {t('hosting.dnsMove.skipped.title', { n: copy.skipped.length })}
          </p>
        )}
      </Step>

      <Step tone={NS_TONE[ns.status]} title={t(`hosting.dnsMove.result.ns.${ns.status}`)}>
        {ns.reason && (
          <p className="text-sm text-muted">{t(`hosting.dnsMove.result.ns.reason.${ns.reason}`)}</p>
        )}
        {ns.status === 'done' && (ns.message || ns.providerRef) && (
          <p className="space-y-0.5 text-xs text-muted">
            {ns.message && (
              <span className="block break-words">
                {t('hosting.action.providerMessage', { provider: registrar })}: <Mono>{ns.message}</Mono>
              </span>
            )}
            {ns.providerRef && (
              <span className="block">
                {t('hosting.action.ref')}: <Mono>{ns.providerRef}</Mono>
              </span>
            )}
          </p>
        )}
        {ns.status === 'failed' && ns.error && <p className="text-xs break-words text-danger">{ns.error}</p>}
        {ns.status !== 'done' && nsToSet.length > 0 && (
          <div>
            <NameserverList nameservers={nsToSet} />
            {nsToSet.length > 1 && <CopyAllButton values={nsToSet} />}
          </div>
        )}
      </Step>
    </ul>
  );
}
