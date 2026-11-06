import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  LOCALE_META,
  TARGET_LOCALES,
  type GlossaryEntryDto,
  type GlossaryInput,
  type TargetLocale,
} from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import {
  useDeleteGlossaryTerm,
  useGlossary,
  useSaveGlossaryTerm,
  useSaveStyleNotes,
  useStyleNotes,
} from '@/lib/api/i18n';
import { Flag } from '@/components/server-bits';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Textarea,
} from '@/components/ui/primitives';

/**
 * The glossary tab (i18n 17.1): the binding terms for AI translations and the checks, and the admin's style
 * notes per language below the read-only defaults. Built-in terms can be edited, never deleted.
 */

export function GlossaryTab({ canWrite }: { canWrite: boolean }) {
  const { t } = useI18n();
  const glossary = useGlossary();
  const [editing, setEditing] = useState<GlossaryEntryDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GlossaryEntryDto | null>(null);
  const remove = useDeleteGlossaryTerm();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={t('admin.i18n.tab.glossary')}
          description={t('admin.i18n.glossary.hint')}
          actions={
            canWrite ? (
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() => setEditing('new')}
              >
                {t('admin.i18n.glossary.add')}
              </Button>
            ) : undefined
          }
        />
        {glossary.isLoading ? (
          <LoadingBlock />
        ) : glossary.isError ? (
          <CardBody>
            <ErrorState error={glossary.error} onRetry={() => void glossary.refetch()} />
          </CardBody>
        ) : (
          <>
            {glossary.data && !glossary.data.some((g) => !g.builtIn) && (
              <p className="px-5 pt-4 text-sm text-muted">{t('admin.i18n.glossary.empty')}</p>
            )}
            <ul className="divide-y divide-border">
              {(glossary.data ?? []).map((term) => (
                <li key={term.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium break-words text-text">{term.term}</span>
                      {term.keep && <Badge tone="primary">{t('admin.i18n.glossary.keep')}</Badge>}
                      {term.builtIn && <Badge tone="neutral">{t('admin.i18n.glossary.builtIn')}</Badge>}
                    </div>
                    {!term.keep && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                        {TARGET_LOCALES.filter((l) => term.translations[l]).map((l) => (
                          <span key={l} className="inline-flex min-w-0 items-center gap-1.5">
                            <Flag country={LOCALE_META[l].flag} decorative />
                            <span className="break-words">{term.translations[l]}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {term.note && <p className="text-xs break-words text-subtle">{term.note}</p>}
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-11 sm:size-8"
                        aria-label={t('common.edit')}
                        title={t('common.edit')}
                        onClick={() => setEditing(term)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      {!term.builtIn && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-11 sm:size-8"
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                          onClick={() => setDeleting(term)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <StyleNotesCard canWrite={canWrite} />

      {editing && (
        <GlossaryDialog term={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('admin.i18n.glossary.deleteTitle')}
        description={deleting ? t('admin.i18n.glossary.deleteText', { term: deleting.term }) : undefined}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}

function GlossaryDialog({ term, onClose }: { term: GlossaryEntryDto | null; onClose: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(term?.term ?? '');
  const [keep, setKeep] = useState(term?.keep ?? false);
  const [translations, setTranslations] = useState<Partial<Record<TargetLocale, string>>>(
    term?.translations ?? {},
  );
  const [note, setNote] = useState(term?.note ?? '');
  const save = useSaveGlossaryTerm(t('admin.i18n.glossary.saved'));

  const submit = () => {
    const cleaned: Partial<Record<TargetLocale, string>> = {};
    for (const l of TARGET_LOCALES) {
      const text = translations[l]?.trim();
      if (text) cleaned[l] = text;
    }
    // A default term keeps its term (the start seeds it by name): its field is read-only.
    const input: GlossaryInput = {
      term: value.trim(),
      keep,
      translations: cleaned,
      note: note.trim() || null,
    };
    save.mutate({ id: term?.id, input }, { onSuccess: onClose });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={term ? term.term : t('admin.i18n.glossary.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!value.trim()} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('admin.i18n.glossary.term')} htmlFor="glossary-term">
          <Input
            id="glossary-term"
            value={value}
            maxLength={100}
            disabled={term?.builtIn}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            className="size-4 accent-brand-blue"
            checked={keep}
            onChange={(e) => setKeep(e.target.checked)}
          />
          {t('admin.i18n.glossary.keep')}
        </label>
        {!keep && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TARGET_LOCALES.map((l) => (
              <Field
                key={l}
                htmlFor={`glossary-${l}`}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <Flag country={LOCALE_META[l].flag} decorative />
                    {LOCALE_META[l].native}
                  </span>
                }
              >
                <Input
                  id={`glossary-${l}`}
                  value={translations[l] ?? ''}
                  maxLength={100}
                  onChange={(e) => setTranslations((prev) => ({ ...prev, [l]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
        )}
        <Field label={t('admin.i18n.glossary.note')} htmlFor="glossary-note">
          <Input id="glossary-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function StyleNotesCard({ canWrite }: { canWrite: boolean }) {
  const { t } = useI18n();
  const style = useStyleNotes();
  return (
    <Card>
      <CardHeader title={t('admin.i18n.style.title')} description={t('admin.i18n.style.hint')} />
      {style.isLoading ? (
        <LoadingBlock rows={2} />
      ) : style.isError ? (
        <CardBody>
          <ErrorState error={style.error} onRetry={() => void style.refetch()} />
        </CardBody>
      ) : (
        <div className="divide-y divide-border">
          {TARGET_LOCALES.map((l) => (
            <StyleNotesRow
              key={l}
              locale={l}
              defaults={style.data?.defaults[l] ?? ''}
              notes={style.data?.notes[l] ?? ''}
              canWrite={canWrite}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function StyleNotesRow({
  locale,
  defaults,
  notes,
  canWrite,
}: {
  locale: TargetLocale;
  defaults: string;
  notes: string;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(notes);
  const save = useSaveStyleNotes(t('admin.i18n.style.saved'));
  return (
    <div className="space-y-2 px-5 py-4">
      <div className="inline-flex items-center gap-1.5 text-sm font-medium text-text">
        <Flag country={LOCALE_META[locale].flag} decorative />
        {LOCALE_META[locale].native}
      </div>
      <p className="text-xs text-muted">
        <span className="font-medium">{t('admin.i18n.style.defaults')}:</span> {defaults}
      </p>
      <Textarea
        aria-label={`${t('admin.i18n.style.title')} (${LOCALE_META[locale].native})`}
        rows={3}
        maxLength={2_000}
        value={draft}
        readOnly={!canWrite}
        onChange={(e) => setDraft(e.target.value)}
      />
      {canWrite && (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={draft === notes}
            loading={save.isPending}
            onClick={() => save.mutate({ locale, notes: draft })}
          >
            {t('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}
