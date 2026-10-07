import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, ChevronLeft, ExternalLink, Plus, Search } from 'lucide-react';
import type { AdminOrgDto, Permission, PolicyStatement } from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { qk, useAdminOrg, useAdminOrgs, useAdminServers, useApiMutation, useMeta } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
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

function CreateCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [kind, setKind] = useState<'customer' | 'internal'>('customer');
  const [result, setResult] = useState<(AdminOrgDto & { inviteLink: string | null }) | null>(null);
  const create = useApiMutation(
    () =>
      api.post<AdminOrgDto & { inviteLink: string | null }>('/admin/orgs', {
        name,
        kind,
        ownerEmail: ownerEmail || undefined,
      }),
    { invalidate: [qk.admin('orgs')], onSuccess: setResult },
  );
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setResult(null);
      setName('');
      setOwnerEmail('');
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('customers.new')}
      description={result ? undefined : t('customers.newText')}
      footer={
        result ? (
          <Button variant="primary" onClick={() => navigate(`/admin/customers/${result.id}`)}>
            {t('customers.open')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              loading={create.isPending}
              onClick={() => create.mutate(undefined)}
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
          {result.inviteLink && (
            <>
              <p className="text-sm text-muted">{t('customers.inviteLink')}</p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <Mono className="min-w-0 flex-1 truncate">{result.inviteLink}</Mono>
                <CopyButton value={result.inviteLink} />
              </div>
            </>
          )}
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
          <Field label={t('orgSettings.kind')} htmlFor="c-kind">
            <Select
              id="c-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'customer' | 'internal')}
            >
              <option value="customer">{t('orgKind.customer')}</option>
              <option value="internal">{t('orgKind.internal')}</option>
            </Select>
          </Field>
        </div>
      )}
    </Dialog>
  );
}

