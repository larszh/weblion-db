import type { translationsDe } from './translations.de';

export const translationsEn: Record<keyof typeof translationsDe, string> = {
  // Page
  'admin.i18n.description': 'View and edit the console texts in five languages and translate them with AI.',
  'admin.i18n.tab.overview': 'Overview',
  'admin.i18n.tab.entries': 'Texts',
  'admin.i18n.tab.glossary': 'Glossary',
  'admin.i18n.tab.jobs': 'AI jobs',
  'admin.i18n.tab.transfer': 'Import and export',

  // Overview
  'admin.i18n.overview.source': 'Source language',
  'admin.i18n.overview.keys': 'Texts: {count}',
  'admin.i18n.overview.translated': '{done} of {total} translated',
  'admin.i18n.overview.upToDate': '{count} up to date',
  'admin.i18n.overview.stale': '{count} outdated',
  'admin.i18n.overview.missing': '{count} missing',
  'admin.i18n.overview.unreviewed': '{count} by AI, not reviewed',
  'admin.i18n.overview.showMissing': 'Show missing',
  'admin.i18n.overview.showStale': 'Show outdated',
  'admin.i18n.overview.legalFallback':
    'The legal text {key} has no current translation in {languages}. Until it is translated, the English or German text is shown there.',

  // Filters and list
  'admin.i18n.filter.search': 'Search key or text…',
  'admin.i18n.filter.locale': 'Language',
  'admin.i18n.filter.anyLocale': 'All languages',
  'admin.i18n.filter.state': 'State',
  'admin.i18n.filter.all': 'All',
  'admin.i18n.filter.untranslated': 'Untranslated',
  'admin.i18n.filter.stale': 'Outdated',
  'admin.i18n.filter.changed': 'Changed',
  'admin.i18n.filter.ai': 'By AI',
  'admin.i18n.filter.unreviewed': 'Not reviewed',
  'admin.i18n.filter.attention': 'Needs attention',
  'admin.i18n.filter.area': 'Area',
  'admin.i18n.filter.anyArea': 'All areas',
  'admin.i18n.filter.keys': '{count} selected texts',
  'admin.i18n.filter.keysCapped': 'Only the first {count} of {total} texts are filtered.',
  'admin.i18n.filter.reset': 'Reset filters',
  'admin.i18n.entries.count': 'Texts: {count}',
  'admin.i18n.entries.empty': 'No texts match these filters.',
  'admin.i18n.col.key': 'Key',

  // Badges
  'admin.i18n.tag.email': 'Email',
  'admin.i18n.tag.pdf': 'PDF',
  'admin.i18n.badge.missing': 'Missing',
  'admin.i18n.badge.stale': 'Outdated',
  'admin.i18n.badge.manual': 'Manual',
  'admin.i18n.badge.ai': 'AI, not reviewed',
  'admin.i18n.badge.aiReviewed': 'AI, reviewed',
  'admin.i18n.badge.legal': 'Legal text',
  'admin.i18n.badge.hidden': 'Not shown',
  'admin.i18n.badge.warnings': '{count} warnings',

  // Cell editor
  'admin.i18n.cell.source': 'German text',
  'admin.i18n.cell.sourceOverride': 'The German text was changed here and differs from the code.',
  'admin.i18n.cell.reference': 'English reference',
  'admin.i18n.cell.value': 'Translation ({language})',
  'admin.i18n.cell.fallback': 'Missing, shown instead: {text}',
  'admin.i18n.cell.placeholders': 'Placeholders',
  'admin.i18n.cell.placeholderMissing': 'Missing: {name}',
  'admin.i18n.cell.placeholderExtra': 'Not in the German text: {name}',
  'admin.i18n.cell.lineBreaks': 'Line breaks: {count} of {expected}',
  'admin.i18n.cell.reviewed': 'Reviewed',
  'admin.i18n.cell.markReviewed': 'Mark as reviewed',
  'admin.i18n.cell.markUnreviewed': 'Mark as not reviewed',
  'admin.i18n.cell.confirm': 'Confirm as up to date',
  'admin.i18n.cell.confirmHint':
    'The German text changed after this translation. Confirm if the translation is still correct.',
  'admin.i18n.cell.revert': 'Revert to the text in the code',
  'admin.i18n.cell.revertTitle': 'Discard change?',
  'admin.i18n.cell.revertText':
    'The change for {language} is deleted. Afterwards the text in the code applies again: {value}',
  'admin.i18n.cell.revertMissing':
    'The change for {language} is deleted. Afterwards the translation is missing and the console shows the English text.',
  'admin.i18n.cell.suggest': 'AI suggestion',
  'admin.i18n.cell.suggestApply': 'Use suggestion',
  'admin.i18n.cell.suggestFailed': 'The suggestion failed the checks: {reason}',
  'admin.i18n.cell.saved': 'Translation saved',
  'admin.i18n.cell.reverted': 'Change discarded',
  'admin.i18n.cell.typographyFixed': 'The French spacing was corrected automatically.',
  'admin.i18n.cell.shortcut': 'Ctrl+Enter saves, Esc cancels.',
  'admin.i18n.cell.legalHint':
    'Legal text: never machine translated. When a translation is outdated after a change to the German text, the console shows the English (else the German) text until it is updated.',
  'admin.i18n.cell.updatedBy': 'Changed by {name}, {when}',
  'admin.i18n.cell.readOnly': 'You can view translations but not change them.',

  // Check results (checks.ts)
  'admin.i18n.check.placeholders': 'The placeholders do not match the German text.',
  'admin.i18n.check.german': 'Looks like German text.',
  'admin.i18n.check.formality': 'Sounds informal. Please use the formal form of address.',
  'admin.i18n.check.length': 'Much longer than the German text. Please keep buttons and labels short.',
  'admin.i18n.check.glossary': 'A glossary term is missing.',
  'admin.i18n.check.sharpS': 'Contains a sharp s. Please use ss.',
  'admin.i18n.check.emDash': 'Contains an em dash. Please use a comma, a colon or parentheses.',
  'admin.i18n.check.typography': 'French spacing: no-break space before : and %, no space before ? ! ;',
  'admin.i18n.check.content': 'Contains links, email addresses or numbers that are not in the German text.',

  // Mass Translate dialog
  'admin.i18n.ai.button': 'Translate with AI',
  'admin.i18n.ai.locales': 'Languages',
  'admin.i18n.ai.selection': 'Which texts',
  'admin.i18n.ai.selection.untranslated': 'Untranslated only',
  'admin.i18n.ai.selection.stale': 'Outdated only',
  'admin.i18n.ai.selection.both': 'Untranslated and outdated',
  'admin.i18n.ai.selection.all': 'All texts of the current selection ({count})',
  'admin.i18n.ai.replaceManual': 'Also replace manually changed and reviewed translations',
  'admin.i18n.ai.estimate': 'Estimate cost',
  'admin.i18n.ai.estimateResult': '{keys} texts in {batches} batches, about USD {cost}',
  'admin.i18n.ai.estimateModel': 'Model: {model}',
  'admin.i18n.ai.estimateKept': '{count} manually changed or reviewed translations stay unchanged.',
  'admin.i18n.ai.estimateLegal': '{count} legal texts are not machine translated.',
  'admin.i18n.ai.budgetRemaining': 'AI budget left this month: about USD {remaining}',
  'admin.i18n.ai.budgetWarning':
    'The AI budget left this month (about USD {remaining}) is probably not enough. The translation stops when the budget is used up; after that, the other AI features are blocked until the end of the month as well.',
  'admin.i18n.ai.costCapNote': 'The job stops if it costs more than one and a half times the estimate.',
  'admin.i18n.ai.reviewNote':
    'AI results are saved as "AI, not reviewed" and are visible to everyone right away.',
  'admin.i18n.ai.demoNote':
    'Demo mode: instead of a real translation, the German text is saved with the language code in brackets, for example [FR].',
  'admin.i18n.ai.featureOff': 'The AI translations feature is switched off under Administration > AI.',
  'admin.i18n.ai.notConfigured': 'AI is not set up or switched off.',
  'admin.i18n.ai.setup': 'Set up AI',
  'admin.i18n.ai.start': 'Start translation',
  'admin.i18n.ai.started': 'Translation started',
  'admin.i18n.ai.costChanged':
    'The cost rose since the estimate: now about USD {cost}. Please confirm again.',

  // Jobs
  'admin.i18n.job.empty': 'No AI jobs yet.',
  'admin.i18n.job.status.queued': 'Queued',
  'admin.i18n.job.status.running': 'Running',
  'admin.i18n.job.status.completed': 'Completed',
  'admin.i18n.job.status.failed': 'Failed',
  'admin.i18n.job.status.cancelled': 'Cancelled',
  'admin.i18n.job.progress': '{done} of {total} texts',
  'admin.i18n.job.failedCount': '{count} failed',
  'admin.i18n.job.skippedCount': '{count} skipped (changed by hand meanwhile)',
  'admin.i18n.job.cost': 'USD {cost} of an estimated USD {estimate}',
  'admin.i18n.job.tokens': '{input} input tokens, {output} output tokens',
  'admin.i18n.job.startedBy': 'Started by {name}, {when}',
  'admin.i18n.job.retryOf': 'Retry of an earlier job',
  'admin.i18n.job.cancel': 'Cancel job',
  'admin.i18n.job.cancelTitle': 'Cancel job?',
  'admin.i18n.job.cancelText': 'Finished batches stay saved. The current batch is discarded.',
  'admin.i18n.job.cancelRequested': 'Cancelling…',
  'admin.i18n.job.retry': 'Retry failed',
  'admin.i18n.job.failures': 'Failed texts',
  'admin.i18n.job.showInEntries': 'Show in the list',
  'admin.i18n.job.reason.missing': 'No answer for this text',
  'admin.i18n.job.reason.empty': 'Empty translation',
  'admin.i18n.job.reason.placeholders': 'Placeholders or line breaks differ',
  'admin.i18n.job.reason.characters': 'Character not allowed',
  'admin.i18n.job.reason.content': 'New links, email addresses or numbers',
  'admin.i18n.job.reason.german': 'Looks like German text',
  'admin.i18n.job.reason.formality': 'Not the formal form of address',
  'admin.i18n.job.reason.length': 'Too long',
  'admin.i18n.job.reason.glossary': 'Glossary term missing',
  'admin.i18n.job.reason.refusal': 'Declined by the AI',
  'admin.i18n.job.reason.error': 'Request failed',
  'admin.i18n.job.budgetJob': 'The AI budget of this month is used up. Finished batches stay saved.',
  'admin.i18n.job.error.cost_cap':
    'Stopped: the job would have cost more than one and a half times the estimate.',
  'admin.i18n.job.error.ai_not_configured': 'Stopped: AI was switched off during the job.',
  'admin.i18n.job.error.ai_upstream':
    'Stopped: the AI service rejected the key or the account. Check Administration > AI.',
  'admin.i18n.job.error.ai_failed': 'Stopped: several batches in a row failed.',

  // Glossary
  'admin.i18n.glossary.add': 'Add term',
  'admin.i18n.glossary.term': 'Term (German)',
  'admin.i18n.glossary.keep': 'Never translate',
  'admin.i18n.glossary.note': 'Note',
  'admin.i18n.glossary.builtIn': 'Default',
  'admin.i18n.glossary.hint': 'The glossary applies to AI translations and to the automatic checks.',
  'admin.i18n.glossary.empty': 'No own terms yet.',
  'admin.i18n.glossary.deleteTitle': 'Delete term?',
  'admin.i18n.glossary.deleteText':
    '{term} is removed from the glossary. Existing translations stay unchanged.',
  'admin.i18n.glossary.saved': 'Glossary saved',

  // Style notes
  'admin.i18n.style.title': 'Style notes',
  'admin.i18n.style.hint':
    'Additional notes per language for AI translations, for example on the form of address or on terms.',
  'admin.i18n.style.defaults': 'Default notes',
  'admin.i18n.style.saved': 'Style notes saved',

  // Import and export
  'admin.i18n.export.title': 'Export',
  'admin.i18n.export.overrides': 'Export changes (JSON)',
  'admin.i18n.export.locale': 'Export a language for translators (JSON)',
  'admin.i18n.export.onlyMissing': 'Only missing and outdated texts',
  'admin.i18n.export.applyHint':
    'Developers apply the exported changes to the code with pnpm --filter @weblion/api i18n:apply <file>. After the next deploy you can clean up the applied changes here.',
  'admin.i18n.import.title': 'Import',
  'admin.i18n.import.file': 'Choose JSON file',
  'admin.i18n.import.replaceManual': 'Replace manually changed translations',
  'admin.i18n.import.markReviewed': 'Mark imported texts as reviewed',
  'admin.i18n.import.check': 'Check',
  'admin.i18n.import.apply': 'Import',
  'admin.i18n.import.result': '{created} new, {updated} changed, {unchanged} unchanged, {skipped} skipped',
  'admin.i18n.import.done': 'Import finished',
  'admin.i18n.import.skip.empty': 'Empty text',
  'admin.i18n.import.skip.placeholders': 'Placeholders differ',
  'admin.i18n.import.skip.characters': 'Character not allowed',
  'admin.i18n.import.skip.unknown_key': 'Unknown key',
  'admin.i18n.import.skip.manual': 'Changed by hand',
  'admin.i18n.import.skip.legal_ai': 'AI text for a legal text',
  'admin.i18n.import.skip.unchanged': 'Unchanged',

  // Clean up
  'admin.i18n.cleanup.title': 'Clean up',
  'admin.i18n.cleanup.text':
    '{orphans} changes belong to texts that no longer exist. {same} changes are already in the code.',
  'admin.i18n.cleanup.demoNotice':
    'In addition, {count} demo translations ([FR] and similar) are deleted as well.',
  'admin.i18n.cleanup.button': 'Clean up',
  'admin.i18n.cleanup.done': '{count} changes deleted',

  // Error texts of the i18n error codes (localizeError)
  'admin.i18n.error.placeholder_mismatch':
    'The placeholders must be exactly those of the German text. Missing: {missing}. Extra: {extra}.',
  'admin.i18n.error.forbidden_character':
    'The text contains a character that is not allowed (sharp s or em dash).',
  'admin.i18n.error.forbidden_character.pdf':
    'Texts of the PDF invoice may only contain characters from Windows-1252 (its font cannot print others), and no sharp s or em dash. Not allowed: {characters}',
  'admin.i18n.error.unknown_key': 'This text no longer exists. Please reload the page.',
  'admin.i18n.error.legal_key': 'Legal texts are never machine translated.',
  'admin.i18n.error.nothing_to_translate': 'There is nothing to translate for this selection.',
  'admin.i18n.error.estimate_changed':
    'The estimated cost rose by more than 25 %. Please check the new estimate.',
  'admin.i18n.error.job_running':
    'A translation is already running. Wait until it has finished or cancel it.',
  'admin.i18n.error.job_finished': 'This job has already finished.',
  'admin.i18n.error.not_stale': 'This translation is already up to date.',
  'admin.i18n.error.glossary_duplicate': 'This term is already in the glossary.',
  'admin.i18n.error.glossary_builtin': 'Default terms can be changed but not deleted.',
  'admin.i18n.error.import_invalid': 'The file is not a translation export of weblion.one.',
};
