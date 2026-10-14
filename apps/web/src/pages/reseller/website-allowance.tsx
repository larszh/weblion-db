import { useState } from 'react';
import { Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CreatableWebsiteType, ResellerCustomerDto, WebsiteAllowanceDto } from '@weblion/shared';
import { formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import {
  useDeleteResellerWebsiteAllowance,
  useResellerWebsiteAllowance,
  useSetResellerWebsiteAllowance,
  useWebsiteOptions,
} from '@/lib/api/websites';
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
import {
  ALLOWANCE_MAX_DATABASES,
  ALLOWANCE_MAX_SITES,
  InstanceLocation,
  SiteTypeChoice,
  WebsiteAllowanceFigures,
  parseCount,
} from '@/pages/hosting/website-bits';
import { DialogError } from '@/pages/hosting/website-dialogs';

/**
 * Websites a reseller hands to one of its customers, out of its own allowance (same
 * CloudPanel instance, types within its own). Saving activates the module for the customer.
 */
export function ResellerWebsiteAllowanceCard({ customer }: { customer: ResellerCustomerDto }) {
  const { t, locale } = useI18n();
  const { org, can, hasModule } = useOrg();
  const canWrite = can('reseller:customer:write');
  const allowance = useResellerWebsiteAllowance(customer.id);
  const own = useWebsiteOptions(org.id, can('webspace:read') && hasModule('webhosting'));
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove = useDeleteResellerWebsiteAllowance(customer.id, {
    success: t('websites.allowance.removed'),
    onSuccess: () => setRemoving(false),
  });
  const data = allowance.data ?? null;
  const pool = own.data?.allowance ?? null;
  const n = (value: number) => formatNumber(value, locale);
  // The customer's own websites and databases (a customer has no customers of its own).
  const removeBlocked =
    data && data.sites > 0 ? t('websites.reseller.removeBlocked', { n: data.sites }) : null;

  return (
    <Card>
      <CardHeader
        title={t('websites.allowance.title')}
        description={t('websites.reseller.cardText')}
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
              {data ? t('common.edit') : t('websites.allowance.setUp')}
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
              <WebsiteAllowanceFigures allowance={data} showInstance={false} />
              {/* Gives the allowance back, e.g. before the customer is deleted. Only without websites. */}
              {canWrite && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {removeBlocked && <p className="mr-auto text-xs text-muted">{removeBlocked}</p>}
                  <Button
                    size="sm"
                    variant="danger-soft"
                    icon={<Trash2 className="size-3.5" />}
                    disabled={!!removeBlocked}
                    title={removeBlocked ?? undefined}
                    onClick={() => setRemoving(true)}
                  >
                    {t('websites.allowance.remove')}
                  </Button>
                </div>
              )}
            </CardBody>
          ) : (
            <EmptyState
              className="py-8"
              icon={<Globe className="size-6" />}
              title={t('websites.reseller.none')}
              description={pool ? t('websites.reseller.noneText') : undefined}
            />
          )}
          <div className="border-t border-border px-5 py-3 text-sm">
            {own.isPending && can('webspace:read') && hasModule('webhosting') ? null : pool ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                <span>
                  {t('websites.reseller.pool', {
                    sites: n(pool.maxSites),
                    usedSites: n(pool.sites),
                    databases: n(pool.maxDatabases),
                    usedDatabases: n(pool.databases),
                  })}
                </span>
                {pool.provider && <InstanceLocation location={pool.provider.location} />}
              </div>
            ) : (
              <Notice tone="warning">{t('websites.reseller.noPool')}</Notice>
            )}
          </div>
        </>
      )}
      {editing && pool && (
        <ResellerWebsiteAllowanceDialog
          customer={customer}
          current={data}
          pool={pool}
          onClose={() => setEditing(false)}
        />
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('websites.allowance.removeTitle', { name: customer.name })}
        description={t('websites.reseller.removeText')}
        confirmLabel={t('websites.allowance.remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

function ResellerWebsiteAllowanceDialog({
  customer,
  current,
  pool,
  onClose,
}: {
  customer: ResellerCustomerDto;
  current: WebsiteAllowanceDto | null;
  pool: WebsiteAllowanceDto;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [maxSites, setMaxSites] = useState(String(current?.maxSites ?? Math.min(1, roomOf(pool).sites)));
  const [maxDatabases, setMaxDatabases] = useState(
    String(current?.maxDatabases ?? Math.min(1, roomOf(pool).databases)),
  );
  const [types, setTypes] = useState<CreatableWebsiteType[]>(
    (current?.siteTypes ?? ['php', 'static']).filter((type) => pool.siteTypes.includes(type)),
  );
  const save = useSetResellerWebsiteAllowance(customer.id, {
    success: t('websites.allowance.saved'),
    onSuccess: onClose,
    error: false,
  });
  const n = (value: number) => formatNumber(value, locale);

  // The customer's current maxima are part of the reseller's commitment already.
  const sitesLeft = pool.maxSites - pool.sites + (current?.maxSites ?? 0);
  const databasesLeft = pool.maxDatabases - pool.databases + (current?.maxDatabases ?? 0);
  const minSites = current?.sites ?? 0;
  const minDatabases = current?.databases ?? 0;
  const sites = parseCount(maxSites, ALLOWANCE_MAX_SITES);
  const databases = parseCount(maxDatabases, ALLOWANCE_MAX_DATABASES);
  const sitesError =
    sites === null
      ? t('websites.allowance.countInvalid')
      : sites > sitesLeft
        ? t('websites.reseller.sitesTooHigh', { n: n(Math.max(0, sitesLeft)) })
        : sites < minSites
          ? t('websites.allowance.belowSites', { n: n(minSites) })
          : null;
  const databasesError =
    databases === null
      ? t('websites.allowance.countInvalid')
      : databases > databasesLeft
        ? t('websites.reseller.databasesTooHigh', { n: n(Math.max(0, databasesLeft)) })
        : databases < minDatabases
          ? t('websites.allowance.belowDatabases', { n: n(minDatabases) })
          : null;
  const typesError = types.length === 0 ? t('websites.allowance.typesRequired') : null;
  const blocked = sites === null || databases === null || !!sitesError || !!databasesError || !!typesError;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={
        current
          ? t('websites.allowance.editTitle', { name: customer.name })
          : t('websites.allowance.setUpTitle', { name: customer.name })
      }
      description={t('websites.reseller.dialogText', { instance: pool.provider?.name ?? '' })}
      footer={
        <>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={blocked}
            loading={save.isPending}
            onClick={() =>
              sites !== null &&
              databases !== null &&
              save.mutate({
                maxSites: sites,
                maxDatabases: databases,
                siteTypes: pool.siteTypes.filter((type) => types.includes(type)),
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('websites.allowance.maxSites')}
            htmlFor="rw-sites"
            error={sitesError}
            hint={t('websites.reseller.left', { n: n(Math.max(0, sitesLeft)) })}
          >
            <Input
              id="rw-sites"
              type="number"
              inputMode="numeric"
              min={minSites}
              max={Math.max(minSites, sitesLeft)}
              step={1}
              value={maxSites}
              onChange={(e) => setMaxSites(e.target.value)}
              className="tabular"
            />
          </Field>
          <Field
            label={t('websites.allowance.maxDatabases')}
            htmlFor="rw-dbs"
            error={databasesError}
            hint={t('websites.reseller.left', { n: n(Math.max(0, databasesLeft)) })}
          >
            <Input
              id="rw-dbs"
              type="number"
              inputMode="numeric"
              min={minDatabases}
              max={Math.max(minDatabases, databasesLeft)}
              step={1}
              value={maxDatabases}
              onChange={(e) => setMaxDatabases(e.target.value)}
              className="tabular"
            />
          </Field>
        </div>
        <div>
          <SiteTypeChoice value={types} onChange={setTypes} offered={pool.siteTypes} />
          {typesError && <p className="mt-1.5 text-xs text-danger">{typesError}</p>}
        </div>
        {current && (current.sites > 0 || current.databases > 0) && (
          <p className="text-xs text-muted">
            {t('websites.reseller.inUse', { sites: n(current.sites), databases: n(current.databases) })}
          </p>
        )}
        {!customer.modules.includes('webhosting') && (
          <Notice tone="info">{t('websites.reseller.enablesModule')}</Notice>
        )}
        <DialogError error={save.error} />
      </div>
    </Dialog>
  );
}

/** What the reseller has not handed out or used yet. */
const roomOf = (pool: WebsiteAllowanceDto) => ({
  sites: Math.max(0, pool.maxSites - pool.sites),
  databases: Math.max(0, pool.maxDatabases - pool.databases),
});
