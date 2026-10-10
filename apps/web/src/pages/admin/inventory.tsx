import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Link2, Plus, Search, Server } from 'lucide-react';
import { formatMoney, type ProviderType, type ServerDto, type ServerPlan } from '@weblion/shared';
import { api } from '@/lib/api';
import { formatMemoryMb } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import {
  isUnsupported,
  qk,
  useAdminOrg,
  useAdminOrgs,
  useAdminProviders,
  useAdminServers,
  useApiMutation,
  useMe,
  useProviderLocations,
  useProviderPlans,
} from '@/lib/queries';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { providerHasServers } from '@/components/server-bits';
import { ServerTable } from '@/components/server-table';

function AssignDialog({ server, onClose }: { server: ServerDto | null; onClose: () => void }) {
  const { t } = useI18n();
  const orgs = useAdminOrgs();
  const [orgId, setOrgId] = useState('');
  const org = useAdminOrg(orgId || server?.org?.id || '');
  const [projectId, setProjectId] = useState('');
  const assign = useApiMutation(
    (pid: string | null) => api.post(`/admin/servers/${server!.id}/assign`, { projectId: pid }),
    {
      success: (_r, pid) => (pid ? t('inventory.assigned') : t('inventory.unassigned')),
      invalidate: [qk.admin('servers'), qk.admin('stats'), ['servers']],
      onSuccess: () => {
        setOrgId('');
        setProjectId('');
        onClose();
      },
    },
  );
  const effectiveOrg = orgId || server?.org?.id || '';
  return (
    <Dialog
      open={!!server}
      onOpenChange={(o) => !o && onClose()}
      title={t('inventory.assignTitle', { name: server?.name ?? '' })}
      description={t('inventory.assignText')}
      footer={
        <>
          {server?.project && (
            <Button
              variant="danger-soft"
              className="mr-auto"
              loading={assign.isPending}
              onClick={() => assign.mutate(null)}
            >
              {t('inventory.unassign')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!projectId}
            loading={assign.isPending}
            onClick={() => assign.mutate(projectId)}
          >
            {t('inventory.assign')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('servers.col.customer')} htmlFor="as-org">
          <Select
            id="as-org"
            value={effectiveOrg}
            onChange={(e) => {
              setOrgId(e.target.value);
              setProjectId('');
            }}
          >
            <option value="">–</option>
            {orgs.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('servers.col.project')} htmlFor="as-project">
          <Select
            id="as-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={!effectiveOrg}
          >
            <option value="">–</option>
            {org.data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const providers = useAdminProviders();
  const serverProviders = providers.data?.filter((p) => providerHasServers(p.type)) ?? [];
  const [providerId, setProviderId] = useState('');
  const [externalId, setExternalId] = useState('');
  const imp = useApiMutation(() => api.post('/admin/servers/import', { providerId, externalId }), {
    success: t('inventory.imported'),
    invalidate: [qk.admin('servers')],
    onSuccess: () => {
      onOpenChange(false);
      setExternalId('');
    },
  });
  const type = providers.data?.find((p) => p.id === providerId)?.type;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('inventory.import')}
      description={t('inventory.importText')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!providerId || !externalId}
            loading={imp.isPending}
            onClick={() => imp.mutate(undefined)}
          >
            {t('inventory.import')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('overview.provider')} htmlFor="imp-provider">
          <Select id="imp-provider" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">–</option>
            {serverProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('overview.providerId')}
          hint={
            type === 'fire24'
              ? t('inventory.importHint.fire24')
              : type === 'proxmox'
                ? t('inventory.importHint.proxmox')
                : type === 'hetzner'
                  ? t('inventory.importHint.hetzner')
                  : undefined
          }
          htmlFor="imp-ext"
        >
          <Input
            id="imp-ext"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            className="font-mono"
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** Provider types that can create servers from the panel. */
const CREATABLE = new Set<ProviderType>(['proxmox', 'hetzner', 'demo']);

/** Shared vCPU first, then by size. */
function planOrder(a: ServerPlan, b: ServerPlan): number {
  const dedicated = (p: ServerPlan) => (p.cpuType === 'dedicated' ? 1 : 0);
  return dedicated(a) - dedicated(b) || a.cores - b.cores || a.memoryMb - b.memoryMb || a.diskGb - b.diskGb;
}

const emptyCreateForm = {
  name: '',
  cores: 2,
  memoryGb: 4,
  diskGb: 40,
  imageId: '',
  plan: '',
  location: '',
};

/**
 * Proxmox clones a template with free sizes. Providers with fixed sizes (Hetzner) answer
 * the plans route, then the dialog asks for server type and location instead.
 */
function CreateServerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale } = useI18n();
  const providers = useAdminProviders();
  const creatable = providers.data?.filter((p) => CREATABLE.has(p.type)) ?? [];
  const [providerId, setProviderId] = useState('');
  const plans = useProviderPlans(providerId);
  const withPlans = !!providerId && plans.isSuccess;
  const locations = useProviderLocations(providerId, withPlans);
  const images = useQuery({
    queryKey: qk.admin('images', { providerId }),
    queryFn: () => api.get<{ id: string; label: string }[]>(`/admin/providers/${providerId}/images`),
    enabled: !!providerId,
  });
  const [form, setForm] = useState(emptyCreateForm);
  const orderable = (plans.data ?? []).filter((p) => !p.deprecated).sort(planOrder);
  const plan = orderable.find((p) => p.id === form.plan);
  const availableAt = (location: string, p = plan) =>
    !p || p.locations.length === 0 || p.locations.includes(location);
  // Hetzner labels system images with their architecture. Hide the ones of the other one.
  const imagesFor = (p?: ServerPlan) => {
    const other = p?.architecture === 'arm' ? '(x86)' : p?.architecture === 'x86' ? '(Arm64)' : null;
    return (images.data ?? []).filter((i) => !other || !i.label.endsWith(other));
  };
  const imageOptions = imagesFor(plan);
  const needsLocation = withPlans && (locations.data?.length ?? 0) > 0;
  const ready =
    !!providerId &&
    !!form.name &&
    !!form.imageId &&
    (!withPlans || (!!form.plan && (!needsLocation || !!form.location)));

  const create = useApiMutation(
    () =>
      api.post(
        '/admin/servers',
        withPlans
          ? {
              providerId,
              name: form.name,
              plan: form.plan,
              location: form.location || undefined,
              imageId: form.imageId,
            }
          : {
              providerId,
              name: form.name,
              cores: form.cores,
              memoryMb: Math.round(form.memoryGb * 1024),
              diskGb: form.diskGb,
              imageId: form.imageId || undefined,
            },
      ),
    {
      success: t('inventory.createStarted'),
      onSuccess: () => {
        onOpenChange(false);
        setForm(emptyCreateForm);
      },
    },
  );

  const planLabel = (p: ServerPlan) =>
    [
      p.label,
      `${p.cores} vCPU`,
      formatMemoryMb(p.memoryMb),
      `${p.diskGb} GB`,
      p.architecture === 'arm' ? 'Arm64' : null,
      p.cpuType === 'dedicated' ? t('plans.dedicated') : null,
      p.priceMonthly
        ? t('plans.priceFrom', {
            price: formatMoney(p.priceMonthly.amount, p.priceMonthly.currency, locale),
          })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('inventory.create')}
      description={withPlans ? t('inventory.createTextPlans') : t('inventory.createText')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            loading={create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('overview.provider')} htmlFor="cs-provider">
          <Select
            id="cs-provider"
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              setForm({ ...form, imageId: '', plan: '', location: '' });
            }}
          >
            <option value="">–</option>
            {creatable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.name')} hint={t('inventory.nameHint')} htmlFor="cs-name">
          <Input
            id="cs-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="font-mono"
            placeholder="web-03"
          />
        </Field>
        {plans.isError && !isUnsupported(plans.error) && (
          <div className="sm:col-span-2">
            <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
          </div>
        )}
        {withPlans ? (
          <>
            <Field label={t('inventory.plan')} htmlFor="cs-plan" className="sm:col-span-2">
              <Select
                id="cs-plan"
                value={form.plan}
                onChange={(e) => {
                  const next = orderable.find((p) => p.id === e.target.value);
                  setForm({
                    ...form,
                    plan: e.target.value,
                    // A location the new type is not sold at, or an image of the other architecture.
                    location: form.location && availableAt(form.location, next) ? form.location : '',
                    imageId: imagesFor(next).some((i) => i.id === form.imageId) ? form.imageId : '',
                  });
                }}
              >
                <option value="">–</option>
                {orderable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {planLabel(p)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('inventory.location')} htmlFor="cs-location">
              <Select
                id="cs-location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                disabled={!locations.data?.length}
              >
                <option value="">–</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id} disabled={!availableAt(l.id)}>
                    {l.label} ({l.country}){availableAt(l.id) ? '' : ` – ${t('inventory.notInLocation')}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('inventory.image')}
              hint={plan?.architecture === 'arm' ? t('inventory.archImage', { arch: 'Arm64' }) : undefined}
              htmlFor="cs-image"
            >
              <Select
                id="cs-image"
                value={form.imageId}
                onChange={(e) => setForm({ ...form, imageId: e.target.value })}
              >
                <option value="">–</option>
                {imageOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <>
            <Field label={t('inventory.template')} htmlFor="cs-image" className="sm:col-span-2">
              <Select
                id="cs-image"
                value={form.imageId}
                onChange={(e) => setForm({ ...form, imageId: e.target.value })}
                disabled={!providerId || plans.isPending}
              >
                <option value="">–</option>
                {imageOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('rescale.cores')} htmlFor="cs-cores">
              <Input
                id="cs-cores"
                type="number"
                min={1}
                value={form.cores}
                onChange={(e) => setForm({ ...form, cores: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('rescale.memory')} htmlFor="cs-mem">
              <Input
                id="cs-mem"
                type="number"
                min={0.5}
                step={0.5}
                value={form.memoryGb}
                onChange={(e) => setForm({ ...form, memoryGb: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('rescale.disk')} htmlFor="cs-disk">
              <Input
                id="cs-disk"
                type="number"
                min={5}
                value={form.diskGb}
                onChange={(e) => setForm({ ...form, diskGb: Number(e.target.value) })}
              />
            </Field>
          </>
        )}
      </div>
      <Notice tone="info" className="mt-4">
        {withPlans ? t('inventory.createHintPlans') : t('inventory.createHint')}
      </Notice>
    </Dialog>
  );
}

export function InventoryPage() {
  const { t } = useI18n();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const assigned = params.get('assigned') ?? 'all';
  const providerId = params.get('provider') ?? undefined;
  const [q, setQ] = useState('');
  const providers = useAdminProviders();
  const serverProviders = providers.data?.filter((p) => providerHasServers(p.type)) ?? [];
  const servers = useAdminServers({ assigned, providerId, q: q || undefined });
  const [assigning, setAssigning] = useState<ServerDto | null>(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const perms = me.data?.platformPermissions ?? [];

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={t('nav.admin.inventory')}
        description={t('inventory.subtitle')}
        actions={
          <>
            {perms.includes('platform:server:assign') && (
              <Button icon={<Download className="size-4" />} onClick={() => setImporting(true)}>
                {t('inventory.import')}
              </Button>
            )}
            {perms.includes('platform:server:create') && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('inventory.create')}
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('inventory.search')}
              className="pl-9"
            />
          </div>
          <Select value={assigned} onChange={(e) => set('assigned', e.target.value)} className="w-auto">
            <option value="all">{t('inventory.all')}</option>
            <option value="no">{t('inventory.onlyUnassigned')}</option>
            <option value="yes">{t('inventory.onlyAssigned')}</option>
          </Select>
          <Select
            value={providerId ?? ''}
            onChange={(e) => set('provider', e.target.value)}
            className="w-auto"
          >
            <option value="">{t('inventory.allProviders')}</option>
            {serverProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        {servers.isError ? (
          <div className="p-5">
            <ErrorState error={servers.error} />
          </div>
        ) : servers.isPending ? (
          <LoadingBlock rows={6} />
        ) : servers.data.length === 0 ? (
          <EmptyState
            icon={<Server className="size-6" />}
            title={t('inventory.empty')}
            description={t('inventory.emptyText')}
          />
        ) : (
          <ServerTable
            servers={servers.data}
            showOrg
            linkFor={(s) => (s.org ? `/o/${s.org.slug}/servers/${s.id}` : null)}
            actions={(s) =>
              perms.includes('platform:server:assign') && (
                <Button
                  size="sm"
                  variant={s.project ? 'ghost' : 'secondary'}
                  icon={<Link2 className="size-3.5" />}
                  onClick={() => setAssigning(s)}
                >
                  {s.project ? t('inventory.reassign') : t('inventory.assign')}
                </Button>
              )
            }
          />
        )}
      </Card>
      <AssignDialog server={assigning} onClose={() => setAssigning(null)} />
      <ImportDialog open={importing} onOpenChange={setImporting} />
      <CreateServerDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
