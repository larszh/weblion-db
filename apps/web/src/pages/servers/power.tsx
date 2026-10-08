import { useState } from 'react';
import { ChevronDown, Pause, Play, Power, PowerOff, RefreshCcw, RotateCcw, Zap } from 'lucide-react';
import type { PowerAction, ServerDto } from '@weblion/shared';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { qk, useApiMutation } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuLabel } from '@/components/ui/menu';
import { Card } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { useServerContext } from './context';

export const POWER_META: Record<PowerAction, { icon: typeof Power; danger: boolean; confirm: boolean }> = {
  start: { icon: Play, danger: false, confirm: false },
  shutdown: { icon: Power, danger: false, confirm: true },
  stop: { icon: PowerOff, danger: true, confirm: true },
  reboot: { icon: RefreshCcw, danger: false, confirm: true },
  reset: { icon: Zap, danger: true, confirm: true },
  suspend: { icon: Pause, danger: false, confirm: true },
  resume: { icon: RotateCcw, danger: false, confirm: false },
};

/** Which actions make sense in the current state. */
function applicable(server: ServerDto, action: PowerAction): boolean {
  const running = server.status === 'running';
  const stopped = server.status === 'stopped';
  switch (action) {
    case 'start':
      return stopped;
    case 'resume':
      return server.status === 'paused';
    case 'suspend':
      return running;
    default:
      return running || server.status === 'paused';
  }
}

export function usePowerAction(server: ServerDto) {
  const t = useT();
  return useApiMutation((action: PowerAction) => api.post(`/servers/${server.id}/power`, { action }), {
    success: (_r, action) => t('power.sent', { action: t(`power.${action}` as TranslationKey) }),
    invalidate: [qk.server(server.id), qk.serverSub(server.id, 'tasks'), ['servers']],
  });
}

/** The header control: on/off switch plus a menu with every available action. */
export function PowerControl() {
  const t = useT();
  const { server, allowed } = useServerContext();
  const mutation = usePowerAction(server);
  const [pending, setPending] = useState<PowerAction | null>(null);
  if (!allowed('power', 'server:power')) return null;

  const running = server.status === 'running';
  const busy = mutation.isPending;
  const actions = server.powerActions;

  const run = (action: PowerAction) => {
    if (POWER_META[action].confirm) setPending(action);
    else mutation.mutate(action);
  };

  return (
    <>
      <div className="inline-flex items-center overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <button
          type="button"
          disabled={busy || !(running || server.status === 'stopped')}
          onClick={() => run(running ? (actions.includes('shutdown') ? 'shutdown' : 'stop') : 'start')}
          className="flex h-9 items-center gap-2.5 px-3 text-sm font-medium text-text hover:bg-surface-3 disabled:opacity-50"
          aria-label={running ? t('power.turnOff') : t('power.turnOn')}
        >
          <span
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              running ? 'bg-success' : 'bg-border-strong',
            )}
          >
            <span
              className={cn(
                'inline-block size-4 rounded-full bg-white shadow transition-transform',
                running ? 'translate-x-[18px]' : 'translate-x-0.5',
              )}
            />
          </span>
          {running ? t('power.on') : t('power.off')}
        </button>
        <Menu
          trigger={
            <button
              className="flex h-9 items-center border-l border-border px-2 text-muted hover:bg-surface-3"
              aria-label={t('power.more')}
            >
              <ChevronDown className="size-4" />
            </button>
          }
        >
          <MenuLabel>{t('power.title')}</MenuLabel>
          {actions.map((action) => {
            const Icon = POWER_META[action].icon;
            return (
              <MenuItem
                key={action}
                icon={<Icon />}
                danger={POWER_META[action].danger}
                disabled={!applicable(server, action) || busy}
                onSelect={() => run(action)}
                hint={t(`power.${action}.hint` as TranslationKey)}
              >
                {t(`power.${action}` as TranslationKey)}
              </MenuItem>
            );
          })}
        </Menu>
      </div>
      <PowerConfirm
        action={pending}
        server={server}
        loading={busy}
        onClose={() => setPending(null)}
        onConfirm={(a) => mutation.mutate(a, { onSettled: () => setPending(null) })}
      />
    </>
  );
}

function PowerConfirm({
  action,
  server,
  loading,
  onClose,
  onConfirm,
}: {
  action: PowerAction | null;
  server: ServerDto;
  loading: boolean;
  onClose: () => void;
  onConfirm: (action: PowerAction) => void;
}) {
  const t = useT();
  return (
    <ConfirmDialog
      open={!!action}
      onOpenChange={(o) => !o && onClose()}
      title={
        action
          ? t('power.confirm.title', { action: t(`power.${action}` as TranslationKey), name: server.name })
          : ''
      }
      description={action ? t(`power.${action}.hint` as TranslationKey) : undefined}
      danger={action ? POWER_META[action].danger : false}
      confirmLabel={action ? t(`power.${action}` as TranslationKey) : ''}
      loading={loading}
      onConfirm={() => action && onConfirm(action)}
    />
  );
}

/** Power tab: every action as a card with an explanation, like the Hetzner console. */
export function PowerTab() {
  const t = useT();
  const { server } = useServerContext();
  const mutation = usePowerAction(server);
  const [pending, setPending] = useState<PowerAction | null>(null);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {server.powerActions.map((action) => {
        const meta = POWER_META[action];
        const Icon = meta.icon;
        const ok = applicable(server, action);
        return (
          <Card key={action} className="flex items-start gap-4 p-5">
            <div
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-lg',
                meta.danger ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary-text',
              )}
            >
              <Icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-text">{t(`power.${action}` as TranslationKey)}</h3>
              <p className="mt-1 text-sm text-muted">{t(`power.${action}.hint` as TranslationKey)}</p>
              <Button
                className="mt-3"
                size="sm"
                variant={meta.danger ? 'danger-soft' : 'secondary'}
                disabled={!ok || mutation.isPending}
                onClick={() => (meta.confirm ? setPending(action) : mutation.mutate(action))}
              >
                {t(`power.${action}` as TranslationKey)}
              </Button>
            </div>
          </Card>
        );
      })}
      <PowerConfirm
        action={pending}
        server={server}
        loading={mutation.isPending}
        onClose={() => setPending(null)}
        onConfirm={(a) => mutation.mutate(a, { onSettled: () => setPending(null) })}
      />
    </div>
  );
}
