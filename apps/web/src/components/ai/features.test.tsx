import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import type { AiResultMeta } from '@weblion/shared';
import { en } from '@weblion/shared/i18n/en';
import { ApiError } from '@/lib/api';
import { withI18n } from '@/test/i18n';
import { errorSource } from './ai-provider';
import { ExplainResultView } from './explain-dialog';
import {
  AuditSummaryResultView,
  DnsCheckResultView,
  ProductTextsResultView,
  ServerHealthResultView,
} from './feature-dialogs';

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
const render = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{withI18n(node)}</MemoryRouter>);
const meta: AiResultMeta = { model: 'claude-opus-5-5', servedModel: 'claude-opus-5-5', demo: true };

describe('feature results (ai 10, 11.3)', () => {
  it('explain: summary, cause, steps, console links only, footnote and demo badge', () => {
    const html = render(
      <ExplainResultView
        result={{
          summary: 'Der Server antwortet nicht.',
          cause: 'Die Firewall blockiert Port 443.',
          steps: ['Firewall öffnen', 'Erneut prüfen'],
          links: [
            { label: 'Firewall', path: '/o/muster/servers/s1/firewall' },
            { label: 'Extern', path: 'https://evil.example' },
          ],
          severity: 'error',
          meta,
        }}
      />,
    );
    expect(html).toContain('Der Server antwortet nicht.');
    expect(html).toContain(esc(en['ai.explain.cause']));
    expect(html).toContain('Erneut prüfen');
    expect(html).toContain('href="/o/muster/servers/s1/firewall"');
    expect(html).not.toContain('evil.example');
    expect(html).toContain(esc(en['ai.explain.severity.error']));
    expect(html).toContain(esc(en['ai.footnote']));
    expect(html).toContain(esc(en['ai.demoBadge']));
  });

  it('DNS check: topics, proposals with their badges, dropped proposals, footnote', () => {
    const html = render(
      <DnsCheckResultView
        result={{
          zone: 'muster.example',
          overall: 'problem',
          topics: [{ topic: 'dmarc', status: 'problem', finding: 'DMARC fehlt.', proposalIds: ['p1'] }],
          proposals: [
            {
              id: 'p1',
              domainId: 'd1',
              zone: 'muster.example',
              action: 'add',
              recordId: null,
              type: 'TXT',
              name: '_dmarc',
              data: 'v=DMARC1; p=none',
              ttl: null,
              reason: 'Empfohlen',
              verified: true,
              textOnly: false,
            },
          ],
          droppedProposals: 2,
          meta,
        }}
        onApply={() => {}}
      />,
    );
    expect(html).toContain(esc(en['ai.dns.topic.dmarc']));
    expect(html).toContain('_dmarc.muster.example');
    expect(html).toContain(esc(en['ai.proposal.verified']));
    expect(html).toContain('2');
    expect(html).toContain(esc(en['ai.footnote']));
  });

  it('audit summary: findings, counts, hidden entries; an empty period says so', () => {
    const html = render(
      <AuditSummaryResultView
        result={{
          summary: 'Ruhige Woche.',
          highlights: [{ text: 'Zwei neue Server', auditIds: ['a1'] }],
          unusual: [{ text: 'Drei fehlgeschlagene Anmeldungen', auditIds: ['a2'] }],
          entries: 120,
          cut: true,
          hidden: 4,
          meta,
        }}
      />,
    );
    expect(html).toContain('Zwei neue Server');
    expect(html).toContain('Drei fehlgeschlagene Anmeldungen');
    expect(html).toContain(esc(en['ai.audit.unusual']));
    expect(html).toContain('120');
    expect(html).toContain('500');
    expect(html).toContain(esc(en['ai.footnote']));
    const empty = render(
      <AuditSummaryResultView
        result={{ summary: '', highlights: [], unusual: [], entries: 0, cut: false, hidden: 0, meta }}
      />,
    );
    expect(empty).toContain(esc(en['ai.audit.none']));
  });

  it('server analysis and product texts show their results with the footnote', () => {
    const health = render(
      <ServerHealthResultView
        result={{
          overall: 'watch',
          summary: 'CPU hoch.',
          metrics: [{ metric: 'cpu', status: 'watch', finding: 'Spitzen bis 80 %.' }],
          recommendations: ['Mehr Kerne'],
          meta,
        }}
      />,
    );
    expect(health).toContain(esc(en['ai.health.metric.cpu']));
    expect(health).toContain('Mehr Kerne');
    expect(health).toContain(esc(en['ai.footnote']));
    const texts = render(
      <ProductTextsResultView
        result={{
          texts: {
            de: { name: 'Webhosting', description: null },
            fr: { name: '[FR] Webhosting', description: null },
          },
          meta,
        }}
      />,
    );
    expect(texts).toContain('[FR] Webhosting');
    expect(texts).toContain('Français');
    expect(texts).toContain(esc(en['ai.product.applyHint']));
  });
});

describe('errorSource (ai 10.1)', () => {
  it('sends the error as the browser got it, within the limits, with the page', () => {
    const err = new ApiError(502, 'provider_error', 'x'.repeat(3000), { big: 'y'.repeat(5000) });
    const source = errorSource(err, { path: '/o/muster/servers', title: 'Server' });
    expect(source).toEqual({
      kind: 'error',
      error: { status: 502, code: 'provider_error', message: 'x'.repeat(2000) },
      page: { path: '/o/muster/servers', title: 'Server' },
    });
    const small = errorSource(new ApiError(404, 'not_found', 'Not found', { id: 'a' }), {
      path: '/admin',
      title: null,
    });
    expect(small).toMatchObject({ error: { details: { id: 'a' } }, page: { path: '/admin', title: null } });
  });
});
