import { useEffect, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Keyboard, Maximize2, X } from 'lucide-react';
import RFB from '@novnc/novnc';
import type { ServerDto } from '@weblion/shared';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/primitives';
import { StatusDot } from '@/components/server-bits';

type ConsoleResponse = { type: 'url'; url: string } | { type: 'vnc'; path: string; password: string };
type State = 'connecting' | 'connected' | 'disconnected' | 'error';

/** Browser console via noVNC, bridged through the API so provider credentials stay server side. */
export function ConsoleDialog({
  open,
  onOpenChange,
  server,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  server: ServerDto;
}) {
  const t = useT();
  const screen = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [state, setState] = useState<State>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState('connecting');
    setError(null);

    api
      .post<ConsoleResponse>(`/servers/${server.id}/console`)
      .then((res) => {
        if (cancelled) return;
        if (res.type === 'url') {
          window.open(res.url, '_blank', 'noopener');
          onOpenChange(false);
          return;
        }
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const rfb = new RFB(screen.current!, `${proto}//${window.location.host}${res.path}`, {
          credentials: { password: res.password },
          wsProtocols: ['binary'],
        });
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.background = '#0b1320';
        rfb.addEventListener('connect', () => setState('connected'));
        rfb.addEventListener('disconnect', (e: CustomEvent<{ clean: boolean }>) => {
          setState(e.detail?.clean ? 'disconnected' : 'error');
          if (!e.detail?.clean) setError(t('console.lost'));
        });
        rfb.addEventListener('securityfailure', () => {
          setState('error');
          setError(t('console.authFailed'));
        });
        rfbRef.current = rfb;
      })
      .catch((err) => {
        if (cancelled) return;
        setState('error');
        setError(errorMessage(err));
      });

    return () => {
      cancelled = true;
      try {
        rfbRef.current?.disconnect();
      } catch {
        /* already gone */
      }
      rfbRef.current = null;
    };
  }, [open, server.id, onOpenChange, t]);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <RadixDialog.Content className="fixed inset-3 z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-[#0b1320] shadow-pop sm:inset-6">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5 text-white">
            <RadixDialog.Title className="flex items-center gap-2.5 text-sm font-medium">
              <StatusDot
                status={state === 'connected' ? 'running' : state === 'connecting' ? 'starting' : 'stopped'}
              />
              {t('console.title', { name: server.name })}
            </RadixDialog.Title>
            <RadixDialog.Description className="sr-only">
              {t('console.title', { name: server.name })}
            </RadixDialog.Description>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="text-white/80 hover:bg-white/10 hover:text-white"
                icon={<Keyboard className="size-4" />}
                disabled={state !== 'connected'}
                onClick={() => rfbRef.current?.sendCtrlAltDel()}
              >
                Ctrl+Alt+Del
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => screen.current?.requestFullscreen?.()}
                aria-label={t('console.fullscreen')}
              >
                <Maximize2 className="size-4" />
              </Button>
              <RadixDialog.Close
                className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
                aria-label={t('common.close')}
              >
                <X className="size-4" />
              </RadixDialog.Close>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <div ref={screen} className="absolute inset-0" />
            {state !== 'connected' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-white/80">
                {state === 'connecting' && (
                  <>
                    <Spinner className="text-white/70" />
                    {t('console.connecting')}
                  </>
                )}
                {state === 'disconnected' && t('console.closed')}
                {state === 'error' && <span className="max-w-md text-center text-[#ff8088]">{error}</span>}
              </div>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
