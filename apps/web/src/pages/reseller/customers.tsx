import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Briefcase,
  ChevronLeft,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Layers,
  Plus,
  Receipt,
  Search,
  Undo2,
} from 'lucide-react';
import {
  DEFAULT_MODULES,
  MODULE_DEFS,
  formatMoney,
  type ModuleKey,
  type ResellerCustomerDto,
} from '@weblion/shared';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { formatDate } from '@/lib/format';
import {
  useCreateResellerCustomer,
  useCustomerResources,
  useDeleteOrg,
  useMoveResource,
  useResellerCustomer,
  useResellerCustomers,
  useUpdateResellerCustomer,
  type CustomerResources,
  type ResellerCustomerCreated,
  type ResourceType,
} from '@/lib/api/admin';
import type { TranslationKey } from '@/i18n/de';
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
  KeyValue,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SellerBillingPanel } from '@/pages/billing/seller-panel';
import { ResellerIssuerForm } from '@/pages/billing/settings-form';
import {
  DeleteError,
  InviteResult,
  ModuleBadges,
  ModuleCheckboxes,
  ModuleSwitches,
  ResourceCounts,
  StatusBadge,
  TabBar,
  useTabParam,
} from './bits';
import { ResellerCloudAllowanceCard } from './cloud-allowance';

/** Resource types a reseller hands out, with the module each one belongs to. */
const RESOURCE_TYPES: {
  type: ResourceType;
  module: ModuleKey;
  key: keyof Omit<CustomerResources, 'pool'>;
}[] = [
  { type: 'server', module: 'servers', key: 'servers' },
  { type: 'domain', module: 'dns', key: 'domains' },
  { type: 'webspace', module: 'webhosting', key: 'webspaces' },
  { type: 'maildomain', module: 'mail', key: 'mailDomains' },
];

/** Only reseller organizations have customers. Everyone else gets a plain explanation. */
function NotAReseller() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={<Briefcase className="size-6" />}
      title={t('admin.reseller.notReseller')}
      description={t('admin.reseller.notResellerText')}
    />
  );
}

function CreateCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { org, base } = useOrg();
  const navigate = useNavigate();
  const defaults = DEFAULT_MODULES.filter((m) => org.modules.includes(m));
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [modules, setModules] = useState<ModuleKey[]>(defaults);
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<ResellerCustomerCreated | null>(null);
  const create = useCreateResellerCustomer(org.id, setResult);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setResult(null);
      setName('');
      setOwnerEmail('');
      setModules(defaults);
      setNotes('');
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('admin.reseller.new')}
      description={result ? undefined : t('admin.reseller.newText')}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {t('common.close')}
            </Button>
            <Button variant="primary" onClick={() => navigate(`${base}/customers/${result.customer.id}`)}>
              {t('customers.open')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={name.trim().length < 2}
              loading={create.isPending}
              onClick={() =>
                create.mutate({
                  name: name.trim(),
                  ownerEmail: ownerEmail.trim() || undefined,
                  modules,
                  notes: notes.trim() || undefined,
                })
              }
            >
              {t('common.create')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone="success" title={t('customers.created', { name: result.customer.name })} />
          {result.inviteLink ? (
            <InviteResult link={result.inviteLink} mail={result.mail} email={ownerEmail.trim()} />
          ) : (
            <p className="text-sm text-muted">{t('admin.reseller.noOwnerYet')}</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('customers.name')} htmlFor="rc-name">
            <Input
              id="rc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bäckerei Muster"
              autoFocus
            />
          </Field>
          <Field label={t('customers.ownerEmail')} hint={t('admin.reseller.ownerHint')} htmlFor="rc-owner">
            <Input
              id="rc-owner"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
            />
          </Field>
          <Field label={t('admin.modules')} hint={t('admin.reseller.modulesHint')}>
            {org.modules.length === 0 ? (
              <Notice tone="warning">{t('admin.reseller.noModules')}</Notice>
            ) : (
              <ModuleCheckboxes value={modules} onChange={setModules} available={org.modules} />
            )}
          </Field>
          <Field label={t('admin.notes')} hint={t('admin.reseller.notesHint')} htmlFor="rc-notes">
            <Textarea id="rc-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

function CustomerList() {
  const { t, locale } = useI18n();
  const { org, can, base } = useOrg();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const customers = useResellerCustomers(org.id);
  const billing = can('reseller:billing');
  const needle = q.trim().toLowerCase();
  const rows = (customers.data ?? []).filter(
    (c) => !needle || c.name.toLowerCase().includes(needle) || c.slug.includes(needle),
  );
  const canWrite = can('reseller:customer:write');

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('common.search')}
              className="pl-9"
              aria-label={t('common.search')}
            />
          </div>
          {canWrite && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('admin.reseller.new')}
            </Button>
          )}
        </div>
        {customers.isPending ? (
          <LoadingBlock />
        ) : customers.isError ? (
          <div className="p-5">
            <ErrorState error={customers.error} onRetry={() => void customers.refetch()} />
          </div>
        ) : customers.data.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="size-6" />}
            title={t('admin.reseller.empty')}
            description={t('admin.reseller.emptyText')}
            action={
              canWrite && (
                <Button
                  variant="primary"
                  icon={<Plus className="size-4" />}
                  onClick={() => setCreating(true)}
                >
                  {t('admin.reseller.new')}
                </Button>
              )
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Search className="size-6" />} title={t('admin.noMatch')} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('customers.name')}</TH>
                <TH>{t('orgSettings.status')}</TH>
                <TH className="hidden md:table-cell">{t('admin.modules')}</TH>
                <TH>{t('admin.resources')}</TH>
                {billing && <TH className="text-right">{t('admin.balance')}</TH>}
                {billing && <TH className="text-right">{t('admin.openTotal')}</TH>}
              </tr>
            </THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id} onClick={() => navigate(`${base}/customers/${c.id}`)}>
                  <TD>
                    <Link
                      to={`${base}/customers/${c.id}`}
                      className="font-medium whitespace-nowrap hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.name}
                    </Link>
                    <Mono className="block whitespace-nowrap text-subtle">{c.slug}</Mono>
                  </TD>
                  <TD>
                    <StatusBadge status={c.status} suspendedBy={c.suspendedBy} viewer="reseller" />
                  </TD>
                  <TD className="hidden md:table-cell">
                    <ModuleBadges modules={c.modules} empty={t('admin.modules.none')} />
                  </TD>
                  <TD>
                    <ResourceCounts counts={c.counts} modules={c.modules} />
                  </TD>
                  {billing && (
                    <TD className="text-right whitespace-nowrap tabular">
                      {formatMoney(c.balance, c.currency, locale)}
                    </TD>
                  )}
                  {billing && (
                    <TD
                      className={`text-right whitespace-nowrap tabular ${c.openTotal > 0 ? 'font-medium text-warning' : 'text-muted'}`}
                    >
                      {formatMoney(c.openTotal, c.currency, locale)}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <CreateCustomerDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export function ResellerCustomersPage() {
  const { t } = useI18n();
  const { org, can } = useOrg();
  // The invoice issuer settings (name, address, bank details) belong to whoever bills the customers.
  const tabs = [
    { value: 'customers' as const, label: t('admin.reseller.tab.customers'), icon: <Briefcase /> },
    {
      value: 'issuer' as const,
      label: t('admin.reseller.tab.issuer'),
      icon: <FileText />,
      show: can('reseller:billing'),
    },
  ];
  const [tab, setTab] = useTabParam(tabs);
  if (org.kind !== 'reseller') return <NotAReseller />;
  if (!can('reseller:customer:read')) {
    return <EmptyState icon={<Briefcase className="size-6" />} title={t('admin.reseller.noAccess')} />;
  }
  return (
    <>
      <PageHeader title={t('nav.customers')} description={t('admin.reseller.subtitle')} />
      {can('reseller:billing') && (
        <TabBar label={t('nav.customers')} current={tab} onChange={setTab} tabs={tabs} />
      )}
      {tab === 'issuer' ? <ResellerIssuerForm orgId={org.id} /> : <CustomerList />}
    </>
  );
}

// --- Customer detail -------------------------------------------------------------------

function OverviewTab({ customer }: { customer: ResellerCustomerDto }) {
  const { t, locale } = useI18n();
  const { org, can } = useOrg();
  const canWrite = can('reseller:customer:write');
  const billing = can('reseller:billing');
  const currency = customer.currency;
  const update = useUpdateResellerCustomer(org.id, customer.id, t('common.saved'));
  const [notes, setNotes] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<ModuleKey | null>(null);
  const setModules = (modules: ModuleKey[]) => update.mutate({ modules });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader title={t('admin.modules')} description={t('admin.reseller.modulesText')} />
          <CardBody>
            <ModuleSwitches
              value={customer.modules}
              available={org.modules}
              unavailableHint={t('admin.reseller.moduleMissing')}
              disabled={!canWrite || update.isPending}
              onToggle={(m, on) => (on ? setModules([...customer.modules, m]) : setDisabling(m))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('admin.notes')} description={t('admin.reseller.notesHint')} />
          <CardBody className="space-y-3">
            <Textarea
              rows={5}
              value={notes ?? customer.notes ?? ''}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canWrite}
              aria-label={t('admin.notes')}
            />
            {canWrite && (
              <Button
                size="sm"
                variant="primary"
                disabled={notes === null}
                loading={update.isPending}
                onClick={() =>
                  update.mutate({ notes: notes?.trim() || null }, { onSuccess: () => setNotes(null) })
                }
              >
                {t('common.save')}
              </Button>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title={t('orgSettings.info')} />
          <CardBody className="py-1">
            <KeyValue
              items={[
                {
                  label: t('orgSettings.status'),
                  value: (
                    <StatusBadge
                      status={customer.status}
                      suspendedBy={customer.suspendedBy}
                      viewer="reseller"
                    />
                  ),
                },
                {
                  label: t('nav.servers'),
                  value: <span className="tabular">{customer.counts.servers}</span>,
                },
                {
                  label: t('admin.resources.domains'),
                  value: <span className="tabular">{customer.counts.domains}</span>,
                },
                {
                  label: t('admin.resources.webspaces'),
                  value: <span className="tabular">{customer.counts.webspaces}</span>,
                },
                {
                  label: t('nav.members'),
                  value: <span className="tabular">{customer.counts.members}</span>,
                },
                ...(billing
                  ? [
                      {
                        label: t('admin.balance'),
                        value: (
                          <span className="tabular">{formatMoney(customer.balance, currency, locale)}</span>
                        ),
                      },
                      {
                        label: t('admin.openTotal'),
                        value: (
                          <span className={`tabular ${customer.openTotal > 0 ? 'text-warning' : ''}`}>
                            {formatMoney(customer.openTotal, currency, locale)}
                          </span>
                        ),
                      },
                    ]
                  : []),
                { label: t('orgSettings.created'), value: formatDate(customer.createdAt, locale, false) },
              ]}
            />
          </CardBody>
        </Card>
        {canWrite && <DeleteCard customer={customer} />}
      </div>
      <ConfirmDialog
        open={disabling !== null}
        onOpenChange={(o) => !o && setDisabling(null)}
        title={t('admin.modules.disableTitle')}
        description={
          disabling
            ? t('admin.modules.disableText', {
                module: MODULE_DEFS[disabling].label[locale],
                name: customer.name,
              })
            : undefined
        }
        confirmLabel={t('admin.modules.disable')}
        loading={update.isPending}
        onConfirm={() =>
          update.mutate(
            { modules: customer.modules.filter((m) => m !== disabling) },
            { onSuccess: () => setDisabling(null) },
          )
        }
      />
    </div>
  );
}

function DeleteCard({ customer }: { customer: ResellerCustomerDto }) {
  const { t } = useI18n();
  const { org, base } = useOrg();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const remove = useDeleteOrg(`/orgs/${org.id}/customers/${customer.id}`, t('customers.deleted'), () =>
    navigate(`${base}/customers`),
  );
  return (
    <Card className="border-danger/40">
      <CardHeader title={t('customers.delete')} description={t('admin.reseller.deleteText')} />
      <CardBody>
        <Button variant="danger-soft" onClick={() => setOpen(true)}>
          {t('customers.delete')}
        </Button>
      </CardBody>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) remove.reset();
        }}
        title={t('customers.delete')}
        description={t('admin.reseller.deleteText')}
        confirmLabel={t('common.delete')}
        confirmText={customer.slug}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        {remove.error && (
          <div className="mb-4">
            <DeleteError error={remove.error} />
          </div>
        )}
      </ConfirmDialog>
    </Card>
  );
}

