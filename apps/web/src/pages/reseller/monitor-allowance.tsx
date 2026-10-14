import { useState } from 'react';
import { HeartPulse, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  MONITOR_DEFAULT_MAX_MONITORS,
  MONITOR_DEFAULT_MIN_INTERVAL_SECONDS,
  type MonitorAllowanceDto,
  type ResellerCustomerDto,
} from '@weblion/shared';
import { formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import {
  useDeleteResellerMonitorAllowance,
  useOrgMonitoring,
  useResellerMonitorAllowance,
  useSetResellerMonitorAllowance,
} from '@/lib/api/monitoring';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Notice,
  Select,
} from '@/components/ui/primitives';
import {
  errorDetail,
  errorPath,
  intervalChoices,
  intervalLabel,
  useMonitorError,
} from '@/pages/monitoring/bits';

/**
 * The customer's share of the reseller's monitoring allowance (maximum monitors, minimum
 * interval), on the customer's resources tab while the reseller has the "monitoring" module.
 * The share lives on the reseller's instance; saving activates the module for the customer.
 */
export function ResellerMonitorAllowanceCard({ customer }: { customer: ResellerCustomerDto }) {
  const { t, locale } = useI18n();
  const { org, can } = useOrg();
  const canWrite = can('reseller:customer:write');
  const allowance = useResellerMonitorAllowance(customer.id);
  const own = useOrgMonitoring(org.id, can('monitor:read'));
  const monitorError = useMonitorError();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove = useDeleteResellerMonitorAllowance(customer.id, {
    success: t('uptime.allowance.removed'),
    onSuccess: () => setRemoving(false),
    error: monitorError,
  });
  const data = allowance.data ?? null;
  const pool = own.data?.allowance ?? null;
  // Console monitors of the customer live on the allowance: it only goes without them.
  const removeBlocked = !!data && data.monitors > 0;

  return (
    <Card>
      <CardHeader
        title={t('nav.uptime')}
        description={t('uptime.reseller.cardText')}
        actions={
          canWrite &&
          pool &&
          !allowance.isPending &&
          !allowance.isError && (
            <Button
              size="sm"
              icon={data ? <Pencil className="size-4" /> : <Plus className="size-4" />}
              onClick={() => setEditing(true)}
            >
              {data ? t('common.edit') : t('uptime.allowance.setUp')}
            </Button>
          )
        }
      />
      {allowance.isPending ? (
        <LoadingBlock rows={2} />
      ) : allowance.isError ? (
        <div className="p-5">
          <ErrorState error={allowance.error} onRetry={() => void allowance.refetch()} />
        </div>
      ) : (
        <>
          {data ? (
            <CardBody className="space-y-4">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">{t('uptime.allowance.monitors')}</dt>
                  <dd className="mt-1 font-semibold text-text tabular">
                    {t('uptime.allowance.used', {
                      n: formatNumber(data.committed, locale),
                      max: formatNumber(data.maxMonitors, locale),
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('uptime.allowance.minInterval')}</dt>
                  <dd className="mt-1 font-semibold text-text">
                    {intervalLabel(t, data.minIntervalSeconds)}
                  </dd>
                </div>
              </dl>
              {canWrite && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {removeBlocked && (
                    <p className="mr-auto text-xs text-muted">{t('uptime.reseller.removeBlocked')}</p>
                  )}
                  <Button
                    size="sm"
                    variant="danger-soft"
                    icon={<Trash2 className="size-3.5" />}
                    disabled={removeBlocked}
                    title={removeBlocked ? t('uptime.reseller.removeBlocked') : undefined}
                    onClick={() => setRemoving(true)}
                  >
                    {t('uptime.allowance.remove')}
                  </Button>
                </div>
              )}
            </CardBody>
          ) : (
            <EmptyState
              className="py-8"
              icon={<HeartPulse className="size-6" />}
              title={t('uptime.reseller.none')}
              description={pool ? t('uptime.reseller.noneText') : undefined}
            />
          )}
          <div className="border-t border-border px-5 py-3 text-sm">
            {own.isPending && can('monitor:read') ? null : pool ? (
              <span className="text-muted">
                {t('uptime.reseller.pool', {
                  free: formatNumber(Math.max(0, pool.maxMonitors - pool.committed), locale),
                  max: formatNumber(pool.maxMonitors, locale),
                })}
              </span>
            ) : (
              <Notice tone="warning">{t('uptime.reseller.noPool')}</Notice>
            )}
          </div>
        </>
      )}
      {editing && pool && (
        <ResellerAllowanceDialog
          customer={customer}
          current={data}
          pool={pool}
          onClose={() => setEditing(false)}
        />
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('uptime.allowance.removeTitle', { name: customer.name })}
        description={t('uptime.reseller.removeText')}
        confirmLabel={t('uptime.allowance.remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

/** Whole numbers from 1 on, else null. */
const parseCount = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

function ResellerAllowanceDialog({
  customer,
  current,
  pool,
  onClose,
}: {
  customer: ResellerCustomerDto;
  current: MonitorAllowanceDto | null;
  pool: MonitorAllowanceDto;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const monitorError = useMonitorError();
  // What the reseller has left, plus what this customer holds already (it can be moved around).
  const left = Math.max(0, pool.maxMonitors - pool.committed + (current?.maxMonitors ?? 0));
  const minMonitors = Math.max(1, current?.committed ?? 0);
  const choices = intervalChoices(pool.minIntervalSeconds, current?.minIntervalSeconds);
  const [max, setMax] = useState(
    String(current?.maxMonitors ?? Math.max(1, Math.min(MONITOR_DEFAULT_MAX_MONITORS, left))),
  );
  const [interval, setMinInterval] = useState(
    current?.minIntervalSeconds ??
      (choices.includes(MONITOR_DEFAULT_MIN_INTERVAL_SECONDS)
        ? MONITOR_DEFAULT_MIN_INTERVAL_SECONDS
        : (choices[0] ?? pool.minIntervalSeconds)),
  );
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const save = useSetResellerMonitorAllowance(customer.id, {
    success: t('uptime.allowance.saved'),
    onSuccess: onClose,
    error: (err) => {
      if (errorPath(err) === 'minIntervalSeconds') {
        setIntervalError(errorDetail(err) ?? monitorError(err));
        return null;
      }
      return monitorError(err);
    },
  });

  const maxMonitors = parseCount(max);
  const maxError =
    maxMonitors === null
      ? t('uptime.allowance.maxInvalid')
      : maxMonitors > left
        ? t('uptime.reseller.maxTooHigh', { n: formatNumber(left, locale) })
        : maxMonitors < minMonitors
          ? t('uptime.allowance.maxBelowCommitted', { n: minMonitors })
          : null;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        current
          ? t('uptime.allowance.editTitle', { name: customer.name })
          : t('uptime.allowance.setUpTitle', { name: customer.name })
      }
      description={t('uptime.reseller.dialogText', { instance: pool.provider?.name ?? '' })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={maxMonitors === null || !!maxError}
            loading={save.isPending}
            onClick={() => maxMonitors !== null && save.mutate({ maxMonitors, minIntervalSeconds: interval })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('uptime.allowance.maxMonitors')}
            htmlFor="rm-max"
            error={maxError}
            hint={t('uptime.reseller.left', { n: formatNumber(left, locale) })}
          >
            <Input
              id="rm-max"
              type="number"
              inputMode="numeric"
              min={minMonitors}
              max={Math.max(minMonitors, left)}
              step={1}
              value={max}
              onChange={(e) => setMax(e.target.value)}
              className="tabular"
            />
          </Field>
          <Field
            label={t('uptime.allowance.minInterval')}
            htmlFor="rm-interval"
            error={intervalError}
            hint={t('uptime.reseller.intervalHint', { min: intervalLabel(t, pool.minIntervalSeconds) })}
          >
            <Select
              id="rm-interval"
              value={String(interval)}
              onChange={(e) => {
                setMinInterval(Number(e.target.value));
                setIntervalError(null);
              }}
            >
              {choices.map((s) => (
                <option key={s} value={s}>
                  {intervalLabel(t, s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {current && current.committed > 0 && (
          <p className="text-xs text-muted">
            {t('uptime.allowance.committedHint', { n: current.committed })}
          </p>
        )}
        {!customer.modules.includes('monitoring') && (
          <Notice tone="info">{t('uptime.reseller.enablesModule')}</Notice>
        )}
      </div>
    </Dialog>
  );
}
