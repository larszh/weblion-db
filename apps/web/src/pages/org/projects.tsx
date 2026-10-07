import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FolderKanban, Pencil, Plus, Server, Trash2 } from 'lucide-react';
import type { ProjectDto } from '@weblion/shared';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { qk, useApiMutation, useProjects, useServers } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Textarea,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ServerTable } from '@/components/server-table';

export function ProjectDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: ProjectDto;
}) {
  const t = useT();
  const { org, base } = useOrg();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  useEffect(() => {
    if (open) {
      setName(project?.name ?? '');
      setDescription(project?.description ?? '');
    }
  }, [open, project]);

  const save = useApiMutation(
    () =>
      project
        ? api.patch<ProjectDto>(`/projects/${project.id}`, { name, description: description || null })
        : api.post<ProjectDto>(`/orgs/${org.id}/projects`, { name, description: description || null }),
    {
      success: t('common.saved'),
      invalidate: [qk.projects(org.id)],
      onSuccess: (result) => {
        onOpenChange(false);
        if (!project) navigate(`${base}/projects/${result.id}`);
      },
    },
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={project ? t('projects.edit') : t('projects.new')}
      description={project ? undefined : t('projects.new.text')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            loading={save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            {project ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save.mutate(undefined);
        }}
      >
        <Field label={t('projects.name')} htmlFor="project-name">
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus
          />
        </Field>
        <Field label={t('projects.description')} htmlFor="project-desc">
          <Textarea
            id="project-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </Field>
      </form>
    </Dialog>
  );
}

export function ProjectsPage() {
  const t = useT();
  const { org, base, can } = useOrg();
  const projects = useProjects(org.id);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title={t('nav.projects')}
        description={t('projects.subtitle')}
        actions={
          can('project:create') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('projects.new')}
            </Button>
          )
        }
      />
      <Card>
        {projects.isError ? (
          <div className="p-5">
            <ErrorState error={projects.error} />
          </div>
        ) : projects.isPending ? (
          <LoadingBlock />
        ) : projects.data.length === 0 ? (
          <EmptyState icon={<FolderKanban className="size-6" />} title={t('projects.empty')} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('projects.name')}</TH>
                <TH>{t('nav.servers')}</TH>
                <TH className="hidden md:table-cell">{t('projects.description')}</TH>
              </tr>
            </THead>
            <TBody>
              {projects.data.map((p) => (
                <TR key={p.id} onClick={() => navigate(`${base}/projects/${p.id}`)}>
                  <TD className="font-medium">
                    <span className="inline-flex items-center gap-2.5">
                      <FolderKanban className="size-4 text-muted" />
                      {p.name}
                    </span>
                  </TD>
                  <TD className="tabular">
                    {p.runningCount}/{p.serverCount} {t('status.running').toLowerCase()}
                  </TD>
                  <TD className="hidden text-muted md:table-cell">{p.description ?? '–'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <ProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export function ProjectPage() {
  const t = useT();
  const { projectId } = useParams();
  const { org, base } = useOrg();
  const navigate = useNavigate();
  const projects = useProjects(org.id);
  const servers = useServers(org.id, { projectId });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const project = projects.data?.find((p) => p.id === projectId);

  const remove = useApiMutation(() => api.del(`/projects/${projectId}`), {
    success: t('projects.deleted'),
    invalidate: [qk.projects(org.id)],
    onSuccess: () => navigate(`${base}/projects`),
  });

  if (projects.isPending) return <LoadingBlock />;
  if (!project) return <ErrorState error={new Error(t('projects.notFound'))} />;

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link to={`${base}/projects`} className="hover:text-text">
          {t('nav.projects')}
        </Link>{' '}
        / {project.name}
      </div>
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        actions={
          <>
            {project.permissions.includes('project:update') && (
              <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
            {project.permissions.includes('project:delete') && (
              <Button
                variant="danger-soft"
                icon={<Trash2 className="size-4" />}
                onClick={() => setDeleting(true)}
              >
                {t('common.delete')}
              </Button>
            )}
          </>
        }
      />
      <Card>
        {servers.isPending ? (
          <LoadingBlock />
        ) : servers.isError ? (
          <div className="p-5">
            <ErrorState error={servers.error} />
          </div>
        ) : servers.data.length === 0 ? (
          <EmptyState
            icon={<Server className="size-6" />}
            title={t('servers.empty.title')}
            description={t('servers.empty.project')}
          />
        ) : (
          <ServerTable
            servers={servers.data}
            showProject={false}
            linkFor={(s) => `${base}/servers/${s.id}`}
          />
        )}
      </Card>
      <ProjectDialog open={editing} onOpenChange={setEditing} project={project} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('projects.delete.title')}
        description={project.serverCount > 0 ? t('projects.delete.notEmpty') : t('projects.delete.text')}
        confirmLabel={t('common.delete')}
        confirmText={project.name}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </>
  );
}
