import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AiSettingsDto } from '@weblion/shared';
import { en } from '@weblion/shared/i18n/en';
import { withI18n } from '@/test/i18n';
import { goLiveDraft, goLiveReady, GoLiveBody, settingsInput, usageMonths } from './ai';

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

describe('KI page (ai 12.2)', () => {
  it('the go-live dialog has the four checks and the opt-in note, no announcement date (plan O34)', () => {
    const html = renderToStaticMarkup(
      withI18n(<GoLiveBody checks={goLiveDraft(null)} onChange={() => {}} />),
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(4);
    for (const key of [
      'admin.ai.status.enableCheck.contracts',
      'admin.ai.status.enableCheck.transfer',
      'admin.ai.status.enableCheck.notice',
      'admin.ai.status.enableCheck.workspace',
      'admin.ai.status.enableOptIn',
    ] as const) {
      expect(html).toContain(esc(en[key]));
    }
    expect(html).not.toContain('type="date"');
  });

  it('the confirm stays off until all four are ticked; the stored checks pre-fill it', () => {
    expect(goLiveReady(goLiveDraft(null))).toBe(false);
    const stored = {
      contracts: true,
      transferBasis: true,
      noticeChecked: true,
      workspaceChecked: false,
      confirmedAt: null,
      confirmedBy: null,
    };
    expect(goLiveDraft(stored)).toEqual({
      contracts: true,
      transferBasis: true,
      noticeChecked: true,
      workspaceChecked: false,
    });
    expect(goLiveReady(goLiveDraft(stored))).toBe(false);
    expect(goLiveReady({ ...goLiveDraft(stored), workspaceChecked: true })).toBe(true);
  });

  it('sends the settings without read-only fields', () => {
    const dto = {
      enabled: true,
      model: 'claude-sonnet-5-5',
      features: {
        assistant: true,
        explain: true,
        dns_check: false,
        audit_summary: true,
        server_health: true,
        product_texts: true,
        translations: true,
      },
      budgetUsd: 50,
      warnPercent: 80,
      dailyOrgLimit: 200,
      dailyUserLimit: 50,
      key: { source: 'ui', savedAt: null, savedBy: null, envSet: false },
      demo: false,
    } as unknown as AiSettingsDto;
    expect(settingsInput(dto)).toEqual({
      enabled: true,
      model: 'claude-sonnet-5-5',
      features: dto.features,
      budgetUsd: 50,
      warnPercent: 80,
      dailyOrgLimit: 200,
      dailyUserLimit: 50,
    });
  });

  it('offers the current month in Zurich and the 12 before it', () => {
    // 31 December 23:30 UTC is already January in Zurich.
    const months = usageMonths(new Date('2026-12-31T23:30:00Z'));
    expect(months).toHaveLength(13);
    expect(months[0]).toBe('2027-01');
    expect(months[1]).toBe('2026-12');
    expect(months[12]).toBe('2026-01');
  });
});
