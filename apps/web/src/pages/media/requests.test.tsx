import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  MediaAccountDto,
  MediaAccountRequestsView,
  MediaAllowanceDto,
  MediaRequestsInfoDto,
} from '@weblion/shared';
import { en } from '@/i18n/en';
import { I18nProvider } from '@/lib/i18n';
import { TooltipProvider } from '@/components/ui/menu';
import { MediaAllowanceFigures } from './bits';
import { MediaRequestsCard } from './requests-card';

/**
 * The requests add-on as customers see it: nothing of it without the add-on (the API leaves the
 * keys out, or answers null for "off" where the caller may see it), numbers only with it.
 * Rendered on the server: the page has no other markup tests.
 */

const html = (node: ReactNode) =>
  renderToStaticMarkup(
    <I18nProvider>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nProvider>,
  );

/** Every text of the add-on as it can appear on the page (English, the test's locale). */
const REQUEST_TEXTS = Object.entries(en)
  .filter(([key]) => key.startsWith('media.requests.'))
  .map(([, text]) => text.split('{')[0]!.trim())
  .filter((text) => text.length > 3);

const allowance = (patch: Partial<MediaAllowanceDto> = {}): MediaAllowanceDto => ({
  orgId: 'a6d4b1a0-0000-4000-8000-000000000001',
  provider: null,
  accountCode: 'kemaro',
  maxAccounts: 5,
  libraries: [],
  maxStreams: 2,
  downloads: false,
  remoteBitrateMbit: null,
  accounts: 2,
  customers: 0,
  customerAccounts: 0,
  updatedAt: null,
  ...patch,
});

const access = {
  movies: true,
  tv: true,
  movieQuota: { limit: 5, days: 30 },
  tvQuota: { limit: 3, days: 30 },
};

describe('allowance figures and the requests add-on', () => {
  it('shows nothing of requests without the key or with the add-on off', () => {
    for (const shown of [
      html(<MediaAllowanceFigures allowance={allowance()} />),
      html(<MediaAllowanceFigures allowance={allowance({ requests: null })} />),
      // Totals alone (a stale count while the add-on is off) are not shown either.
      html(
        <MediaAllowanceFigures
          allowance={allowance({
            requests: null,
            requestTotals: { accounts: 1, pending: 1, approved: 0, available: 0 },
          })}
        />,
      ),
    ]) {
      expect(shown).not.toMatch(/request/i);
      for (const text of REQUEST_TEXTS) expect(shown).not.toContain(text);
    }
  });

  it('shows the types and limits with the add-on, and the totals where they are given', () => {
    const shown = html(<MediaAllowanceFigures allowance={allowance({ requests: access })} />);
    expect(shown).toContain('Requests');
    expect(shown).toContain('Movies and series');
    expect(shown).toContain('up to 5 movies in 30 days per account');
    expect(shown).toContain('up to 3 seasons in 30 days per account');
    expect(shown).not.toContain('Open 1');
    const totals = html(
      <MediaAllowanceFigures
        allowance={allowance({
          requests: { ...access, tv: false, tvQuota: null, movieQuota: null },
          requestTotals: { accounts: 2, pending: 1, approved: 3, available: 2 },
        })}
      />,
    );
    expect(totals).toContain('Movies: no limit');
    expect(totals).not.toContain('Series:');
    expect(totals).toContain('Open 1, approved 3, available 2');
  });
});

describe('requests card', () => {
  const info: MediaRequestsInfoDto = {
    url: 'https://requests.demo.weblion.one',
    access,
    syncedAt: null,
  };
  const account = (username: string, enabled: boolean, requests?: MediaAccountRequestsView) =>
    ({
      id: `id-${username}`,
      username,
      enabled,
      hasPassword: true,
      lastActiveOn: null,
      issues: [],
      provider: { id: 'p', type: 'jellyfin', name: 'Demo' },
      location: { country: 'CH', label: 'Zürich' },
      org: null,
      loginUrl: null,
      permissions: [],
      lastSyncedAt: null,
      missingSince: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      ...(requests ? { requests } : {}),
    }) as unknown as MediaAccountDto;

  it('lists numbers per account, the quota used and accounts still being set up', () => {
    const shown = html(
      <MediaRequestsCard
        requests={info}
        accounts={[
          account('anna-kemaro', true, {
            ready: true,
            counts: { pending: 1, approved: 4, available: 2, movieUsed: 2, tvUsed: 1 },
          }),
          account('wohnzimmer-kemaro', false, { ready: false, counts: null }),
          // Gone at Jellyfin: no requests view, no row.
          account('gone-kemaro', true),
        ]}
      />,
    );
    expect(shown).toContain('https://requests.demo.weblion.one');
    expect(shown).toContain('rel="noopener noreferrer"');
    expect(shown).toContain('anna-kemaro');
    expect(shown).toContain('Movies: 2 of 5');
    expect(shown).toContain('Seasons: 1 of 3');
    expect(shown).toContain('wohnzimmer-kemaro');
    expect(shown).toContain('Being set up');
    expect(shown).toContain('Disabled accounts cannot request.');
    expect(shown).not.toContain('gone-kemaro');
    expect(shown).toContain('The console shows numbers only');
  });

  it('repeats the numbers below the login name for narrow screens, and shows no quota of a disabled account', () => {
    const shown = html(
      <MediaRequestsCard
        requests={info}
        accounts={[
          account('wohnzimmer-kemaro', false, {
            ready: true,
            counts: { pending: 0, approved: 1, available: 3, movieUsed: null, tvUsed: null },
          }),
        ]}
      />,
    );
    expect(shown).toContain('Open 0, approved 1, available 3');
    expect(shown).toContain('Disabled accounts cannot request.');
    expect(shown).not.toContain(' of 5');
    expect(shown).not.toContain(' of 3');
  });

  it('never links an address that is not http(s)', () => {
    const shown = html(
      <MediaRequestsCard requests={{ ...info, url: 'javascript:alert(1)' }} accounts={[]} />,
    );
    expect(shown).not.toContain('javascript:');
  });
});