function AssignDialog({
  type,
  customer,
  pool,
  onOpenChange,
}: {
  type: ResourceType | null;
  customer: ResellerCustomerDto;
  pool: CustomerResources['pool'];
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { org } = useOrg();
  const [selected, setSelected] = useState('');
  const def = RESOURCE_TYPES.find((r) => r.type === type);
  const items = def ? pool[def.key] : [];
  const assign = useMoveResource(org.id, customer.id, 'assign', t('admin.resources.assigned'));
  const close = () => {
    setSelected('');
    onOpenChange(false);
  };
  const value = selected || items[0]?.id || '';
  return (
    <Dialog
      open={type !== null}
      onOpenChange={(o) => !o && close()}
      title={def ? t(`admin.resources.assign.${def.type}` as TranslationKey) : ''}
      description={t('admin.resources.assignText', { name: customer.name })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!value}
            loading={assign.isPending}
            onClick={() => def && assign.mutate({ type: def.type, id: value }, { onSuccess: close })}
          >
            {t('admin.resources.assign')}
          </Button>
        </>
      }
    >
      {def && (
        <div className="space-y-4">
          {items.length === 0 ? (
            <Notice tone="info">{t('admin.resources.poolEmpty')}</Notice>
          ) : (
            <Field label={t('admin.resources.fromPool')} htmlFor="assign-item">
              <Select id="assign-item" value={value} onChange={(e) => setSelected(e.target.value)}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {def.type === 'server' && (
            <p className="text-xs text-muted">{t('admin.resources.serverProject')}</p>
          )}
          {!customer.modules.includes(def.module) && (
            <Notice tone="warning">
              {t('admin.resources.enablesModule', { module: MODULE_DEFS[def.module].label[locale] })}
            </Notice>
          )}
        </div>
      )}
    </Dialog>
  );
}

function ResourcesTab({ customer }: { customer: ResellerCustomerDto }) {
  const { t, locale } = useI18n();
  const { org, can } = useOrg();
  const canWrite = can('reseller:customer:write');
  const resources = useCustomerResources(org.id, customer.id);
  const release = useMoveResource(org.id, customer.id, 'release', t('admin.resources.released'));
  const [assigning, setAssigning] = useState<ResourceType | null>(null);
  const [releasing, setReleasing] = useState<{ type: ResourceType; id: string; name: string } | null>(null);
  const types = RESOURCE_TYPES.filter((r) => org.modules.includes(r.module));
  // Cloud storage is no resource that moves, the customer gets a share of the allowance.
  const cloud = org.modules.includes('storage');

  if (resources.isPending) return <LoadingBlock rows={6} />;
  if (resources.isError) {
    return <ErrorState error={resources.error} onRetry={() => void resources.refetch()} />;
  }
  const data = resources.data;
  if (types.length === 0 && !cloud) {
    return <EmptyState title={t('admin.reseller.noModules')} />;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{t('admin.resources.intro')}</p>
      {types.map((def) => {
        const items = data[def.key];
        const pool = data.pool[def.key];
        return (
          <Card key={def.type}>
            <CardHeader
              title={t(`admin.resources.title.${def.type}` as TranslationKey)}
              description={
                <>
                  {MODULE_DEFS[def.module].label[locale]}
                  {' · '}
                  {t('admin.resources.poolCount', { n: pool.length })}
                </>
              }
              actions={
                canWrite && (
                  <Button
                    size="sm"
                    icon={<Plus className="size-4" />}
                    disabled={pool.length === 0}
                    title={pool.length === 0 ? t('admin.resources.poolEmpty') : undefined}
                    onClick={() => setAssigning(def.type)}
                  >
                    {t('admin.resources.assign')}
                  </Button>
                )
              }
            />
            {items.length === 0 ? (
              <EmptyState className="py-8" title={t(`admin.resources.empty.${def.type}` as TranslationKey)} />
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="min-w-0 truncate text-sm font-medium text-text">{item.name}</span>
                    {canWrite && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Undo2 className="size-4" />}
                        onClick={() => setReleasing({ type: def.type, id: item.id, name: item.name })}
                      >
                        {t('admin.resources.release')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      {cloud && <ResellerCloudAllowanceCard customer={customer} />}
      <AssignDialog
        type={assigning}
        customer={customer}
        pool={data.pool}
        onOpenChange={(o) => !o && setAssigning(null)}
      />
      <ConfirmDialog
        open={releasing !== null}
        onOpenChange={(o) => !o && setReleasing(null)}
        title={t('admin.resources.releaseTitle')}
        description={
          releasing
            ? t('admin.resources.releaseText', { name: releasing.name, customer: customer.name })
            : undefined
        }
        confirmLabel={t('admin.resources.release')}
        loading={release.isPending}
        onConfirm={() =>
          releasing &&
          release.mutate({ type: releasing.type, id: releasing.id }, { onSuccess: () => setReleasing(null) })
        }
      />
    </div>
  );
}

type DetailTab = 'overview' | 'resources' | 'billing';

function CustomerDetail({ customer }: { customer: ResellerCustomerDto }) {
  const { t } = useI18n();
  const { org, can } = useOrg();
  const canWrite = can('reseller:customer:write');
  const update = useUpdateResellerCustomer(org.id, customer.id, t('common.saved'));
  const [toggling, setToggling] = useState(false);
  const suspended = customer.status === 'suspended';
  // Only weblion.one lifts a suspension it set.
  const platformSuspended = suspended && customer.suspendedBy === 'platform';
  const tabs = [
    { value: 'overview' as DetailTab, label: t('admin.tab.overview'), icon: <LayoutDashboard /> },
    { value: 'resources' as DetailTab, label: t('admin.tab.resources'), icon: <Layers /> },
    {
      value: 'billing' as DetailTab,
      label: t('admin.tab.billing'),
      icon: <Receipt />,
      show: can('reseller:billing'),
    },
  ];
  const [tab, setTab] = useTabParam(tabs);

  return (
    <>
      <PageHeader
        title={customer.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Mono>{customer.slug}</Mono>
            <StatusBadge status={customer.status} suspendedBy={customer.suspendedBy} viewer="reseller" />
          </span>
        }
        actions={
          <>
            {can('reseller:customer:access') && (
              <Link
                to={`/o/${customer.slug}`}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium shadow-card hover:bg-surface-3"
              >
                <ExternalLink className="size-4" /> {t('admin.reseller.openPanel')}
              </Link>
            )}
            {canWrite && !platformSuspended && (
              <Button variant={suspended ? 'primary' : 'danger-soft'} onClick={() => setToggling(true)}>
                {suspended ? t('customers.reactivate') : t('customers.suspend')}
              </Button>
            )}
          </>
        }
      />
      {suspended && (
        <Notice tone="danger" className="mb-6">
          {platformSuspended ? t('admin.reseller.platformSuspended') : t('customers.suspendedHint')}
        </Notice>
      )}
      <TabBar label={customer.name} tabs={tabs} current={tab} onChange={setTab} />
      {tab === 'resources' ? (
        <ResourcesTab customer={customer} />
      ) : tab === 'billing' ? (
        <SellerBillingPanel orgId={customer.id} />
      ) : (
        <OverviewTab customer={customer} />
      )}
      <ConfirmDialog
        open={toggling}
        onOpenChange={setToggling}
        title={suspended ? t('admin.status.activateTitle') : t('admin.status.suspendTitle')}
        description={
          suspended
            ? t('admin.status.activateText', { name: customer.name })
            : t('admin.status.suspendText', { name: customer.name })
        }
        confirmLabel={suspended ? t('customers.reactivate') : t('customers.suspend')}
        danger={!suspended}
        loading={update.isPending}
        onConfirm={() =>
          update.mutate(
            { status: suspended ? 'active' : 'suspended' },
            { onSuccess: () => setToggling(false) },
          )
        }
      />
    </>
  );
}

export function ResellerCustomerPage() {
  const { t } = useI18n();
  const { org, base, can } = useOrg();
  const { customerId } = useParams();
  const isReseller = org.kind === 'reseller' && can('reseller:customer:read');
  const customer = useResellerCustomer(org.id, isReseller ? customerId : undefined);

  if (org.kind !== 'reseller') return <NotAReseller />;
  return (
    <>
      <Link
        to={`${base}/customers`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.customers')}
      </Link>
      {!isReseller ? (
        <EmptyState icon={<Briefcase className="size-6" />} title={t('admin.reseller.noAccess')} />
      ) : customer.isPending ? (
        <LoadingBlock rows={6} />
      ) : customer.isError ? (
        customer.error instanceof ApiError && customer.error.status === 404 ? (
          <EmptyState
            icon={<Briefcase className="size-6" />}
            title={t('admin.reseller.notFound')}
            description={t('admin.reseller.notFoundText')}
          />
        ) : (
          <ErrorState error={customer.error} onRetry={() => void customer.refetch()} />
        )
      ) : (
        <CustomerDetail customer={customer.data} />
      )}
    </>
  );
}
