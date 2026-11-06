import type { I18nErrorCode } from '@weblion/shared';
import { AppError } from '../../lib/errors';

/**
 * The error answers of the translation routes (i18n 11.4, plan 2.10). Each has its own code and a fixed English
 * message; the web shows admin.i18n.error.<code> with the parameters of `details`.
 */

export const I18N_ERROR_MESSAGES: Record<I18nErrorCode, string> = {
  placeholder_mismatch: 'The placeholders must be exactly those of the German text.',
  forbidden_character: 'The text contains a character that is not allowed (sharp s or em dash).',
  unknown_key: 'This text key does not exist.',
  legal_key: 'Legal texts are never machine translated.',
  nothing_to_translate: 'There is nothing to translate for this selection.',
  estimate_changed: 'The estimated cost rose by more than 25 percent. Please check the new estimate.',
  job_running: 'A translation job is already queued or running.',
  job_finished: 'This job has already finished.',
  not_stale: 'This translation is not outdated.',
  glossary_duplicate: 'This term is already in the glossary.',
  glossary_builtin: 'Default terms can be changed but not deleted.',
  import_invalid: 'The file is not a translation export of weblion.one.',
};

const STATUS: Record<I18nErrorCode, number> = {
  placeholder_mismatch: 400,
  forbidden_character: 400,
  unknown_key: 404,
  legal_key: 409,
  nothing_to_translate: 409,
  estimate_changed: 409,
  job_running: 409,
  job_finished: 409,
  not_stale: 409,
  glossary_duplicate: 409,
  glossary_builtin: 409,
  import_invalid: 400,
};

export function i18nError(code: I18nErrorCode, details?: Record<string, unknown>): AppError {
  return new AppError(STATUS[code], code, I18N_ERROR_MESSAGES[code], details);
}

export const placeholderMismatch = (details: {
  missing: string[];
  extra: string[];
  lineBreaks?: { expected: number; actual: number };
}) => i18nError('placeholder_mismatch', details);
export const forbiddenCharacter = (characters: string[]) => i18nError('forbidden_character', { characters });
export const unknownKey = (key: string) => i18nError('unknown_key', { key });
export const legalKey = (keys: string[]) => i18nError('legal_key', { keys });
export const nothingToTranslate = () => i18nError('nothing_to_translate');
export const estimateChanged = (costMicros: number, confirmedMicros: number) =>
  i18nError('estimate_changed', { costMicros, confirmedMicros });
export const jobRunning = (jobId: string | null) => i18nError('job_running', { jobId });
export const jobFinished = (status: string) => i18nError('job_finished', { status });
export const notStale = () => i18nError('not_stale');
export const glossaryDuplicate = (term: string) => i18nError('glossary_duplicate', { term });
export const glossaryBuiltin = (term: string) => i18nError('glossary_builtin', { term });
export const importInvalid = (problems: string[]) =>
  i18nError('import_invalid', { problems: problems.slice(0, 20) });
