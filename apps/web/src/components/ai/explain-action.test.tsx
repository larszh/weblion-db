import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { withI18n } from '@/test/i18n';
import { ErrorState } from '@/components/ui/primitives';
import {
  explainAvailable,
  explainError,
  registerExplainHandler,
  useExplainAvailable,
} from './explain-action';
import { AI_CHAT_STORAGE_PREFIX, clearAiChats } from './storage';

const apiError = new ApiError(502, 'provider_error', 'The provider refused the request.');
const aiError = new ApiError(429, 'ai_limit', 'Limit', { limit: 'budget' });

function Probe({ err }: { err: unknown }) {
  return <span>{useExplainAvailable(err) ? 'yes' : 'no'}</span>;
}

describe('explain action', () => {
  afterEach(() => {
    registerExplainHandler(null);
    vi.unstubAllGlobals();
  });

  it('is off without a handler', () => {
    expect(explainAvailable(apiError)).toBe(false);
    expect(renderToStaticMarkup(<Probe err={apiError} />)).toBe('<span>no</span>');
    expect(() => explainError(apiError)).not.toThrow();
  });

  it('offers API errors to the registered handler, never errors of the AI itself', () => {
    const handler = vi.fn();
    registerExplainHandler(handler);
    expect(explainAvailable(apiError)).toBe(true);
    expect(explainAvailable(aiError)).toBe(false);
    expect(explainAvailable(new Error('x'))).toBe(false);
    // The server snapshot is the store's own, so a static render sees the handler.
    expect(renderToStaticMarkup(<Probe err={apiError} />)).toBe('<span>yes</span>');
    expect(renderToStaticMarkup(<Probe err={aiError} />)).toBe('<span>no</span>');
    explainError(aiError);
    expect(handler).not.toHaveBeenCalled();
    explainError(apiError);
    expect(handler).toHaveBeenCalledWith(apiError);
  });

  it('shows the small button in ErrorState only while a handler is registered', () => {
    const without = renderToStaticMarkup(withI18n(<ErrorState error={apiError} />));
    expect(without).toContain('The provider refused the request.');
    expect(without).not.toContain('Explain');
    registerExplainHandler(() => {});
    expect(renderToStaticMarkup(withI18n(<ErrorState error={apiError} />))).toContain('Explain');
    expect(renderToStaticMarkup(withI18n(<ErrorState error={apiError} />, 'de'))).toContain('Erklären');
    expect(renderToStaticMarkup(withI18n(<ErrorState error={aiError} />))).not.toContain('Explain');
  });

  it('clearAiChats removes every chat and nothing else', () => {
    const store = new Map<string, string>([
      [`${AI_CHAT_STORAGE_PREFIX}org-1`, '[]'],
      [`${AI_CHAT_STORAGE_PREFIX}org-2`, '[]'],
      ['wl-other', 'keep'],
    ]);
    vi.stubGlobal('sessionStorage', {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => void store.delete(k),
    });
    clearAiChats();
    expect([...store.keys()]).toEqual(['wl-other']);
  });

  it('clearAiChats does nothing when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => clearAiChats()).not.toThrow();
  });
});
