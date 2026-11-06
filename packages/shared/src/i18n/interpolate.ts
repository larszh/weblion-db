/** Values for the {name} placeholders of a text. */
export type I18nParams = Record<string, string | number | null | undefined>;

// Same pattern as PLACEHOLDER_RE (placeholders.ts), kept local so the web runtime needs only this file.
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** Replaces {name} with String(params.name ?? ''). Unknown placeholders stay as they are. */
export function interpolate(text: string, params?: I18nParams): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? '') : match,
  );
}
