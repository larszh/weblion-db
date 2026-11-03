import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleHelp, ExternalLink, RefreshCw, Settings2, XCircle } from 'lucide-react';
import {
  MEDIA_SEERR_FIXABLE,
  type MediaInstanceDto,
  type MediaPolicyApplyResult,
  type MediaSeerrCheck,
  type MediaSeerrDto,
  type MediaSeerrProblem,
} from '@weblion/shared';
import type { TranslationKey } from '@/i18n/de';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useApplySeerrSettings, useMediaSeerr, useSetMediaSeerr } from '@/lib/api/media';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import { CopyButton, ErrorState, LoadingBlock, Mono, Notice } from '@/components/ui/primitives';
import { safePanelUrl } from '@/pages/hosting/bits';
import { PolicyFailures } from '@/pages/media/dialogs';

/**
 * Requests (Seerr) of one Jellyfin instance for staff: the live check, the recommended settings
 * and the switch that offers requests to customers. Seerr's address and key live on the provider
 * connection; this dialog reads the add-on only from MediaSeerrDto (never the provider summary).
 */

// --- Pure helpers (tested in pages/media/bits.test.ts) -------------------------------------

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

/** The badge of the instance row: no Seerr, off, or the state of the last check while on. */
export function seerrBadge(seerr: MediaInstanceDto['seerr']): { tone: Tone; key: TranslationKey } {
  if (!seerr) return { tone: 'neutral', key: 'media.seerr.none' };
  if (!seerr.enabled) return { tone: 'neutral', key: 'media.seerr.status.off' };
  const byStatus: Record<MediaSeerrDto['status'], { tone: Tone; key: TranslationKey }> = {
    ok: { tone: 'success', key: 'media.seerr.status.ok' },
    unsafe: { tone: 'warning', key: 'media.seerr.status.unsafe' },
    error: { tone: 'danger', key: 'media.seerr.status.error' },
    unknown: { tone: 'neutral', key: 'media.seerr.status.unknown' },
  };
  return byStatus[seerr.status];
}

export type SeerrCheckState = 'ok' | 'fail' | 'unknown';

export interface SeerrCheckItem {
  key: TranslationKey;
  state: SeerrCheckState;
}

/**
 * The check as a list. A step after an unreachable Seerr or a rejected key was never asked, so
 * it is unknown, not passed.
 */
export function seerrCheckItems(check: MediaSeerrCheck | null): SeerrCheckItem[] {
  const problems = new Set<MediaSeerrProblem>(check?.problems ?? []);
  const reached = !!check && !problems.has('unreachable');
  const read = reached && !problems.has('key');
  const item = (key: TranslationKey, failed: boolean, passed: boolean, asked = read): SeerrCheckItem => ({
    key,
    state: !asked ? 'unknown' : failed ? 'fail' : passed ? 'ok' : 'unknown',
  });
  return [
    item('media.seerr.check.reachable', problems.has('unreachable'), reached, !!check),
    item('media.seerr.check.key', problems.has('key'), read, reached),
    item(
      'media.seerr.check.sameServer',
      problems.has('other_server') || problems.has('not_jellyfin'),
      check?.sameServer === true,
    ),
    item('media.seerr.check.newSignIns', problems.has('new_signins'), check?.newSignIns === false),
    item(
      'media.seerr.check.defaultPermissions',
      problems.has('default_permissions'),
      check?.defaultPermissions === 0,
    ),
    item(
      'media.seerr.check.mediaServerLogin',
      problems.has('media_server_login'),
      check?.mediaServerLogin === true,
    ),
    item('media.seerr.check.csrf', problems.has('csrf'), check?.csrfProtection === false),
  ];
}

/** "Empfohlene Einstellungen anwenden" helps only when every problem left is one of the three settings. */
export function seerrOnlyFixable(check: MediaSeerrCheck | null): boolean {
  return !!check && check.problems.length > 0 && check.problems.every((p) => MEDIA_SEERR_FIXABLE.includes(p));
}

