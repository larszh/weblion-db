import { useState } from 'react';
import { Clapperboard, Plus, Search, Users } from 'lucide-react';
import type { MediaAccountDto, MediaAllowanceDto } from '@weblion/shared';
import { formatDate, formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useOrgMedia } from '@/lib/api/media';
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
import { ActivityDay, LoginName, MediaAllowanceFigures, MediaStatusBadge, mediaAllowanceFull } from './bits';
import {
  CreateMediaAccountDialog,
  MediaAccountActions,
  MediaPasswordDialog,
  type ShownMediaPassword,
} from './dialogs';
import { MediaLoginCard } from './login-card';

/**
 * Streaming accounts of the organization (/o/:slug/media): allowance, login card and the
 * accounts on the organization's Jellyfin instance. Shows the calendar day of the last activity
 * only, never what anyone watches.
 */
export function MediaPage() {
  const { t } = useI18n();
  const { org, can, hasModule } = useOrg();
  const moduleOn = hasModule('media');
  const canRead = can('media:read');
  const media = useOrgMedia(org.id, canRead);
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<ShownMediaPassword | null>(null);

  const allowance = media.data?.allowance ?? null;
  const accounts = media.data?.accounts ?? [];
  const login = media.data?.login ?? null;
  const openUrl = safePanelUrl(login?.url ?? allowance?.provider?.url);
  const canCreate = can('media:write') && !!allowance;
  const createBlocked = allowance && mediaAllowanceFull(allowance) ? t('media.limit.accounts') : null;

  let body;
  if (!canRead || (!moduleOn && media.isError)) {
    body = (
      <Card>{moduleOn ? <EmptyState title={t('media.noAccess')} /> : <ModuleOffState module="media" />}</Card>
    );
  } else if (media.isPending) {
    body = <LoadingBlock rows={6} />;
  } else if (media.isError) {
    body = <ErrorState error={media.error} onRetry={() => void media.refetch()} />;
  } else if (!allowance && accounts.length === 0) {
    body = (
      <Card>
        {moduleOn ? (
          <EmptyState
            icon={<Clapperboard className="size-6" />}
            title={t('media.none.title')}
            description={
              org.parent ? t('media.none.textReseller', { reseller: org.parent.name }) : t('media.none.text')
            }
          />
        ) : (
          <ModuleOffState module="media" />
        )}
      </Card>
    );
  } else {
    body = (
      <div className="space-y-6">
        {!moduleOn && <Notice tone="warning">{t('hosting.moduleOff.staff')}</Notice>}
        {allowance ? (
          <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
            <AllowanceCard allowance={allowance} className={login ? 'lg:col-span-3' : 'lg:col-span-5'} />
            {login && (
              <div className="lg:col-span-2">
                <MediaLoginCard login={login} />
              </div>
            )}
          </div>
        ) : (
          <Notice tone="warning">{t('media.noAllowanceAccounts')}</Notice>
        )}
        {allowance && can('media:write') && createBlocked && <Notice tone="info">{createBlocked}</Notice>}
        <AccountsCard
          accounts={accounts}
          onCreate={canCreate && !createBlocked ? () => setCreating(true) : undefined}
          onPassword={setShown}
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('nav.media')}
        description={t('media.subtitle')}
        actions={
          <>
            {openUrl && (
              <PanelLink href={openUrl} variant="secondary">
                {t('media.open')}
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
                {t('media.create')}
              </Button>
            )}
          </>
        }
      />
      {body}
      {creating && allowance && (
        <CreateMediaAccountDialog
          orgId={org.id}
          allowance={allowance}
          login={login}
          accounts={accounts}
          onClose={() => setCreating(false)}
          onPassword={setShown}
        />
      )}
      <MediaPasswordDialog shown={shown} onClose={() => setShown(null)} />
    </>
  );
}

function AllowanceCard({ allowance, className }: { allowance: MediaAllowanceDto; className?: string }) {
  const { t } = useI18n();
  return (
    <Card className={className}>
      <CardHeader title={t('media.allowance')} description={t('media.allowanceText')} />
      <CardBody>
        <MediaAllowanceFigures allowance={allowance} showInstance={false} />
      </CardBody>
    </Card>
  );
}

function AccountsCard({
  accounts,
  onCreate,
  onPassword,
}: {
  accounts: MediaAccountDto[];
  onCreate?: () => void;
  onPassword: (shown: ShownMediaPassword) => void;
}) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  // The search only shows for longer lists. Below that, a leftover search must not hide accounts.
  const searchable = accounts.length > 8;
  const needle = searchable ? q.trim().toLowerCase() : '';
  const list = accounts.filter((a) => !needle || a.username.toLowerCase().includes(needle));
  const lastSync = accounts
    .map((a) => a.lastSyncedAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const withActions = accounts.some(
    (a) => a.permissions.includes('media:write') || a.permissions.includes('media:password'),
  );

  return (
    <Card>
      <CardHeader
        title={t('media.accounts')}
        description={
          lastSync ? t('media.lastSync', { when: formatRelative(lastSync, locale) }) : t('media.accountsText')
        }
        actions={
          searchable && (
            <div className="relative w-64 max-w-full">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('media.search')}
                className="pl-9"
                aria-label={t('media.search')}
              />
            </div>
          )
        }
      />
      {accounts.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title={t('media.empty')}
          description={t('media.emptyText')}
          action={
            onCreate && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={onCreate}>
                {t('media.create')}
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
              <TH>{t('media.col.login')}</TH>
              <TH className="hidden sm:table-cell">{t('media.col.status')}</TH>
              <TH className="hidden md:table-cell">{t('media.col.lastActive')}</TH>
              <TH className="hidden lg:table-cell">{t('media.col.created')}</TH>
              {withActions && <TH />}
            </tr>
          </THead>
          <TBody>
            {list.map((a) => (
              <TR key={a.id}>
                <TD className="max-w-[320px]">
                  <LoginName username={a.username} />
                  {/* Status and last activity move below the login name on narrow screens. */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted md:hidden">
                    <span className="sm:hidden">
                      <MediaStatusBadge account={a} />
                    </span>
                    <span>
                      {t('media.col.lastActive')}: <ActivityDay day={a.lastActiveOn} />
                    </span>
                  </div>
                </TD>
                <TD className="hidden sm:table-cell">
                  <MediaStatusBadge account={a} />
                </TD>
                <TD className="hidden text-sm md:table-cell">
                  <ActivityDay day={a.lastActiveOn} />
                </TD>
                <TD className="hidden text-sm whitespace-nowrap text-muted lg:table-cell">
                  {formatDate(a.createdAt, locale, false)}
                </TD>
                {withActions && (
                  <TD className="w-12 text-right">
                    <MediaAccountActions account={a} onPassword={onPassword} />
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <p className="border-t border-border px-5 py-3 text-xs text-muted">{t('media.privacyNote')}</p>
    </Card>
  );
}
