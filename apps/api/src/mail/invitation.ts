import type { OrgRole } from '@weblion/shared';
import { mailDate, mailLocale, roleLabel } from './templates';
import type { Mailer, MailResult } from './types';

export interface InvitationMail {
  email: string;
  orgId: string;
  orgName: string;
  role: OrgRole;
  link: string;
  expiresAt: Date;
  /** The person who invited. Their language is used for the mail unless the address has an account. */
  inviter: { name: string; locale: string } | null;
  /** The account of the invited address, when there is one: the mail goes out in its language (i18n 8.2). */
  invitee: { locale: string } | null;
}

/**
 * Sends the invitation email in the invitee's language when the address has an account, else in the
 * inviter's (i18n 8.2). Called wherever invitations are created (members, new customers by admins and
 * resellers). Never throws: the API response carries the link anyway, so a mail problem never blocks an
 * invitation.
 */
export function sendInvitationMail(mail: Mailer, input: InvitationMail): Promise<MailResult> {
  // A new account picks its own language on the invite page; the mail cannot know it yet.
  const locale = mailLocale(input.invitee?.locale ?? input.inviter?.locale);
  return mail.send(
    'invitation',
    {
      orgName: input.orgName,
      inviterName: input.inviter?.name ?? null,
      role: roleLabel(input.role, mail.translator(locale)),
      link: input.link,
      expiresAt: mailDate(input.expiresAt, locale),
    },
    { to: input.email, locale, orgId: input.orgId },
  );
}
