import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  Cloud,
  HardDrive,
  Plus,
  RefreshCw,
  ServerCog,
  Settings2,
  Stethoscope,
} from 'lucide-react';
import type { ProviderConnectionDto, ProviderType } from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBytes, formatDuration, formatPercent, formatRelative } from '@/lib/format';
import { qk, useAdminProviders, useApiMutation, useMe, useMeta, useProviderOverview } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import {
  Badge,
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
  UsageBar,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { Flag, ProviderBadge, providerHasServers } from '@/components/server-bits';

interface ProviderForm {
  type: ProviderType;
  name: string;
  country: string;
  city: string;
  label: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  tokenId: string;
  tokenSecret: string;
  verifyTls: boolean;
  caCert: string;
  backupStorage: string;
  /** Joker.com: API key (recommended) or reseller username and password. */
  jokerAuth: 'apiKey' | 'password';
  username: string;
  password: string;
}

const DEFAULT_NAME: Record<ProviderType, string> = {
  fire24: '24fire',
  proxmox: 'Proxmox',
  joker: 'Joker.com',
  demo: 'Demo',
};

const DEFAULT_BASE_URL: Partial<Record<ProviderType, string>> = {
  fire24: 'https://manage.24fire.de',
  joker: 'https://dmapi.joker.com/request',
};

/** Joker's test system (OT&E), separate account and no costs. */
const JOKER_OTE_URL = 'https://dmapi.ote.joker.com/request';

const emptyForm = (type: ProviderType): ProviderForm => ({
  type,
  name: DEFAULT_NAME[type],
  country: type === 'proxmox' ? 'CH' : 'DE',
  city: '',
  label: '',
  enabled: true,
  apiKey: '',
  baseUrl: DEFAULT_BASE_URL[type] ?? '',
  tokenId: '',
  tokenSecret: '',
  verifyTls: true,
  caCert: '',
  backupStorage: '',
  jokerAuth: 'apiKey',
  username: '',
  password: '',
});

function configFromForm(f: ProviderForm, editing: boolean) {
  switch (f.type) {
    case 'fire24':
      return { baseUrl: f.baseUrl, ...(f.apiKey || !editing ? { apiKey: f.apiKey } : {}) };
    case 'proxmox':
      return {
        baseUrl: f.baseUrl,
        tokenId: f.tokenId,
        ...(f.tokenSecret || !editing ? { tokenSecret: f.tokenSecret } : {}),
        verifyTls: f.verifyTls,
        ...(f.caCert ? { caCert: f.caCert } : {}),
        ...(f.backupStorage ? { backupStorage: f.backupStorage } : {}),
      };
    case 'joker':
      // Empty secrets on edit keep the stored ones (the API merges), null removes the
      // credentials of the other sign-in method so a stored API key cannot win.
      return {
        baseUrl: f.baseUrl,
        ...(f.jokerAuth === 'apiKey'
          ? {
              ...(f.apiKey || !editing ? { apiKey: f.apiKey } : {}),
              ...(editing ? { username: null, password: null } : {}),
            }
          : {
              username: f.username,
              ...(f.password || !editing ? { password: f.password } : {}),
              ...(editing ? { apiKey: null } : {}),
            }),
      };
    default:
      return {};
  }
}

/** Joker needs an API key or username and password, unless the stored ones are kept. */
function jokerIncomplete(f: ProviderForm, existing?: ProviderConnectionDto): boolean {
  if (f.type !== 'joker') return false;
  const storedKey = !!existing?.summary.apiKey;
  const storedPassword = !!existing && !storedKey && !!existing.summary.username;
  if (f.jokerAuth === 'apiKey') return !f.apiKey && !storedKey;
  return !f.username || (!f.password && !storedPassword);
}

function ProviderDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: ProviderConnectionDto;
}) {
  const { t } = useI18n();
  const meta = useMeta();
  const [form, setForm] = useState<ProviderForm>(() =>
    existing
      ? {
          ...emptyForm(existing.type),
          name: existing.name,
          country: existing.location.country,
          city: existing.location.city ?? '',
          label: existing.location.label,
          enabled: existing.enabled,
          baseUrl: existing.summary.baseUrl ?? '',
          tokenId: existing.summary.tokenId ?? '',
          verifyTls: existing.summary.verifyTls !== 'false',
          backupStorage: existing.summary.backupStorage ?? '',
          jokerAuth: existing.type === 'joker' && !existing.summary.apiKey ? 'password' : 'apiKey',
          username: existing.summary.username ?? '',
        }
      : emptyForm('proxmox'),
  );
  const envManaged = existing?.summary.managedBy === 'env';
  const save = useApiMutation(
    () => {
      const location = {
        country: form.country,
        city: form.city || undefined,
        label: form.label || `${form.city || form.country}`,
      };
      if (existing) {
        return api.patch(`/admin/providers/${existing.id}`, {
          name: form.name,
          location,
          enabled: form.enabled,
          ...(envManaged ? {} : { config: configFromForm(form, true) }),
        });
      }
      return api.post('/admin/providers', {
        type: form.type,
        name: form.name,
        location,
        enabled: form.enabled,
        config: configFromForm(form, false),
      });
    },
    {
      success: t('common.saved'),
      invalidate: [qk.admin('providers'), qk.admin('stats')],
      onSuccess: () => onOpenChange(false),
    },
  );
  const set = <K extends keyof ProviderForm>(k: K, v: ProviderForm[K]) => setForm({ ...form, [k]: v });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? t('providers.edit') : t('providers.add')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => save.mutate(undefined)}
            disabled={!form.name || (!envManaged && jokerIncomplete(form, existing))}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!existing && (
          <Field label={t('providers.type')} htmlFor="p-type" className="sm:col-span-2">
            <Select
              id="p-type"
              value={form.type}
              onChange={(e) => setForm(emptyForm(e.target.value as ProviderType))}
            >
              {meta.data?.providerTypes.map((type) => (
                <option key={type} value={type}>
                  {meta.data.providerLabels[type]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('providers.name')} htmlFor="p-name">
          <Input id="p-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('providers.label')} hint={t('providers.labelHint')} htmlFor="p-label">
          <Input
            id="p-label"
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder="Zürich (on-prem)"
          />
        </Field>
        <Field label={t('providers.country')} htmlFor="p-country">
          <Select id="p-country" value={form.country} onChange={(e) => set('country', e.target.value)}>
            <option value="CH">Schweiz (CH)</option>
            <option value="DE">Deutschland (DE)</option>
            <option value="AT">Österreich (AT)</option>
            <option value="NL">Niederlande (NL)</option>
          </Select>
        </Field>
        <Field label={t('providers.city')} htmlFor="p-city">
          <Input id="p-city" value={form.city} onChange={(e) => set('city', e.target.value)} />
        </Field>

        {envManaged ? (
          <Notice tone="info" className="sm:col-span-2">
            {t('providers.envManaged')}
          </Notice>
        ) : form.type === 'fire24' ? (
          <>
            <Field label="API Base URL" htmlFor="p-base">
              <Input
                id="p-base"
                value={form.baseUrl}
                onChange={(e) => set('baseUrl', e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field label="API Key" hint={existing ? t('providers.keepSecret') : undefined} htmlFor="p-key">
              <Input
                id="p-key"
                type="password"
                value={form.apiKey}
                onChange={(e) => set('apiKey', e.target.value)}
                className="font-mono"
                autoComplete="off"
              />
            </Field>
          </>
        ) : form.type === 'joker' ? (
          <JokerFields form={form} set={set} existing={existing} />
        ) : form.type === 'proxmox' ? (
          <>
            <Field label="URL" hint="https://pve.example.ch:8006" htmlFor="p-url" className="sm:col-span-2">
              <Input
                id="p-url"
                value={form.baseUrl}
                onChange={(e) => set('baseUrl', e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field label="Token ID" hint="user@realm!tokenid" htmlFor="p-tokenid">
              <Input
                id="p-tokenid"
                value={form.tokenId}
                onChange={(e) => set('tokenId', e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field
              label="Token Secret"
              hint={existing ? t('providers.keepSecret') : undefined}
              htmlFor="p-secret"
            >
              <Input
                id="p-secret"
                type="password"
                value={form.tokenSecret}
                onChange={(e) => set('tokenSecret', e.target.value)}
                className="font-mono"
                autoComplete="off"
              />
            </Field>
            <Field label={t('providers.backupStorage')} hint={t('common.optional')} htmlFor="p-bs">
              <Input
                id="p-bs"
                value={form.backupStorage}
                onChange={(e) => set('backupStorage', e.target.value)}
                className="font-mono"
                placeholder="pbs"
              />
            </Field>
            <label className="flex items-center justify-between gap-3 self-end rounded-lg border border-border px-3 py-2">
              <span className="text-sm">{t('providers.verifyTls')}</span>
              <Switch
                checked={form.verifyTls}
                onCheckedChange={(v) => set('verifyTls', v)}
                label={t('providers.verifyTls')}
              />
            </label>
            <Field
              label={t('providers.caCert')}
              hint={t('providers.caCertHint')}
              htmlFor="p-ca"
              className="sm:col-span-2"
            >
              <Textarea
                id="p-ca"
                rows={3}
                value={form.caCert}
                onChange={(e) => set('caCert', e.target.value)}
                className="font-mono text-xs"
                placeholder="-----BEGIN CERTIFICATE-----"
              />
            </Field>
          </>
        ) : null}
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 sm:col-span-2">
          <span className="text-sm">{t('providers.enabled')}</span>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => set('enabled', v)}
            label={t('providers.enabled')}
          />
        </label>
      </div>
    </Dialog>
  );
}

function JokerFields({
  form,
  set,
  existing,
}: {
  form: ProviderForm;
  set: <K extends keyof ProviderForm>(k: K, v: ProviderForm[K]) => void;
  existing?: ProviderConnectionDto;
}) {
  const { t } = useI18n();
  const storedKey = !!existing?.summary.apiKey;
  const keepHint = existing ? t('providers.keepSecret') : undefined;
  return (
    <>
      <Notice tone="info" className="sm:col-span-2">
        {t('providers.joker.help')}
      </Notice>
      <Field
        label={t('providers.joker.auth')}
        htmlFor="p-joker-auth"
        hint={
          form.jokerAuth === 'apiKey' ? t('providers.joker.apiKeyHint') : t('providers.joker.passwordHint')
        }
        className="sm:col-span-2"
      >
        <Select
          id="p-joker-auth"
          value={form.jokerAuth}
          onChange={(e) => set('jokerAuth', e.target.value as ProviderForm['jokerAuth'])}
        >
          <option value="apiKey">{t('providers.joker.authApiKey')}</option>
          <option value="password">{t('providers.joker.authPassword')}</option>
        </Select>
      </Field>
      {form.jokerAuth === 'apiKey' ? (
        <Field
          label="API Key"
          hint={storedKey ? keepHint : undefined}
          htmlFor="p-joker-key"
          className="sm:col-span-2"
        >
          <Input
            id="p-joker-key"
            type="password"
            value={form.apiKey}
            onChange={(e) => set('apiKey', e.target.value)}
            className="font-mono"
            autoComplete="off"
          />
        </Field>
      ) : (
        <>
          <Field label={t('providers.joker.username')} htmlFor="p-joker-user">
            <Input
              id="p-joker-user"
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field
            label={t('providers.joker.password')}
            hint={existing && !storedKey ? keepHint : undefined}
            htmlFor="p-joker-password"
          >
            <Input
              id="p-joker-password"
              type="password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {storedKey && (
            <Notice tone="warning" className="sm:col-span-2">
              {t('providers.joker.apiKeyRemoved')}
            </Notice>
          )}
        </>
      )}
      <Field
        label="API Base URL"
        htmlFor="p-joker-base"
        className="sm:col-span-2"
        hint={
          <>
            {t('providers.joker.baseUrlHint', { url: DEFAULT_BASE_URL.joker! })}{' '}
            {form.baseUrl !== JOKER_OTE_URL ? (
              <button
                type="button"
                className="font-medium text-primary-text underline underline-offset-2"
                onClick={() => set('baseUrl', JOKER_OTE_URL)}
              >
                {t('providers.joker.useOte')}
              </button>
            ) : (
              <button
                type="button"
                className="font-medium text-primary-text underline underline-offset-2"
                onClick={() => set('baseUrl', DEFAULT_BASE_URL.joker!)}
              >
                {t('providers.joker.useLive')}
              </button>
            )}
          </>
        }
      >
        <Input
          id="p-joker-base"
          value={form.baseUrl}
          onChange={(e) => set('baseUrl', e.target.value)}
          className="font-mono"
        />
      </Field>
    </>
  );
}

function useProviderActions(id: string) {
  const { t } = useI18n();
  const test = useApiMutation(
    () =>
      api.post<{ ok: boolean; latencyMs: number; info?: Record<string, unknown>; error?: string }>(
        `/admin/providers/${id}/test`,
      ),
    {
      success: (r) => (r.ok ? t('providers.testOk', { ms: r.latencyMs }) : null),
      invalidate: [qk.admin('providers')],
    },
  );
  const sync = useApiMutation(
    () =>
      api.post<{ seen: number; missing: number; domains?: { seen: number; missing: number } }>(
        `/admin/providers/${id}/sync`,
      ),
    {
      // Registrars (Joker.com) only have domains.
      success: (r) =>
        r.seen === 0 && r.missing === 0 && r.domains
          ? t('providers.syncedDomains', { seen: r.domains.seen, missing: r.domains.missing })
          : t('providers.synced', { seen: r.seen, missing: r.missing }),
      invalidate: [qk.admin('providers'), qk.admin('servers'), qk.admin('stats'), ['hosting', 'admin']],
    },
  );
  return { test, sync };
}

function ProviderCard({ p }: { p: ProviderConnectionDto }) {
  const { t, locale } = useI18n();
  const { test, sync } = useProviderActions(p.id);
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ProviderBadge type={p.type} />
            {!p.enabled && <Badge tone="neutral">{t('providers.disabledBadge')}</Badge>}
          </div>
          <Link
            to={`/admin/providers/${p.id}`}
            className="mt-2 block truncate text-lg font-semibold hover:underline"
          >
            {p.name}
          </Link>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted">
            <Flag country={p.location.country} /> {p.location.label}
          </div>
        </div>
        <Badge tone={p.status === 'ok' ? 'success' : p.status === 'error' ? 'danger' : 'neutral'}>
          {t(`providers.status.${p.status}`)}
        </Badge>
      </div>
      <div className="px-5 py-4 text-sm">
        {providerHasServers(p.type) && (
          <div className="flex justify-between py-1">
            <span className="text-muted">{t('nav.servers')}</span>
            <span className="tabular">{p.serverCount}</span>
          </div>
        )}
        <div className="flex justify-between py-1">
          <span className="text-muted">{t('providers.lastSync')}</span>
          <span>{formatRelative(p.lastSyncAt, locale)}</span>
        </div>
        {p.summary.baseUrl && (
          <div className="flex justify-between gap-3 py-1">
            <span className="text-muted">URL</span>
            <Mono className="truncate">{p.summary.baseUrl}</Mono>
          </div>
        )}
        {p.lastError && (
          <p
            className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs break-words text-danger"
            title={p.lastError}
          >
            {p.lastError.length > 220 ? `${p.lastError.slice(0, 220)}…` : p.lastError}
          </p>
        )}
        {test.data && !test.data.ok && (
          <p className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs break-words text-danger">
            {test.data.error}
          </p>
        )}
      </div>
      <div className="mt-auto flex flex-wrap gap-2 border-t border-border px-5 py-3">
        <Button
          size="sm"
          icon={<Stethoscope className="size-3.5" />}
          loading={test.isPending}
          onClick={() => test.mutate(undefined)}
        >
          {t('providers.test')}
        </Button>
        <Button
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          loading={sync.isPending}
          onClick={() => sync.mutate(undefined)}
        >
          {t('providers.sync')}
        </Button>
        <Link
          to={`/admin/providers/${p.id}`}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-primary-text hover:bg-surface-3"
        >
          {t('common.details')}
        </Link>
      </div>
    </Card>
  );
}

export function ProvidersPage() {
  const { t } = useI18n();
  const me = useMe();
  const providers = useAdminProviders();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title={t('nav.admin.providers')}
        description={t('providers.subtitle')}
        actions={
          me.data?.platformPermissions.includes('platform:provider:write') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              {t('providers.add')}
            </Button>
          )
        }
      />
      {providers.isPending ? (
        <LoadingBlock />
      ) : providers.isError ? (
        <ErrorState error={providers.error} />
      ) : providers.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Cloud className="size-6" />}
            title={t('providers.empty')}
            description={t('providers.emptyText')}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {providers.data.map((p) => (
            <ProviderCard key={p.id} p={p} />
          ))}
        </div>
      )}
      {adding && <ProviderDialog open={adding} onOpenChange={setAdding} />}
    </>
  );
}

