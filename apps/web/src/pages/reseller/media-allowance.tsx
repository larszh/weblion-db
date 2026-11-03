import { useState } from 'react';
import { Clapperboard, Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  MediaAllowanceChangeResult,
  MediaAllowanceDto,
  MediaPolicyApplyResult,
  ResellerCustomerDto,
} from '@weblion/shared';
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
import { MediaAllowanceFigures, mediaRequestsFormFrom, readMediaRequestsForm } from '@/pages/media/bits';
import {
  MediaAccessFields,
  MediaRequestsFields,
  PolicyFailures,
  mediaAccessFormFrom,
  readMediaAccessForm,
} from '@/pages/media/dialogs';

/**
 * The customer's share of the reseller's streaming allowance (accounts, libraries, streams,
 * downloads, bitrate and, while the reseller has it, the requests add-on), on the customer's
 * resources tab while the reseller has the "media" module. Always on the reseller's instance and
 * within its access; saving activates the module for the customer and applies the access to the
 * customer's accounts.
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
  // Accounts whose request rights in Seerr could not be set after the add-on changed.
  const [seerrFailed, setSeerrFailed] = useState<MediaPolicyApplyResult['failed']>([]);
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
              {seerrFailed.length > 0 && (
                <PolicyFailures
                  failed={seerrFailed}
                  title={t('media.requests.applyFailed')}
                  onDismiss={() => setSeerrFailed([])}
                />
              )}
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
          onResult={(r) => {
            setFailed(r.policy.failed);
            setSeerrFailed(r.seerr?.failed ?? []);
          }}
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
  onResult,
}: {
  customer: ResellerCustomerDto;
  current: MediaAllowanceDto | null;
  pool: MediaAllowanceDto;
  onClose: () => void;
  /** The policy and Seerr writes the change caused (failed accounts are shown on the card). */
  onResult: (result: MediaAllowanceChangeResult) => void;
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
  // The reseller's own add-on: only there while it has one on an instance whose Seerr is active.
  // Without it the reseller sees nothing of requests and sends nothing (the customer's stays).
  const cap = pool.requests ?? null;
  // Switched on, the customer starts with what the reseller has itself.
  const [requestsForm, setRequestsForm] = useState(() =>
    mediaRequestsFormFrom(current?.requests ?? null, cap ?? undefined),
  );
  const save = useSetResellerMediaAllowance(
    customer.id,
    (r) =>
      [
        t('media.allowance.saved'),
        r.policy.applied > 0 ? t('media.allowance.applied', { n: r.policy.applied }) : null,
        r.seerr && r.seerr.applied > 0 ? t('media.seerr.applyResult', { n: r.seerr.applied }) : null,
      ]
        .filter(Boolean)
        .join('. '),
    (r) => {
      onResult(r);
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
  const requestsRead = readMediaRequestsForm(t, requestsForm, cap);
  const blocked = !body || (!!cap && !requestsRead.valid);
  const send = () => {
    if (!body || blocked) return;
    save.mutate({ ...body, ...(cap ? { requests: requestsRead.value } : {}) });
  };

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
          <Button variant="primary" disabled={blocked} loading={save.isPending} onClick={send}>
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
        {cap && (
          <MediaRequestsFields
            id="rma-requests"
            form={requestsForm}
            onChange={setRequestsForm}
            errors={requestsRead.errors}
            cap={cap}
            warnings={
              <>
                {/* The reseller and its customer share the instance at least. */}
                <Notice tone="warning">{t('media.requests.sharedWarning')}</Notice>
                {body?.maxStreams === 1 && <Notice tone="info">{t('media.requests.streamsWarning')}</Notice>}
              </>
            }
          />
        )}
        {!customer.modules.includes('media') && (
          <Notice tone="info">{t('media.reseller.enablesModule')}</Notice>
        )}
        <p className="text-xs text-muted">{t('media.allowance.policyHint')}</p>
      </div>
    </Dialog>
  );
}
