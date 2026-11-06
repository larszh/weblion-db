import type { ChatMessage } from '@/lib/api/ai';

/** Each organization's chat lives in sessionStorage under this prefix plus the organization id (ai 12.3). */
export const AI_CHAT_STORAGE_PREFIX = 'wl-ai-chat:';

/** The tab keeps at most this many messages per organization (the API takes 40, plan decision 22). */
const MAX_STORED = 40;

/** Removes every chat of this tab; the shell's logout calls it, so the next person never sees a chat. */
export function clearAiChats(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(AI_CHAT_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode, tests); then there is nothing to clear.
  }
}

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<ChatMessage>;
  return (
    typeof m.id === 'string' &&
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.text === 'string' &&
    typeof m.status === 'string'
  );
}

/**
 * The stored chat of an organization. An answer that was still streaming when the tab reloaded is marked
 * cancelled, so it is shown as stopped and never sent back as history.
 */
export function loadAiChat(orgId: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(AI_CHAT_STORAGE_PREFIX + orgId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isMessage)
      .map((m) => (m.status === 'streaming' ? { ...m, status: 'cancelled' as const } : m));
  } catch {
    return [];
  }
}

/** Stores the newest messages of an organization's chat; an empty chat removes the key. */
export function saveAiChat(orgId: string, messages: ChatMessage[]): void {
  try {
    const key = AI_CHAT_STORAGE_PREFIX + orgId;
    if (messages.length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(messages.slice(-MAX_STORED)));
  } catch {
    // Full or unavailable storage: the chat stays in memory for this page only.
  }
}
