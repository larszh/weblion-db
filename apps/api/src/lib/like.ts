/**
 * Search text for LIKE and ILIKE, taken literally. The wildcards % and _ and the escape character
 * are escaped instead of removed: removing them turned a search for an action code such as
 * "ai.org_switch" into "ai.orgswitch", which matches nothing. Postgres uses the backslash as the
 * default escape character of LIKE (independent of standard_conforming_strings, the value is a
 * bound parameter), so no ESCAPE clause is needed. A single pass escapes every character of the
 * input once, so the backslashes added here are never escaped a second time.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Matches values that contain `q` anywhere. */
export const containsPattern = (q: string) => `%${escapeLike(q)}%`;

/** Matches values that start with `q`. */
export const prefixPattern = (q: string) => `${escapeLike(q)}%`;
