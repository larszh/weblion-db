import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  PHONE_LANGUAGES,
  type PhoneRingGroup,
  type PhoneSystemDto,
  type PhoneUserDto,
  type PhoneUserListDto,
} from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/queries';
import {
  fetchNextPhoneNumber,
  useAddRingGroupMember,
  useCreatePhoneUser,
  useDeletePhoneUser,
  useRemoveRingGroupMember,
  useRenamePhoneSystem,
  useSendPhoneWelcome,
  useUpdatePhoneUser,
} from '@/lib/api/phone';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Mono, Notice, Select } from '@/components/ui/primitives';
import {
  canChangePhoneEmail,
  emptyPhoneUserForm,
  isPhoneLanguage,
  languageLabel,
  memberLabel,
  numberRuleText,
  phoneErrorField,
  phoneErrorText,
  phoneIssueText,
  phoneServerFieldText,
  phoneUserCreateBody,
  phoneUserFormFrom,
  phoneUserFormIssues,
  phoneUserName,
  phoneUserPatchBody,
  ringGroupCandidates,
  ringGroupLabel,
  usePhoneError,
  PHONE_USER_FIELDS,
  type PhoneUserField,
  type PhoneUserForm,
  type PhoneUserIssues,
} from './bits';

/** Dialogs of a phone system: users, welcome e-mail, ring group members and the site name. */

const NAME_MAX = 80;

/** A field error that came back from the API, until the field changes. */
interface ServerFieldError {
  field: PhoneUserField;
  text: string;
}

/** The fields shared by the create and the edit dialog. */
function UserFields({
  form,
  onChange,
  errors,
  emailDisabled,
  emailHint,
  number,
}: {
  form: PhoneUserForm;
  onChange: (patch: Partial<PhoneUserForm>) => void;
  errors: Partial<Record<PhoneUserField, string>>;
  emailDisabled?: boolean;
  emailHint: ReactNode;
  /** The extension field: an input when creating, the fixed number when editing. */
  number: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  // A language the PBX has but the panel does not offer stays selectable as it is.
  const other = form.language && !isPhoneLanguage(form.language) ? form.language : null;
  return (
    <div className="space-y-4">
      {number}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('phone.user.firstName')} htmlFor={`${id}-first`} error={errors.firstName}>
          <Input
            id={`${id}-first`}
            value={form.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            autoComplete="off"
            aria-invalid={!!errors.firstName}
          />
        </Field>
        <Field
          label={
            <>
              {t('phone.user.lastName')}{' '}
              <span className="font-normal text-subtle">({t('common.optional')})</span>
            </>
          }
          htmlFor={`${id}-last`}
          error={errors.lastName}
        >
          <Input
            id={`${id}-last`}
            value={form.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            autoComplete="off"
            aria-invalid={!!errors.lastName}
          />
        </Field>
      </div>
      <Field label={t('phone.user.email')} htmlFor={`${id}-email`} error={errors.email} hint={emailHint}>
        <Input
          id={`${id}-email`}
          type="email"
          value={form.email}
          onChange={(e) => onChange({ email: e.target.value })}
          disabled={emailDisabled}
          autoComplete="off"
          aria-invalid={!!errors.email}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={
            <>
              {t('phone.user.mobile')}{' '}
              <span className="font-normal text-subtle">({t('common.optional')})</span>
            </>
          }
          htmlFor={`${id}-mobile`}
          error={errors.mobile}
        >
          <Input
            id={`${id}-mobile`}
            type="tel"
            value={form.mobile}
            onChange={(e) => onChange({ mobile: e.target.value })}
            placeholder="+41 79 123 45 67"
            autoComplete="off"
            aria-invalid={!!errors.mobile}
          />
        </Field>
        <Field label={t('phone.user.language')} htmlFor={`${id}-lang`} error={errors.language}>
          <Select
            id={`${id}-lang`}
            value={form.language}
            onChange={(e) => onChange({ language: e.target.value })}
          >
            <option value="">{t('phone.user.language.default')}</option>
            {PHONE_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {languageLabel(t, code)}
              </option>
            ))}
            {other && <option value={other}>{other}</option>}
          </Select>
        </Field>
      </div>
      <Field
        label={
          <>
            {t('phone.user.outboundCallerId')}{' '}
            <span className="font-normal text-subtle">({t('common.optional')})</span>
          </>
        }
        htmlFor={`${id}-outbound`}
        error={errors.outboundCallerId}
        hint={t('phone.user.outboundCallerIdHint')}
      >
        <Input
          id={`${id}-outbound`}
          type="tel"
          value={form.outboundCallerId}
          onChange={(e) => onChange({ outboundCallerId: e.target.value })}
          autoComplete="off"
          aria-invalid={!!errors.outboundCallerId}
        />
      </Field>
    </div>
  );
}

