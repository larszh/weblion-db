/** E-mail texts, rendered by the API only (i18n 18.3). German is the source; English is the English of the
 * templates before the move. Never part of a web bundle. */
export const emailDe = {
  // Layout
  'email.layout.footer': 'Diese E-Mail wurde automatisch von weblion.one versendet.',
  'email.layout.buttonFallback': 'Falls der Button nicht funktioniert, öffnen Sie diesen Link:',

  // Greeting and closing
  'email.common.greeting': 'Guten Tag',
  'email.common.closing': 'Freundliche Grüsse',

  // Invitation
  'email.invitation.subject': 'Einladung zu {org} auf weblion.one',
  'email.invitation.heading': 'Einladung zu {org}',
  'email.invitation.someone': 'Jemand',
  'email.invitation.text':
    '{inviter} hat Sie eingeladen, der Organisation {org} auf weblion.one beizutreten.',
  'email.invitation.role': 'Rolle',
  'email.invitation.validUntil': 'Gültig bis',
  'email.invitation.button': 'Einladung annehmen',
  'email.invitation.note':
    'Falls Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.',

  // Invoice
  'email.invoice.subject': 'Rechnung {number} von {issuer}',
  'email.invoice.subjectPaid': 'Rechnung {number} von {issuer} (bezahlt)',
  'email.invoice.heading': 'Rechnung {number}',
  'email.invoice.text': 'Im Anhang finden Sie die Rechnung {number} für {org}.',
  'email.invoice.amount': 'Betrag',
  'email.invoice.status': 'Status',
  'email.invoice.statusPaid': 'Bezahlt',
  'email.invoice.dueDate': 'Zahlbar bis',
  'email.invoice.paidText': 'Die Rechnung ist bereits bezahlt, Sie müssen nichts weiter tun.',
  'email.invoice.openText': 'Sie können die Rechnung auch in der Konsole ansehen und bezahlen.',
  'email.invoice.button': 'Rechnung ansehen',

  // Payment reminder
  'email.reminder.subject': 'Zahlungserinnerung: Rechnung {number}',
  'email.reminder.heading': 'Zahlungserinnerung',
  'email.reminder.text':
    'Die Rechnung {number} für {org} ist noch offen. Bitte begleichen Sie den offenen Betrag.',
  'email.reminder.amountDue': 'Offener Betrag',
  'email.reminder.dueSince': 'Fällig seit',
  'email.reminder.button': 'Rechnung ansehen',
  'email.reminder.note':
    'Falls Sie die Zahlung bereits ausgelöst haben, betrachten Sie diese E-Mail als erledigt.',

  // Payment received
  'email.payment.subject': 'Zahlung erhalten: {amount}',
  'email.payment.heading': 'Vielen Dank für Ihre Zahlung',
  'email.payment.text': 'Wir haben Ihre Zahlung für {org} erhalten.',
  'email.payment.amount': 'Betrag',
  'email.payment.invoice': 'Rechnung',
  'email.payment.button': 'Zur Abrechnung',

  // Credit booked
  'email.credit.subject': 'Guthaben verbucht: {amount}',
  'email.credit.heading': 'Guthaben verbucht',
  'email.credit.text': 'Auf dem Konto von {org} wurde eine Gutschrift oder Korrektur verbucht.',
  'email.credit.amount': 'Betrag',
  'email.credit.description': 'Beschreibung',
  'email.credit.balance': 'Neues Guthaben',
  'email.credit.button': 'Guthaben ansehen',

  // Test e-mail
  'email.test.subject': 'Test-E-Mail von weblion.one',
  'email.test.heading': 'Der E-Mail-Versand funktioniert',
  'email.test.text': 'Diese Test-E-Mail wurde von {name} im Adminbereich ausgelöst.',
  'email.test.check': 'Wenn Sie diese Nachricht lesen, sind die SMTP-Einstellungen korrekt.',

  // AI budget warning and exhaustion (plan 5.3)
  'email.aiBudget.warning.subject': 'KI-Budget zu {percent} % verbraucht',
  'email.aiBudget.warning.heading': 'KI-Budget fast aufgebraucht',
  'email.aiBudget.warning.text':
    'Im {month} sind {spent} von {budget} verbraucht ({percent} %). Bei 100 % startet weblion.one keine neuen KI-Anfragen mehr bis Monatsende.',
  'email.aiBudget.exhausted.subject': 'KI-Budget aufgebraucht',
  'email.aiBudget.exhausted.heading': 'KI-Budget aufgebraucht',
  'email.aiBudget.exhausted.text':
    'Im {month} sind {spent} von {budget} verbraucht. Neue KI-Anfragen sind bis Monatsende gesperrt. Sie können das Budget in den KI-Einstellungen erhöhen.',
  'email.aiBudget.button': 'KI-Einstellungen öffnen',
} as const;
