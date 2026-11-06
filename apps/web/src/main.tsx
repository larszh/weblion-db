import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import '@fontsource-variable/inter';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import './styles.css';
import { bootI18n, I18nProvider } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { TooltipProvider } from '@/components/ui/menu';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // Do not hammer the API for errors that will not go away by retrying.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

// After a deploy an open tab may ask for a chunk that no longer exists: reload once (the usual Vite advice).
// The time of the last reload guards against a loop when the chunk is missing for another reason.
const RELOAD_FLAG = 'wl-chunk-reload';
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

/** The one text outside the dictionaries: no dictionary could be loaded (i18n 5.2). */
function showBootError(root: HTMLElement) {
  root.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;padding:24px;font-family:Inter Variable,system-ui,sans-serif;text-align:center">
<div style="max-width:420px">
<p style="margin:0 0 8px;font-size:15px">Die Konsole konnte nicht geladen werden. Bitte laden Sie die Seite neu.</p>
<p style="margin:0 0 20px;font-size:15px;opacity:.75">The console could not be loaded. Please reload the page.</p>
<button type="button" style="height:40px;padding:0 18px;border:0;border-radius:8px;background:#2f72ad;color:#fff;font-size:14px;font-weight:500;cursor:pointer">Neu laden / Reload</button>
</div></div>`;
  // The CSP forbids inline handlers, so the button gets its listener here.
  root.querySelector('button')?.addEventListener('click', () => window.location.reload());
}

const root = document.getElementById('root')!;
// The dictionary first, so keys never flash (top-level await, Vite builds for es2022). The static spinner of
// index.html stays until React replaces it.
const boot = await bootI18n().catch(() => null);
if (!boot) {
  showBootError(root);
} else {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nProvider boot={boot}>
          <TooltipProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
            <Toaster position="bottom-right" richColors closeButton theme="system" />
          </TooltipProvider>
        </I18nProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
