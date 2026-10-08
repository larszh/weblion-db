import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import type { MeDto } from '@weblion/shared';
import { api, errorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { qk, useMe } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ErrorState, Field, Input } from '@/components/ui/primitives';
import { Flag } from '@/components/server-bits';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#0d1726] lg:block">
        <div className="absolute -top-40 -left-40 size-[520px] rounded-full bg-brand-teal/20 blur-3xl" />
        <div className="absolute -right-32 -bottom-48 size-[560px] rounded-full bg-brand-blue/25 blur-3xl" />
        <div className="absolute top-1/2 left-1/3 size-[280px] rounded-full bg-brand-coral/15 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <img src="/logo-mark.png" alt="" className="h-12 w-auto self-start" />
          <div className="max-w-md">
            <h1 className="font-display text-4xl leading-tight font-semibold">{t('login.hero.title')}</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-white/70">{t('login.hero.text')}</p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm text-white/80">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5">
                <Flag country="DE" /> {t('login.hero.de')}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5">
                <Flag country="CH" /> {t('login.hero.ch')}
              </span>
            </div>
          </div>
          <p className="text-xs text-white/40">© {new Date().getFullYear()} weblion.one</p>
        </div>
      </div>
      <div className="flex flex-col bg-surface">
        <div className="flex justify-end p-4">
          <button
            className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-3"
            onClick={() => setLocale(locale === 'de' ? 'en' : 'de')}
          >
            {locale === 'de' ? 'English' : 'Deutsch'}
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm">
            <img src="/logo-horizontal.png" alt="weblion.one" className="mb-10 h-8 w-auto" />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'mfa'>(me.data?.mfaPending ? 'mfa' : 'password');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (me.data && !me.data.mfaPending) return <Navigate to={target} replace />;

  const finish = (data: MeDto) => {
    qc.setQueryData(qk.me, data);
    navigate(target, { replace: true });
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<MeDto | { mfaRequired: true }>('/auth/login', { email, password });
      if ('mfaRequired' in res) setStep('mfa');
      else finish(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      finish(await api.post<MeDto>('/auth/login/mfa', { code }));
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      {step === 'password' ? (
        <form onSubmit={submitPassword} className="space-y-5">
          <div>
            <h2 className="font-display text-2xl font-semibold text-text">{t('login.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('login.subtitle')}</p>
          </div>
          {error && <ErrorState error={new Error(error)} />}
          <Field label={t('login.email')} htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label={t('login.password')} htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy}>
            {t('login.submit')}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-5">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-text">{t('login.mfa.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('login.mfa.subtitle')}</p>
          </div>
          {error && <ErrorState error={new Error(error)} />}
          <Field label={t('login.mfa.code')} htmlFor="code">
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="text-center font-mono text-lg tracking-[0.4em]"
              autoFocus
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy}>
            {t('login.mfa.submit')}
          </Button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
            onClick={() => {
              void api.post('/auth/logout').finally(() => {
                qc.removeQueries({ queryKey: qk.me });
                setStep('password');
                setError(null);
              });
            }}
          >
            <ArrowLeft className="size-4" /> {t('login.mfa.back')}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
