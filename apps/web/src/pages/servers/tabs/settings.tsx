import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { qk, useApiMutation, useProjects, useServerConfig } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/menu';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Select,
} from '@/components/ui/primitives';
import { useServerContext } from '../context';

export function SettingsTab() {
  const t = useT();
  const { org } = useOrg();
  const { server, can, has } = useServerContext();
  const projects = useProjects(org.id);
  const [name, setName] = useState(server.name);
  const [labels, setLabels] = useState<[string, string][]>(Object.entries(server.labels));
  const [projectId, setProjectId] = useState(server.project?.id ?? '');
  const [showConfig, setShowConfig] = useState(false);
  const config = useServerConfig(server.id, showConfig && has('config') && can('server:config:read'));

  useEffect(() => {
    setName(server.name);
    setLabels(Object.entries(server.labels));
    setProjectId(server.project?.id ?? '');
  }, [server]);

  const invalidate = [qk.server(server.id), ['servers']];
  const update = useApiMutation((body: object) => api.patch(`/servers/${server.id}`, body), {
    success: t('common.saved'),
    invalidate,
  });
  const move = useApiMutation(() => api.post(`/servers/${server.id}/move`, { projectId }), {
    success: t('settings.moved'),
    invalidate: [...invalidate, qk.projects(org.id)],
  });

  const labelObject = Object.fromEntries(
    labels.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v.trim()]),
  );

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {can('server:rename') && (
        <Card>
          <CardHeader title={t('settings.name')} description={t('settings.nameText')} />
          <CardBody className="flex flex-wrap items-end gap-3">
            <Field label={t('settings.name')} className="min-w-[220px] flex-1" htmlFor="s-name">
              <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={63} />
            </Field>
            <Button
              variant="primary"
              disabled={!name.trim() || name === server.name}
              loading={update.isPending}
              onClick={() => update.mutate({ name })}
            >
              {t('common.save')}
            </Button>
          </CardBody>
        </Card>
      )}

      {can('server:move') && (
        <Card>
          <CardHeader title={t('settings.project')} description={t('settings.projectText')} />
          <CardBody className="flex flex-wrap items-end gap-3">
            <Field label={t('servers.col.project')} className="min-w-[220px] flex-1" htmlFor="s-project">
              <Select id="s-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              disabled={!projectId || projectId === server.project?.id}
              loading={move.isPending}
              onClick={() => move.mutate(undefined)}
            >
              {t('settings.move')}
            </Button>
          </CardBody>
        </Card>
      )}

      {can('server:labels') && (
        <Card>
          <CardHeader title={t('settings.labels')} description={t('settings.labelsText')} />
          <CardBody className="space-y-2">
            {labels.map(([k, v], i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={k}
                  placeholder="key"
                  className="font-mono"
                  aria-label="Label key"
                  onChange={(e) => setLabels(labels.map((l, j) => (j === i ? [e.target.value, l[1]] : l)))}
                />
                <span className="text-subtle">=</span>
                <Input
                  value={v}
                  placeholder="value"
                  className="font-mono"
                  aria-label="Label value"
                  onChange={(e) => setLabels(labels.map((l, j) => (j === i ? [l[0], e.target.value] : l)))}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setLabels(labels.filter((_, j) => j !== i))}
                  aria-label={t('common.remove')}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                size="sm"
                icon={<Plus className="size-3.5" />}
                onClick={() => setLabels([...labels, ['', '']])}
              >
                {t('settings.addLabel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={update.isPending}
                onClick={() => update.mutate({ labels: labelObject })}
              >
                {t('common.save')}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {can('server:protection') && (
        <Card>
          <CardHeader title={t('settings.protection')} description={t('settings.protectionText')} />
          <CardBody className="space-y-3">
            {(['delete', 'rebuild'] as const).map((kind) => (
              <label
                key={kind}
                className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5"
              >
                <span>
                  <span className="block text-sm font-medium">{t(`settings.protect.${kind}`)}</span>
                  <span className="block text-xs text-muted">{t(`settings.protect.${kind}.hint`)}</span>
                </span>
                <Switch
                  checked={server.protection[kind]}
                  disabled={update.isPending}
                  onCheckedChange={(v) => update.mutate({ protection: { [kind]: v } })}
                  label={t(`settings.protect.${kind}`)}
                />
              </label>
            ))}
          </CardBody>
        </Card>
      )}

      {has('config') && can('server:config:read') && (
        <Card className="xl:col-span-2">
          <CardHeader
            title={t('settings.config')}
            description={t('settings.configText')}
            actions={
              <Button size="sm" onClick={() => setShowConfig(!showConfig)}>
                {showConfig ? t('common.hide') : t('common.show')}
              </Button>
            }
          />
          {showConfig &&
            (config.isPending ? (
              <LoadingBlock rows={2} />
            ) : config.isError ? (
              <CardBody>
                <ErrorState error={config.error} />
              </CardBody>
            ) : (
              <pre className="max-h-[480px] overflow-auto bg-surface-2 px-5 py-4 font-mono text-xs leading-relaxed text-text">
                {JSON.stringify(config.data, null, 2)}
              </pre>
            ))}
        </Card>
      )}
    </div>
  );
}
