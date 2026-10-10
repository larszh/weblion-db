import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CopyButton, Mono, Notice } from '@/components/ui/primitives';

/**
 * A password that was just generated (root password reset, Hetzner rebuild, cloud accounts).
 * Shown once: the console never stores it. `password: null` means the provider returned none.
 * `title` replaces the root password title, `children` (e.g. the login name) goes above it.
 */
export function NewPasswordDialog({
  result,
  onClose,
  title,
  children,
}: {
  result: { password: string | null } | null;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Dialog
      open={!!result}
      onOpenChange={(o) => !o && onClose()}
      title={title ?? t('password.newTitle')}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common.done')}
        </Button>
      }
    >
      {children}
      {result?.password ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
            <Mono className="text-base break-all text-text">{result.password}</Mono>
            <CopyButton value={result.password} />
          </div>
          <Notice tone="warning">{t('password.newText')}</Notice>
        </div>
      ) : (
        <Notice tone="info">{t('password.none')}</Notice>
      )}
    </Dialog>
  );
}
