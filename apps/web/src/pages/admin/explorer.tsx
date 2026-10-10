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
  // Relative to /v1. Lists are paginated (?page=&per_page=, at most 50).
  hetzner: [
    { method: 'GET', path: '/servers', label: 'Servers' },
    { method: 'GET', path: '/server_types', label: 'Server types' },
    { method: 'GET', path: '/locations', label: 'Locations' },
    { method: 'GET', path: '/images?type=system', label: 'System images' },
    { method: 'GET', path: '/isos', label: 'ISOs' },
    { method: 'GET', path: '/pricing', label: 'Pricing' },
    { method: 'GET', path: '/servers/<id>/actions', label: 'Actions of a server' },
  ],
  // DMAPI request names; the method is derived from the request (see jokerMethod).
  joker: [
    { method: 'DMAPI', path: '/query-domain-list?showstatus=1&showjokerns=1', label: 'Domain list' },
    { method: 'DMAPI', path: '/query-whois?domain=example.com', label: 'Whois (domain)' },
    { method: 'DMAPI', path: '/query-profile', label: 'Reseller profile' },
    { method: 'DMAPI', path: '/dns-zone-list', label: 'DNS zones' },
    { method: 'DMAPI', path: '/dns-zone-get?domain=example.com', label: 'DNS zone' },
    { method: 'DMAPI', path: '/result-list', label: 'Job results (Proc-IDs)' },
  ],
  // OCS provisioning API. Answers come as JSON, passwords in them are blanked out.
  nextcloud: [
    { method: 'GET', path: '/ocs/v2.php/cloud/users/details', label: 'Users with details' },
    { method: 'GET', path: '/ocs/v2.php/cloud/users', label: 'User ids' },
    { method: 'GET', path: '/ocs/v2.php/cloud/users/<userid>', label: 'User (quota, usage)' },
    { method: 'GET', path: '/ocs/v2.php/cloud/groups', label: 'Groups' },
    { method: 'GET', path: '/ocs/v2.php/cloud/groups/<groupid>/users', label: 'Members of a group' },
    { method: 'GET', path: '/ocs/v2.php/cloud/capabilities', label: 'Capabilities (version)' },
  ],
  // Relative to /client/v4. Lists are paginated (?page=&per_page=, zones at most 50).
  cloudflare: [
    { method: 'GET', path: '/user/tokens/verify', label: 'Token status' },
    { method: 'GET', path: '/zones?per_page=50', label: 'Zones' },
    { method: 'GET', path: '/zones/<zone_id>', label: 'Zone' },
    { method: 'GET', path: '/zones/<zone_id>/dns_records?per_page=100', label: 'DNS records' },
    { method: 'GET', path: '/zones/<zone_id>/settings/ssl', label: 'SSL/TLS mode' },
    { method: 'GET', path: '/zones/<zone_id>/settings/always_use_https', label: 'Always Use HTTPS' },
    { method: 'GET', path: '/zones/<zone_id>/settings/development_mode', label: 'Development mode' },
    { method: 'GET', path: '/accounts', label: 'Accounts' },
  ],
  // The method is derived from the path (see mailcowMethod).
  mailcow: [
    { method: 'GET', path: '/api/v1/get/domain/all', label: 'Domains' },
    { method: 'GET', path: '/api/v1/get/mailbox/all/<domain>', label: 'Mailboxes' },
    { method: 'GET', path: '/api/v1/get/alias/all/<domain>', label: 'Aliases' },
    { method: 'GET', path: '/api/v1/get/dkim/<domain>', label: 'DKIM' },
    { method: 'GET', path: '/api/v1/get/status/version', label: 'Version' },
    { method: 'GET', path: '/api/v1/get/passwordpolicy', label: 'Password policy' },
  ],
  demo: [{ method: 'GET', path: '/echo', label: 'Echo' }],
};

/** DMAPI requests that only read. */
const JOKER_READ = /^\/*(query-[a-z-]+|dns-zone-(list|get)|result-(list|retrieve)|domain-check)(\?|$)/i;

/**
 * Joker always gets a POST, the method only decides the audit: reads are sent as GET (not
 * logged), everything else as POST so changes land in the audit log.
 */
const jokerMethod = (path: string) => (JOKER_READ.test(path.trim()) ? 'GET' : 'POST');

