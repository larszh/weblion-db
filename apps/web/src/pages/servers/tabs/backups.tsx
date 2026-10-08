import { useState } from 'react';
import { Archive, Lock, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { BackupInfo } from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBytes, formatDate } from '@/lib/format';
import { qk, useApiMutation, useBackups } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { useServerContext } from '../context';

export function BackupsTab() {
  const { t, locale } = useI18n();
  const { server, can, has } = useServerContext();
  const backups = useBackups(server.id);
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [restore, setRestore] = useState<BackupInfo | null>(null);
  const [remove, setRemove] = useState<BackupInfo | null>(null);
  const keys = [qk.serverSub(server.id, 'backups'), qk.serverSub(server.id, 'tasks'), qk.server(server.id)];

  const create = useApiMutation(
    () => api.post(`/servers/${server.id}/backups`, description ? { description } : {}),
    {
      success: t('backups.started'),
      invalidate: keys,
      onSuccess: () => {
        setCreating(false);
        setDescription('');
      },
    },
  );
  const restoreMutation = useApiMutation(
    (b: BackupInfo) => api.post(`/servers/${server.id}/backups/restore`, { backupId: b.id }),
    {
      success: t('backups.restoreStarted'),
      invalidate: keys,
      onSuccess: () => setRestore(null),
    },
  );
  const deleteMutation = useApiMutation(
    (b: BackupInfo) => api.del(`/servers/${server.id}/backups`, undefined, { backupId: b.id }),
    {
      success: t('backups.deleted'),
      invalidate: keys,
      onSuccess: () => setRemove(null),
    },
  );

  const slots = server.specs.backupSlots;
  const used = backups.data?.length ?? 0;

  return (
    <div className="space-y-4">
      {server.provider.type === 'fire24' && <Notice tone="info">{t('backups.fire24Hint')}</Notice>}
      <Card>
        <CardHeader
          title={t('tab.backups')}
          description={slots ? t('backups.slots', { used, total: slots }) : t('backups.subtitle')}
          actions={
            can('server:backup:create') && (
              <Button
                variant="primary"
                icon={<Plus className="size-4" />}
                onClick={() => setCreating(true)}
                disabled={!!slots && used >= slots}
              >
                {t('backups.create')}
              </Button>
            )
          }
        />
        {backups.isPending ? (
          <LoadingBlock />
        ) : backups.isError ? (
          <div className="p-5">
            <ErrorState error={backups.error} onRetry={() => void backups.refetch()} />
          </div>
        ) : backups.data.length === 0 ? (
          <EmptyState
            icon={<Archive className="size-6" />}
            title={t('backups.empty')}
            description={t('backups.emptyText')}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('backups.created')}</TH>
                <TH>{t('backups.description')}</TH>
                <TH>{t('backups.size')}</TH>
                <TH className="hidden md:table-cell">{t('backups.storage')}</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {backups.data.map((b) => (
                <tr key={b.id}>
                  <TD className="tabular">
                    <div className="flex items-center gap-2">
                      {b.protected && <Lock className="size-3.5 text-warning" />}
                      {formatDate(b.createdAt, locale)}
                    </div>
                  </TD>
                  <TD>
                    <div className="max-w-[320px] truncate">
                      {b.description || <span className="text-subtle">–</span>}
                    </div>
                    {b.status && b.status !== 'finished' && (
                      <Badge tone={b.status === 'running' ? 'warning' : 'danger'} className="mt-1">
                        {b.status}
                      </Badge>
                    )}
                  </TD>
                  <TD className="tabular">{formatBytes(b.sizeBytes)}</TD>
                  <TD className="hidden md:table-cell">
                    <Mono className="text-muted">{b.storage ?? '–'}</Mono>
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    {can('server:backup:restore') && has('backupRestore') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<RotateCcw className="size-3.5" />}
                        onClick={() => setRestore(b)}
                        disabled={b.status === 'running'}
                      >
                        {t('backups.restore')}
                      </Button>
                    )}
                    {can('server:backup:delete') && has('backupDelete') && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setRemove(b)}
                        aria-label={t('common.delete')}
                        disabled={b.protected}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title={t('backups.create')}
        description={t('backups.createText')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate(undefined)}>
              {t('backups.create')}
            </Button>
          </>
        }
      >
        <Field label={t('backups.description')} hint={t('common.optional')} htmlFor="backup-desc">
          <Input
            id="backup-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            autoFocus
          />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={!!restore}
        onOpenChange={(o) => !o && setRestore(null)}
        title={t('backups.restoreTitle')}
        description={t('backups.restoreText', { date: formatDate(restore?.createdAt, locale) })}
        confirmLabel={t('backups.restore')}
        confirmText={server.name}
        loading={restoreMutation.isPending}
        onConfirm={() => restore && restoreMutation.mutate(restore)}
      >
        {server.provider.type === 'proxmox' && server.status !== 'stopped' && (
          <Notice tone="warning" className="mb-3">
            {t('backups.mustStop')}
          </Notice>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title={t('backups.deleteTitle')}
        description={t('backups.deleteText', { date: formatDate(remove?.createdAt, locale) })}
        confirmLabel={t('common.delete')}
        loading={deleteMutation.isPending}
        onConfirm={() => remove && deleteMutation.mutate(remove)}
      />
    </div>
  );
}
