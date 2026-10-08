import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Briefcase,
  Building2,
  ChevronLeft,
  ExternalLink,
  LayoutDashboard,
  Plus,
  Receipt,
  Search,
} from 'lucide-react';
import {
  DEFAULT_MODULES,
  MODULE_DEFS,
  ORG_KINDS,
  formatMoney,
  type AdminOrgDto,
  type ModuleKey,
  type OrgKind,
  type Permission,
  type PolicyStatement,
} from '@weblion/shared';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { qk, useAdminOrg, useAdminServers, useApiMutation, useMe, useMeta } from '@/lib/queries';
import {
  useAdminOrgList,
  useCreateAdminOrg,
  useDeleteOrg,
  useUpdateAdminOrg,
  type AdminOrgCreated,
} from '@/lib/api/admin';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ServerTable } from '@/components/server-table';
import { SellerBillingPanel } from '@/pages/billing/seller-panel';
import {
  DeleteError,
  InviteResult,
  KindBadge,
  ModuleBadges,
  ModuleCheckboxes,
  ModuleSwitches,
  ResourceCounts,
  StatusBadge,
  TabBar,
  kindKey,
  useTabParam,
} from '@/pages/reseller/bits';

/** Platform permissions of the signed in user, for hiding what they can't change. */
function usePlatformCan() {
  const me = useMe();
  const perms = me.data?.platformPermissions ?? [];
  return (permission: Permission) => perms.includes(permission);
}

/** Reseller organizations, for parent selects and module limits. */
const useResellers = (enabled = true) => useAdminOrgList({ kind: 'reseller' }, enabled);

