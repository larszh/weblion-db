import type { emailDe } from './email.de';

export const emailEn: Record<keyof typeof emailDe, string> = {
  // Layout
  'email.layout.footer': 'This email was sent automatically by weblion.one.',
  'email.layout.buttonFallback': 'If the button does not work, open this link:',

  // Greeting and closing
  'email.common.greeting': 'Hello',
  'email.common.closing': 'Kind regards',

  // Invitation
  'email.invitation.subject': 'Invitation to {org} on weblion.one',
  'email.invitation.heading': 'Invitation to {org}',
  'email.invitation.someone': 'Someone',
  'email.invitation.text': '{inviter} invited you to join the organization {org} on weblion.one.',
  'email.invitation.role': 'Role',
  'email.invitation.validUntil': 'Valid until',
  'email.invitation.button': 'Accept invitation',
  'email.invitation.note': 'If you did not expect this invitation, you can ignore this email.',

  // Invoice
  'email.invoice.subject': 'Invoice {number} from {issuer}',
  'email.invoice.subjectPaid': 'Invoice {number} from {issuer} (paid)',
  'email.invoice.heading': 'Invoice {number}',
  'email.invoice.text': 'Please find attached invoice {number} for {org}.',
  'email.invoice.amount': 'Amount',
  'email.invoice.status': 'Status',
  'email.invoice.statusPaid': 'Paid',
  'email.invoice.dueDate': 'Due date',
  'email.invoice.paidText': 'The invoice is already paid, there is nothing left to do.',
  'email.invoice.openText': 'You can also view and pay the invoice in the console.',
  'email.invoice.button': 'View invoice',

  // Payment reminder
  'email.reminder.subject': 'Payment reminder: invoice {number}',
  'email.reminder.heading': 'Payment reminder',
  'email.reminder.text': 'Invoice {number} for {org} is still open. Please pay the amount due.',
  'email.reminder.amountDue': 'Amount due',
  'email.reminder.dueSince': 'Due since',
  'email.reminder.button': 'View invoice',
  'email.reminder.note': 'If you have already paid, please ignore this email.',

  // Payment received
  'email.payment.subject': 'Payment received: {amount}',
  'email.payment.heading': 'Thank you for your payment',
  'email.payment.text': 'We have received your payment for {org}.',
  'email.payment.amount': 'Amount',
  'email.payment.invoice': 'Invoice',
  'email.payment.button': 'Go to billing',

  // Credit booked
  'email.credit.subject': 'Credit booked: {amount}',
  'email.credit.heading': 'Credit booked',
  'email.credit.text': 'A credit or correction was booked to the account of {org}.',
  'email.credit.amount': 'Amount',
  'email.credit.description': 'Description',
  'email.credit.balance': 'New balance',
  'email.credit.button': 'View credit',

  // Test e-mail
  'email.test.subject': 'Test email from weblion.one',
  'email.test.heading': 'Email delivery works',
  'email.test.text': 'This test email was sent by {name} from the admin area.',
  'email.test.check': 'If you can read this message, the SMTP settings are correct.',

  // AI budget warning and exhaustion (plan 5.3)
  'email.aiBudget.warning.subject': 'AI budget {percent} % used',
  'email.aiBudget.warning.heading': 'AI budget almost used up',
  'email.aiBudget.warning.text':
    'In {month}, {spent} of {budget} have been used ({percent} %). At 100 %, weblion.one starts no new AI requests until the end of the month.',
  'email.aiBudget.exhausted.subject': 'AI budget used up',
  'email.aiBudget.exhausted.heading': 'AI budget used up',
  'email.aiBudget.exhausted.text':
    'In {month}, {spent} of {budget} have been used. New AI requests are blocked until the end of the month. You can raise the budget in the AI settings.',
  'email.aiBudget.button': 'Open AI settings',
};