/** Switching on needs a check without problems; switching off is always possible. */
export function seerrCanSwitchOn(seerr: Pick<MediaSeerrDto, 'check'>): boolean {
  return !!seerr.check && seerr.check.problems.length === 0;
}

// --- Dialog --------------------------------------------------------------------------------

const PROBLEM_KEY: Record<MediaSeerrProblem, TranslationKey> = {
  unreachable: 'media.seerr.problem.unreachable',
  key: 'media.seerr.problem.key',
  not_jellyfin: 'media.seerr.problem.not_jellyfin',
  other_server: 'media.seerr.problem.other_server',
  csrf: 'media.seerr.problem.csrf',
  new_signins: 'media.seerr.problem.new_signins',
  default_permissions: 'media.seerr.problem.default_permissions',
  media_server_login: 'media.seerr.problem.media_server_login',
};

function CheckIcon({ state }: { state: SeerrCheckState }) {
  if (state === 'ok') return <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />;
  if (state === 'fail') return <XCircle className="size-4 shrink-0 text-danger" aria-hidden />;
  return <CircleHelp className="size-4 shrink-0 text-subtle" aria-hidden />;
}

/**
 * "Anfragen…" of an instance. `canWrite`: platform:media:write (the switch and the settings);
 * without it the dialog only shows the check.
 */
