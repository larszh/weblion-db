import { errorMessage } from './api';
import type { TFunction } from './i18n';

/**
 * Text for an error in the UI language: translated for known codes, the API's English message otherwise
 * (i18n 7, plan O25). Foundation stub: the API message as before; U2 implements the rules with every code of
 * plan 2.10. useApiMutation and ErrorState already call it, so they need no change then.
 */
export function localizeError(err: unknown, t: TFunction): string {
  void t;
  return errorMessage(err);
}