/** Mailcow reads with GET (/api/v1/get/...) and changes with POST (add, edit, delete). */
const mailcowMethod = (path: string) =>
  /^(https?:\/\/[^/]+)?\/api\/v1\/get\//i.test(path.trim()) ? 'GET' : 'POST';

const PLACEHOLDERS: Record<string, { path: string; body: string }> = {
  proxmox: { path: '/nodes/pve01/qemu/100/status/current', body: '{ "vmid": 100 }' },
  fire24: { path: '/api/kvm/<id>/config', body: '{ "mode": "start" }' },
  hetzner: { path: '/servers/<id>', body: '{ "server_type": "cx32", "upgrade_disk": false }' },
  joker: { path: '/query-whois?domain=example.com', body: '{ "domain": "example.com" }' },
  nextcloud: { path: '/ocs/v2.php/cloud/users/<userid>', body: '{ "key": "quota", "value": "10 GB" }' },
  cloudflare: { path: '/zones/<zone_id>/settings/ssl', body: '{ "value": "full" }' },
  mailcow: {
    path: '/api/v1/edit/mailbox',
    body: '{ "items": ["anna@kunde.ch"], "attr": { "quota": "4096" } }',
  },
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
  const isJoker = provider?.type === 'joker';
  /** Joker and Mailcow derive the method from the path, the others take it from the select. */
  const derivedMethod = isJoker
    ? jokerMethod(path)
    : provider?.type === 'mailcow'
      ? mailcowMethod(path)
      : null;
  /** Joker takes parameters with every request, the others only with a body method. */
  const withBody = isJoker || (derivedMethod ?? method) !== 'GET';
  const placeholder = PLACEHOLDERS[provider?.type ?? 'proxmox'] ?? PLACEHOLDERS.proxmox!;

  const run = async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      let parsedBody: Record<string, unknown> | undefined;
      if (body.trim() && withBody) parsedBody = JSON.parse(body) as Record<string, unknown>;
      setResult(
        await api.post<Result>('/admin/explorer', {
          providerId: provider.id,
          method: derivedMethod ?? method,
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
              <div
                className={cn(
                  'grid gap-3 md:items-end',
                  derivedMethod ? 'md:grid-cols-[200px_1fr_auto]' : 'md:grid-cols-[200px_110px_1fr_auto]',
                )}
              >
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
                {!derivedMethod && (
                  <Field label={t('explorer.method')} htmlFor="ex-method">
                    <Select id="ex-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label={t('explorer.path')} htmlFor="ex-path">
                  <Input
                    id="ex-path"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder={placeholder.path}
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
              {isJoker && <p className="text-xs text-muted">{t('explorer.jokerHint')}</p>}
              {provider?.type === 'hetzner' && (
                <p className="text-xs text-muted">{t('explorer.hetznerPath')}</p>
              )}
              {provider?.type === 'nextcloud' && (
                <p className="text-xs text-muted">{t('explorer.nextcloudPath')}</p>
              )}
              {provider?.type === 'cloudflare' && (
                <p className="text-xs text-muted">{t('explorer.cloudflarePath')}</p>
              )}
              {provider?.type === 'mailcow' && (
                <p className="text-xs text-muted">{t('explorer.mailcowPath')}</p>
              )}
              {withBody && (
                <Field
                  label={t('explorer.body')}
                  hint={
                    isJoker
                      ? t('explorer.jokerBodyHint')
                      : provider?.type === 'hetzner' || provider?.type === 'cloudflare'
                        ? t('explorer.bodyHintJson')
                        : provider?.type === 'nextcloud'
                          ? t('explorer.nextcloudBodyHint')
                          : provider?.type === 'mailcow'
                            ? t('explorer.mailcowBodyHint')
                            : t('explorer.bodyHint')
                  }
                  htmlFor="ex-body"
                >
                  <Textarea
                    id="ex-body"
                    rows={5}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="font-mono text-xs"
                    placeholder={placeholder.body}
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
                  if (p.method !== 'DMAPI') setMethod(p.method);
                  setPath(p.path);
                }}
              >
                <Badge tone={p.method === 'DMAPI' ? 'info' : 'primary'}>{p.method}</Badge>
                <span className="truncate">{p.label}</span>
              </button>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
