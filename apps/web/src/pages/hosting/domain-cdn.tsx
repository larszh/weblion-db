import { useEffect, useState, type ReactNode } from 'react';
import { Eraser } from 'lucide-react';
import { CDN_SSL_MODES, type CdnSettings, type CdnSslMode, type DomainDetailDto } from '@weblion/shared';
import { useI18n, type TFunction } from '@/lib/i18n';
import type { TranslationKey } from '@/i18n/de';
import { useDnsRecords } from '@/lib/api/hosting';
import { useCdnSettings, usePurgeCache, useUpdateCdnSetting } from '@/lib/api/zones';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  LoadingBlock,
  Notice,
  Select,
} from '@/components/ui/primitives';
import { formatRemaining } from './dns-format';
import { zoneState } from './domain-zone';

/**
 * "CDN" tab of a DNS zone with the capability "cdn" (Cloudflare): SSL/TLS mode, Always Use
 * HTTPS, development mode and cache purge. Reading needs domain:read, every change
 * domain:manage (checked again by the API).
 */

/** Modes without encryption to the server: confirmed with a warning. */
const RISKY_MODES: readonly string[] = ['off', 'flexible'] satisfies CdnSslMode[];
const KNOWN_MODES: readonly string[] = CDN_SSL_MODES;
/** The purge button rests this long after a purge (Cloudflare limits purges per zone). */
const PURGE_PAUSE_MS = 30_000;

function modeLabel(t: TFunction, mode: string): string {
  // Unknown values (e.g. "origin_pull") are shown as Cloudflare reports them.
  return KNOWN_MODES.includes(mode) ? t(`hosting.cdn.ssl.mode.${mode}` as TranslationKey) : mode;
}

export function DomainCdn({ domain }: { domain: DomainDetailDto }) {
  const { t } = useI18n();
  const settings = useCdnSettings(domain.id);
  const records = useDnsRecords(domain.id, domain.capabilities.includes('dns'));
  const canManage = domain.permissions.includes('domain:manage');
  const provider = domain.provider.name;
  const status = zoneState(domain);
  const active = status === 'active';
  const paused = domain.info?.zone?.paused === true;
  const noneProxied = !!records.data && !records.data.some((r) => r.proxied);

  return (
    <div className="space-y-4">
      {status === 'moved' ? (
        <Notice tone="danger">{t('hosting.zone.movedText', { provider })}</Notice>
      ) : (
        !active && <Notice tone="warning">{t('hosting.cdn.notActive', { provider })}</Notice>
      )}
      {active && paused && (
        <Notice tone="info" title={t('hosting.zone.paused')}>
          {t('hosting.zone.pausedText', { provider })}
        </Notice>
      )}
      {active && !paused && noneProxied && (
        <Notice tone="info">{t('hosting.cdn.noProxied', { provider })}</Notice>
      )}
      {!canManage && <Notice tone="info">{t('hosting.cdn.readOnly')}</Notice>}
      {settings.isPending ? (
        <Card>
          <LoadingBlock rows={4} />
        </Card>
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <SslCard domain={domain} settings={settings.data} canManage={canManage} />
          <HttpsCard domain={domain} settings={settings.data} canManage={canManage} />
          <DevModeCard
            domain={domain}
            settings={settings.data}
            fetchedAt={settings.dataUpdatedAt}
            canManage={canManage}
          />
          <PurgeCard domain={domain} canManage={canManage} />
        </div>
      )}
    </div>
  );
}

interface CardProps {
  domain: DomainDetailDto;
  settings: CdnSettings;
  canManage: boolean;
}

