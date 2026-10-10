import { useState } from 'react';
import { HardDrive, Plus, Search, Users } from 'lucide-react';
import type { CloudAccountDto, CloudAllowanceDto } from '@weblion/shared';
import { formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useOrgCloud } from '@/lib/api/cloud';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ModuleOffState, PanelLink, safePanelUrl } from '@/pages/hosting/bits';
import {
  AccountStatusBadge,
  AllowanceFigures,
  LastLogin,
  LoginName,
  QuotaUsage,
  countedBytes,
  formatQuota,
  freeGb,
} from './bits';
import { AccountActions, CloudPasswordDialog, CreateAccountDialog, type ShownPassword } from './dialogs';

/** Cloud storage of an organization: its allowance and its Nextcloud accounts. */
export function CloudPage() {
  const { t } = useI18n();
  const { org, can, hasModule } = useOrg();
  const moduleOn = hasModule('storage');
  const canRead = can('cloud:read');
  const cloud = useOrgCloud(org.id, canRead);
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<ShownPassword | null>(null);

  const allowance = cloud.data?.allowance ?? null;
  const accounts = cloud.data?.accounts ?? [];
  const loginUrl = safePanelUrl(allowance?.provider?.url);
  const canCreate = can('cloud:write') && !!allowance;
  const accountLimit =
    !!allowance && allowance.maxAccounts !== null && allowance.accounts >= allowance.maxAccounts;
  const full = !!allowance && freeGb(allowance) < 1;
  const createBlocked = accountLimit ? t('storage.limit.accounts') : full ? t('storage.limit.storage') : null;

  let body;
  if (!canRead || (!moduleOn && cloud.isError)) {
    body = (
      <Card>
        {moduleOn ? <EmptyState title={t('storage.noAccess')} /> : <ModuleOffState module="storage" />}
      </Card>
    );
  } else if (cloud.isPending) {
    body = <LoadingBlock rows={6} />;
  } else if (cloud.isError) {
    body = <ErrorState error={cloud.error} onRetry={() => void cloud.refetch()} />;
  } else if (!allowance && accounts.length === 0) {
    body = (
      <Card>
        {moduleOn ? (
          <EmptyState
            icon={<HardDrive className="size-6" />}
            title={t('storage.none.title')}
            description={
              org.parent
                ? t('storage.none.textReseller', { reseller: org.parent.name })
                : t('storage.none.text')
            }
          />
        ) : (
          <ModuleOffState module="storage" />
        )}
      </Card>
    );
  } else {
    body = (
      <div className="space-y-6">
        {!moduleOn && <Notice tone="warning">{t('hosting.moduleOff.staff')}</Notice>}
        {allowance ? (
          <AllowanceCard allowance={allowance} accounts={accounts} reseller={org.kind === 'reseller'} />
        ) : (
          <Notice tone="warning">{t('storage.noAllowanceAccounts')}</Notice>
        )}
        {allowance && can('cloud:write') && createBlocked && <Notice tone="info">{createBlocked}</Notice>}
        <AccountsCard
          accounts={accounts}
          allowance={allowance}
          onCreate={canCreate && !createBlocked ? () => setCreating(true) : undefined}
          onPassword={setShown}
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('nav.cloud')}
        description={t('storage.subtitle')}
        actions={
          <>
            {loginUrl && (
              <PanelLink href={loginUrl} variant="secondary">
                {t('storage.open')}
              </PanelLink>
            )}
            {canCreate && (
              <Button
                variant="primary"
                icon={<Plus className="size-4" />}
                disabled={!!createBlocked}
                title={createBlocked ?? undefined}
                onClick={() => setCreating(true)}
              >
                {t('storage.create')}
              </Button>
            )}
          </>
        }
      />
      {body}
      {creating && allowance && (
        <CreateAccountDialog
          orgId={org.id}
          orgSlug={org.slug}
          allowance={allowance}
          accounts={accounts}
          onClose={() => setCreating(false)}
          onPassword={setShown}
        />
      )}
      <CloudPasswordDialog shown={shown} onClose={() => setShown(null)} />
    </>
  );
}