export function CustomersPage() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const orgs = useAdminOrgs(q || undefined);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={t('nav.admin.customers')}
        description={t('customers.subtitle')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('customers.new')}
          </Button>
        }
      />
      <Card>
        <div className="border-b border-border px-4 py-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('common.search')}
              className="pl-9"
            />
          </div>
        </div>
        {orgs.isPending ? (
          <LoadingBlock />
        ) : orgs.isError ? (
          <div className="p-5">
            <ErrorState error={orgs.error} />
          </div>
        ) : orgs.data.length === 0 ? (
          <EmptyState icon={<Building2 className="size-6" />} title={t('customers.empty')} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('customers.name')}</TH>
                <TH>{t('orgSettings.kind')}</TH>
                <TH>{t('nav.servers')}</TH>
                <TH className="hidden md:table-cell">{t('nav.members')}</TH>
                <TH className="hidden lg:table-cell">{t('orgSettings.created')}</TH>
              </tr>
            </THead>
            <TBody>
              {orgs.data.map((o) => (
                <TR key={o.id} onClick={() => navigate(`/admin/customers/${o.id}`)}>
                  <TD>
                    <div className="font-medium">{o.name}</div>
                    <Mono className="text-subtle">{o.slug}</Mono>
                  </TD>
                  <TD>
                    <div className="flex gap-1">
                      <Badge tone={o.kind === 'internal' ? 'primary' : 'neutral'}>
                        {t(`orgKind.${o.kind}` as TranslationKey)}
                      </Badge>
                      {o.status === 'suspended' && <Badge tone="danger">{t('orgStatus.suspended')}</Badge>}
                    </div>
                  </TD>
                  <TD className="tabular">{o.counts.servers}</TD>
                  <TD className="hidden tabular md:table-cell">{o.counts.members}</TD>
                  <TD className="hidden text-muted lg:table-cell">
                    {formatDate(o.createdAt, locale, false)}
                  </TD>
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

function BoundaryCard({ org }: { org: AdminOrgDto }) {
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
        description={t('customers.boundaryText')}
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
            />
            <Button
              variant="primary"
              disabled={!parsed}
              loading={save.isPending}
              onClick={() => save.mutate(parsed)}
            >
              {t('common.save')}
            </Button>
          </>
        ) : (
          <>
            <div className="grid gap-2 md:grid-cols-2">
              {BOUNDARY_TOGGLES.map((p) => (
                <label
                  key={p}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="text-sm">
                    {meta.data?.permissions[p]?.label[locale] ?? p}
                    <Mono className="block text-[11px] text-subtle">{p}</Mono>
                  </span>
                  <Switch
                    checked={!denied.includes(p)}
                    onCheckedChange={(allowed) =>
                      setDenied(allowed ? denied.filter((d) => d !== p) : [...denied, p])
                    }
                    label={p}
                  />
                </label>
              ))}
            </div>
            <Button
              variant="primary"
              loading={save.isPending}
              onClick={() => save.mutate(buildBoundary(denied))}
            >
              {t('common.save')}
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export function CustomerDetailPage() {
  const { t, locale } = useI18n();
  const { orgId } = useParams();
  const navigate = useNavigate();
  const org = useAdminOrg(orgId!);
  const servers = useAdminServers({ orgId });
  const [notes, setNotes] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const update = useApiMutation((body: object) => api.patch(`/admin/orgs/${orgId}`, body), {
    success: t('common.saved'),
    invalidate: [qk.admin('org', { id: orgId }), qk.admin('orgs')],
  });
  const remove = useApiMutation(() => api.del(`/admin/orgs/${orgId}`), {
    success: t('customers.deleted'),
    invalidate: [qk.admin('orgs')],
    onSuccess: () => navigate('/admin/customers'),
  });

  if (org.isPending) return <LoadingBlock rows={6} />;
  if (org.isError) return <ErrorState error={org.error} />;
  const o = org.data;

  return (
    <>
      <Link
        to="/admin/customers"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.admin.customers')}
      </Link>
      <PageHeader
        title={o.name}
        description={<Mono>{o.slug}</Mono>}
        actions={
          <>
            <Link
              to={`/o/${o.slug}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium shadow-card hover:bg-surface-3"
            >
              <ExternalLink className="size-4" /> {t('customers.openConsole')}
            </Link>
            <Button
              variant={o.status === 'active' ? 'danger-soft' : 'primary'}
              loading={update.isPending}
              onClick={() => update.mutate({ status: o.status === 'active' ? 'suspended' : 'active' })}
            >
              {o.status === 'active' ? t('customers.suspend') : t('customers.reactivate')}
            </Button>
          </>
        }
      />
      {o.status === 'suspended' && (
        <Notice tone="danger" className="mb-6">
          {t('customers.suspendedHint')}
        </Notice>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
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
            ) : servers.data?.length ? (
              <ServerTable servers={servers.data} linkFor={(s) => `/o/${o.slug}/servers/${s.id}`} />
            ) : (
              <EmptyState title={t('customers.noServers')} />
            )}
          </Card>
          <BoundaryCard org={o} />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('orgSettings.info')} />
            <CardBody className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">{t('orgSettings.kind')}</span>
                <Select
                  className="h-8 w-auto"
                  value={o.kind}
                  onChange={(e) => update.mutate({ kind: e.target.value })}
                >
                  <option value="customer">{t('orgKind.customer')}</option>
                  <option value="internal">{t('orgKind.internal')}</option>
                </Select>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('nav.projects')}</span>
                <span>{o.projects.map((p) => p.name).join(', ') || '–'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('nav.members')}</span>
                <span className="tabular">{o.counts.members}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('orgSettings.created')}</span>
                <span>{formatDate(o.createdAt, locale, false)}</span>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('customers.notes')} description={t('customers.notesText')} />
            <CardBody className="space-y-3">
              <Textarea rows={5} value={notes ?? o.notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
              <Button
                size="sm"
                variant="primary"
                disabled={notes === null}
                loading={update.isPending}
                onClick={() => update.mutate({ notes })}
              >
                {t('common.save')}
              </Button>
            </CardBody>
          </Card>
          <Card className="border-danger/40">
            <CardHeader title={t('customers.delete')} description={t('customers.deleteText')} />
            <CardBody>
              <Button variant="danger-soft" disabled={o.counts.servers > 0} onClick={() => setDeleting(true)}>
                {t('customers.delete')}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('customers.delete')}
        description={t('customers.deleteText')}
        confirmLabel={t('common.delete')}
        confirmText={o.slug}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </>
  );
}
