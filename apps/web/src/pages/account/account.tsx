import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Laptop, ShieldCheck, ShieldOff } from 'lucide-react';
import type { MeDto } from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatRelative } from '@/lib/format';
import { qk, useApiMutation, useMe, useSessions } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';

function MfaCard({ me }: { me: MeDto }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');

  const start = useApiMutation(() => api.post<{ secret: string; qr: string }>('/auth/mfa/setup'), {
    onSuccess: setSetup,
  });
  const enable = useApiMutation(() => api.post('/auth/mfa/enable', { code }), {
    success: t('account.mfa.enabled'),
    onSuccess: () => {
      setSetup(null);
      setCode('');
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
  const disable = useApiMutation(() => api.post('/auth/mfa/disable', { password }), {
    success: t('account.mfa.disabled'),
    onSuccess: () => {
      setDisabling(false);
      setPassword('');
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });

  return (
    <Card>
      <CardHeader
        title={t('account.mfa.title')}
        description={t('account.mfa.text')}
        actions={
          me.user.mfaEnabled ? (
            <Badge tone="success">{t('account.mfa.active')}</Badge>
          ) : (
            <Badge tone="warning">{t('account.mfa.inactive')}</Badge>
          )
        }
      />
      <CardBody>
        {me.user.mfaEnabled ? (
          <Button
            variant="danger-soft"
            icon={<ShieldOff className="size-4" />}
            onClick={() => setDisabling(true)}
          >
            {t('account.mfa.disable')}
          </Button>
        ) : setup ? (
          <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
            <img
              src={setup.qr}
              alt={t('account.mfa.qr')}
              className="size-[220px] rounded-lg border border-border bg-white p-2"
            />
            <div className="space-y-3">
              <p className="text-sm text-muted">{t('account.mfa.scan')}</p>
              <div className="text-xs text-muted">
                {t('account.mfa.manual')} <Mono className="break-all text-text">{setup.secret}</Mono>
              </div>
              <Field label={t('login.mfa.code')} htmlFor="mfa-code">
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-40 font-mono tracking-widest"
                />
              </Field>
              <Button
                variant="primary"
                disabled={code.replace(/\s/g, '').length !== 6}
                loading={enable.isPending}
                onClick={() => enable.mutate(undefined)}
              >
                {t('account.mfa.confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="primary"
            icon={<ShieldCheck className="size-4" />}
            loading={start.isPending}
            onClick={() => start.mutate(undefined)}
          >
            {t('account.mfa.setup')}
          </Button>
        )}
      </CardBody>
      <Dialog
        open={disabling}
        onOpenChange={setDisabling}
        title={t('account.mfa.disable')}
        description={t('account.mfa.disableText')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisabling(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!password}
              loading={disable.isPending}
              onClick={() => disable.mutate(undefined)}
            >
              {t('account.mfa.disable')}
            </Button>
          </>
        }
      >
        <Field label={t('login.password')} htmlFor="mfa-pw">
          <Input
            id="mfa-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
      </Dialog>
    </Card>
  );
}

export function AccountPage() {
  const { t, locale, setLocale } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const sessions = useSessions();
  const [name, setName] = useState(me.data?.user.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  const profile = useApiMutation((body: object) => api.patch<MeDto>('/auth/me', body), {
    success: t('common.saved'),
    onSuccess: (data) => qc.setQueryData(qk.me, data),
  });
  const password = useApiMutation(
    () => api.post('/auth/password', { currentPassword: current, newPassword: next }),
    {
      success: t('account.password.changed'),
      invalidate: [['sessions']],
      onSuccess: () => {
        setCurrent('');
        setNext('');
      },
    },
  );
  const revoke = useApiMutation((id: string) => api.del(`/auth/sessions/${id}`), {
    success: t('account.sessions.revoked'),
    invalidate: [['sessions']],
  });

  if (!me.data) return <LoadingBlock />;

  return (
    <>
      <PageHeader title={t('nav.account')} description={me.data.user.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('account.profile')} />
          <CardBody className="space-y-4">
            <Field label={t('invite.name')} htmlFor="acc-name">
              <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('account.language')} htmlFor="acc-lang">
              <Select
                id="acc-lang"
                value={locale}
                onChange={(e) => {
                  const l = e.target.value as 'de' | 'en';
                  setLocale(l);
                  profile.mutate({ locale: l });
                }}
              >
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Button
              variant="primary"
              disabled={!name.trim() || name === me.data.user.name}
              loading={profile.isPending}
              onClick={() => profile.mutate({ name })}
            >
              {t('common.save')}
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('account.password.title')} />
          <CardBody className="space-y-4">
            <Field label={t('account.password.current')} htmlFor="pw-cur">
              <Input
                id="pw-cur"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label={t('account.password.new')} hint={t('invite.passwordHint')} htmlFor="pw-new">
              <Input
                id="pw-new"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                minLength={10}
              />
            </Field>
            <Button
              variant="primary"
              disabled={!current || next.length < 10}
              loading={password.isPending}
              onClick={() => password.mutate(undefined)}
            >
              {t('account.password.change')}
            </Button>
          </CardBody>
        </Card>

        <div className="lg:col-span-2">
          <MfaCard me={me.data} />
        </div>

        <Card className="lg:col-span-2">
          <CardHeader title={t('account.sessions.title')} description={t('account.sessions.text')} />
          {sessions.isPending ? (
            <LoadingBlock rows={2} />
          ) : (
            <ul className="divide-y divide-border">
              {sessions.data?.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Laptop className="size-4 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{s.userAgent ?? '–'}</div>
                    <div className="text-xs text-muted">
                      {s.ip ?? '–'} ·{' '}
                      {t('account.sessions.lastSeen', { when: formatRelative(s.lastSeenAt, locale) })}
                    </div>
                  </div>
                  {s.current ? (
                    <Badge tone="success">{t('account.sessions.current')}</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                      {t('account.sessions.revoke')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {me.data.platformPermissions.length > 0 && !me.data.user.mfaEnabled && (
          <Notice tone="warning" className="lg:col-span-2">
            {t('account.mfa.staffHint')}
          </Notice>
        )}
      </div>
    </>
  );
}
