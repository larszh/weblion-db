import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { interpolate, type OrgAiDto } from '@weblion/shared';
import { en } from '@weblion/shared/i18n/en';
import type { TFunction } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { withI18n } from '@/test/i18n';
import {
  adminAiLines,
  ConsentBody,
  neverEnabled,
  orgAiLines,
  OrgAiActions,
  resellerAiState,
  StateBadge,
} from './cards';

const t: TFunction = (key, params) => interpolate(en[key], params);
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

const available = { available: true, reason: null, demo: false, model: 'claude-opus-5-5' as const };

/** A new organization as the API answers after O34: off, nobody switched it off, no decline. */
const fresh: OrgAiDto = {
  enabled: false,
  offReasons: ['platform'],
  switch: { enabled: false, by: null },
  reseller: null,
  declined: null,
  platform: available,
  usage: { month: '2026-11', requests: 0, staffRequests: 0 },
};

describe('switch cards (ai 12.4, plan O34)', () => {
  it('a never switched-on organization shows ai.org.notEnabled, not "switched off by weblion"', () => {
    expect(neverEnabled(fresh)).toBe(true);
    const lines = orgAiLines(fresh, t, 'en');
    expect(lines).toContain(en['ai.org.notEnabled']);
    expect(lines).not.toContain(en['ai.org.offByPlatform']);
  });

  it('names who switched it off, the reseller cascade, the decline and the platform state', () => {
    const off: OrgAiDto = { ...fresh, switch: { enabled: false, by: 'platform' } };
    expect(orgAiLines(off, t, 'en')).toEqual([en['ai.org.offByPlatform']]);

    const capped: OrgAiDto = {
      ...fresh,
      switch: { enabled: true, by: null },
      reseller: { id: 'r1', name: 'Alpen Hosting', enabled: false },
      offReasons: ['parent'],
    };
    expect(orgAiLines(capped, t, 'en')).toEqual([t('ai.org.offByReseller', { name: 'Alpen Hosting' })]);

    const declined: OrgAiDto = {
      ...fresh,
      switch: { enabled: true, by: null },
      declined: { at: '2026-11-02T10:00:00Z', by: { id: 'u1', name: 'Anna Muster' } },
      platform: { ...available, available: false, reason: 'disabled' },
    };
    const lines = orgAiLines(declined, t, 'en');
    expect(lines[0]).toBe(en['ai.org.platformOff']);
    expect(lines[1]).toContain('Anna Muster');

    expect(adminAiLines(capped, t, 'en')).toEqual([t('admin.ai.card.reseller', { name: 'Alpen Hosting' })]);
  });

  it('the badge says "not active yet" for a switched-on organization while the platform is off', () => {
    const badge = (dto: OrgAiDto) => renderToStaticMarkup(withI18n(<StateBadge dto={dto} />));
    const on: OrgAiDto = { ...fresh, enabled: true, offReasons: [], switch: { enabled: true, by: null } };
    expect(badge(on)).toContain(esc(en['ai.org.state.on']));
    const platformOff = { ...on, platform: { ...available, available: false, reason: 'disabled' as const } };
    expect(badge(platformOff)).toContain(esc(en['ai.org.state.notActive']));
    expect(badge(platformOff)).not.toContain(esc(en['ai.org.state.on']));
    expect(badge({ ...fresh, platform: platformOff.platform })).toContain(esc(en['ai.org.state.off']));
  });

  it('only the organization itself is offered to withdraw its decline (plan O34)', () => {
    const actions = (declined: boolean, ownOrg: boolean) =>
      renderToStaticMarkup(
        withI18n(
          <OrgAiActions declined={declined} ownOrg={ownOrg} onToggle={() => {}} onNotice={() => {}} />,
        ),
      );
    expect(actions(true, true)).toContain(esc(en['ai.org.allow']));
    expect(actions(true, true)).not.toContain(esc(en['ai.org.allowOwnOnly']));
    // Reseller or weblion staff inside the customer: no allow button, the sentence instead.
    expect(actions(true, false)).not.toContain(esc(en['ai.org.allow']));
    expect(actions(true, false)).toContain(esc(en['ai.org.allowOwnOnly']));
    // Declining stays open to them.
    expect(actions(false, false)).toContain(esc(en['ai.org.decline']));
    expect(actions(false, false)).not.toContain(esc(en['ai.org.allowOwnOnly']));
  });

  it('locks the reseller switch when weblion switched the customer off or the reseller is off', () => {
    expect(resellerAiState(fresh)).toEqual({ lockedByPlatform: false, ownOff: false });
    expect(resellerAiState({ ...fresh, switch: { enabled: false, by: 'platform' } }).lockedByPlatform).toBe(
      true,
    );
    expect(
      resellerAiState({ ...fresh, reseller: { id: 'r1', name: 'Alpen Hosting', enabled: false } }).ownOff,
    ).toBe(true);
  });

  it('the consent dialog asks for the customer agreement and shows a refusal', () => {
    const html = renderToStaticMarkup(
      withI18n(
        <ConsentBody
          checked={false}
          onCheckedChange={() => {}}
          error={
            new ApiError(400, 'bad_request', 'consentConfirmed is required.', { field: 'consentConfirmed' })
          }
        />,
      ),
    );
    expect(html).toContain(esc(en['admin.ai.card.consentText']));
    expect(html).toContain(esc(en['admin.ai.card.consentCheck']));
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('role="alert"');
  });
});
