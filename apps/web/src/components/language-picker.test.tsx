import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { Locale } from '@weblion/shared';
import { withI18n } from '@/test/i18n';
import { TooltipProvider } from '@/components/ui/menu';
import { Flag } from '@/components/server-bits';
import {
  languageName,
  LanguageMenu,
  LanguageMenuItems,
  LanguageRadioGroup,
  LanguageSelect,
} from './language-picker';

const html = (node: ReactNode, locale: Locale = 'en') =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      {withI18n(<TooltipProvider>{node}</TooltipProvider>, locale)}
    </QueryClientProvider>,
  );

const NATIVE = ['Deutsch', 'English', 'Français', 'Italiano', 'Nederlands'];

describe('LanguageRadioGroup (i18n 6.1)', () => {
  it('renders five radios with native names, decorative flags and the current one checked', () => {
    const out = html(<LanguageRadioGroup value="fr" onChange={() => {}} labelledBy="lbl" />);
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain('aria-labelledby="lbl"');
    expect(out.match(/role="radio"/g)).toHaveLength(5);
    for (const name of NATIVE) expect(out).toContain(`>${name}</span>`);
    expect(out.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-checked="true"[^>]*lang="fr"/);
    // Roving tabIndex: only the checked tile is in the tab order.
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    // The flags are decorative: the name is written next to them.
    expect(out.match(/<svg[^>]*aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(5);
    expect(out).not.toContain('role="img"');
  });

  it('names each language in the UI language below the native name', () => {
    const out = html(<LanguageRadioGroup value="de" onChange={() => {}} />, 'de');
    expect(out).toContain('aria-label="Sprache"');
    expect(out).toContain(languageName('fr', 'de')!);
    expect(languageName('fr', 'de')).toBe('Französisch');
    expect(languageName('nl', 'en')).toBe('Dutch');
    // German in a German UI: the second line would repeat the name, so it is left out.
    expect(out.match(/>Deutsch</g)).toHaveLength(1);
  });
});

describe('LanguageMenu (i18n 6.2)', () => {
  it('shows the current flag and name on a labelled button', () => {
    const out = html(<LanguageMenu />, 'it');
    expect(out).toContain('aria-label="Choose language: Italiano"');
    expect(out).toContain('>Italiano</span>');
    expect(out).toMatch(/<svg[^>]*viewBox="0 0 3 2"[^>]*aria-hidden="true"/);
  });

  it('lists five languages with a check on the current one', () => {
    // The menu's content renders in a portal only while open; inside an open root it renders in place.
    const out = html(
      <Dropdown.Root open>
        <Dropdown.Trigger />
        <Dropdown.Content>
          <LanguageMenuItems onChange={() => {}} />
        </Dropdown.Content>
      </Dropdown.Root>,
      'nl',
    );
    expect(out).toContain('>Language</div>');
    expect(out.match(/role="menuitemradio"/g)).toHaveLength(5);
    for (const name of NATIVE) expect(out).toContain(`>${name}</span>`);
    expect(out.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-checked="true"[^>]*lang="nl"/);
  });
});

describe('LanguageSelect', () => {
  it('offers the five languages and an optional first option for no own language', () => {
    const out = html(
      <LanguageSelect
        value={null}
        onChange={() => {}}
        nullOption={{ label: "Owner's language (Deutsch)", locale: 'de' }}
      />,
    );
    expect(out.match(/<option/g)).toHaveLength(6);
    expect(out).toContain(`<option value="" selected="">Owner&#x27;s language (Deutsch)</option>`);
    for (const name of NATIVE) expect(out).toContain(`>${name}</option>`);
  });
});

describe('Flag (i18n 6.4)', () => {
  it('draws FR, IT and GB', () => {
    for (const country of ['FR', 'IT', 'GB']) {
      expect(renderToStaticMarkup(<Flag country={country} />)).toMatch(/^<svg /);
    }
  });

  it('labels a flag with the country name in the UI language (Intl.DisplayNames)', () => {
    expect(html(<Flag country="FR" />, 'de')).toContain('aria-label="Frankreich"');
    expect(html(<Flag country="FR" />, 'en')).toContain('aria-label="France"');
    expect(html(<Flag country="NL" />, 'nl')).toContain('aria-label="Nederland"');
    expect(html(<Flag country="IT" />, 'it')).toContain('aria-label="Italia"');
    expect(html(<Flag country="GB" />, 'fr')).toContain('aria-label="Royaume-Uni"');
    // Outside the provider: English.
    expect(renderToStaticMarkup(<Flag country="DE" />)).toContain('aria-label="Germany"');
  });

  it('shows German with the German flag, never the Swiss one', () => {
    const out = html(<LanguageRadioGroup value="de" onChange={() => {}} />);
    expect(out).toContain('viewBox="0 0 5 3"');
    expect(out).not.toContain('viewBox="0 0 32 32"');
  });
});