/**
 * Field errors to show: what the panel checks itself (required fields and the e-mail address
 * only after a first try, so the form does not turn red while typing) and what the API sent
 * back for a field.
 */
function useFieldErrors(
  issues: PhoneUserIssues,
  numberLength: number | null,
  tried: boolean,
  server: ServerFieldError | null,
): Partial<Record<PhoneUserField, string>> {
  const { t } = useI18n();
  const errors: Partial<Record<PhoneUserField, string>> = {};
  for (const field of PHONE_USER_FIELDS) {
    const issue = issues[field];
    // A half typed address is no mistake yet.
    if (!issue || (!tried && (issue === 'required' || field === 'email'))) continue;
    errors[field] = phoneIssueText(t, field, issue, numberLength);
  }
  if (server && !errors[server.field]) errors[server.field] = server.text;
  return errors;
}

// --- Create ----------------------------------------------------------------------------

export function CreatePhoneUserDialog({
  system,
  list,
  onClose,
}: {
  system: PhoneSystemDto;
  list: PhoneUserListDto | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const numberLength = list?.numberLength ?? system.info?.numberLength ?? null;
  const canPropose = system.capabilities.includes('nextNumber');
  const welcome = system.capabilities.includes('welcomeMail');
  const [form, setForm] = useState<PhoneUserForm>(() => emptyPhoneUserForm());
  const [proposing, setProposing] = useState(canPropose);
  const [tried, setTried] = useState(false);
  const [server, setServer] = useState<ServerFieldError | null>(null);
  /** Once the user typed in the number field, a late proposal must not overwrite it. */
  const numberTouched = useRef(false);

  // The PBX proposes the next free extension; the field stays editable and may stay empty.
  useEffect(() => {
    if (!canPropose) return;
    let cancelled = false;
    fetchNextPhoneNumber(system.id)
      .then((r) => {
        if (!cancelled && r.number && !numberTouched.current)
          setForm((f) => ({ ...f, number: r.number ?? '' }));
      })
      .catch(() => {
        // Without a proposal the PBX picks the number itself.
      })
      .finally(() => {
        if (!cancelled) setProposing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [system.id, canPropose]);

  const create = useCreatePhoneUser(system.id, {
    success: (r) => t('phone.user.created', { name: phoneUserName(r.user), number: r.user.number }),
    onSuccess: (r) => {
      if (r.welcomeError) toast.warning(t('phone.user.welcomeFailed', { error: r.welcomeError }));
      onClose();
    },
    error: (err) => {
      const field = phoneErrorField(err);
      if (field) {
        setServer({ field, text: phoneServerFieldText(t, err, field, numberLength) });
        return null;
      }
      return phoneErrorText(t, err);
    },
  });

  const issues = phoneUserFormIssues(form, numberLength);
  const errors = useFieldErrors(issues, numberLength, tried, server);
  const change = (patch: Partial<PhoneUserForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (server && Object.hasOwn(patch, server.field)) setServer(null);
    if (Object.hasOwn(patch, 'number')) numberTouched.current = true;
  };
  const blocked = Object.keys(issues).length > 0 || !!server;

  const submit = () => {
    setTried(true);
    if (blocked || create.isPending) return;
    create.mutate(phoneUserCreateBody({ ...form, sendWelcome: welcome && form.sendWelcome }));
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !create.isPending && onClose()}
      title={t('phone.user.create')}
      description={t('phone.user.createText')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={tried && blocked} onClick={submit}>
            {t('phone.user.create')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <UserFields
          form={form}
          onChange={change}
          errors={errors}
          emailHint={t('phone.user.emailHint')}
          number={
            <Field
              label={t('phone.user.number')}
              htmlFor={`${id}-number`}
              error={errors.number}
              hint={numberRuleText(t, numberLength, 'hint')}
            >
              <Input
                id={`${id}-number`}
                inputMode="numeric"
                autoComplete="off"
                value={form.number}
                onChange={(e) => change({ number: e.target.value.replace(/\s/g, '') })}
                placeholder={proposing && !numberTouched.current ? '…' : undefined}
                maxLength={12}
                className="w-40 font-mono tabular"
                aria-invalid={!!errors.number}
              />
            </Field>
          }
        />
        {welcome && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[var(--primary)]"
              checked={form.sendWelcome}
              onChange={(e) => change({ sendWelcome: e.target.checked })}
            />
            <span>
              <span className="block text-sm font-medium">{t('phone.user.sendWelcome')}</span>
              <span className="block text-xs text-muted">{t('phone.user.sendWelcomeHint')}</span>
            </span>
          </label>
        )}
        {/* Enter submits the form. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// --- Edit ------------------------------------------------------------------------------

export function EditPhoneUserDialog({
  system,
  user,
  numberLength,
  onClose,
}: {
  system: PhoneSystemDto;
  user: PhoneUserDto;
  numberLength: number | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const me = useMe();
  const platform = me.data?.platformPermissions ?? [];
  const emailEditable = canChangePhoneEmail(user, system.permissions, platform);
  const [form, setForm] = useState<PhoneUserForm>(() => phoneUserFormFrom(user));
  const [tried, setTried] = useState(false);
  const [server, setServer] = useState<ServerFieldError | null>(null);
  const update = useUpdatePhoneUser(system.id, {
    success: (u) => t('phone.user.updated', { number: u.number }),
    onSuccess: onClose,
    error: (err) => {
      const field = phoneErrorField(err);
      if (field) {
        setServer({ field, text: phoneServerFieldText(t, err, field, numberLength) });
        return null;
      }
      return phoneErrorText(t, err);
    },
  });

  const issues = phoneUserFormIssues(form, numberLength, user, emailEditable);
  const errors = useFieldErrors(issues, numberLength, tried, server);
  const patch = phoneUserPatchBody(user, form, emailEditable);
  const unchanged = Object.keys(patch).length === 0;
  const blocked = Object.keys(issues).length > 0 || !!server || unchanged;
  const change = (next: Partial<PhoneUserForm>) => {
    setForm((f) => ({ ...f, ...next }));
    if (server && Object.hasOwn(next, server.field)) setServer(null);
  };
  const submit = () => {
    setTried(true);
    if (blocked || update.isPending) return;
    update.mutate({ userId: user.id, patch });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !update.isPending && onClose()}
      title={t('phone.user.editTitle', { number: user.number })}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={update.isPending} disabled={blocked} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <UserFields
          form={form}
          onChange={change}
          errors={errors}
          emailDisabled={!emailEditable}
          emailHint={
            emailEditable
              ? t('phone.user.emailHint')
              : user.protected && system.permissions.includes('phone:credentials')
                ? t('phone.user.emailLockedProtected')
                : t('phone.user.emailLocked')
          }
          number={
            <div className="space-y-1.5">
              <p className="text-[13px] font-medium text-text">{t('phone.user.number')}</p>
              <Mono className="block text-base text-text">{user.number}</Mono>
              <p className="text-xs text-muted">{t('phone.user.numberFixed')}</p>
            </div>
          }
        />
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// --- Delete and welcome e-mail ---------------------------------------------------------

/** Deleting removes the extension at the PBX; the user types the number to confirm. */
export function DeletePhoneUserDialog({
  system,
  user,
  onClose,
}: {
  system: PhoneSystemDto;
  user: PhoneUserDto;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const remove = useDeletePhoneUser(system.id, {
    success: () => t('phone.user.deleted', { number: user.number }),
    onSuccess: onClose,
    error: usePhoneError(),
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !remove.isPending && onClose()}
      title={t('phone.user.deleteTitle', { number: user.number })}
      description={t('phone.user.deleteText', { number: user.number })}
      confirmLabel={t('common.delete')}
      confirmText={user.number}
      loading={remove.isPending}
      onConfirm={() => remove.mutate({ userId: user.id, confirm: user.number })}
    >
      <p className="mb-3 text-sm text-text">
        <span className="font-medium">{phoneUserName(user)}</span>
        {user.email && <span className="text-muted"> · {user.email}</span>}
      </p>
    </ConfirmDialog>
  );
}

/** The PBX sends the user's access again: needs phone:credentials (and a browser session). */
export function WelcomeMailDialog({
  system,
  user,
  onClose,
}: {
  system: PhoneSystemDto;
  user: PhoneUserDto;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const send = useSendPhoneWelcome(system.id, {
    success: () => t('phone.user.welcomeSent', { email: user.email ?? '' }),
    onSuccess: onClose,
    error: usePhoneError(),
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !send.isPending && onClose()}
      title={t('phone.user.welcomeTitle')}
      description={t('phone.user.welcomeText', { number: user.number, email: user.email ?? '' })}
      confirmLabel={t('phone.user.welcome')}
      danger={false}
      loading={send.isPending}
      onConfirm={() => send.mutate(user.id)}
    />
  );
}

// --- Ring groups -----------------------------------------------------------------------

export function AddRingGroupMemberDialog({
  system,
  group,
  users,
  onClose,
}: {
  system: PhoneSystemDto;
  group: PhoneRingGroup;
  users: PhoneUserDto[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const candidates = ringGroupCandidates(users, group);
  const [number, setNumber] = useState(candidates[0]?.number ?? '');
  const add = useAddRingGroupMember(system.id, {
    success: (_g, vars) =>
      t('phone.ringGroup.memberAdded', {
        member: memberLabel({ number: vars.number, name: null }, users),
        group: ringGroupLabel(group),
      }),
    onSuccess: onClose,
    error: usePhoneError(),
  });
  const valid = candidates.some((u) => u.number === number);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !add.isPending && onClose()}
      title={t('phone.ringGroup.addTitle', { group: ringGroupLabel(group) })}
      description={t('phone.ringGroup.addText')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={add.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={add.isPending}
            disabled={!valid}
            onClick={() => add.mutate({ groupId: group.id, number })}
          >
            {t('common.add')}
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <Notice tone="info">{t('phone.ringGroup.allMembers')}</Notice>
      ) : (
        <Field label={t('phone.ringGroup.member')} htmlFor={`${id}-member`}>
          <Select id={`${id}-member`} value={number} onChange={(e) => setNumber(e.target.value)}>
            {candidates.map((u) => (
              <option key={u.id} value={u.number}>
                {u.number} {phoneUserName(u) !== u.number ? phoneUserName(u) : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Dialog>
  );
}

export function RemoveRingGroupMemberDialog({
  system,
  group,
  number,
  users,
  onClose,
}: {
  system: PhoneSystemDto;
  group: PhoneRingGroup;
  number: string;
  users: PhoneUserDto[] | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const member = group.members.find((m) => m.number === number) ?? { number, name: null };
  const label = memberLabel(member, users);
  const remove = useRemoveRingGroupMember(system.id, {
    success: () => t('phone.ringGroup.memberRemoved', { member: label, group: ringGroupLabel(group) }),
    onSuccess: onClose,
    error: usePhoneError(),
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !remove.isPending && onClose()}
      title={t('phone.ringGroup.removeTitle', { member: label, group: ringGroupLabel(group) })}
      description={t('phone.ringGroup.removeText', { group: ringGroupLabel(group), number })}
      confirmLabel={t('common.remove')}
      loading={remove.isPending}
      onConfirm={() => remove.mutate({ groupId: group.id, number })}
    />
  );
}

// --- Site name -------------------------------------------------------------------------

/** The name the console shows (e.g. the site); the PBX keeps its own. */
export function RenamePhoneSystemDialog({
  system,
  onClose,
}: {
  system: PhoneSystemDto;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [name, setName] = useState(system.name);
  const rename = useRenamePhoneSystem({
    success: (r) => t('phone.renamed', { name: r.name }),
    onSuccess: onClose,
    error: usePhoneError(),
  });
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= NAME_MAX && trimmed !== system.name;
  const submit = () => {
    if (valid && !rename.isPending) rename.mutate({ id: system.id, name: trimmed });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !rename.isPending && onClose()}
      title={t('phone.renameTitle')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={rename.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={rename.isPending} disabled={!valid} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t('phone.renameName')} htmlFor={`${id}-name`} hint={t('phone.renameHint')}>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            autoFocus
          />
        </Field>
      </form>
    </Dialog>
  );
}
