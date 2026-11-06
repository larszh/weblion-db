/** Each organization's chat lives in sessionStorage under this prefix plus the organization id (ai 12.3). */
export const AI_CHAT_STORAGE_PREFIX = 'wl-ai-chat:';

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
