import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Braces, ChevronLeft, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Permission, PermissionDef, PolicyDto, PolicyStatement } from '@weblion/shared';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { formatRelative } from '@/lib/format';
import { qk, useApiMutation, useMeta, usePolicies, useProjects, useServers } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

export function PoliciesPage() {
  const { t, locale } = useI18n();
  const { org, base, can } = useOrg();
  const policies = usePolicies(org.id);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={t('nav.policies')}
        description={t('policies.subtitle')}
        actions={
          can('policy:write') && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => navigate(`${base}/policies/new`)}
            >
              {t('policies.new')}
            </Button>
          )
        }
      />
      <Notice tone="info" className="mb-6" icon={<ShieldCheck className="size-4" />}>
        {t('policies.explainer')}
      </Notice>
      <Card>
        {policies.isPending ? (
          <LoadingBlock />
        ) : policies.isError ? (
          <div className="p-5">
            <ErrorState error={policies.error} />
          </div>
        ) : policies.data.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="size-6" />}
            title={t('policies.empty')}
            description={t('policies.emptyText')}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('policies.name')}</TH>
                <TH>{t('policies.statements')}</TH>
                <TH>{t('policies.attached')}</TH>
                <TH className="hidden md:table-cell">{t('policies.updated')}</TH>
              </tr>
            </THead>
            <TBody>
              {policies.data.map((p) => (
                <TR key={p.id} onClick={() => navigate(`${base}/policies/${p.id}`)}>
                  <TD>
                    <div className="font-medium">{p.name}</div>
                    {p.description && <div className="text-xs text-muted">{p.description}</div>}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {p.statements.map((s, i) => (
                        <Badge key={i} tone={s.effect === 'allow' ? 'success' : 'danger'}>
                          {s.effect} · {s.actions.length}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TD className="tabular">{p.attachedCount}</TD>
                  <TD className="hidden text-muted md:table-cell">{formatRelative(p.updatedAt, locale)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}

const emptyStatement = (): PolicyStatement => ({ effect: 'allow', actions: [], resources: [] });

function templates(projectId: string | undefined): { key: TranslationKey; statements: PolicyStatement[] }[] {
  const p = projectId ?? '*';
  return [
    {
      key: 'policies.template.projectRead',
      statements: [
        { sid: 'Project', effect: 'allow', actions: ['project:read'], resources: [`project/${p}`] },
        {
          sid: 'Servers',
          effect: 'allow',
          actions: [
            'server:read',
            'server:metrics',
            'server:task:read',
            'server:backup:read',
            'server:snapshot:read',
            'server:network:read',
          ],
          resources: [`project/${p}/*`],
        },
      ],
    },
    {
      key: 'policies.template.projectOperate',
      statements: [
        { sid: 'Project', effect: 'allow', actions: ['project:read'], resources: [`project/${p}`] },
        {
          sid: 'Operate',
          effect: 'allow',
          actions: [
            'server:read',
            'server:metrics',
            'server:task:read',
            'server:power',
            'server:console',
            'server:backup:read',
            'server:backup:create',
            'server:snapshot:*',
          ],
          resources: [`project/${p}/*`],
        },
      ],
    },
    {
      key: 'policies.template.noConsole',
      statements: [
        { sid: 'NoConsole', effect: 'deny', actions: ['server:console', 'server:password-reset'] },
      ],
    },
    {
      key: 'policies.template.labelDev',
      statements: [
        { sid: 'DevServers', effect: 'allow', actions: ['server:*'], conditions: { labels: { env: 'dev' } } },
        { sid: 'NoDelete', effect: 'deny', actions: ['server:delete', 'server:rebuild'] },
      ],
    },
  ];
}

function ActionPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t, locale } = useI18n();
  const meta = useMeta();
  const [custom, setCustom] = useState('');
  if (!meta.data) return <LoadingBlock rows={1} />;
  const perms = Object.entries(meta.data.permissions) as [Permission, PermissionDef][];
  const groups = meta.data.permissionGroups.filter((g) => g !== 'platform');
  const patterns = value.filter((v) => v.includes('*'));
  const toggle = (p: string) => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => {
          const items = perms.filter(([, d]) => d.group === g && !d.platform);
          if (items.length === 0) return null;
          const all = items.every(([k]) => value.includes(k));
          return (
            <div key={g} className="rounded-lg border border-border p-3">
              <label className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--primary)]"
                  checked={all}
                  onChange={() =>
                    onChange(
                      all
                        ? value.filter((v) => !items.some(([k]) => k === v))
                        : [...new Set([...value, ...items.map(([k]) => k)])],
                    )
                  }
                />
                {t(`perm.group.${g}`)}
              </label>
              <div className="space-y-1">
                {items.map(([key, def]) => (
                  <label key={key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-3.5 accent-[var(--primary)]"
                      checked={value.includes(key)}
                      onChange={() => toggle(key)}
                    />
                    <span className={cn(def.dangerous && 'text-danger')}>
                      {def.label[locale]}
                      <Mono className="ml-1.5 text-[11px] text-subtle">{key}</Mono>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {patterns.map((p) => (
          <span
            key={p}
            className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 font-mono text-xs"
          >
            {p}
            <button onClick={() => toggle(p)} aria-label={t('common.remove')}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="server:backup:*"
          className="h-8 w-48 font-mono text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) {
              e.preventDefault();
              onChange([...new Set([...value, custom.trim()])]);
              setCustom('');
            }
          }}
          aria-label={t('policies.customPattern')}
        />
        <span className="text-xs text-subtle">{t('policies.customPatternHint')}</span>
      </div>
    </div>
  );
}

function ResourcePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  const { org } = useOrg();
  const projects = useProjects(org.id);
  const servers = useServers(org.id);
  const [custom, setCustom] = useState('');
  const [pick, setPick] = useState('');

  const describe = (pattern: string) => {
    const project = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? id.slice(0, 8);
    let m = /^project\/([^/]+)\/\*$/.exec(pattern);
    if (m)
      return t('policies.res.projectServers', {
        project: m[1] === '*' ? t('policies.res.any') : project(m[1]!),
      });
    m = /^project\/([^/]+)$/.exec(pattern);
    if (m)
      return t('policies.res.project', { project: m[1] === '*' ? t('policies.res.any') : project(m[1]!) });
    m = /^project\/([^/]+)\/server\/([^/]+)$/.exec(pattern);
    if (m)
      return t('policies.res.server', { server: servers.data?.find((s) => s.id === m![2])?.name ?? m[2]! });
    if (pattern === '*') return t('policies.res.all');
    return pattern;
  };

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-sm text-muted">{t('policies.res.allDefault')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {value.map((r) => (
            <span
              key={r}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs"
            >
              <span>{describe(r)}</span>
              <Mono className="text-subtle">{r}</Mono>
              <button onClick={() => onChange(value.filter((x) => x !== r))} aria-label={t('common.remove')}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="h-8 w-auto max-w-xs text-xs"
        >
          <option value="">{t('policies.res.add')}</option>
          <optgroup label={t('nav.projects')}>
            {projects.data?.map((p) => (
              <option key={`p${p.id}`} value={`both:${p.id}`}>
                {t('policies.res.projectAndServers', { project: p.name })}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('nav.servers')}>
            {servers.data
              ?.filter((s) => s.project)
              .map((s) => (
                <option key={s.id} value={`project/${s.project!.id}/server/${s.id}`}>
                  {s.name}
                </option>
              ))}
          </optgroup>
        </Select>
        <Button
          size="sm"
          disabled={!pick}
          onClick={() => {
            const add = pick.startsWith('both:')
              ? [`project/${pick.slice(5)}`, `project/${pick.slice(5)}/*`]
              : [pick];
            onChange([...new Set([...value, ...add])]);
            setPick('');
          }}
        >
          {t('common.add')}
        </Button>
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="project/*/server/*"
          className="h-8 w-52 font-mono text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) {
              e.preventDefault();
              onChange([...new Set([...value, custom.trim()])]);
              setCustom('');
            }
          }}
          aria-label={t('policies.customPattern')}
        />
      </div>
    </div>
  );
}

function LabelConditions({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {Object.entries(value).map(([key, val]) => (
          <span
            key={key}
            className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 font-mono text-xs"
          >
            {key}={val}
            <button
              onClick={() => {
                const next = { ...value };
                delete next[key];
                onChange(next);
              }}
              aria-label={t('common.remove')}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {Object.keys(value).length === 0 && (
          <span className="text-sm text-muted">{t('policies.noConditions')}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={k}
          onChange={(e) => setK(e.target.value)}
          placeholder="env"
          className="h-8 w-32 font-mono text-xs"
          aria-label="Label key"
        />
        <span className="text-subtle">=</span>
        <Input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="prod"
          className="h-8 w-32 font-mono text-xs"
          aria-label="Label value"
        />
        <Button
          size="sm"
          disabled={!k.trim()}
          onClick={() => {
            onChange({ ...value, [k.trim()]: v.trim() });
            setK('');
            setV('');
          }}
        >
          {t('common.add')}
        </Button>
      </div>
    </div>
  );
}

export function PolicyEditorPage() {
  const { t } = useI18n();
  const { policyId } = useParams();
  const { org, base, can } = useOrg();
  const navigate = useNavigate();
  const policies = usePolicies(org.id);
  const projects = useProjects(org.id);
  const isNew = policyId === 'new';
  const existing = policies.data?.find((p) => p.id === policyId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [statements, setStatements] = useState<PolicyStatement[]>([emptyStatement()]);
  const [jsonMode, setJsonMode] = useState(false);
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const readOnly = !can('policy:write');

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDescription(existing.description ?? '');
      setStatements(existing.statements);
    }
  }, [existing]);

  const effective = useMemo(() => {
    if (!jsonMode) return statements;
    try {
      return JSON.parse(json) as PolicyStatement[];
    } catch {
      return null;
    }
  }, [jsonMode, json, statements]);

  const save = useApiMutation(
    () => {
      const body = { name, description: description || null, statements: effective };
      return isNew
        ? api.post<PolicyDto>(`/orgs/${org.id}/policies`, body)
        : api.patch<PolicyDto>(`/orgs/${org.id}/policies/${policyId}`, body);
    },
    {
      success: t('common.saved'),
      invalidate: [qk.policies(org.id), qk.members(org.id)],
      onSuccess: (p) => isNew && navigate(`${base}/policies/${p.id}`, { replace: true }),
    },
  );
  const remove = useApiMutation(() => api.del(`/orgs/${org.id}/policies/${policyId}`), {
    success: t('policies.deleted'),
    invalidate: [qk.policies(org.id)],
    onSuccess: () => navigate(`${base}/policies`),
  });

  if (!isNew && policies.isPending) return <LoadingBlock />;
  if (!isNew && !existing) return <ErrorState error={new Error(t('policies.notFound'))} />;

  const update = (i: number, patch: Partial<PolicyStatement>) =>
    setStatements(statements.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <>
      <Link
        to={`${base}/policies`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.policies')}
      </Link>
      <PageHeader
        title={isNew ? t('policies.new') : name || existing?.name}
        actions={
          <>
            <Button
              icon={<Braces className="size-4" />}
              onClick={() => {
                if (!jsonMode) {
                  setJson(JSON.stringify(statements, null, 2));
                  setJsonError(null);
                } else {
                  try {
                    setStatements(JSON.parse(json) as PolicyStatement[]);
                  } catch (err) {
                    setJsonError(errorMessage(err));
                    return;
                  }
                }
                setJsonMode(!jsonMode);
              }}
            >
              {jsonMode ? t('policies.visual') : 'JSON'}
            </Button>
            {!isNew && can('policy:write') && (
              <Button
                variant="danger-soft"
                icon={<Trash2 className="size-4" />}
                onClick={() => setDeleting(true)}
              >
                {t('common.delete')}
              </Button>
            )}
            {!readOnly && (
              <Button
                variant="primary"
                disabled={!name.trim() || !effective}
                loading={save.isPending}
                onClick={() => save.mutate(undefined)}
              >
                {t('common.save')}
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-6">
        <Card>
          <CardBody className="grid gap-4 md:grid-cols-2">
            <Field label={t('policies.name')} htmlFor="pol-name">
              <Input
                id="pol-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={readOnly}
                maxLength={80}
              />
            </Field>
            <Field label={t('projects.description')} htmlFor="pol-desc">
              <Input
                id="pol-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={readOnly}
                maxLength={500}
              />
            </Field>
          </CardBody>
        </Card>

        {isNew && (
          <Card>
            <CardHeader title={t('policies.templates')} description={t('policies.templatesText')} />
            <CardBody className="flex flex-wrap gap-2">
              {templates(projects.data?.[0]?.id).map((tpl) => (
                <Button
                  key={tpl.key}
                  size="sm"
                  onClick={() => {
                    setStatements(tpl.statements);
                    if (!name) setName(t(tpl.key));
                    setJsonMode(false);
                  }}
                >
                  {t(tpl.key)}
                </Button>
              ))}
            </CardBody>
          </Card>
        )}

        {jsonMode ? (
          <Card>
            <CardHeader title="JSON" description={t('policies.jsonText')} />
            <CardBody>
              <Textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                rows={22}
                className="font-mono text-xs"
                spellCheck={false}
                disabled={readOnly}
              />
              {(jsonError || !effective) && (
                <p className="mt-2 text-xs text-danger">{jsonError ?? t('policies.jsonInvalid')}</p>
              )}
            </CardBody>
          </Card>
        ) : (
          <>
            {statements.map((s, i) => (
              <Card
                key={i}
                className={cn('border-l-4', s.effect === 'allow' ? 'border-l-success' : 'border-l-danger')}
              >
                <CardHeader
                  title={
                    <span className="flex items-center gap-3">
                      {t('policies.statement', { n: i + 1 })}
                      <span className="inline-flex rounded-lg border border-border p-0.5">
                        {(['allow', 'deny'] as const).map((e) => (
                          <button
                            key={e}
                            disabled={readOnly}
                            onClick={() => update(i, { effect: e })}
                            className={cn(
                              'rounded-md px-2.5 py-0.5 text-xs font-medium',
                              s.effect === e
                                ? e === 'allow'
                                  ? 'bg-success text-white'
                                  : 'bg-danger text-white'
                                : 'text-muted',
                            )}
                          >
                            {t(`policies.effect.${e}`)}
                          </button>
                        ))}
                      </span>
                    </span>
                  }
                  actions={
                    !readOnly &&
                    statements.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setStatements(statements.filter((_, j) => j !== i))}
                        aria-label={t('common.remove')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )
                  }
                />
                <CardBody className="space-y-5">
                  <div>
                    <h4 className="mb-2 text-sm font-semibold">{t('policies.actions')}</h4>
                    <ActionPicker value={s.actions} onChange={(actions) => update(i, { actions })} />
                  </div>
                  <div>
                    <h4 className="mb-2 text-sm font-semibold">{t('policies.resources')}</h4>
                    <ResourcePicker
                      value={s.resources ?? []}
                      onChange={(resources) => update(i, { resources })}
                    />
                  </div>
                  <div>
                    <h4 className="mb-2 text-sm font-semibold">{t('policies.conditions')}</h4>
                    <LabelConditions
                      value={s.conditions?.labels ?? {}}
                      onChange={(labels) =>
                        update(i, { conditions: Object.keys(labels).length ? { labels } : undefined })
                      }
                    />
                  </div>
                </CardBody>
              </Card>
            ))}
            {!readOnly && (
              <Button
                icon={<Plus className="size-4" />}
                onClick={() => setStatements([...statements, emptyStatement()])}
              >
                {t('policies.addStatement')}
              </Button>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('policies.deleteTitle', { name: existing?.name ?? '' })}
        description={
          existing?.attachedCount ? t('policies.deleteAttached', { n: existing.attachedCount }) : undefined
        }
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </>
  );
}
