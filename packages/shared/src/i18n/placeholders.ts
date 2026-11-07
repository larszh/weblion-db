/**
 * {name}: a letter, then letters, digits or underscores. JSON examples such as { "a": 1 } are no placeholder.
 * Global: use it with matchAll or replace, never with test or exec on its own (lastIndex).
 */
export const PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** Placeholder names in order of appearance, duplicates kept. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
}

/** Multiset difference: what the value lacks and what it adds compared to the German text. */
export function comparePlaceholders(source: string, value: string): { missing: string[]; extra: string[] } {
  const counts = new Map<string, number>();
  for (const name of placeholdersOf(source)) counts.set(name, (counts.get(name) ?? 0) + 1);
  const extra: string[] = [];
  for (const name of placeholdersOf(value)) {
    const left = counts.get(name) ?? 0;
    if (left > 0) counts.set(name, left - 1);
    else extra.push(name);
  }
  const missing: string[] = [];
  for (const [name, left] of counts) for (let i = 0; i < left; i++) missing.push(name);
  return { missing, extra };
}

/** Number of line breaks (\n) in a text. */
export function lineBreakCount(text: string): number {
  let count = 0;
  for (const ch of text) if (ch === '\n') count++;
  return count;
}
