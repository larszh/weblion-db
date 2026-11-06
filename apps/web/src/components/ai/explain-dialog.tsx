import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import type { AiExplainResult, AiExplainSource, AiSeverity } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { useAiExplain, type AiScope } from '@/lib/api/ai';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Spinner } from '@/components/ui/primitives';
import { AiText, isConsolePath } from './ai-text';
import { AiErrorBox, AiFootnote, useAiAllowed } from './bits';

/**
 * "Mit KI erklären" (ai 10.1, 12.5): the dialog asks the explain route of the organization or of the admin
 * area once per opening and shows summary, cause, next steps and console links, with the footnote.
 */

const SEVERITY_TONE: Record<AiSeverity, 'info' | 'warning' | 'danger'> = {
  info: 'info',
  warning: 'warning',
  error: 'danger',
};

/** The result as it is shown; also rendered by the tests. */
export function ExplainResultView({ result }: { result: AiExplainResult }) {
  const { t } = useI18n();
  // The server drops links outside the console; the browser checks again (ai 11.3).
  const links = result.links.filter((link) => isConsolePath(link.path));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <Badge tone={SEVERITY_TONE[result.severity]}>{t(`ai.explain.severity.${result.severity}`)}</Badge>
      </div>
      <AiText text={result.summary} />
      {result.cause && (
        <section>
          <h4 className="mb-1 text-[13px] font-semibold text-text">{t('ai.explain.cause')}</h4>
          <AiText text={result.cause} />
        </section>
      )}
      {result.steps.length > 0 && (
        <section>
          <h4 className="mb-1 text-[13px] font-semibold text-text">{t('ai.explain.steps')}</h4>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {result.steps.map((step, i) => (
              <li key={i}>
                <AiText text={step} />
              </li>
            ))}
          </ol>
        </section>
      )}
      {links.length > 0 && (
        <section>
          <h4 className="mb-1 text-[13px] font-semibold text-text">{t('ai.explain.links')}</h4>
          <ul className="space-y-1 text-sm">
            {links.map((link) => (
              <li key={link.path}>
                <Link to={link.path} className="font-medium text-primary-text underline underline-offset-2">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <AiFootnote meta={result.meta} className="border-t border-border pt-3" />
    </div>
  );
}

/** Asks once per opening; source null closes the dialog. */
export function ExplainDialog({
  scope,
  source,
  onClose,
}: {
  scope: AiScope;
  source: AiExplainSource | null;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const explain = useAiExplain(scope);
  // StrictMode runs effects twice in development; the ref keeps it to one request per source.
  const asked = useRef<AiExplainSource | null>(null);
  const { mutate, reset } = explain;
  useEffect(() => {
    if (!source) {
      asked.current = null;
      return;
    }
    if (asked.current === source) return;
    asked.current = source;
    reset();
    mutate({ source, locale });
  }, [source, locale, mutate, reset]);

  return (
    <Dialog
      open={!!source}
      onOpenChange={(open) => !open && onClose()}
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="size-4 text-primary-text" aria-hidden />
          {t('ai.explain.title')}
        </span>
      }
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {explain.isPending ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner className="size-4" />
          {t('ai.explain.loading')}
        </div>
      ) : explain.isError ? (
        <AiErrorBox error={explain.error} onRetry={() => source && mutate({ source, locale })} />
      ) : explain.data ? (
        <ExplainResultView result={explain.data} />
      ) : null}
    </Dialog>
  );
}

/**
 * The "Erklären" button next to a failed row (audit, server action, monitor, website, provider, mail log).
 * Renders nothing unless the explain feature is available to the person (ai 12.5).
 */
export function ExplainButton({
  scope,
  source,
  short,
  className,
}: {
  scope: AiScope;
  /** Built lazily, so a list of rows creates no objects until a click. */
  source: () => AiExplainSource;
  short?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const allowed = useAiAllowed('explain', scope === 'admin' ? 'admin' : 'org');
  const [open, setOpen] = useState<AiExplainSource | null>(null);
  if (!allowed) return null;
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className={className}
        icon={<Sparkles className="size-3.5" aria-hidden />}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(source());
        }}
      >
        {short ? t('ai.explain.short') : t('ai.explain.button')}
      </Button>
      <ExplainDialog scope={scope} source={open} onClose={() => setOpen(null)} />
    </>
  );
}
