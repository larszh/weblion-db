import { useState } from 'react';
import { Clapperboard, Pencil, Plus, Trash2 } from 'lucide-react';
import type { MediaAllowanceDto, MediaPolicyApplyResult, ResellerCustomerDto } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import {
  useDeleteResellerMediaAllowance,
  useOrgMedia,
  useResellerMediaAllowance,
  useSetResellerMediaAllowance,
} from '@/lib/api/media';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
} from '@/components/ui/primitives';
import { MediaAllowanceFigures } from '@/pages/media/bits';
import {
  MediaAccessFields,
  PolicyFailures,
  mediaAccessFormFrom,
  readMediaAccessForm,
} from '@/pages/media/dialogs';

/**
 * The customer's share of the reseller's streaming allowance (accounts, libraries, streams,
 * downloads, bitrate), on the customer's resources tab while the reseller has the "media"
 * module. Always on the reseller's instance and within its access; saving activates the module
 * for the customer and applies the access to the customer's accounts.
 */
export function ResellerMediaAllowanceCard({ customer }: { customer: ResellerCustomerDto }) {
  const { t } = useI18n();
  const { org, can } = useOrg();
  const canWrite = can('reseller:customer:write');
  const allowance = useResellerMediaAllowance(customer.id);
  const own = useOrgMedia(org.id, can('media:read'));
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState<MediaPolicyApplyResult['failed']>([]);
  const remove = useDeleteResellerMediaAllowance(customer.id, t('media.allowance.removed'), () =>
    setRemoving(false),
  );
  const data = allowance.data ?? null;
  const pool = own.data?.allowance ?? null;

  return (
    <Card>
      <CardHeader
        title={t('nav.media')}
        description={t('media.reseller.cardText')}
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
              {data ? t('common.edit') : t('media.allowance.setUp')}
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
              <MediaAllowanceFigures allowance={data} showInstance={false} />
              {failed.length > 0 && <PolicyFailures failed={failed} onDismiss={() => setFailed([])} />}
              {/* Gives the accounts back, e.g. before the customer is deleted. Only without accounts. */}
              {canWrite && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {data.accounts > 0 && (
                    <p className="mr-auto text-xs text-muted">{t('media.reseller.removeBlocked')}</p>
                  )}
                  <Button
                    size="sm"
                    variant="danger-soft"
                    icon={<Trash2 className="size-3.5" />}
                    disabled={data.accounts > 0}
                    title={data.accounts > 0 ? t('media.reseller.removeBlocked') : undefined}
                    onClick={() => setRemoving(true)}
                  >
                    {t('media.allowance.remove')}
                  </Button>
                </div>
              )}
            </CardBody>
          ) : (
            <EmptyState
              className="py-8"
              icon={<Clapperboard className="size-6" />}
              title={t('media.reseller.none')}
              description={pool ? t('media.reseller.noneText') : undefined}
            />
          )}
          <div className="border-t border-border px-5 py-3 text-sm">
            {own.isPending && can('media:read') ? null : pool ? (
              <span className="text-muted">
                {t('media.reseller.pool', {
                  free: Math.max(0, pool.maxAccounts - pool.accounts),
                  max: pool.maxAccounts,
                })}
              </span>
            ) : (
              <Notice tone="warning">{t('media.reseller.noPool')}</Notice>
            )}
          </div>
        </>
      )}
      {editing && pool && (
        <ResellerMediaAllowanceDialog
          customer={customer}
          current={data}
          pool={pool}
          onClose={() => setEditing(false)}
          onFailed={setFailed}
        />
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('media.allowance.removeTitle', { name: customer.name })}
        description={t('media.reseller.removeText')}
        confirmLabel={t('media.allowance.remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

function ResellerMediaAllowanceDialog({
  customer,
  current,
  pool,
  onClose,
  onFailed,
}: {
  customer: ResellerCustomerDto;
  current: MediaAllowanceDto | null;
  pool: MediaAllowanceDto;
  onClose: () => void;
  onFailed: (failed: MediaPolicyApplyResult['failed']) => void;
}) {
  const { t } = useI18n();
  // What the reseller has left, plus what this customer holds already (it can be moved around).
  const accountsLeft = Math.max(0, pool.maxAccounts - pool.accounts + (current?.maxAccounts ?? 0));
  const [form, setForm] = useState(() =>
    mediaAccessFormFrom(current, {
      maxAccounts: Math.max(1, Math.min(5, accountsLeft)),
      maxStreams: Math.min(2, pool.maxStreams),
      remoteBitrateMbit: pool.remoteBitrateMbit,
    }),
  );
  const save = useSetResellerMediaAllowance(
    customer.id,
    (r) =>
      r.policy.applied > 0
        ? `${t('media.allowance.saved')}. ${t('media.allowance.applied', { n: r.policy.applied })}`
        : t('media.allowance.saved'),
    (r) => {
      onFailed(r.policy.failed);
      onClose();
    },
  );
  const limits = {
    libraryIds: pool.libraries.map((l) => l.id),
    minAccounts: current?.accounts ?? 0,
    maxAccounts: accountsLeft,
    maxStreams: pool.maxStreams,
    downloads: pool.downloads,
    bitrateCap: pool.remoteBitrateMbit,
  };
  const { body, errors } = readMediaAccessForm(t, form, limits);

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={
        current
          ? t('media.allowance.editTitle', { name: customer.name })
          : t('media.allowance.setUpTitle', { name: customer.name })
      }
      description={t('media.reseller.dialogText', { instance: pool.provider?.name ?? '' })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!body}
            loading={save.isPending}
            onClick={() => body && save.mutate(body)}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MediaAccessFields
          id="rma"
          form={form}
          onChange={setForm}
          errors={errors}
          limits={limits}
          libraries={pool.libraries}
          accountsHint={t('media.reseller.accountsLeft', { n: accountsLeft })}
        />
        {!customer.modules.includes('media') && (
          <Notice tone="info">{t('media.reseller.enablesModule')}</Notice>
        )}
        <p className="text-xs text-muted">{t('media.allowance.policyHint')}</p>
      </div>
    </Dialog>
  );
}
