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
  /** The person who invited. Their language is used for the mail. */
  inviter: { name: string; locale: string } | null;
}

/**
 * Sends the invitation email. Called wherever invitations are created (members, new
 * customers by admins and resellers). Never throws: the API response carries the link
 * anyway, so a mail problem never blocks an invitation.
 */
export function sendInvitationMail(mail: Mailer, input: InvitationMail): Promise<MailResult> {
  const locale = mailLocale(input.inviter?.locale);
  return mail.send(
    'invitation',
    {
      orgName: input.orgName,
      inviterName: input.inviter?.name ?? null,
      role: roleLabel(input.role, locale),
      link: input.link,
      expiresAt: mailDate(input.expiresAt, locale),
    },
    { to: input.email, locale, orgId: input.orgId },
  );
}
