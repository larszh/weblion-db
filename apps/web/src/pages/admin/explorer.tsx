import { useState } from 'react';
import { Play } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useAdminProviders } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui/primitives';

const PRESETS: Record<string, { method: string; path: string; label: string }[]> = {
  proxmox: [
    { method: 'GET', path: '/version', label: 'Version' },
    { method: 'GET', path: '/cluster/status', label: 'Cluster status' },
    { method: 'GET', path: '/cluster/resources?type=vm', label: 'All VMs/CTs' },
    { method: 'GET', path: '/nodes', label: 'Nodes' },
    { method: 'GET', path: '/cluster/nextid', label: 'Next free VMID' },
    { method: 'GET', path: '/access/permissions', label: 'Token permissions' },
    { method: 'GET', path: '/pools', label: 'Pools' },
    { method: 'GET', path: '/cluster/backup', label: 'Backup jobs' },
  ],
  fire24: [
    { method: 'GET', path: '/api/account/services', label: 'Account services' },
    { method: 'GET', path: '/api/account/donations', label: 'Donations' },
  ],
  demo: [{ method: 'GET', path: '/echo', label: 'Echo' }],
};

interface Result {
  status: number;
  data: unknown;
  durationMs: number;
}

export function ExplorerPage() {
  const { t } = useI18n();
  const providers = useAdminProviders();
  const [providerId, setProviderId] = useState('');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const provider = providers.data?.find((p) => p.id === providerId) ?? providers.data?.[0];

  const run = async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      let parsedBody: Record<string, unknown> | undefined;
      if (body.trim() && method !== 'GET') parsedBody = JSON.parse(body) as Record<string, unknown>;
      setResult(
        await api.post<Result>('/admin/explorer', {
          providerId: provider.id,
          method,
          path,
          body: parsedBody,
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('nav.admin.explorer')} description={t('explorer.subtitle')} />
      <Notice tone="warning" className="mb-6">
        {t('explorer.warning')}
      </Notice>
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[200px_110px_1fr_auto] md:items-end">
                <Field label={t('overview.provider')} htmlFor="ex-provider">
                  <Select
                    id="ex-provider"
                    value={provider?.id ?? ''}
                    onChange={(e) => setProviderId(e.target.value)}
                  >
                    {providers.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('explorer.method')} htmlFor="ex-method">
                  <Select id="ex-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                    {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('explorer.path')} htmlFor="ex-path">
                  <Input
                    id="ex-path"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder={
                      provider?.type === 'fire24'
                        ? '/api/kvm/<id>/config'
                        : '/nodes/pve01/qemu/100/status/current'
                    }
                    className="font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && void run()}
                  />
                </Field>
                <Button
                  variant="primary"
                  icon={<Play className="size-4" />}
                  loading={busy}
                  disabled={!path || !provider}
                  onClick={() => void run()}
                >
                  {t('explorer.send')}
                </Button>
              </div>
              {method !== 'GET' && (
                <Field label={t('explorer.body')} hint={t('explorer.bodyHint')} htmlFor="ex-body">
                  <Textarea
                    id="ex-body"
                    rows={5}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="font-mono text-xs"
                    placeholder='{ "vmid": 100 }'
                  />
                </Field>
              )}
            </CardBody>
          </Card>
          {error && <Notice tone="danger">{error}</Notice>}
          {result && (
            <Card>
              <CardHeader
                title={t('explorer.response')}
                actions={
                  <>
                    <Badge
                      tone={result.status < 300 ? 'success' : result.status < 500 ? 'warning' : 'danger'}
                    >
                      HTTP {result.status}
                    </Badge>
                    <span className="text-xs text-muted tabular">{result.durationMs} ms</span>
                  </>
                }
              />
              <pre
                className={cn(
                  'max-h-[560px] overflow-auto bg-surface-2 px-5 py-4 font-mono text-xs leading-relaxed text-text',
                )}
              >
                {JSON.stringify(result.data, null, 2)}
              </pre>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader title={t('explorer.presets')} />
          <CardBody className="space-y-1 py-2">
            {(PRESETS[provider?.type ?? 'proxmox'] ?? []).map((p) => (
              <button
                key={p.path}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3"
                onClick={() => {
                  setMethod(p.method);
                  setPath(p.path);
                }}
              >
                <Badge tone="primary">{p.method}</Badge>
                <span className="truncate">{p.label}</span>
              </button>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