export function ProviderDetailPage() {
  const { t, locale } = useI18n();
  const { providerId } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const providers = useAdminProviders();
  const overview = useProviderOverview(providerId!);
  const provider = providers.data?.find((p) => p.id === providerId);
  const { test, sync } = useProviderActions(providerId!);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useApiMutation(() => api.del(`/admin/providers/${providerId}`), {
    success: t('providers.deleted'),
    invalidate: [qk.admin('providers')],
    onSuccess: () => navigate('/admin/providers'),
  });
  const canWrite = me.data?.platformPermissions.includes('platform:provider:write');

  if (providers.isPending) return <LoadingBlock />;
  if (!provider) return <ErrorState error={new Error(t('providers.notFound'))} />;

  return (
    <>
      <Link
        to="/admin/providers"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.admin.providers')}
      </Link>
      <PageHeader
        title={provider.name}
        description={
          <span className="inline-flex items-center gap-2">
            <ProviderBadge type={provider.type} /> <Flag country={provider.location.country} />{' '}
            {provider.location.label}
          </span>
        }
        actions={
          <>
            <Button
              icon={<Stethoscope className="size-4" />}
              loading={test.isPending}
              onClick={() => test.mutate(undefined)}
            >
              {t('providers.test')}
            </Button>
            <Button
              icon={<RefreshCw className="size-4" />}
              loading={sync.isPending}
              onClick={() => sync.mutate(undefined)}
            >
              {t('providers.sync')}
            </Button>
            {canWrite && (
              <Button icon={<Settings2 className="size-4" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
          </>
        }
      />
      {provider.lastError && (
        <Notice tone="danger" className="mb-6" title={t('providers.lastError')}>
          <span className="break-words">{provider.lastError}</span>
        </Notice>
      )}
      {test.data && (
        <Notice
          tone={test.data.ok ? 'success' : 'danger'}
          className="mb-6"
          title={
            test.data.ok ? t('providers.testOk', { ms: test.data.latencyMs }) : t('providers.testFailed')
          }
        >
          {test.data.ok ? (
            <Mono>{JSON.stringify(test.data.info)}</Mono>
          ) : (
            <span className="break-words">{test.data.error}</span>
          )}
        </Notice>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {overview.isPending ? (
            <LoadingBlock rows={4} />
          ) : overview.isError ? (
            <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
          ) : (
            <>
              {overview.data.nodes.length > 0 && (
                <Card>
                  <CardHeader
                    title={t('providers.nodes')}
                    description={overview.data.version ? `Proxmox VE ${overview.data.version}` : undefined}
                  />
                  <Table>
                    <THead>
                      <tr>
                        <TH>Node</TH>
                        <TH>Status</TH>
                        <TH className="w-48">CPU</TH>
                        <TH className="w-48">RAM</TH>
                        <TH className="hidden md:table-cell">{t('overview.uptime')}</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {overview.data.nodes.map((n) => {
                        const memPct =
                          n.memoryUsed && n.memoryTotal ? (n.memoryUsed / n.memoryTotal) * 100 : null;
                        return (
                          <tr key={n.name}>
                            <TD className="font-medium">
                              <span className="inline-flex items-center gap-2">
                                <ServerCog className="size-4 text-muted" /> {n.name}
                              </span>
                            </TD>
                            <TD>
                              <Badge tone={n.status === 'online' ? 'success' : 'danger'}>{n.status}</Badge>
                            </TD>
                            <TD>
                              <div className="text-xs text-muted tabular">
                                {formatPercent(n.cpuPercent)} · {n.cores} {t('providers.cores')}
                              </div>
                              <UsageBar value={n.cpuPercent} className="mt-1" />
                            </TD>
                            <TD>
                              <div className="text-xs text-muted tabular">
                                {formatBytes(n.memoryUsed)} / {formatBytes(n.memoryTotal)}
                              </div>
                              <UsageBar value={memPct} className="mt-1" />
                            </TD>
                            <TD className="hidden text-muted md:table-cell">
                              {formatDuration(n.uptimeSeconds, locale)}
                            </TD>
                          </tr>
                        );
                      })}
                    </TBody>
                  </Table>
                </Card>
              )}
              {overview.data.storages.length > 0 && (
                <Card>
                  <CardHeader title={t('providers.storages')} />
                  <Table>
                    <THead>
                      <tr>
                        <TH>Storage</TH>
                        <TH className="hidden md:table-cell">{t('providers.content')}</TH>
                        <TH className="w-56">{t('providers.usage')}</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {overview.data.storages.map((s) => {
                        const pct = s.used && s.total ? (s.used / s.total) * 100 : null;
                        return (
                          <tr key={`${s.node}-${s.name}`}>
                            <TD>
                              <div className="flex items-center gap-2 font-medium">
                                <HardDrive className="size-4 text-muted" /> {s.name}
                                {s.shared && <Badge tone="info">shared</Badge>}
                              </div>
                              <div className="text-xs text-muted">
                                {s.type} {s.node && `· ${s.node}`}
                              </div>
                            </TD>
                            <TD className="hidden md:table-cell">
                              <div className="flex flex-wrap gap-1">
                                {s.content.map((c) => (
                                  <Badge key={c}>{c}</Badge>
                                ))}
                              </div>
                            </TD>
                            <TD>
                              <div className="text-xs text-muted tabular">
                                {formatBytes(s.used)} / {formatBytes(s.total)}
                              </div>
                              <UsageBar value={pct} className="mt-1" />
                            </TD>
                          </tr>
                        );
                      })}
                    </TBody>
                  </Table>
                </Card>
              )}
              {overview.data.nodes.length === 0 && overview.data.storages.length === 0 && (
                <Card>
                  <EmptyState title={t('providers.noInfra')} />
                </Card>
              )}
            </>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('providers.config')} />
            <CardBody className="py-1">
              <KeyValue
                items={[
                  ...Object.entries(provider.summary).map(([k, v]) => ({
                    label: k,
                    value: <Mono className="break-all">{v}</Mono>,
                  })),
                  ...(overview.data?.facts ?? []).map((f) => ({ label: f.label, value: f.value })),
                ]}
              />
            </CardBody>
          </Card>
          {canWrite && provider.summary.managedBy !== 'env' && (
            <Card className="border-danger/40">
              <CardHeader title={t('providers.delete')} description={t('providers.deleteText')} />
              <CardBody>
                <Button variant="danger-soft" onClick={() => setDeleting(true)}>
                  {t('providers.delete')}
                </Button>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
      {editing && <ProviderDialog open={editing} onOpenChange={setEditing} existing={provider} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('providers.delete')}
        description={t('providers.deleteText')}
        confirmLabel={t('common.delete')}
        confirmText={provider.name}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </>
  );
}
