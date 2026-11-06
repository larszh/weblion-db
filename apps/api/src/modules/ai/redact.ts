import type { Env } from '../../config/env';
import { SECRET_KEY_PATTERN } from '../../lib/redact';

/**
 * Redaction of everything the AI module sends to Claude or stores as an error text (ai 11.2, plan F13). Known
 * secrets are removed by their exact value, typical credential formats by pattern; long strings are cut. There
 * is deliberately no generic "long random string" rule: DKIM public keys and hashes are DNS data the checks need.
 */

const HIDDEN = '[hidden]';
const MAX_TEXT = 4_000;
const MAX_DEPTH = 10;
/** Exact values shorter than this are too likely to occur in ordinary text. */
const MIN_SECRET_LENGTH = 8;

let envSecrets: string[] = [];
let anthropicKeys: string[] = [];
let exactSecrets: string[] = [];

function rebuildExact(): void {
  // Longest first, so a secret that contains a shorter one is removed as a whole.
  exactSecrets = [...new Set([...envSecrets, ...anthropicKeys])]
    .filter((s) => s.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
}

const SECRET_ENV_NAME = /(_KEY|_TOKEN|_SECRET|_PASSWORD)$/;

/**
 * At startup: the exact values of every env variable whose name matches SECRET_KEY_PATTERN or ends in _KEY,
 * _TOKEN, _SECRET or _PASSWORD (ENCRYPTION_KEY, provider keys, SMTP_PASSWORD, STRIPE_*, ZOHO_*,
 * ANTHROPIC_API_KEY, ...). A multi-line value (CLOUDPANEL_PRIVATE_KEY) also contributes its lines, so a single
 * leaked line is caught too.
 */
export function initAiSecrets(env: Env): void {
  const values: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    if (!SECRET_KEY_PATTERN.test(name) && !SECRET_ENV_NAME.test(name)) continue;
    values.push(value);
    if (value.includes('\n')) {
      for (const line of value.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length >= 16 && !trimmed.startsWith('-----')) values.push(trimmed);
      }
    }
  }
  envSecrets = values;
  rebuildExact();
}

/** The saved and the env Anthropic key; set whenever the key is resolved and after every save or delete. */
export function setAnthropicKeys(keys: string[]): void {
  anthropicKeys = keys.filter((k) => typeof k === 'string' && k.length > 0);
  rebuildExact();
}

/** Credential formats, each replaced as a whole unless a replacement keeps a label. */
const PATTERNS: Array<[RegExp, string]> = [
  // Anthropic keys (API and Admin API).
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, HIDDEN],
  // PEM private keys, to the matching END line or to the end of the text.
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, HIDDEN],
  // Stripe secret, restricted and publishable keys, webhook secrets.
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, HIDDEN],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, HIDDEN],
  // JWTs: three base64url parts, the first one a JSON object.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, HIDDEN],
  // Authorization header values.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${HIDDEN}`],
  // The password in URL user info: scheme://user:password@host.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/gi, `$1:${HIDDEN}@`],
  // password=..., "token": "...", api_key: ... (also inside longer names such as access_token).
  [
    /(?<![A-Za-z0-9])(password|passwd|pwd|secret|token|api_key|apikey)("?\s*[=:]\s*"?)[^\s"',;&}]+/gi,
    `$1$2${HIDDEN}`,
  ],
  // 24fire personal access tokens: "<id>|<token>".
  [/\b\d+\|[A-Za-z0-9_-]{20,}/g, HIDDEN],
  // Uptime Kuma API keys.
  [/\buk\d+_[A-Za-z0-9_-]{8,}/g, HIDDEN],
  // GitHub tokens.
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, HIDDEN],
  // AWS access key ids.
  [/\bAKIA[0-9A-Z]{16}\b/g, HIDDEN],
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Exact secrets, then the patterns, without the length cap: for the person's own chat messages, which have their
 * own limits (ai 9.2), so a key pasted into the chat never leaves the console (ai 5.2).
 */
export function redactSecrets(s: string): string {
  let out = s;
  for (const secret of exactSecrets) {
    if (out.includes(secret)) out = out.split(secret).join(HIDDEN);
  }
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Exact secrets, then the patterns, then the 4,000 character cap (ai 11.2). */
export function redactText(s: string): string {
  const out = redactSecrets(s);
  return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)} [cut]` : out;
}

/** Keys dropped in personal mode (plan O28): addresses and browser data of people. */
function isPersonalKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === 'ip' || k === 'useragent' || k === 'user_agent' || k.endsWith('email');
}

/**
 * Walks objects and arrays (depth at most 10): values of keys matching SECRET_KEY_PATTERN become [hidden],
 * every string goes through redactText. With `personal: true` (audit entries, mail logs, mail domains, cloud
 * storage, streaming) it also drops ip, userAgent, user_agent and e-mail keys and replaces e-mail addresses in
 * strings by [email]. DNS data is sent without personal mode: a DMARC rua=mailto: address is what is checked.
 */
export function redactForAi(value: unknown, opts: { personal?: boolean } = {}): unknown {
  const personal = opts.personal === true;
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const text = redactText(v);
      return personal ? text.replace(EMAIL, '[email]') : text;
    }
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Date) return walk(v.toISOString(), depth);
    if (typeof v !== 'object') return undefined;
    if (depth >= MAX_DEPTH) return '[cut]';
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(v as Record<string, unknown>)) {
      if (personal && isPersonalKey(key)) continue;
      out[key] =
        SECRET_KEY_PATTERN.test(key) && item !== null && item !== undefined ? HIDDEN : walk(item, depth + 1);
    }
    return out;
  };
  return walk(value, 0);
}

/**
 * JSON.stringify with < and > written as the JSON escapes \u003c and \u003e (ai 8.1). Still valid JSON and
 * the model still reads the characters, but a value can never open or close a tag of the prompt
 * (</third_party>, <context>).
 */
export function toolJson(value: unknown): string {
  return (JSON.stringify(value ?? null) ?? 'null').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
