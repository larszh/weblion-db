import { useSyncExternalStore } from 'react';

/**
 * Whether the assistant launcher is on screen. From 600 px the toasts sit in the same bottom-right corner as the
 * launcher, so the Toaster (mounted once in main.tsx, outside the shell) moves them up while the launcher shows.
 */

let shown = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Marks the launcher as shown; returns the cleanup for useEffect. */
export function showLauncher(): () => void {
  shown++;
  emit();
  return () => {
    shown--;
    emit();
  };
}

export function useLauncherVisible(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown > 0,
    () => false,
  );
}

/** The desktop offset of the toasts: above the launcher (24 px from the bottom, 48 px high) with a 16 px gap. */
export const TOAST_OFFSET_ABOVE_LAUNCHER = { bottom: 88 } as const;
