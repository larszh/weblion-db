import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import type { InvitationInfoDto } from '@weblion/shared';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { qk, useMe } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import { ErrorState, Field, Input, Spinner } from '@/components/ui/primitives';
import { AuthLayout } from './login';

export function InvitePage() {
  const { token } = useParams();
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<InvitationInfoDto>(`/auth/invitations/${token}`),
    retry: false,
  });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ orgSlug: string }>(
        `/auth/invitations/${token}/accept`,
        info.data?.userExists ? {} : { name, password },
      );
      await qc.invalidateQueries({ queryKey: qk.me });
      navigate(`/o/${res.orgSlug}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const signedInAsInvitee =
    me.data &&
    !me.data.mfaPending &&
    info.data &&
    me.data.user.email.toLowerCase() === info.data.email.toLowerCase();

  return (
    <AuthLayout>
      {info.isPending ? (
        <Spinner />
      ) : info.isError || !info.data ? (
        <div className="space-y-4">
          <h2 className="font-display text-2xl font-semibold">{t('invite.invalid.title')}</h2>
          <p className="text-sm text-muted">{t('invite.invalid.text')}</p>
          <Link to="/login" className="text-sm font-medium text-primary-text hover:underline">
            {t('invite.toLogin')}
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
            <MailCheck className="size-6" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-text">
              {t('invite.title', { org: info.data.orgName })}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t('invite.subtitle', {
                email: info.data.email,
                role: t(`role.${info.data.role}` as TranslationKey),
              })}
            </p>
          </div>
          {error && <ErrorState error={new Error(error)} />}
          {info.data.userExists ? (
            signedInAsInvitee ? (
              <Button
                variant="primary"
                size="lg"
                className="w-full justify-center"
                loading={busy}
                onClick={() => void accept()}
              >
                {t('invite.accept')}
              </Button>
            ) : (
              <div className="space-y-3 text-sm text-muted">
                <p>{t('invite.signInFirst')}</p>
                <Link
                  to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                  className="inline-flex h-10 items-center rounded-lg bg-primary px-4 font-medium text-white hover:bg-primary-hover"
                >
                  {t('invite.toLogin')}
                </Link>
              </div>
            )
          ) : (
            <form onSubmit={accept} className="space-y-4">
              <Field label={t('invite.name')} htmlFor="name">
                <Input
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  autoFocus
                />
              </Field>
              <Field label={t('invite.password')} hint={t('invite.passwordHint')} htmlFor="password">
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full justify-center"
                loading={busy}
              >
                {t('invite.create')}
              </Button>
            </form>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
