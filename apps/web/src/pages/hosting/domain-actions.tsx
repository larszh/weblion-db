import { useState, type ReactNode } from 'react';
import { CalendarPlus } from 'lucide-react';
import type { ProviderType } from '@weblion/shared';
import { formatDate } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { useMe } from '@/lib/queries';
import { useRenewDomain, useSetAutoRenew, type DomainActionResult } from '@/lib/api/hosting';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, KeyValue, Mono, Notice, Select } from '@/components/ui/primitives';

/**
 * Registrar actions shared by the domain detail page and the admin inventory: result notices
 * and the platform-only renewal dialogs (renewals cost money at the registrar).
 */

/** What the renewal dialogs need to know about a domain. */
export interface RenewalTarget {
  id: string;
  name: string;
  expiresAt: string | null;
  provider: { type: ProviderType; name: string };
}

/** Auto-renew and renewals: permission platform:domain:write, checked again by the API. */
export function useCanRenew(): boolean {
  const me = useMe();
  return !!me.data?.platformPermissions.includes('platform:domain:write');
}

/** Toast text with the registrar's job reference, e.g. "Renewal submitted · Reference 12345". */
export function withProviderRef(t: TFunction, text: string, result: DomainActionResult): string {
  return result.providerRef ? `${text} · ${t('hosting.action.refShort', { ref: result.providerRef })}` : text;
}

/** Success notice for a registrar job: what was asked plus the registrar's own answer. */
export function ActionResultNotice({
  title,
  result,
  provider,
  children,
  className,
}: {
  title: ReactNode;
  result: DomainActionResult;
  provider: string;
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Notice tone="success" title={title} className={className}>
      {children}
      {(result.message || result.providerRef) && (
        <span className="mt-1 block space-y-0.5 text-xs">
          {result.message && (
            <span className="block break-words">
              {t('hosting.action.providerMessage', { provider })}: <Mono>{result.message}</Mono>
            </span>
          )}
          {result.providerRef && (
            <span className="block">
              {t('hosting.action.ref')}: <Mono>{result.providerRef}</Mono>
            </span>
          )}
        </span>
      )}
    </Notice>
  );
}

/** Confirmation for switching auto-renew. Turning it off can let the domain expire. */
export function AutoRenewDialog({
  domain,
  enabled,
  onClose,
  onDone,
}: {
  domain: RenewalTarget;
  enabled: boolean;
  onClose: () => void;
  onDone?: (result: DomainActionResult) => void;
}) {
  const { t, locale } = useI18n();
  const mutation = useSetAutoRenew({
    success: (r, v) =>
      withProviderRef(
        t,
        v.enabled
          ? t('hosting.renewal.enabledToast', { name: domain.name })
          : t('hosting.renewal.disabledToast', { name: domain.name }),
        r,
      ),
    onSuccess: (r) => {
      onDone?.(r);
      onClose();
    },
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        enabled
          ? t('hosting.renewal.enableTitle', { name: domain.name })
          : t('hosting.renewal.disableTitle', { name: domain.name })
      }
      description={
        enabled
          ? t('hosting.renewal.enableText', { provider: domain.provider.name })
          : t('hosting.renewal.disableText', { date: formatDate(domain.expiresAt, locale, false) })
      }
      confirmLabel={enabled ? t('hosting.renewal.enable') : t('hosting.renewal.disable')}
      danger={!enabled}
      loading={mutation.isPending}
      onConfirm={() => mutation.mutate({ domainId: domain.id, enabled })}
    />
  );
}

const YEARS = Array.from({ length: 10 }, (_, i) => i + 1);

/** Expiry after renewing by `years`: registrars extend from the current expiry date. */
function renewedUntil(expiresAt: string | null, years: number): Date | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date;
}

/** "Jetzt verlängern": 1 to 10 years, charged by the registrar right away. */
export function RenewDialog({
  domain,
  onClose,
  onDone,
}: {
  domain: RenewalTarget;
  onClose: () => void;
  onDone?: (result: DomainActionResult) => void;
}) {
  const { t, locale } = useI18n();
  const [years, setYears] = useState(1);
  const mutation = useRenewDomain({
    success: (r) => withProviderRef(t, t('hosting.renewal.renewedToast', { name: domain.name }), r),
    onSuccess: (r) => {
      onDone?.(r);
      onClose();
    },
  });
  const yearsLabel = (n: number) =>
    n === 1 ? t('hosting.renewal.year1') : t('hosting.renewal.yearsN', { n });
  const until = renewedUntil(domain.expiresAt, years);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hosting.renewal.renewTitle', { name: domain.name })}
      description={t('hosting.renewal.renewText')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            icon={<CalendarPlus className="size-4" />}
            loading={mutation.isPending}
            onClick={() => mutation.mutate({ domainId: domain.id, years, expiresAt: domain.expiresAt })}
          >
            {t('hosting.renewal.confirm', { years: yearsLabel(years) })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('hosting.renewal.years')} htmlFor="renew-years">
          <Select id="renew-years" value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {YEARS.map((n) => (
              <option key={n} value={n}>
                {yearsLabel(n)}
              </option>
            ))}
          </Select>
        </Field>
        <KeyValue
          className="rounded-lg border border-border px-3"
          items={[
            {
              label: t('hosting.renewal.current'),
              value: domain.expiresAt
                ? formatDate(domain.expiresAt, locale, false)
                : t('hosting.status.unknown'),
            },
            {
              label: t('hosting.renewal.new'),
              value: until ? (
                <span className="font-medium">
                  {formatDate(until, locale, false)}{' '}
                  <span className="text-muted">({until.getUTCFullYear()})</span>
                </span>
              ) : (
                '–'
              ),
            },
          ]}
        />
        {!domain.expiresAt && <p className="text-xs text-muted">{t('hosting.renewal.unknownExpiry')}</p>}
        {domain.provider.type === 'joker' && until && (
          <p className="text-xs text-muted">
            {t('hosting.renewal.targetYear', { year: until.getUTCFullYear() })}
          </p>
        )}
        <Notice tone="warning">{t('hosting.renewal.charge', { provider: domain.provider.name })}</Notice>
      </div>
    </Dialog>
  );
}
