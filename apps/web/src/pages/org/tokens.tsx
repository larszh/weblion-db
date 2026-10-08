import { useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import type { ApiTokenDto, TokenScope } from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { formatDate, formatRelative } from '@/lib/format';
import { qk, useApiMutation, useTokens } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';

function CreateTokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { org } = useOrg();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Exclude<TokenScope, 'custom'>>('read');
  const [expires, setExpires] = useState('90');
  const [created, setCreated] = useState<ApiTokenDto | null>(null);
  const create = useApiMutation(
    () =>
      api.post<ApiTokenDto>(`/orgs/${org.id}/tokens`, {
        name,
        scope,
        expiresInDays: expires ? Number(expires) : null,
      }),
    { invalidate: [qk.tokens(org.id)], onSuccess: (tok) => setCreated(tok) },
  );
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setCreated(null);
      setName('');
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('tokens.create')}
      description={created ? undefined : t('tokens.createText')}
      footer={
        created ? (
          <Button variant="primary" onClick={() => close(false)}>
            {t('common.done')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              loading={create.isPending}
              onClick={() => create.mutate(undefined)}
            >
              {t('tokens.create')}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3">
          <Notice tone="warning" title={t('tokens.copyNow')}>
            {t('tokens.copyNowText')}
          </Notice>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
            <Mono className="min-w-0 flex-1 break-all">{created.token}</Mono>
            <CopyButton value={created.token ?? ''} />
          </div>
          <p className="text-xs text-muted">{t('tokens.usage')}</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
            {`curl -H "Authorization: Bearer ${created.token?.slice(0, 16)}…" \\\n  ${window.location.origin}/api/v1/orgs/${org.id}/servers`}
          </pre>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('tokens.name')} htmlFor="tok-name">
            <Input
              id="tok-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Terraform, CI, Monitoring…"
              autoFocus
            />
          </Field>
          <Field label={t('tokens.scope')} htmlFor="tok-scope" hint={t(`tokens.scope.${scope}.hint`)}>
            <Select
              id="tok-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'read' | 'read_write')}
            >
              <option value="read">{t('tokens.scope.read')}</option>
              <option value="read_write">{t('tokens.scope.read_write')}</option>
            </Select>
          </Field>
          <Field label={t('tokens.expires')} htmlFor="tok-exp">
            <Select id="tok-exp" value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="30">30 {t('common.days')}</option>
              <option value="90">90 {t('common.days')}</option>
              <option value="365">365 {t('common.days')}</option>
              <option value="">{t('tokens.never')}</option>
            </Select>
          </Field>
        </div>
      )}
    </Dialog>
  );
}

export function TokensPage() {
  const { t, locale } = useI18n();
  const { org, can } = useOrg();
  const tokens = useTokens(org.id);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiTokenDto | null>(null);
  const revoke = useApiMutation((tok: ApiTokenDto) => api.del(`/orgs/${org.id}/tokens/${tok.id}`), {
    success: t('tokens.revoked'),
    invalidate: [qk.tokens(org.id)],
    onSuccess: () => setRevoking(null),
  });

  return (
    <>
      <PageHeader
        title={t('nav.tokens')}
        description={t('tokens.subtitle')}
        actions={
          can('apitoken:write') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('tokens.create')}
            </Button>
          )
        }
      />
      <Card>
        {tokens.isPending ? (
          <LoadingBlock />
        ) : tokens.isError ? (
          <div className="p-5">
            <ErrorState error={tokens.error} />
          </div>
        ) : tokens.data.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="size-6" />}
            title={t('tokens.empty')}
            description={t('tokens.emptyText')}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('tokens.name')}</TH>
                <TH>{t('tokens.scope')}</TH>
                <TH className="hidden md:table-cell">{t('tokens.owner')}</TH>
                <TH className="hidden lg:table-cell">{t('tokens.lastUsed')}</TH>
                <TH className="hidden lg:table-cell">{t('tokens.expires')}</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {tokens.data.map((tok) => (
                <tr key={tok.id}>
                  <TD>
                    <div className="font-medium">{tok.name}</div>
                    <Mono className="text-subtle">{tok.prefix}…</Mono>
                  </TD>
                  <TD>
                    <Badge tone={tok.scope === 'read' ? 'neutral' : 'warning'}>
                      {t(`tokens.scope.${tok.scope}`)}
                    </Badge>
                  </TD>
                  <TD className="hidden text-muted md:table-cell">{tok.user.name}</TD>
                  <TD className="hidden text-muted lg:table-cell">
                    {tok.lastUsedAt ? formatRelative(tok.lastUsedAt, locale) : t('tokens.neverUsed')}
                  </TD>
                  <TD className="hidden text-muted lg:table-cell">
                    {tok.expiresAt ? formatDate(tok.expiresAt, locale, false) : t('tokens.never')}
                  </TD>
                  <TD className="text-right">
                    {can('apitoken:write') && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setRevoking(tok)}
                        aria-label={t('tokens.revoke')}
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
      <CreateTokenDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('tokens.revokeTitle', { name: revoking?.name ?? '' })}
        description={t('tokens.revokeText')}
        confirmLabel={t('tokens.revoke')}
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </>
  );
}
