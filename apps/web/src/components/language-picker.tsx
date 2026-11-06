import { useMemo, useRef, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { intlLocale, LOCALE_META, LOCALES, type Locale, type MeDto } from '@weblion/shared';
import { api } from '@/lib/api';
import { localizeError } from '@/lib/api-errors';
import { cn } from '@/lib/cn';
import { useChangeLocale, useI18n } from '@/lib/i18n';
import { qk } from '@/lib/queries';
import { Menu, MenuLabel } from '@/components/ui/menu';
import { Flag } from '@/components/server-bits';

/**
 * The language pickers (i18n 6). Every language is offered in its own name (LOCALE_META.native) with its flag;
 * the pickers differ in where the choice is saved: the profile tiles and the user menu save it to the profile,
 * the login and invite pages only in this browser.
 */

const displayNames = new Map<string, Intl.DisplayNames | null>();

/** The name of a language in the UI language ("Französisch" in a German UI), or null without Intl support. */
export function languageName(language: Locale, uiLocale: Locale): string | null {
  const tag = intlLocale(uiLocale);
  if (!displayNames.has(tag)) {
    try {
      displayNames.set(tag, new Intl.DisplayNames([tag], { type: 'language' }));
    } catch {
      displayNames.set(tag, null);
    }
  }
  try {
    return displayNames.get(tag)?.of(language) ?? null;
  } catch {
    return null;
  }
}

/** The flag of a language: DE, GB, FR, IT, NL (never CH for German, never an emoji, i18n 6.4). */
export function LanguageFlag({ locale, className }: { locale: Locale; className?: string }) {
  return <Flag country={LOCALE_META[locale].flag} decorative className={className} />;
}

/**
 * Saves the language to the profile (users.locale), so it applies after sign-in on every device and to the
 * e-mails sent to this person (i18n 6.1, 6.3). The UI switches first; a failed save keeps the new UI language.
 */
export function useSaveProfileLocale(): (next: Locale) => Promise<void> {
  const { t } = useI18n();
  const changeLocale = useChangeLocale();
  const qc = useQueryClient();
  // The toast comes after the switch, so it reads the t of the new language, not the one of this render.
  const latest = useRef(t);
  latest.current = t;
  return async (next: Locale) => {
    if (!(await changeLocale(next))) return;
    try {
      const me = await api.patch<MeDto>('/auth/me', { locale: next });
      qc.setQueryData(qk.me, me);
      toast.success(latest.current('language.saved'));
    } catch (err) {
      toast.error(localizeError(err, latest.current));
    }
  };
}

// --- Profile: five tiles ------------------------------------------------------------------

/**
 * Five tiles in a radio group (account page, i18n 6.1): flag, native name and, below it, the name in the UI
 * language. Arrow keys move the selection (roving tabIndex), as in a native radio group.
 */
export function LanguageRadioGroup({
  value,
  onChange,
  disabled,
  labelledBy,
}: {
  value: Locale;
  onChange(next: Locale): void;
  disabled?: boolean;
  /** Id of the visible field label; without it the group is labelled "Sprache". */
  labelledBy?: string;
}) {
  const { t, locale: uiLocale } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    let target = index;
    if (step) target = (index + step + LOCALES.length) % LOCALES.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = LOCALES.length - 1;
    else return;
    event.preventDefault();
    refs.current[target]?.focus();
    const next = LOCALES[target]!;
    if (next !== value) onChange(next);
  };

  return (
    <div
      role="radiogroup"
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': t('account.language') })}
      aria-disabled={disabled || undefined}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
    >
      {LOCALES.map((l, i) => {
        const checked = l === value;
        const native = LOCALE_META[l].native;
        const translated = languageName(l, uiLocale);
        const second = translated && translated.toLowerCase() !== native.toLowerCase() ? translated : null;
        return (
          <button
            key={l}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            lang={l}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => !checked && onChange(l)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              'relative flex min-h-[64px] min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
              checked
                ? 'border-primary bg-primary-soft text-primary-text'
                : 'border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2',
            )}
          >
            <LanguageFlag locale={l} className="h-[18px] w-[27px] rounded-[3px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{native}</span>
              {second && (
                <span className="block truncate text-xs text-muted" lang={uiLocale}>
                  {second}
                </span>
              )}
            </span>
            {checked && <Check className="size-4 shrink-0" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

// --- Menu items (user menu, login menu) -----------------------------------------------------

function LanguageItems({ onChange }: { onChange(next: Locale): void }) {
  const { locale } = useI18n();
  return (
    <Dropdown.RadioGroup value={locale} onValueChange={(v) => v !== locale && onChange(v as Locale)}>
      {LOCALES.map((l) => (
        <Dropdown.RadioItem
          key={l}
          value={l}
          lang={l}
          className={cn(
            'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-text outline-none select-none',
            'data-[highlighted]:bg-surface-3 data-[state=checked]:font-medium',
          )}
        >
          <LanguageFlag locale={l} />
          <span className="min-w-0 flex-1 truncate">{LOCALE_META[l].native}</span>
          <Dropdown.ItemIndicator className="text-primary-text">
            <Check className="size-4" aria-hidden />
          </Dropdown.ItemIndicator>
        </Dropdown.RadioItem>
      ))}
    </Dropdown.RadioGroup>
  );
}

/** "Sprache" and the five languages, for a menu that exists already (the user menu, i18n 6.3). */
export function LanguageMenuItems({ onChange }: { onChange(next: Locale): void }) {
  const { t } = useI18n();
  return (
    <>
      <MenuLabel>{t('account.language')}</MenuLabel>
      <LanguageItems onChange={onChange} />
    </>
  );
}

/**
 * A compact button with the current flag and name that opens the five languages (login and invite pages,
 * i18n 6.2). The choice is stored in this browser only: before sign-in there is no profile to save it to.
 */
export function LanguageMenu({ align = 'end', className }: { align?: 'start' | 'end'; className?: string }) {
  const { t, locale } = useI18n();
  const changeLocale = useChangeLocale();
  const native = LOCALE_META[locale].native;
  return (
    <Menu
      align={align}
      className="w-[200px]"
      trigger={
        <button
          type="button"
          aria-label={`${t('language.choose')}: ${native}`}
          title={t('language.current', { language: native })}
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text',
            'hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
            className,
          )}
        >
          <LanguageFlag locale={locale} />
          <span>{native}</span>
          <ChevronDown className="size-4 text-subtle" aria-hidden />
        </button>
      }
    >
      <MenuLabel>{t('language.choose')}</MenuLabel>
      <LanguageItems onChange={(next) => void changeLocale(next)} />
    </Menu>
  );
}

// --- Select for forms (admin user dialog, billing profile) ------------------------------------

/**
 * A native select of the five languages with the flag of the chosen one in front (a native option cannot
 * show an image). With `nullOption` the first option stands for "no own language" (value null).
 */
export function LanguageSelect({
  id,
  value,
  onChange,
  nullOption,
  disabled,
}: {
  id?: string;
  value: Locale | null;
  onChange(next: Locale | null): void;
  nullOption?: { label: string; locale: Locale };
  disabled?: boolean;
}) {
  const shown = value ?? nullOption?.locale ?? 'de';
  const options = useMemo(() => LOCALES.map((l) => ({ value: l, label: LOCALE_META[l].native })), []);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2">
        <LanguageFlag locale={shown} />
      </span>
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? (e.target.value as Locale) : null)}
        className={cn(
          'h-9 w-full rounded-lg border border-border-strong bg-surface pr-2.5 pl-10 text-sm text-text',
          'focus:border-ring focus:ring-2 focus:ring-ring/25 focus:outline-none disabled:opacity-60',
        )}
      >
        {nullOption && <option value="">{nullOption.label}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} lang={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
