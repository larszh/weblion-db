import type { MailDnsApplyResult } from '@weblion/shared';

/** How "add missing records" went: the title and tone of its result notice. */
export type MailDnsApplyOutcome = 'added' | 'partial' | 'failed' | 'nothing';

export function mailDnsApplyOutcome(
  result: Pick<MailDnsApplyResult, 'added' | 'failed'>,
): MailDnsApplyOutcome {
  if (result.failed.length > 0) return result.added.length > 0 ? 'partial' : 'failed';
  return result.added.length > 0 ? 'added' : 'nothing';
}