function SslCard({ domain, settings, canManage }: CardProps) {
  const { t } = useI18n();
  const provider = domain.provider.name;
  const current = settings.sslAutomatic ? 'auto' : settings.sslMode;
  /** Mode picked in the select and not saved yet. */
  const [choice, setChoice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const update = useUpdateCdnSetting(domain.id, { success: () => t('hosting.cdn.saved') });
  const value = choice ?? current;
  const editable = canManage && settings.editable.sslMode;
  // Automatic SSL/TLS could not be read (token or plan): the panel cannot switch it either.
  const modes = CDN_SSL_MODES.filter((mode) => mode !== 'auto' || settings.sslAutomatic !== null);
  const changed = choice !== null && choice !== current;

  const apply = () => {
    if (choice === null || choice === current) return;
    update.mutate(
      { sslMode: choice as CdnSslMode },
      {
        onSuccess: () => {
          setChoice(null);
          setConfirming(false);
        },
      },
    );
  };
  const save = () => {
    if (choice === null || choice === current) return;
    if (RISKY_MODES.includes(choice)) setConfirming(true);
    else apply();
  };

  return (
    <Card>
      <CardHeader title={t('hosting.cdn.ssl.title')} description={t('hosting.cdn.ssl.text', { provider })} />
      <CardBody className="space-y-3">
        <Field
          label={t('hosting.cdn.ssl.label')}
          htmlFor="cdn-ssl"
          hint={canManage && !settings.editable.sslMode ? t('hosting.cdn.notEditable') : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Select
              id="cdn-ssl"
              value={value}
              onChange={(e) => setChoice(e.target.value)}
              disabled={!editable || update.isPending}
              className="w-auto min-w-[220px] flex-1"
            >
              {!KNOWN_MODES.includes(current) && (
                <option value={current} disabled>
                  {current}
                </option>
              )}
              {modes.map((mode) => (
                <option key={mode} value={mode}>
                  {modeLabel(t, mode)}
                </option>
              ))}
            </Select>
            {editable && (
              <Button
                variant="primary"
                size="sm"
                disabled={!changed}
                loading={update.isPending}
                onClick={save}
              >
                {t('common.save')}
              </Button>
            )}
          </div>
        </Field>
        {KNOWN_MODES.includes(value) && (
          <p className="text-sm text-muted">
            {t(`hosting.cdn.ssl.desc.${value}` as TranslationKey, { provider })}
          </p>
        )}
        {settings.sslAutomatic && (
          <p className="text-sm text-text">
            {t('hosting.cdn.ssl.effective', { provider, mode: modeLabel(t, settings.sslMode) })}
          </p>
        )}
        <p className="text-xs text-muted">{t('hosting.cdn.ssl.propagation')}</p>
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('hosting.cdn.ssl.confirmTitle', { mode: modeLabel(t, choice ?? '') })}
        description={t('hosting.cdn.ssl.confirmText')}
        confirmLabel={t('common.save')}
        loading={update.isPending}
        onConfirm={apply}
      />
    </Card>
  );
}

/** One switch with its explanation; not editable settings are disabled with a hint. */
function SettingSwitch({
  label,
  hint,
  checked,
  canManage,
  editable,
  pending,
  onChange,
  children,
}: {
  label: string;
  hint: string;
  checked: boolean;
  canManage: boolean;
  editable: boolean;
  pending: boolean;
  onChange: (value: boolean) => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{label}</p>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
        {canManage && !editable && (
          <p className="mt-1 text-xs text-warning">{t('hosting.cdn.notEditable')}</p>
        )}
        {children}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={!canManage || !editable || pending}
        label={label}
      />
    </div>
  );
}

function HttpsCard({ domain, settings, canManage }: CardProps) {
  const { t } = useI18n();
  const update = useUpdateCdnSetting(domain.id, { success: () => t('hosting.cdn.saved') });
  return (
    <Card>
      <CardHeader title={t('hosting.cdn.https.title')} />
      <CardBody>
        <SettingSwitch
          label={t('hosting.cdn.https.label')}
          hint={t('hosting.cdn.https.hint')}
          checked={settings.alwaysUseHttps}
          canManage={canManage}
          editable={settings.editable.alwaysUseHttps}
          pending={update.isPending}
          onChange={(alwaysUseHttps) => update.mutate({ alwaysUseHttps })}
        />
      </CardBody>
    </Card>
  );
}

function DevModeCard({ domain, settings, fetchedAt, canManage }: CardProps & { fetchedAt: number }) {
  const { t } = useI18n();
  const provider = domain.provider.name;
  const update = useUpdateCdnSetting(domain.id, { success: () => t('hosting.cdn.saved') });
  const [now, setNow] = useState(() => Date.now());
  // Count down between two reads of the settings (the query reads again every minute).
  useEffect(() => {
    if (!settings.developmentMode) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [settings.developmentMode]);
  // A read newer than the last tick counts from zero.
  const elapsed = Math.max(0, Math.floor((now - fetchedAt) / 1000));
  const remaining =
    settings.developmentMode && settings.developmentModeRemaining !== null
      ? // Rounded up to a minute at least: "0 min" never shows while the mode is on.
        formatRemaining(Math.max(1, settings.developmentModeRemaining - elapsed))
      : null;

  return (
    <Card>
      <CardHeader title={t('hosting.cdn.dev.title')} />
      <CardBody>
        <SettingSwitch
          label={t('hosting.cdn.dev.label')}
          hint={t('hosting.cdn.dev.hint', { provider })}
          checked={settings.developmentMode}
          canManage={canManage}
          editable={settings.editable.developmentMode}
          pending={update.isPending}
          onChange={(developmentMode) => update.mutate({ developmentMode })}
        >
          {remaining && (
            <p className="mt-1 text-xs font-medium text-warning">
              {t('hosting.cdn.dev.remaining', { time: remaining })}
            </p>
          )}
        </SettingSwitch>
      </CardBody>
    </Card>
  );
}

function PurgeCard({ domain, canManage }: { domain: DomainDetailDto; canManage: boolean }) {
  const { t } = useI18n();
  const provider = domain.provider.name;
  const [confirming, setConfirming] = useState(false);
  const [resting, setResting] = useState(false);
  const purge = usePurgeCache(domain.id, { success: t('hosting.cdn.purge.done') });
  useEffect(() => {
    if (!resting) return;
    const timer = setTimeout(() => setResting(false), PURGE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [resting]);

  return (
    <Card>
      <CardHeader title={t('hosting.cdn.purge.title')} />
      <CardBody className="space-y-3">
        <p className="text-sm text-muted">{t('hosting.cdn.purge.text', { provider })}</p>
        <Button
          size="sm"
          variant="danger-soft"
          icon={<Eraser className="size-3.5" />}
          disabled={!canManage || resting}
          loading={purge.isPending}
          onClick={() => setConfirming(true)}
        >
          {t('hosting.cdn.purge.button')}
        </Button>
        {resting && <p className="text-xs text-muted">{t('hosting.cdn.purge.wait')}</p>}
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('hosting.cdn.purge.confirmTitle', { name: domain.name })}
        description={t('hosting.cdn.purge.confirmText', { provider })}
        confirmLabel={t('hosting.cdn.purge.button')}
        loading={purge.isPending}
        onConfirm={() =>
          purge.mutate(undefined, {
            onSuccess: () => {
              setConfirming(false);
              setResting(true);
            },
          })
        }
      />
    </Card>
  );
}
