import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n';
import { AuditView } from './audit';

/**
 * The free-text search of the audit log is applied on submit. A form with two text fields submits on
 * Enter only when it has a submit button, so the view must render one, or Enter sends no request.
 */
describe('AuditView search', () => {
  it('has a submit button in the filter form, so Enter applies the search', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        {withI18n(<AuditView path="/admin/audit" showOrg />, 'en')}
      </QueryClientProvider>,
    );
    const form = /<form[^>]*>([\s\S]*?)<\/form>/.exec(html)?.[1] ?? '';
    expect(form.match(/<input/g)?.length).toBeGreaterThan(1);
    expect(form).toContain('type="submit"');
  });
});
