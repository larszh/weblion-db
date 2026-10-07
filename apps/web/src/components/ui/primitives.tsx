import {
  forwardRef,
  useState,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, Check, Copy, Inbox, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/api';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface shadow-card', className)} {...props} />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-text">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted',
  primary: 'bg-primary-soft text-primary-text',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-[#0a8d90] dark:text-brand-teal',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-subtle',
        'focus:border-ring focus:ring-2 focus:ring-ring/25 focus:outline-none disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-subtle',
          'focus:border-ring focus:ring-2 focus:ring-ring/25 focus:outline-none',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 text-sm text-text',
        'focus:border-ring focus:ring-2 focus:ring-ring/25 focus:outline-none disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-text">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-muted', className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-3', className)} />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-surface-3 text-muted">
        {icon ?? <Inbox className="size-6" />}
      </div>
      <p className="text-[15px] font-semibold text-text">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
      role="alert"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{errorMessage(error)}</div>
      {onRetry && (
        <button className="shrink-0 font-medium underline underline-offset-2" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
  icon,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'border-brand-blue/30 bg-primary-soft text-primary-text',
    warning: 'border-warning/30 bg-warning-soft text-warning',
    danger: 'border-danger/30 bg-danger-soft text-danger',
    success: 'border-success/30 bg-success-soft text-success',
  }[tone];
  return (
    <div className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', styles, className)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}

export function CopyButton({
  value,
  className,
  label,
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 rounded p-1 text-subtle hover:bg-surface-3 hover:text-text',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={label ?? t('common.copy')}
      title={label ?? t('common.copy')}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function UsageBar({
  value,
  className,
  tone,
}: {
  value: number | null | undefined;
  className?: string;
  tone?: 'auto' | 'primary';
}) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const color =
    tone === 'primary' ? 'bg-brand-blue' : pct > 90 ? 'bg-danger' : pct > 75 ? 'bg-warning' : 'bg-brand-teal';
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div className={cn('h-full rounded-full transition-[width]', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KeyValue({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn('divide-y divide-border', className)}>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-[minmax(110px,40%)_1fr] gap-3 py-2.5 text-sm">
          <dt className="text-muted">{item.label}</dt>
          <dd className="min-w-0 break-words text-text">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{eyebrow}</div>
        )}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12.5px]', className)}>{children}</span>;
}
