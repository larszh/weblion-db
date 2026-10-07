import { useState } from 'react';
import { Camera, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { SnapshotInfo } from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { qk, useApiMutation, useSnapshots } from '@/lib/queries';
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
} from '@/components/ui/primitives';
import { Switch } from '@/components/ui/menu';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { useServerContext } from '../context';

const NAME = /^[a-zA-Z][a-zA-Z0-9_-]{1,39}$/;

export function SnapshotsTab() {
  const { t, locale } = useI18n();
  const { server, can } = useServerContext();
  const snapshots = useSnapshots(server.id);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [includeRam, setIncludeRam] = useState(false);
  const [rollback, setRollback] = useState<SnapshotInfo | null>(null);
  const [remove, setRemove] = useState<SnapshotInfo | null>(null);
  const keys = [qk.serverSub(server.id, 'snapshots'), qk.serverSub(server.id, 'tasks')];

  const create = useApiMutation(
    () =>
      api.post(`/servers/${server.id}/snapshots`, {
        name,
        description: description || undefined,
        includeRam,
      }),
    {
      success: t('snapshots.created'),
      invalidate: keys,
      onSuccess: () => {
        setCreating(false);
        setName('');
        setDescription('');
        setIncludeRam(false);
      },
    },
  );
  const rollbackMutation = useApiMutation(
    (s: SnapshotInfo) => api.post(`/servers/${server.id}/snapshots/${encodeURIComponent(s.id)}/rollback`),
    {
      success: t('snapshots.rollbackStarted'),
      invalidate: [...keys, qk.server(server.id)],
      onSuccess: () => setRollback(null),
    },
  );
  const deleteMutation = useApiMutation(
    (s: SnapshotInfo) => api.del(`/servers/${server.id}/snapshots/${encodeURIComponent(s.id)}`),
    {
      success: t('snapshots.deleted'),
      invalidate: keys,
      onSuccess: () => setRemove(null),
    },
  );

  const openCreate = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    setName(`snap-${stamp}`);
    setCreating(true);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('tab.snapshots')}
          description={t('snapshots.subtitle')}
          actions={
            can('server:snapshot:create') && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                {t('snapshots.create')}
              </Button>
            )
          }
        />
        {snapshots.isPending ? (
          <LoadingBlock />
        ) : snapshots.isError ? (
          <div className="p-5">
            <ErrorState error={snapshots.error} />
          </div>
        ) : snapshots.data.length === 0 ? (
          <EmptyState
            icon={<Camera className="size-6" />}
            title={t('snapshots.empty')}
            description={t('snapshots.emptyText')}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('snapshots.name')}</TH>
                <TH>{t('backups.created')}</TH>
                <TH className="hidden md:table-cell">{t('backups.description')}</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {snapshots.data.map((s) => (
                <tr key={s.id}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Mono className="font-medium text-text">{s.id}</Mono>
                      {s.includesRam && <Badge tone="info">RAM</Badge>}
                    </div>
                  </TD>
                  <TD className="tabular">{formatDate(s.createdAt, locale)}</TD>
                  <TD className="hidden max-w-[320px] truncate text-muted md:table-cell">
                    {s.description || '–'}
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    {can('server:snapshot:rollback') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<RotateCcw className="size-3.5" />}
                        onClick={() => setRollback(s)}
                      >
                        {t('snapshots.rollback')}
                      </Button>
                    )}
                    {can('server:snapshot:delete') && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setRemove(s)}
                        aria-label={t('common.delete')}
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
        title={t('snapshots.create')}
        description={t('snapshots.createText')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!NAME.test(name)}
              loading={create.isPending}
              onClick={() => create.mutate(undefined)}
            >
              {t('snapshots.create')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label={t('snapshots.name')}
            hint={t('snapshots.nameHint')}
            error={name && !NAME.test(name) ? t('snapshots.nameInvalid') : undefined}
            htmlFor="snap-name"
          >
            <Input
              id="snap-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="font-mono"
              autoFocus
            />
          </Field>
          <Field label={t('backups.description')} hint={t('common.optional')} htmlFor="snap-desc">
            <Input
              id="snap-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
            />
          </Field>
          {server.kind === 'vm' && (
            <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">{t('snapshots.includeRam')}</span>
                <span className="block text-xs text-muted">{t('snapshots.includeRamHint')}</span>
              </span>
              <Switch
                checked={includeRam}
                onCheckedChange={setIncludeRam}
                label={t('snapshots.includeRam')}
              />
            </label>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!rollback}
        onOpenChange={(o) => !o && setRollback(null)}
        title={t('snapshots.rollbackTitle', { name: rollback?.id ?? '' })}
        description={t('snapshots.rollbackText')}
        confirmLabel={t('snapshots.rollback')}
        confirmText={server.name}
        loading={rollbackMutation.isPending}
        onConfirm={() => rollback && rollbackMutation.mutate(rollback)}
      />
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title={t('snapshots.deleteTitle', { name: remove?.id ?? '' })}
        confirmLabel={t('common.delete')}
        loading={deleteMutation.isPending}
        onConfirm={() => remove && deleteMutation.mutate(remove)}
      />
    </div>
  );
}