export function SeerrDialog({
  instance,
  canWrite,
  onClose,
}: {
  instance: MediaInstanceDto;
  canWrite: boolean;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const providerId = instance.provider.id;
  const name = instance.provider.name;
  const seerr = useMediaSeerr(providerId, true);
  const [confirmShared, setConfirmShared] = useState<number | null>(null);
  const [sharedChecked, setSharedChecked] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [result, setResult] = useState<MediaPolicyApplyResult | null>(null);
  const toggle = useSetMediaSeerr(providerId, {
    success: (_r, vars) =>
      vars.enabled
        ? t('media.seerr.enabled', { instance: name })
        : t('media.seerr.disabled', { instance: name }),
    onSuccess: (r) => {
      setResult(r.applied);
      setConfirmShared(null);
      setSharedChecked(false);
      setConfirmOff(false);
    },
    // More organizations than this dialog knew of: ask with the number the API gave.
    onShared: (n) => {
      setSharedChecked(false);
      setConfirmShared(n);
    },
  });
  const apply = useApplySeerrSettings(providerId, t('media.seerr.applied'));
  const data = seerr.data;

  const switchOn = () => {
    if (!data) return;
    setResult(null);
    if (data.organizations > 1) {
      setSharedChecked(false);
      setConfirmShared(data.organizations);
    } else {
      toggle.mutate({ enabled: true });
    }
  };

  let body;
  if (seerr.isPending) {
    body = <LoadingBlock rows={4} />;
  } else if (seerr.isError) {
    body = <ErrorState error={seerr.error} onRetry={() => void seerr.refetch()} />;
  } else if (!data) {
    body = (
      <div className="space-y-3">
        <Notice tone="info">{t('media.seerr.notConfigured')}</Notice>
        <Link
          to={`/admin/providers/${providerId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-text hover:underline"
        >
          <Settings2 className="size-4" aria-hidden /> {t('media.seerr.toProvider')}
        </Link>
      </div>
    );
  } else {
    const url = safePanelUrl(data.url);
    const check = data.check;
    const items = seerrCheckItems(check);
    const canOn = seerrCanSwitchOn(data);
    const fixable = seerrOnlyFixable(check);
    body = (
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('media.seerr.text')}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {url ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-primary-text hover:underline"
              >
                <Mono className="truncate">{url}</Mono>
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              </a>
              <CopyButton value={url} />
            </span>
          ) : (
            <Mono className="text-subtle">{data.url || '–'}</Mono>
          )}
          {check?.version && (
            <span className="text-muted">{t('media.seerr.version', { version: check.version })}</span>
          )}
        </div>

        <ul className="space-y-1.5 rounded-lg border border-border px-3 py-2.5 text-sm">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              <CheckIcon state={item.state} />
              <span className={cn(item.state === 'fail' ? 'text-danger' : 'text-text')}>{t(item.key)}</span>
            </li>
          ))}
        </ul>

        {check && check.problems.length > 0 && (
          <Notice tone={fixable ? 'warning' : 'danger'}>
            <ul className="space-y-0.5">
              {check.problems.map((p) => (
                <li key={p}>{t(PROBLEM_KEY[p])}</li>
              ))}
            </ul>
          </Notice>
        )}
        {data.lastError && <p className="text-xs break-words text-danger">{data.lastError}</p>}

        {fixable && canWrite && (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <p className="min-w-0 flex-1 text-xs text-muted">{t('media.seerr.applyText')}</p>
            <Button size="sm" variant="primary" loading={apply.isPending} onClick={() => apply.mutate()}>
              {t('media.seerr.apply')}
            </Button>
          </div>
        )}

        {(!!check?.unmanagedRequesters || !!check?.orphans) && (
          <div className="space-y-1 text-xs text-muted">
            {!!check?.unmanagedRequesters && (
              <p>{t('media.seerr.unmanaged', { n: check.unmanagedRequesters })}</p>
            )}
            {!!check?.orphans && <p>{t('media.seerr.orphans', { n: check.orphans })}</p>}
          </div>
        )}

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{t('media.seerr.enable')}</p>
            {!data.enabled && !canOn && <p className="text-xs text-muted">{t('media.seerr.enableHint')}</p>}
            {data.organizations > 1 && (
              <p className="mt-0.5 text-xs text-warning">
                {t('media.admin.orgCount', { n: data.organizations })}
              </p>
            )}
          </div>
          <Switch
            checked={data.enabled}
            onCheckedChange={(on) => (on ? switchOn() : setConfirmOff(true))}
            disabled={!canWrite || toggle.isPending || (!data.enabled && !canOn)}
            label={t('media.seerr.enable')}
          />
        </div>

        {result && (
          <div className="space-y-2">
            <p className="text-sm text-muted">{t('media.seerr.applyResult', { n: result.applied })}</p>
            {result.failed.length > 0 && (
              <PolicyFailures
                failed={result.failed}
                title={t('media.requests.applyFailed')}
                onDismiss={() => setResult({ ...result, failed: [] })}
              />
            )}
          </div>
        )}

        {data.checkedAt && (
          <p className="text-xs text-muted">
            {t('media.seerr.checkedAt', { when: formatRelative(data.checkedAt, locale) })}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <Dialog
        open
        size="lg"
        onOpenChange={(o) => !o && onClose()}
        title={t('media.seerr.title', { instance: name })}
        footer={
          <>
            {data && (
              <Button
                variant="ghost"
                className="mr-auto"
                icon={<RefreshCw className="size-4" />}
                loading={seerr.isFetching}
                onClick={() => void seerr.refetch()}
              >
                {t('media.seerr.recheck')}
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              {t('common.done')}
            </Button>
          </>
        }
      >
        {body}
      </Dialog>

      {/* Switching on for a shared instance: a warning and a box to tick before the button works. */}
      <Dialog
        open={confirmShared !== null}
        onOpenChange={(o) => !o && setConfirmShared(null)}
        title={t('media.seerr.sharedTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmShared(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!sharedChecked}
              loading={toggle.isPending}
              onClick={() => toggle.mutate({ enabled: true, confirmShared: true })}
            >
              {t('media.seerr.enableConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Notice tone="warning">
            {t('media.seerr.sharedText', { n: confirmShared ?? 0, instance: name })}
          </Notice>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-text">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={sharedChecked}
              onChange={(e) => setSharedChecked(e.target.checked)}
            />
            <span>{t('media.seerr.sharedConfirm')}</span>
          </label>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={t('media.seerr.disableTitle', { instance: name })}
        description={t('media.seerr.disableText')}
        confirmLabel={t('media.seerr.disableConfirm')}
        loading={toggle.isPending}
        onConfirm={() => {
          setResult(null);
          toggle.mutate({ enabled: false });
        }}
      />
    </>
  );
}
