import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AiText, isConsolePath } from './ai-text';

const render = (text: string) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <AiText text={text} />
    </MemoryRouter>,
  );

describe('AiText (ai 11.3)', () => {
  it('renders no HTML from the text', () => {
    const html = render('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>fett</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('makes only console paths links', () => {
    const html = render(
      'Siehe [Server](/o/muster/servers/abc) und [Admin](/admin/ai?tab=usage), nicht [Phish](https://evil.example/login).',
    );
    expect(html).toContain('href="/o/muster/servers/abc"');
    expect(html).toContain('href="/admin/ai?tab=usage"');
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).not.toContain('href="https://evil.example');
    expect(html).toContain('Phish (https://evil.example/login)');
  });

  it('keeps bare URLs and javascript links as plain text', () => {
    const html = render('Mehr unter https://example.com und [klick](javascript:alert(1))');
    expect(html).not.toContain('<a');
    expect(html).toContain('https://example.com');
    expect(html).toContain('klick (javascript:alert(1)');
  });

  it('renders paragraphs, line breaks, lists, bold and code', () => {
    const html = render('Erster Absatz\nzweite Zeile\n\n- eins\n- **zwei**\n\n1. `dig MX`\n2. drei');
    expect(html).toContain('<p>Erster Absatz<br/>zweite Zeile</p>');
    expect(html).toMatch(/<ul[^>]*><li>eins<\/li><li><strong[^>]*>zwei<\/strong><\/li><\/ul>/);
    expect(html).toMatch(/<ol[^>]*><li><code[^>]*>dig MX<\/code><\/li><li>drei<\/li><\/ol>/);
  });
});

describe('isConsolePath', () => {
  it('accepts organization and admin paths', () => {
    expect(isConsolePath('/o/muster')).toBe(true);
    expect(isConsolePath('/o/muster/domains/1b2c?tab=dns')).toBe(true);
    expect(isConsolePath('/admin')).toBe(true);
    expect(isConsolePath('/admin/translations?tab=entries&q=ai.notice.text')).toBe(true);
  });

  it('refuses everything else', () => {
    for (const path of [
      'https://example.com',
      '//evil.example/o/x',
      '/o//evil',
      '/o/a\\b',
      '/account',
      '/o',
      '/o/../account',
      '/o/a b',
      'javascript:alert(1)',
      `/o/${'a'.repeat(300)}`,
      42,
      null,
    ]) {
      expect(isConsolePath(path), String(path)).toBe(false);
    }
  });
});
