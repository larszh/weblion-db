import { useState } from 'react';
import { HardDrive, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CloudAllowanceDto, ResellerCustomerDto } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import {
  useDeleteResellerCloudAllowance,
  useOrgCloud,
  useResellerCloudAllowance,
  useSetResellerCloudAllowance,
} from '@/lib/api/cloud';
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
} from '@/components/ui/primitives';
import { AllowanceFigures, GIB, formatQuota, parseGb } from '@/pages/cloud/bits';

/**
 * Cloud storage a reseller hands to one of its customers, out of its own allowance (same
 * Nextcloud instance). Saving activates the module for the customer.
 */
export function ResellerCloudAllowanceCard({ customer }: { customer: ResellerCustomerDto }) {
  const { t, locale } = useI18n();
  const { org, can } = useOrg();
  const canWrite = can('reseller:customer:write');
  const allowance = useResellerCloudAllowance(customer.id);
  const own = useOrgCloud(org.id, can('cloud:read'));
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove = useDeleteResellerCloudAllowance(customer.id, t('storage.allowance.removed'), () =>
    setRemoving(false),
  );
  const data = allowance.data ?? null;
  const pool = own.data?.allowance ?? null;
  // What the reseller has left, plus what this customer holds already (it can be moved around).
  const freeBytes = pool ? Math.max(0, pool.quotaBytes - pool.allocatedBytes) : null;

  return (
    <Card>
      <CardHeader
        title={t('nav.cloud')}
        description={t('storage.reseller.cardText')}
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
              {data ? t('common.edit') : t('storage.allowance.setUp')}
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
              <AllowanceFigures allowance={data} showInstance={false} />
              {/* Gives the storage back, e.g. before the customer is deleted. Only without accounts. */}
              {canWrite && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {data.accounts > 0 && (
                    <p className="mr-auto text-xs text-muted">{t('storage.reseller.removeBlocked')}</p>
                  )}
                  <Button
                    size="sm"
                    variant="danger-soft"
                    icon={<Trash2 className="size-3.5" />}
                    disabled={data.accounts > 0}
                    title={data.accounts > 0 ? t('storage.reseller.removeBlocked') : undefined}
                    onClick={() => setRemoving(true)}
                  >
                    {t('storage.allowance.remove')}
                  </Button>
                </div>
              )}
            </CardBody>
          ) : (
            <EmptyState
              className="py-8"
              icon={<HardDrive className="size-6" />}
              title={t('storage.reseller.none')}
              description={pool ? t('storage.reseller.noneText') : undefined}
            />
          )}
          <div className="border-t border-border px-5 py-3 text-sm">
            {own.isPending && can('cloud:read') ? null : pool ? (
              <span className="text-muted">
                {t('storage.reseller.pool', {
                  free: formatQuota(freeBytes ?? 0, locale),
                  quota: formatQuota(pool.quotaBytes, locale),
                })}
              </span>
            ) : (
              <Notice tone="warning">{t('storage.reseller.noPool')}</Notice>
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
        title={t('storage.allowance.removeTitle', { name: customer.name })}
        description={t('storage.reseller.removeText')}
        confirmLabel={t('storage.allowance.remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

function ResellerAllowanceDialog({
  customer,
  current,
  pool,
  onClose,
}: {
  customer: ResellerCustomerDto;
  current: CloudAllowanceDto | null;
  pool: CloudAllowanceDto;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [quota, setQuota] = useState(current ? String(Math.ceil(current.quotaBytes / GIB)) : '10');
  const [maxAccounts, setMaxAccounts] = useState(current?.maxAccounts?.toString() ?? '');
  const save = useSetResellerCloudAllowance(customer.id, t('storage.allowance.saved'), onClose);

  // The customer's current allowance is part of the reseller's allocation already.
  const maxGb = Math.floor((pool.quotaBytes - pool.allocatedBytes + (current?.quotaBytes ?? 0)) / GIB);
  const minGb = current ? Math.max(1, Math.ceil(current.allocatedBytes / GIB)) : 1;
  const accountsLeft =
    pool.maxAccounts === null
      ? null
      : pool.maxAccounts - pool.accounts + (current ? (current.maxAccounts ?? current.accounts) : 0);
  const minAccounts = current?.accounts ?? 0;

  const quotaGb = parseGb(quota);
  const quotaError =
    quotaGb === null
      ? t('storage.quota.invalid')
      : quotaGb > maxGb
        ? t('storage.quota.tooLarge', { max: formatQuota(Math.max(0, maxGb) * GIB, locale) })
        : quotaGb < minGb
          ? t('storage.allowance.belowAllocated', { size: formatQuota(minGb * GIB, locale) })
          : null;
  const max = maxAccounts.trim() === '' ? null : parseGb(maxAccounts);
  const maxError =
    maxAccounts.trim() !== '' && max === null
      ? t('storage.allowance.maxInvalid')
      : max === null && accountsLeft !== null
        ? t('storage.reseller.maxRequired', { n: Math.max(0, accountsLeft) })
        : max !== null && accountsLeft !== null && max > accountsLeft
          ? t('storage.reseller.maxTooHigh', { n: Math.max(0, accountsLeft) })
          : max !== null && max < minAccounts
            ? t('storage.allowance.maxBelowAccounts', { n: minAccounts })
            : null;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        current
          ? t('storage.allowance.editTitle', { name: customer.name })
          : t('storage.allowance.setUpTitle', { name: customer.name })
      }
      description={t('storage.reseller.dialogText', { instance: pool.provider?.name ?? '' })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={quotaGb === null || !!quotaError || !!maxError}
            loading={save.isPending}
            onClick={() => quotaGb !== null && save.mutate({ quotaGb, maxAccounts: max })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('storage.allowance.quota')}
            htmlFor="rc-quota"
            error={quotaError}
            hint={t('storage.reseller.quotaHint', { max: formatQuota(Math.max(0, maxGb) * GIB, locale) })}
          >
            <div className="flex items-center gap-2">
              <Input
                id="rc-quota"
                type="number"
                inputMode="numeric"
                min={minGb}
                max={Math.max(minGb, maxGb)}
                step={1}
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
                className="tabular"
              />
              <span className="text-sm text-muted">GB</span>
            </div>
          </Field>
          <Field
            label={t('storage.allowance.maxAccounts')}
            htmlFor="rc-max"
            error={maxError}
            hint={
              accountsLeft === null
                ? t('storage.allowance.maxAccountsHint')
                : t('storage.reseller.accountsLeft', { n: Math.max(0, accountsLeft) })
            }
          >
            <Input
              id="rc-max"
              type="number"
              inputMode="numeric"
              min={Math.max(1, minAccounts)}
              step={1}
              value={maxAccounts}
              onChange={(e) => setMaxAccounts(e.target.value)}
              placeholder={accountsLeft === null ? t('storage.allowance.unlimited') : undefined}
              className="tabular"
            />
          </Field>
        </div>
        {current && current.allocatedBytes > 0 && (
          <p className="text-xs text-muted">
            {t('storage.allowance.allocatedHint', { size: formatQuota(current.allocatedBytes, locale) })}
          </p>
        )}
        {!customer.modules.includes('storage') && (
          <Notice tone="info">{t('storage.reseller.enablesModule')}</Notice>
        )}
      </div>
    </Dialog>
  );
}
