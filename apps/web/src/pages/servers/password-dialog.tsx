import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CopyButton, Mono, Notice } from '@/components/ui/primitives';

/**
 * A root password the provider just generated (password reset, Hetzner rebuild). Shown once:
 * the console never stores it. `password: null` means the provider returned none.
 */
export function NewPasswordDialog({
  result,
  onClose,
}: {
  result: { password: string | null } | null;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={!!result}
      onOpenChange={(o) => !o && onClose()}
      title={t('password.newTitle')}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common.done')}
        </Button>
      }
    >
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