function AllowanceCard({
  allowance,
  accounts,
  reseller,
}: {
  allowance: CloudAllowanceDto;
  accounts: CloudAccountDto[];
  reseller: boolean;
}) {
  const { t, locale } = useI18n();
  // A reseller's allocation and account count include what it handed to its customers.
  const own = accounts.reduce((sum, a) => sum + countedBytes(a), 0);
  const toCustomers = reseller ? Math.max(0, allowance.allocatedBytes - own) : 0;
  const customerAccounts = reseller ? Math.max(0, allowance.accounts - accounts.length) : 0;
  return (
    <Card>
      <CardHeader title={t('storage.allowance')} description={t('storage.allowanceText')} />
      <CardBody>
        <AllowanceFigures
          allowance={allowance}
          extra={
            toCustomers > 0 || customerAccounts > 0 ? (
              <p className="text-xs text-muted">
                {t('storage.toCustomers', { size: formatQuota(toCustomers, locale), n: customerAccounts })}
              </p>
            ) : null
          }
        />
      </CardBody>
    </Card>
  );
}

function AccountsCard({
  accounts,
  allowance,
  onCreate,
  onPassword,
}: {
  accounts: CloudAccountDto[];
  allowance: CloudAllowanceDto | null;
  onCreate?: () => void;
  onPassword: (shown: ShownPassword) => void;
}) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  // The search only shows for longer lists. Below that, a leftover search must not hide accounts.
  const searchable = accounts.length > 8;
  const needle = searchable ? q.trim().toLowerCase() : '';
  const list = accounts.filter(
    (a) =>
      !needle ||
      a.username.includes(needle) ||
      a.displayName?.toLowerCase().includes(needle) ||
      a.email?.toLowerCase().includes(needle),
  );
  const lastSync = accounts
    .map((a) => a.lastSyncedAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const withActions = accounts.some(
    (a) => a.permissions.includes('cloud:write') || a.permissions.includes('cloud:password'),
  );

  return (
    <Card>
      <CardHeader
        title={t('storage.accounts')}
        description={
          lastSync
            ? t('storage.lastSync', { when: formatRelative(lastSync, locale) })
            : t('storage.accountsText')
        }
        actions={
          searchable && (
            <div className="relative w-64 max-w-full">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('storage.search')}
                className="pl-9"
                aria-label={t('storage.search')}
              />
            </div>
          )
        }
      />
      {accounts.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title={t('storage.empty')}
          description={t('storage.emptyText')}
          action={
            onCreate && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={onCreate}>
                {t('storage.create')}
              </Button>
            )
          }
        />
      ) : list.length === 0 ? (
        <EmptyState icon={<Search className="size-6" />} title={t('hosting.noMatch')} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{t('storage.col.login')}</TH>
              <TH className="hidden md:table-cell">{t('storage.col.name')}</TH>
              <TH className="hidden xl:table-cell">{t('storage.col.email')}</TH>
              <TH className="hidden sm:table-cell">{t('storage.col.storage')}</TH>
              <TH className="hidden sm:table-cell">{t('storage.col.status')}</TH>
              <TH className="hidden lg:table-cell">{t('storage.col.lastLogin')}</TH>
              {withActions && <TH />}
            </tr>
          </THead>
          <TBody>
            {list.map((a) => (
              <TR key={a.id}>
                <TD className="max-w-[260px]">
                  <LoginName username={a.username} />
                  {/* Name, e-mail, usage and status move below the login name on narrow screens. */}
                  <div className="truncate text-xs text-muted md:hidden">
                    {[a.displayName, a.email].filter(Boolean).join(' · ')}
                  </div>
                  <div className="mt-1.5 space-y-1.5 sm:hidden">
                    <QuotaUsage usedBytes={a.usedBytes} quotaBytes={a.quotaBytes} className="max-w-[220px]" />
                    <AccountStatusBadge account={a} />
                  </div>
                </TD>
                <TD className="hidden max-w-[220px] md:table-cell">
                  <div className="truncate">{a.displayName ?? <span className="text-subtle">–</span>}</div>
                  <div className="truncate text-xs text-muted xl:hidden">{a.email}</div>
                </TD>
                <TD className="hidden max-w-[240px] xl:table-cell">
                  <span className="block truncate">{a.email ?? <span className="text-subtle">–</span>}</span>
                </TD>
                <TD className="hidden sm:table-cell">
                  <QuotaUsage usedBytes={a.usedBytes} quotaBytes={a.quotaBytes} />
                </TD>
                <TD className="hidden sm:table-cell">
                  <AccountStatusBadge account={a} />
                </TD>
                <TD className="hidden text-sm lg:table-cell">
                  <LastLogin value={a.lastLoginAt} />
                </TD>
                {withActions && (
                  <TD className="w-12 text-right">
                    <AccountActions account={a} allowance={allowance} onPassword={onPassword} />
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