function CreateOrgDialog({
  open,
  onOpenChange,
  defaultParentId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Preselects the reseller, e.g. when opened from a reseller's customer list. */
  defaultParentId?: string;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const resellers = useResellers(open);
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [kind, setKind] = useState<OrgKind>('customer');
  const [parentId, setParentId] = useState(defaultParentId ?? '');
  const [modules, setModules] = useState<ModuleKey[]>(DEFAULT_MODULES);
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<AdminOrgCreated | null>(null);
  const create = useCreateAdminOrg(setResult);

  const parent = kind === 'customer' ? resellers.data?.find((r) => r.id === parentId) : undefined;
  // A reseller's customer can only have modules the reseller has.
  const available = parent?.modules;
  const chosen = available ? modules.filter((m) => available.includes(m)) : modules;

  const reset = () => {
    setResult(null);
    setName('');
    setOwnerEmail('');
    setKind('customer');
    setParentId(defaultParentId ?? '');
    setModules(DEFAULT_MODULES);
    setNotes('');
  };
  useEffect(() => {
    if (open) setParentId(defaultParentId ?? '');
  }, [open, defaultParentId]);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('customers.new')}
      description={result ? undefined : t('admin.orgs.newText')}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {t('common.close')}
            </Button>
            <Button variant="primary" onClick={() => navigate(`/admin/customers/${result.id}`)}>
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
                  kind,
                  parentOrgId: parent?.id,
                  modules: chosen,
                  ownerEmail: ownerEmail.trim() || undefined,
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
          <Notice tone="success" title={t('customers.created', { name: result.name })} />
          {result.inviteLink ? (
            <InviteResult link={result.inviteLink} mail={result.mail} email={ownerEmail.trim()} />
          ) : ownerEmail.trim() ? (
            <p className="text-sm text-muted">{t('admin.orgs.ownerAdded', { email: ownerEmail.trim() })}</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('customers.name')} htmlFor="c-name">
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Muster AG"
              autoFocus
            />
          </Field>
          <Field label={t('customers.ownerEmail')} hint={t('customers.ownerEmailHint')} htmlFor="c-owner">
            <Input
              id="c-owner"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('orgSettings.kind')} htmlFor="c-kind">
              <Select id="c-kind" value={kind} onChange={(e) => setKind(e.target.value as OrgKind)}>
                {ORG_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(kindKey(k))}
                  </option>
                ))}
              </Select>
            </Field>
            {kind === 'customer' && (
              <Field label={t('admin.orgs.reseller')} htmlFor="c-parent">
                <Select
                  id="c-parent"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  disabled={resellers.isPending}
                >
                  <option value="">{t('admin.orgs.noReseller')}</option>
                  {resellers.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <p className="-mt-2 text-xs text-muted">{t(`admin.orgs.kindHint.${kind}`)}</p>
          <Field
            label={t('admin.modules')}
            hint={
              parent ? t('admin.orgs.modulesOfReseller', { name: parent.name }) : t('admin.orgs.modulesHint')
            }
          >
            {available && available.length === 0 ? (
              <Notice tone="warning">
                {t('admin.orgs.resellerNoModules', { name: parent?.name ?? '' })}
              </Notice>
            ) : (
              <ModuleCheckboxes value={chosen} onChange={setModules} available={available} />
            )}
          </Field>
          <Field label={t('customers.notes')} hint={t('customers.notesText')} htmlFor="c-notes">
            <Textarea id="c-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

export function CustomersPage() {
  const { t, locale } = useI18n();
  const can = usePlatformCan();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<OrgKind | ''>('');
  const orgs = useAdminOrgList({ q: q.trim() || undefined, kind: kind || undefined });
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const filtered = !!q.trim() || !!kind;
  return (
    <>
      <PageHeader
        title={t('nav.admin.customers')}
        description={t('admin.orgs.subtitle')}
        actions={
          can('platform:org:write') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('customers.new')}
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('common.search')}
              className="pl-9"
              aria-label={t('common.search')}
            />
          </div>
          <Select
            className="w-auto"
            value={kind}
            onChange={(e) => setKind(e.target.value as OrgKind | '')}
            aria-label={t('orgSettings.kind')}
          >
            <option value="">{t('admin.orgs.allKinds')}</option>
            {ORG_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(kindKey(k))}
              </option>
            ))}
          </Select>
        </div>
        {orgs.isPending ? (
          <LoadingBlock />
        ) : orgs.isError ? (
          <div className="p-5">
            <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />
          </div>
        ) : orgs.data.length === 0 ? (
          <EmptyState
            icon={filtered ? <Search className="size-6" /> : <Building2 className="size-6" />}
            title={filtered ? t('admin.noMatch') : t('customers.empty')}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('customers.name')}</TH>
                <TH>{t('orgSettings.kind')}</TH>
                <TH>{t('admin.orgs.reseller')}</TH>
                <TH className="hidden md:table-cell">{t('admin.modules')}</TH>
                <TH>{t('admin.resources')}</TH>
                <TH className="hidden lg:table-cell">{t('nav.members')}</TH>
                <TH className="hidden xl:table-cell">{t('orgSettings.created')}</TH>
              </tr>
            </THead>
            <TBody>
              {orgs.data.map((o) => (
                <TR key={o.id} onClick={() => navigate(`/admin/customers/${o.id}`)}>
                  <TD>
                    <Link
                      to={`/admin/customers/${o.id}`}
                      className="font-medium whitespace-nowrap hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {o.name}
                    </Link>
                    <Mono className="block whitespace-nowrap text-subtle">{o.slug}</Mono>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <KindBadge kind={o.kind} />
                      {o.status === 'suspended' && (
                        <StatusBadge status={o.status} suspendedBy={o.suspendedBy} />
                      )}
                    </div>
                    {o.kind === 'reseller' && (
                      <span className="mt-0.5 block text-xs whitespace-nowrap text-muted">
                        {t('admin.orgs.customerCount', { n: o.counts.customers })}
                      </span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {o.parent ? (
                      <Link
                        to={`/admin/customers/${o.parent.id}`}
                        className="text-primary-text hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.parent.name}
                      </Link>
                    ) : (
                      <span className="text-subtle">–</span>
                    )}
                  </TD>
                  <TD className="hidden md:table-cell">
                    <ModuleBadges modules={o.modules} empty={t('admin.modules.none')} />
                  </TD>
                  <TD>
                    <ResourceCounts counts={o.counts} modules={o.modules} />
                  </TD>
                  <TD className="hidden tabular lg:table-cell">{o.counts.members}</TD>
                  <TD className="hidden whitespace-nowrap text-muted xl:table-cell">
                    {formatDate(o.createdAt, locale, false)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <CreateOrgDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

// --- Detail --------------------------------------------------------------------------

/** Actions staff can open up or lock for a customer through its permission boundary. */
const BOUNDARY_TOGGLES: Permission[] = [
  'server:delete',
  'server:rescale',
  'server:rebuild',
  'server:config:read',
  'server:console',
  'server:password-reset',
  'server:firewall:write',
  'server:backup:restore',
  'server:snapshot:rollback',
  'member:invite',
  'apitoken:write',
];

/** Extra switches for resellers: what they may do for their customers. */
const RESELLER_TOGGLES: Permission[] = [
  'reseller:customer:write',
  'reseller:customer:access',
  'reseller:billing',
];

function parseSimpleBoundary(boundary: PolicyStatement[]): string[] | null {
  const [allow, deny, ...rest] = boundary;
  if (
    rest.length > 0 ||
    !allow ||
    allow.effect !== 'allow' ||
    allow.actions.join() !== '*' ||
    (allow.resources?.length ?? 0) > 0
  )
    return null;
  if (!deny) return [];
  if (deny.effect !== 'deny' || (deny.resources?.length ?? 0) > 0 || deny.conditions) return null;
  return deny.actions;
}

function buildBoundary(denied: string[]): PolicyStatement[] {
  return [
    { sid: 'Everything', effect: 'allow', actions: ['*'] },
    { sid: 'StaffOnly', effect: 'deny', actions: [...new Set([...denied, 'platform:*'])] },
  ];
}

function BoundaryCard({ org, canWrite }: { org: AdminOrgDto; canWrite: boolean }) {
  const { t, locale } = useI18n();
  const meta = useMeta();
  const simple = parseSimpleBoundary(org.boundary);
  const [denied, setDenied] = useState<string[]>(simple ?? []);
  const [advanced, setAdvanced] = useState(simple === null);
  const [json, setJson] = useState(JSON.stringify(org.boundary, null, 2));
  useEffect(() => {
    const s = parseSimpleBoundary(org.boundary);
    if (s) setDenied(s);
    setJson(JSON.stringify(org.boundary, null, 2));
  }, [org.boundary]);

  const save = useApiMutation((boundary: unknown) => api.patch(`/admin/orgs/${org.id}`, { boundary }), {
    success: t('common.saved'),
    invalidate: [qk.admin('org', { id: org.id }), qk.admin('orgs')],
  });
  const toggles = org.kind === 'reseller' ? [...BOUNDARY_TOGGLES, ...RESELLER_TOGGLES] : BOUNDARY_TOGGLES;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = null;
  }

  return (
    <Card>
      <CardHeader
        title={t('customers.boundary')}
        description={org.kind === 'reseller' ? t('admin.orgs.boundaryReseller') : t('customers.boundaryText')}
        actions={
          <Button size="sm" onClick={() => setAdvanced(!advanced)}>
            {advanced ? t('policies.visual') : 'JSON'}
          </Button>
        }
      />
      <CardBody className="space-y-3">
        {advanced ? (
          <>
            <Textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              rows={14}
              className="font-mono text-xs"
              spellCheck={false}
              disabled={!canWrite}
            />
            {canWrite && (
              <Button
                variant="primary"
                disabled={!parsed}
                loading={save.isPending}
                onClick={() => save.mutate(parsed)}
              >
                {t('common.save')}
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="grid gap-2 md:grid-cols-2">
              {toggles.map((p) => (
                <label
                  key={p}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="min-w-0 text-sm">
                    {meta.data?.permissions[p]?.label[locale] ?? p}
                    <Mono className="block truncate text-[11px] text-subtle">{p}</Mono>
                  </span>
                  <Switch
                    checked={!denied.includes(p)}
                    disabled={!canWrite}
                    onCheckedChange={(allowed) =>
                      setDenied(allowed ? denied.filter((d) => d !== p) : [...denied, p])
                    }
                    label={p}
                  />
                </label>
              ))}
            </div>
            {canWrite && (
              <Button
                variant="primary"
                loading={save.isPending}
                onClick={() => save.mutate(buildBoundary(denied))}
              >
                {t('common.save')}
              </Button>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

type DetailOrg = AdminOrgDto & { projects: { id: string; name: string }[] };

function ModulesCard({
  org,
  parent,
  canWrite,
}: {
  org: DetailOrg;
  parent: AdminOrgDto | undefined;
  canWrite: boolean;
}) {
  const { t, locale } = useI18n();
  const update = useUpdateAdminOrg(org.id, t('common.saved'));
  const [disabling, setDisabling] = useState<ModuleKey | null>(null);
  const resellerWithCustomers = org.kind === 'reseller' && org.counts.customers > 0;
  return (
    <Card>
      <CardHeader
        title={t('admin.modules')}
        description={
          org.kind === 'reseller'
            ? t('admin.orgs.modulesReseller')
            : parent
              ? t('admin.orgs.modulesOfReseller', { name: parent.name })
              : t('admin.orgs.modulesText')
        }
      />
      <CardBody>
        <ModuleSwitches
          value={org.modules}
          available={parent?.modules}
          unavailableHint={parent ? t('admin.orgs.moduleMissing', { name: parent.name }) : undefined}
          disabled={!canWrite || update.isPending}
          onToggle={(m, on) => (on ? update.mutate({ modules: [...org.modules, m] }) : setDisabling(m))}
        />
      </CardBody>
      <ConfirmDialog
        open={disabling !== null}
        onOpenChange={(o) => !o && setDisabling(null)}
        title={t('admin.modules.disableTitle')}
        description={
          disabling
            ? t(resellerWithCustomers ? 'admin.modules.disableReseller' : 'admin.modules.disableText', {
                module: MODULE_DEFS[disabling].label[locale],
                name: org.name,
              })
            : undefined
        }
        confirmLabel={t('admin.modules.disable')}
        loading={update.isPending}
        onConfirm={() =>
          update.mutate(
            { modules: org.modules.filter((m) => m !== disabling) },
            { onSuccess: () => setDisabling(null) },
          )
        }
      />
    </Card>
  );
}

/** Open billing with the current seller, as a 409 on a reseller change carries it. */
interface MoveBlockerDetails {
  balance: number;
  currency: string;
  invoices: number;
  payments: number;
  services: number;
}

/** Explains why the reseller can't change (409 with open billing), nothing for other errors. */
function MoveBlockers({ error }: { error: unknown }) {
  const { t, locale } = useI18n();
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const details = error.details as Partial<MoveBlockerDetails> | null;
  if (!details || typeof details !== 'object' || typeof details.balance !== 'number') return null;
  const items = [
    details.balance
      ? t('admin.orgs.moveBlocker.balance', {
          amount: formatMoney(details.balance, details.currency ?? 'CHF', locale),
        })
      : null,
    details.invoices ? t('admin.orgs.moveBlocker.invoices', { n: details.invoices }) : null,
    details.payments ? t('admin.orgs.moveBlocker.payments', { n: details.payments }) : null,
    details.services ? t('admin.orgs.moveBlocker.services', { n: details.services }) : null,
  ].filter((item): item is string => item !== null);
  if (items.length === 0) return null;
  return (
    <Notice tone="danger" title={t('admin.orgs.moveBlocked')}>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-2">{t('admin.orgs.moveBlockedHint')}</p>
    </Notice>
  );
}

/** Which reseller a customer belongs to. Moving it changes who bills and manages it. */
function ResellerCard({
  org,
  resellers,
  canWrite,
}: {
  org: DetailOrg;
  resellers: AdminOrgDto[] | undefined;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const current = org.parent?.id ?? '';
  const [parentId, setParentId] = useState(current);
  useEffect(() => setParentId(current), [current]);
  const update = useUpdateAdminOrg(org.id, t('admin.orgs.resellerSaved'));
  const target = resellers?.find((r) => r.id === parentId);
  const missing = target ? org.modules.filter((m) => !target.modules.includes(m)) : [];
  return (
    <Card>
      <CardHeader title={t('admin.orgs.reseller')} description={t('admin.orgs.resellerText')} />
      <CardBody className="space-y-3">
        <Select
          value={parentId}
          onChange={(e) => {
            setParentId(e.target.value);
            update.reset();
          }}
          disabled={!canWrite || !resellers}
          aria-label={t('admin.orgs.reseller')}
        >
          <option value="">{t('admin.orgs.noReseller')}</option>
          {resellers?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        {missing.length > 0 && (
          <Notice tone="warning">{t('admin.orgs.moveMissing', { name: target?.name ?? '' })}</Notice>
        )}
        {canWrite && <p className="text-xs text-muted">{t('admin.orgs.moveBillingHint')}</p>}
        <MoveBlockers error={update.error} />
        {canWrite && (
          <Button
            size="sm"
            variant="primary"
            disabled={parentId === current || missing.length > 0}
            loading={update.isPending}
            onClick={() => update.mutate({ parentOrgId: parentId || null })}
          >
            {t('common.save')}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

/** The customers below a reseller, with a shortcut to create one. */
function ResellerCustomersCard({ org, canWrite }: { org: DetailOrg; canWrite: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const customers = useAdminOrgList({ parentOrgId: org.id });
  const [creating, setCreating] = useState(false);
  return (
    <Card>
      <CardHeader
        title={t('admin.orgs.customersOf')}
        description={t('admin.orgs.customersOfText')}
        actions={
          canWrite && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('customers.new')}
            </Button>
          )
        }
      />
      {customers.isPending ? (
        <LoadingBlock rows={2} />
      ) : customers.isError ? (
        <div className="p-5">
          <ErrorState error={customers.error} onRetry={() => void customers.refetch()} />
        </div>
      ) : customers.data.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Briefcase className="size-6" />}
          title={t('admin.orgs.noCustomers')}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{t('customers.name')}</TH>
              <TH>{t('orgSettings.status')}</TH>
              <TH className="hidden md:table-cell">{t('admin.modules')}</TH>
              <TH>{t('admin.resources')}</TH>
            </tr>
          </THead>
          <TBody>
            {customers.data.map((c) => (
              <TR key={c.id} onClick={() => navigate(`/admin/customers/${c.id}`)}>
                <TD>
                  <span className="font-medium whitespace-nowrap">{c.name}</span>
                  <Mono className="block whitespace-nowrap text-subtle">{c.slug}</Mono>
                </TD>
                <TD>
                  <StatusBadge status={c.status} suspendedBy={c.suspendedBy} />
                </TD>
                <TD className="hidden md:table-cell">
                  <ModuleBadges modules={c.modules} empty={t('admin.modules.none')} />
                </TD>
                <TD>
                  <ResourceCounts counts={c.counts} modules={c.modules} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <CreateOrgDialog open={creating} onOpenChange={setCreating} defaultParentId={org.id} />
    </Card>
  );
}

function InfoCard({ org, canWrite }: { org: DetailOrg; canWrite: boolean }) {
  const { t, locale } = useI18n();
  const update = useUpdateAdminOrg(org.id, t('common.saved'));
  const [kind, setKind] = useState<OrgKind | null>(null);
  // Resellers with customers keep their kind, and a reseller's customer stays a customer.
  const kindLocked = (org.kind === 'reseller' && org.counts.customers > 0) || !!org.parent;
  return (
    <Card>
      <CardHeader title={t('orgSettings.info')} />
      <CardBody className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">{t('orgSettings.kind')}</span>
          <Select
            className="h-8 w-auto"
            value={org.kind}
            disabled={!canWrite || kindLocked}
            onChange={(e) => setKind(e.target.value as OrgKind)}
            aria-label={t('orgSettings.kind')}
          >
            {ORG_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(kindKey(k))}
              </option>
            ))}
          </Select>
        </div>
        {kindLocked && (
          <p className="text-xs text-muted">
            {t(org.parent ? 'admin.orgs.kindLockedParent' : 'admin.orgs.kindLocked')}
          </p>
        )}
        <div className="flex justify-between gap-3">
          <span className="text-muted">{t('orgSettings.status')}</span>
          <StatusBadge status={org.status} suspendedBy={org.suspendedBy} />
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">{t('nav.projects')}</span>
          <span className="min-w-0 text-right break-words">
            {org.projects.map((p) => p.name).join(', ') || '–'}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">{t('nav.members')}</span>
          <span className="tabular">{org.counts.members}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">{t('admin.resources')}</span>
          <ResourceCounts counts={org.counts} modules={org.modules} />
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">{t('orgSettings.created')}</span>
          <span>{formatDate(org.createdAt, locale, false)}</span>
        </div>
      </CardBody>
      <ConfirmDialog
        open={kind !== null}
        onOpenChange={(o) => !o && setKind(null)}
        title={t('admin.orgs.kindTitle')}
        description={kind ? t('admin.orgs.kindText', { name: org.name, kind: t(kindKey(kind)) }) : undefined}
        confirmLabel={t('admin.orgs.kindConfirm')}
        danger={false}
        loading={update.isPending}
        onConfirm={() => kind && update.mutate({ kind }, { onSuccess: () => setKind(null) })}
      />
    </Card>
  );
}

function NotesCard({ org, canWrite }: { org: DetailOrg; canWrite: boolean }) {
  const { t } = useI18n();
  const [notes, setNotes] = useState<string | null>(null);
  const update = useUpdateAdminOrg(org.id, t('common.saved'));
  return (
    <Card>
      <CardHeader title={t('customers.notes')} description={t('customers.notesText')} />
      <CardBody className="space-y-3">
        <Textarea
          rows={5}
          value={notes ?? org.notes ?? ''}
          onChange={(e) => setNotes(e.target.value)}
          disabled={!canWrite}
          aria-label={t('customers.notes')}
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
  );
}

function DeleteOrgCard({ org }: { org: DetailOrg }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const remove = useDeleteOrg(`/admin/orgs/${org.id}`, t('customers.deleted'), () =>
    navigate('/admin/customers'),
  );
  return (
    <Card className="border-danger/40">
      <CardHeader title={t('customers.delete')} description={t('admin.orgs.deleteText')} />
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
        description={t('admin.orgs.deleteText')}
        confirmLabel={t('common.delete')}
        confirmText={org.slug}
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

function OverviewTab({ org, canWrite }: { org: DetailOrg; canWrite: boolean }) {
  const { t } = useI18n();
  const servers = useAdminServers({ orgId: org.id });
  const resellers = useResellers(org.kind === 'customer');
  const parent = org.parent ? resellers.data?.find((r) => r.id === org.parent?.id) : undefined;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-6">
        {org.kind === 'reseller' && <ResellerCustomersCard org={org} canWrite={canWrite} />}
        <ModulesCard org={org} parent={parent} canWrite={canWrite} />
        <Card>
          <CardHeader
            title={t('nav.servers')}
            actions={
              <Link
                to={`/admin/servers?assigned=no`}
                className="text-sm font-medium text-primary-text hover:underline"
              >
                {t('customers.assignServers')}
              </Link>
            }
          />
          {servers.isPending ? (
            <LoadingBlock />
          ) : servers.isError ? (
            <div className="p-5">
              <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />
            </div>
          ) : servers.data.length ? (
            <ServerTable servers={servers.data} compact linkFor={(s) => `/o/${org.slug}/servers/${s.id}`} />
          ) : (
            <EmptyState title={t('customers.noServers')} />
          )}
        </Card>
        <BoundaryCard org={org} canWrite={canWrite} />
      </div>
      <div className="space-y-6">
        <InfoCard org={org} canWrite={canWrite} />
        {org.kind === 'customer' && <ResellerCard org={org} resellers={resellers.data} canWrite={canWrite} />}
        <NotesCard org={org} canWrite={canWrite} />
        {canWrite && <DeleteOrgCard org={org} />}
      </div>
    </div>
  );
}

function BillingTab({ org }: { org: DetailOrg }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      {org.parent && (
        <Notice tone="info">
          {t('admin.orgs.billedByReseller', { name: org.parent.name })}{' '}
          <Link to={`/admin/customers/${org.parent.id}`} className="font-medium underline underline-offset-2">
            {t('admin.orgs.openReseller')}
          </Link>
        </Notice>
      )}
      <SellerBillingPanel orgId={org.id} />
    </div>
  );
}

function CustomerDetail({ org }: { org: DetailOrg }) {
  const { t } = useI18n();
  const can = usePlatformCan();
  const canWrite = can('platform:org:write');
  const update = useUpdateAdminOrg(org.id, t('common.saved'));
  const [toggling, setToggling] = useState(false);
  const suspended = org.status === 'suspended';
  const tabs = [
    { value: 'overview' as const, label: t('admin.tab.overview'), icon: <LayoutDashboard /> },
    {
      value: 'billing' as const,
      label: t('admin.tab.billing'),
      icon: <Receipt />,
      show: can('platform:billing:read'),
    },
  ];
  const [tab, setTab] = useTabParam(tabs);

  return (
    <>
      <PageHeader
        title={org.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Mono>{org.slug}</Mono>
            <KindBadge kind={org.kind} />
            {org.parent && (
              <span>
                {t('admin.orgs.customerOf')}{' '}
                <Link to={`/admin/customers/${org.parent.id}`} className="text-primary-text hover:underline">
                  {org.parent.name}
                </Link>
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Link
              to={`/o/${org.slug}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium shadow-card hover:bg-surface-3"
            >
              <ExternalLink className="size-4" /> {t('customers.openConsole')}
            </Link>
            {canWrite && (
              <Button variant={suspended ? 'primary' : 'danger-soft'} onClick={() => setToggling(true)}>
                {suspended ? t('customers.reactivate') : t('customers.suspend')}
              </Button>
            )}
          </>
        }
      />
      {suspended && (
        <Notice tone="danger" className="mb-6">
          {t('customers.suspendedHint')}
          {org.parent && org.suspendedBy && (
            <>
              {' '}
              {org.suspendedBy === 'platform'
                ? t('admin.orgs.suspendedByPlatform')
                : t('admin.orgs.suspendedByReseller', { name: org.parent.name })}
            </>
          )}
        </Notice>
      )}
      <TabBar label={org.name} tabs={tabs} current={tab} onChange={setTab} />
      {tab === 'billing' ? <BillingTab org={org} /> : <OverviewTab org={org} canWrite={canWrite} />}
      <ConfirmDialog
        open={toggling}
        onOpenChange={setToggling}
        title={suspended ? t('admin.status.activateTitle') : t('admin.status.suspendTitle')}
        description={
          suspended
            ? t('admin.status.activateText', { name: org.name })
            : t(org.kind === 'reseller' ? 'admin.status.suspendReseller' : 'admin.status.suspendText', {
                name: org.name,
              })
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

export function CustomerDetailPage() {
  const { t } = useI18n();
  const { orgId } = useParams();
  const org = useAdminOrg(orgId!);
  return (
    <>
      <Link
        to="/admin/customers"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.admin.customers')}
      </Link>
      {org.isPending ? (
        <LoadingBlock rows={6} />
      ) : org.isError ? (
        <ErrorState error={org.error} onRetry={() => void org.refetch()} />
      ) : (
        // Keyed so local edits (notes, selects) start fresh when another organization opens.
        <CustomerDetail key={org.data.id} org={org.data} />
      )}
    </>
  );
}
