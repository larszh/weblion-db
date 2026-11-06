import { useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api';

/**
 * "Mit KI erklären" on error toasts (lib/queries.ts) and error boxes (ErrorState): the AiProvider registers a
 * handler while the explain feature is available (ai 12.5). A small module store, so the two places that use
 * it need no context and re-render when the handler comes or goes.
 */
export type ExplainHandler = (err: unknown) => void;

let handler: ExplainHandler | null = null;
const listeners = new Set<() => void>();

/** AiProvider registers its handler while the explain feature is available, null otherwise. */
export function registerExplainHandler(next: ExplainHandler | null): void {
  if (handler === next) return;
  handler = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hasHandler(): boolean {
  return handler !== null;
}

/** Errors of the AI itself are never explained by the AI. */
function explainable(err: unknown): boolean {
  return err instanceof ApiError && !err.code.startsWith('ai_');
}

/** A handler is registered and err is an ApiError whose code does not start with "ai_". */
export function explainAvailable(err: unknown): boolean {
  return hasHandler() && explainable(err);
}

/**
 * The same, re-rendering when a handler is registered or removed. The server snapshot is the same function:
 * the web tests render with renderToStaticMarkup, which needs one, and there no handler is registered.
 */
export function useExplainAvailable(err: unknown): boolean {
  const registered = useSyncExternalStore(subscribe, hasHandler, hasHandler);
  return registered && explainable(err);
}

/** Hands the error to the registered handler; does nothing without one or for an AI error. */
export function explainError(err: unknown): void {
  if (handler && explainable(err)) handler(err);
}
