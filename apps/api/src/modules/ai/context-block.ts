import type { AiPageRef, Locale } from '@weblion/shared';

/**
 * The <context> block at the start of every user turn (ai 9.2): who asks (the role only, never the name or the
 * e-mail address, plan O28), from which page and in which language. The system prompt stays free of per-request
 * values (prompt cache, ai 6.2), so these go here.
 */

export interface RequestContext {
  /** 'owner', 'viewer', 'reseller admin', 'weblion staff (support)', ... */
  role: string;
  access: 'member' | 'reseller' | 'staff';
  /** The organization's kind; null in the admin area without one organization. */
  organizationKind: string | null;
  language: Locale;
}

/** < and > as the JSON escapes, line breaks as spaces: a page title can be a customer-chosen name. */
export function escapeLine(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .trim();
}

/** Today in Europe/Zurich as YYYY-MM-DD. */
export function todayZurich(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function contextBlock(
  ctx: RequestContext,
  page: AiPageRef | null | undefined,
  today?: string,
): string {
  const lines = ['<context>', `role: ${escapeLine(ctx.role)}`, `access: ${ctx.access}`];
  if (ctx.organizationKind) lines.push(`organization_kind: ${escapeLine(ctx.organizationKind)}`);
  if (page) {
    lines.push(`page: ${escapeLine(page.path)}`);
    if (page.title) lines.push(`page_title: ${escapeLine(page.title)}`);
  }
  lines.push(`language: ${ctx.language}`);
  if (today) lines.push(`today: ${today} (Europe/Zurich)`);
  lines.push('</context>');
  return lines.join('\n');
}
