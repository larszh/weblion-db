import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { MeDto, Permission } from '@weblion/shared';
import { qk } from '@/lib/queries';
import { withI18n } from '@/test/i18n';
import { TooltipProvider } from '@/components/ui/menu';
import { AppShell } from './app-shell';

function render(platformPermissions: Permission[]) {
  const me: MeDto = {
    user: {
      id: 'u1',
      email: 'staff@weblion.example',
      name: 'Staff Person',
      platformRole: 'superadmin',
      mfaEnabled: true,
      locale: 'en',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: null,
    },
    memberships: [],
    platformPermissions,
  };
  const qc = new QueryClient();
  qc.setQueryData(qk.me, me);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin']}>
        {withI18n(
          <TooltipProvider>
            <AppShell>
              <p>content</p>
            </AppShell>
          </TooltipProvider>,
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const hrefs = (html: string) => [...html.matchAll(/href="(\/admin[^"]*)"/g)].map((m) => m[1]);

describe('AppShell navigation (plan O16)', () => {
  it('lists KI and Übersetzungen after the audit log, settings last', () => {
    const html = render([
      'platform:access',
      'platform:audit:read',
      'platform:settings',
      'platform:i18n:read',
    ] as Permission[]);
    const admin = hrefs(html);
    expect(admin.slice(-4)).toEqual(['/admin/audit', '/admin/ai', '/admin/translations', '/admin/settings']);
    expect(html).toContain('>AI</a>');
    expect(html).toContain('>Translations</a>');
    // No assistant yet: the main area keeps its padding.
    expect(html).not.toContain('pb-32');
  });

  it('shows each item only with its permission', () => {
    const translationsOnly = hrefs(render(['platform:access', 'platform:i18n:read'] as Permission[]));
    expect(translationsOnly).toContain('/admin/translations');
    expect(translationsOnly).not.toContain('/admin/ai');
    const settingsOnly = hrefs(render(['platform:access', 'platform:settings'] as Permission[]));
    expect(settingsOnly).toContain('/admin/ai');
    expect(settingsOnly).not.toContain('/admin/translations');
  });
});
