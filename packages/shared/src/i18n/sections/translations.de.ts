/** Translation admin and Mass Translate (admin.i18n.*, i18n 18.2). German is the source. */
export const translationsDe = {
  // Page
  'admin.i18n.description': 'Texte der Konsole in fünf Sprachen ansehen, bearbeiten und mit KI übersetzen.',
  'admin.i18n.tab.overview': 'Übersicht',
  'admin.i18n.tab.entries': 'Texte',
  'admin.i18n.tab.glossary': 'Glossar',
  'admin.i18n.tab.jobs': 'KI-Aufträge',
  'admin.i18n.tab.transfer': 'Import und Export',

  // Overview
  'admin.i18n.overview.source': 'Ausgangssprache',
  'admin.i18n.overview.keys': 'Texte: {count}',
  'admin.i18n.overview.translated': '{done} von {total} übersetzt',
  'admin.i18n.overview.upToDate': '{count} aktuell',
  'admin.i18n.overview.stale': '{count} veraltet',
  'admin.i18n.overview.missing': '{count} fehlen',
  'admin.i18n.overview.unreviewed': '{count} von KI, ungeprüft',
  'admin.i18n.overview.showMissing': 'Fehlende anzeigen',
  'admin.i18n.overview.showStale': 'Veraltete anzeigen',
  'admin.i18n.overview.legalFallback':
    'Der Rechtstext {key} ist in {languages} nicht aktuell übersetzt. Dort sieht man bis zur Übersetzung den englischen oder deutschen Text.',

  // Filters and list
  'admin.i18n.filter.search': 'Schlüssel oder Text suchen…',
  'admin.i18n.filter.locale': 'Sprache',
  'admin.i18n.filter.anyLocale': 'Alle Sprachen',
  'admin.i18n.filter.state': 'Zustand',
  'admin.i18n.filter.all': 'Alle',
  'admin.i18n.filter.untranslated': 'Unübersetzt',
  'admin.i18n.filter.stale': 'Veraltet',
  'admin.i18n.filter.changed': 'Geändert',
  'admin.i18n.filter.ai': 'Von KI',
  'admin.i18n.filter.unreviewed': 'Ungeprüft',
  'admin.i18n.filter.attention': 'Braucht Aufmerksamkeit',
  'admin.i18n.filter.area': 'Bereich',
  'admin.i18n.filter.anyArea': 'Alle Bereiche',
  'admin.i18n.filter.keys': '{count} ausgewählte Texte',
  'admin.i18n.filter.reset': 'Filter zurücksetzen',
  'admin.i18n.entries.count': 'Texte: {count}',
  'admin.i18n.entries.empty': 'Keine Texte für diese Filter.',
  'admin.i18n.col.key': 'Schlüssel',

  // Badges
  'admin.i18n.tag.email': 'E-Mail',
  'admin.i18n.tag.pdf': 'PDF',
  'admin.i18n.badge.missing': 'Fehlt',
  'admin.i18n.badge.stale': 'Veraltet',
  'admin.i18n.badge.manual': 'Manuell',
  'admin.i18n.badge.ai': 'KI, ungeprüft',
  'admin.i18n.badge.aiReviewed': 'KI, geprüft',
  'admin.i18n.badge.legal': 'Rechtstext',
  'admin.i18n.badge.hidden': 'Nicht sichtbar',
  'admin.i18n.badge.warnings': '{count} Hinweise',

  // Cell editor
  'admin.i18n.cell.source': 'Deutscher Text',
  'admin.i18n.cell.sourceOverride': 'Der deutsche Text wurde hier geändert und weicht vom Code ab.',
  'admin.i18n.cell.reference': 'Englische Referenz',
  'admin.i18n.cell.value': 'Übersetzung ({language})',
  'admin.i18n.cell.fallback': 'Fehlt, angezeigt wird: {text}',
  'admin.i18n.cell.placeholders': 'Platzhalter',
  'admin.i18n.cell.placeholderMissing': 'Fehlt: {name}',
  'admin.i18n.cell.placeholderExtra': 'Nicht im deutschen Text: {name}',
  'admin.i18n.cell.lineBreaks': 'Zeilenumbrüche: {count} von {expected}',
  'admin.i18n.cell.reviewed': 'Geprüft',
  'admin.i18n.cell.markReviewed': 'Als geprüft markieren',
  'admin.i18n.cell.markUnreviewed': 'Als ungeprüft markieren',
  'admin.i18n.cell.confirm': 'Als aktuell bestätigen',
  'admin.i18n.cell.confirmHint':
    'Der deutsche Text hat sich seit dieser Übersetzung geändert. Bestätigen Sie, wenn die Übersetzung trotzdem stimmt.',
  'admin.i18n.cell.revert': 'Auf Text aus dem Code zurücksetzen',
  'admin.i18n.cell.revertTitle': 'Änderung verwerfen?',
  'admin.i18n.cell.revertText':
    'Die Änderung für {language} wird gelöscht. Danach gilt wieder der Text aus dem Code: {value}',
  'admin.i18n.cell.revertMissing':
    'Die Änderung für {language} wird gelöscht. Danach fehlt die Übersetzung, und die Konsole zeigt den englischen Text.',
  'admin.i18n.cell.suggest': 'KI-Vorschlag',
  'admin.i18n.cell.suggestApply': 'Vorschlag übernehmen',
  'admin.i18n.cell.suggestFailed': 'Der Vorschlag hat die Prüfung nicht bestanden: {reason}',
  'admin.i18n.cell.saved': 'Übersetzung gespeichert',
  'admin.i18n.cell.reverted': 'Änderung verworfen',
  'admin.i18n.cell.typographyFixed': 'Die französischen Leerzeichen wurden automatisch korrigiert.',
  'admin.i18n.cell.shortcut': 'Strg+Enter speichert, Esc bricht ab.',
  'admin.i18n.cell.legalHint':
    'Rechtstext: wird nie maschinell übersetzt. Ist eine Übersetzung nach einer Änderung am deutschen Text veraltet, zeigt die Konsole den englischen (sonst den deutschen) Text, bis sie aktualisiert ist.',
  'admin.i18n.cell.updatedBy': 'Geändert von {name}, {when}',
  'admin.i18n.cell.readOnly': 'Sie können Übersetzungen ansehen, aber nicht ändern.',

  // Check results (checks.ts)
  'admin.i18n.check.placeholders': 'Die Platzhalter stimmen nicht mit dem deutschen Text überein.',
  'admin.i18n.check.german': 'Sieht nach deutschem Text aus.',
  'admin.i18n.check.formality': 'Klingt nach Du-Form. Bitte die Höflichkeitsform verwenden.',
  'admin.i18n.check.length':
    'Deutlich länger als der deutsche Text. Knöpfe und Beschriftungen bitte kurz halten.',
  'admin.i18n.check.glossary': 'Ein Begriff aus dem Glossar fehlt.',
  'admin.i18n.check.sharpS': 'Enthält ein scharfes S (Eszett). Bitte ss verwenden.',
  'admin.i18n.check.emDash':
    'Enthält einen langen Gedankenstrich. Bitte Komma, Doppelpunkt oder Klammern verwenden.',
  'admin.i18n.check.typography':
    'Französische Leerzeichen: geschütztes Leerzeichen vor : und %, kein Leerzeichen vor ? ! ;',
  'admin.i18n.check.content':
    'Enthält Links, E-Mail-Adressen oder Zahlen, die im deutschen Text nicht vorkommen.',

  // Mass Translate dialog
  'admin.i18n.ai.button': 'Mit KI übersetzen',
  'admin.i18n.ai.locales': 'Sprachen',
  'admin.i18n.ai.selection': 'Welche Texte',
  'admin.i18n.ai.selection.untranslated': 'Nur unübersetzte',
  'admin.i18n.ai.selection.stale': 'Nur veraltete',
  'admin.i18n.ai.selection.both': 'Unübersetzte und veraltete',
  'admin.i18n.ai.selection.all': 'Alle Texte der aktuellen Auswahl ({count})',
  'admin.i18n.ai.replaceManual': 'Auch manuell geänderte und geprüfte Übersetzungen ersetzen',
  'admin.i18n.ai.estimate': 'Kosten schätzen',
  'admin.i18n.ai.estimateResult': '{keys} Texte in {batches} Paketen, ca. USD {cost}',
  'admin.i18n.ai.estimateModel': 'Modell: {model}',
  'admin.i18n.ai.estimateKept': '{count} manuell geänderte oder geprüfte Übersetzungen bleiben unverändert.',
  'admin.i18n.ai.estimateLegal': '{count} Rechtstexte werden nicht maschinell übersetzt.',
  'admin.i18n.ai.budgetRemaining': 'Verbleibendes KI-Budget in diesem Monat: ca. USD {remaining}',
  'admin.i18n.ai.budgetWarning':
    'Das verbleibende KI-Budget dieses Monats (ca. USD {remaining}) reicht voraussichtlich nicht. Die Übersetzung stoppt, wenn das Budget aufgebraucht ist; danach sind auch die übrigen KI-Funktionen bis Monatsende gesperrt.',
  'admin.i18n.ai.costCapNote':
    'Der Auftrag stoppt, wenn er mehr als das Anderthalbfache der Schätzung kostet.',
  'admin.i18n.ai.reviewNote':
    'KI-Ergebnisse werden als "KI, ungeprüft" gespeichert und sind sofort für alle sichtbar.',
  'admin.i18n.ai.demoNote':
    'Demo-Modus: Statt einer echten Übersetzung wird der deutsche Text mit dem Sprachcode in Klammern gespeichert, zum Beispiel [FR].',
  'admin.i18n.ai.featureOff': 'Die KI-Funktion Übersetzungen ist unter Verwaltung > KI ausgeschaltet.',
  'admin.i18n.ai.notConfigured': 'Die KI ist nicht eingerichtet oder ausgeschaltet.',
  'admin.i18n.ai.setup': 'KI einrichten',
  'admin.i18n.ai.start': 'Übersetzung starten',
  'admin.i18n.ai.started': 'Übersetzung gestartet',
  'admin.i18n.ai.costChanged':
    'Die Kosten sind seit der Schätzung gestiegen: neu ca. USD {cost}. Bitte bestätigen Sie erneut.',

  // Jobs
  'admin.i18n.job.empty': 'Noch keine KI-Aufträge.',
  'admin.i18n.job.status.queued': 'Wartet',
  'admin.i18n.job.status.running': 'Läuft',
  'admin.i18n.job.status.completed': 'Fertig',
  'admin.i18n.job.status.failed': 'Fehlgeschlagen',
  'admin.i18n.job.status.cancelled': 'Abgebrochen',
  'admin.i18n.job.progress': '{done} von {total} Texten',
  'admin.i18n.job.failedCount': '{count} fehlgeschlagen',
  'admin.i18n.job.skippedCount': '{count} übersprungen (inzwischen von Hand geändert)',
  'admin.i18n.job.cost': 'USD {cost} von geschätzt USD {estimate}',
  'admin.i18n.job.tokens': '{input} Eingabe-Tokens, {output} Ausgabe-Tokens',
  'admin.i18n.job.startedBy': 'Gestartet von {name}, {when}',
  'admin.i18n.job.retryOf': 'Wiederholung eines früheren Auftrags',
  'admin.i18n.job.cancel': 'Auftrag abbrechen',
  'admin.i18n.job.cancelTitle': 'Auftrag abbrechen?',
  'admin.i18n.job.cancelText': 'Fertige Pakete bleiben gespeichert. Das laufende Paket wird verworfen.',
  'admin.i18n.job.cancelRequested': 'Wird abgebrochen…',
  'admin.i18n.job.retry': 'Fehlgeschlagene erneut versuchen',
  'admin.i18n.job.failures': 'Fehlgeschlagene Texte',
  'admin.i18n.job.showInEntries': 'In der Liste anzeigen',
  'admin.i18n.job.reason.missing': 'Keine Antwort für diesen Text',
  'admin.i18n.job.reason.empty': 'Leere Übersetzung',
  'admin.i18n.job.reason.placeholders': 'Platzhalter oder Zeilenumbrüche weichen ab',
  'admin.i18n.job.reason.characters': 'Nicht erlaubtes Zeichen',
  'admin.i18n.job.reason.content': 'Neue Links, E-Mail-Adressen oder Zahlen',
  'admin.i18n.job.reason.german': 'Sieht nach deutschem Text aus',
  'admin.i18n.job.reason.formality': 'Keine Höflichkeitsform',
  'admin.i18n.job.reason.length': 'Zu lang',
  'admin.i18n.job.reason.glossary': 'Glossarbegriff fehlt',
  'admin.i18n.job.reason.refusal': 'Von der KI abgelehnt',
  'admin.i18n.job.reason.error': 'Anfrage fehlgeschlagen',
  'admin.i18n.job.budgetJob':
    'Das KI-Budget dieses Monats ist aufgebraucht. Fertige Pakete bleiben gespeichert.',
  'admin.i18n.job.error.cost_cap':
    'Gestoppt: Der Auftrag hätte mehr als das Anderthalbfache der Schätzung gekostet.',
  'admin.i18n.job.error.ai_not_configured': 'Gestoppt: Die KI wurde während des Auftrags ausgeschaltet.',
  'admin.i18n.job.error.ai_upstream':
    'Gestoppt: Der KI-Dienst hat den Schlüssel oder das Konto abgelehnt. Prüfen Sie Verwaltung > KI.',
  'admin.i18n.job.error.ai_failed': 'Gestoppt: Mehrere Pakete hintereinander sind fehlgeschlagen.',

  // Glossary
  'admin.i18n.glossary.add': 'Begriff hinzufügen',
  'admin.i18n.glossary.term': 'Begriff (Deutsch)',
  'admin.i18n.glossary.keep': 'Nie übersetzen',
  'admin.i18n.glossary.note': 'Hinweis',
  'admin.i18n.glossary.builtIn': 'Standard',
  'admin.i18n.glossary.hint': 'Das Glossar gilt für KI-Übersetzungen und für die automatischen Prüfungen.',
  'admin.i18n.glossary.empty': 'Noch keine eigenen Begriffe.',
  'admin.i18n.glossary.deleteTitle': 'Begriff löschen?',
  'admin.i18n.glossary.deleteText':
    '{term} wird aus dem Glossar entfernt. Bestehende Übersetzungen bleiben unverändert.',
  'admin.i18n.glossary.saved': 'Glossar gespeichert',

  // Style notes
  'admin.i18n.style.title': 'Stilhinweise',
  'admin.i18n.style.hint':
    'Zusätzliche Hinweise pro Sprache für KI-Übersetzungen, zum Beispiel zur Anrede oder zu Begriffen.',
  'admin.i18n.style.defaults': 'Standardhinweise',
  'admin.i18n.style.saved': 'Stilhinweise gespeichert',

  // Import and export
  'admin.i18n.export.title': 'Export',
  'admin.i18n.export.overrides': 'Änderungen exportieren (JSON)',
  'admin.i18n.export.locale': 'Sprache für Übersetzer exportieren (JSON)',
  'admin.i18n.export.onlyMissing': 'Nur fehlende und veraltete Texte',
  'admin.i18n.export.applyHint':
    'Entwickler übernehmen die exportierten Änderungen mit pnpm --filter @weblion/api i18n:apply <Datei> in den Code. Nach dem nächsten Deploy können Sie die übernommenen Änderungen hier aufräumen.',
  'admin.i18n.import.title': 'Import',
  'admin.i18n.import.file': 'JSON-Datei wählen',
  'admin.i18n.import.replaceManual': 'Manuell geänderte Übersetzungen ersetzen',
  'admin.i18n.import.markReviewed': 'Importierte Texte als geprüft markieren',
  'admin.i18n.import.check': 'Prüfen',
  'admin.i18n.import.apply': 'Importieren',
  'admin.i18n.import.result':
    '{created} neu, {updated} geändert, {unchanged} unverändert, {skipped} übersprungen',
  'admin.i18n.import.done': 'Import abgeschlossen',
  'admin.i18n.import.skip.placeholders': 'Platzhalter weichen ab',
  'admin.i18n.import.skip.characters': 'Nicht erlaubtes Zeichen',
  'admin.i18n.import.skip.unknown_key': 'Unbekannter Schlüssel',
  'admin.i18n.import.skip.manual': 'Manuell geändert',
  'admin.i18n.import.skip.legal_ai': 'KI-Text für einen Rechtstext',
  'admin.i18n.import.skip.unchanged': 'Unverändert',

  // Clean up
  'admin.i18n.cleanup.title': 'Aufräumen',
  'admin.i18n.cleanup.text':
    '{orphans} Änderungen gehören zu Texten, die es nicht mehr gibt. {same} Änderungen sind schon im Code enthalten.',
  'admin.i18n.cleanup.demoNotice':
    'Dazu kommen {count} Demo-Übersetzungen ([FR] und ähnlich), die ebenfalls gelöscht werden.',
  'admin.i18n.cleanup.button': 'Aufräumen',
  'admin.i18n.cleanup.done': '{count} Änderungen gelöscht',

  // Error texts of the i18n error codes (localizeError)
  'admin.i18n.error.placeholder_mismatch':
    'Die Platzhalter müssen genau die des deutschen Textes sein. Fehlt: {missing}. Zu viel: {extra}.',
  'admin.i18n.error.forbidden_character':
    'Der Text enthält ein nicht erlaubtes Zeichen (scharfes S oder langer Gedankenstrich).',
  'admin.i18n.error.forbidden_character.pdf':
    'Texte der PDF-Rechnung dürfen nur Zeichen aus Windows-1252 enthalten (andere kann die Schrift der Rechnung nicht drucken), kein scharfes S und keinen langen Gedankenstrich. Nicht erlaubt: {characters}',
  'admin.i18n.error.unknown_key': 'Diesen Text gibt es nicht mehr. Laden Sie die Seite neu.',
  'admin.i18n.error.legal_key': 'Rechtstexte werden nie maschinell übersetzt.',
  'admin.i18n.error.nothing_to_translate': 'Für diese Auswahl gibt es nichts zu übersetzen.',
  'admin.i18n.error.estimate_changed':
    'Die geschätzten Kosten sind um mehr als 25 % gestiegen. Bitte prüfen Sie die neue Schätzung.',
  'admin.i18n.error.job_running':
    'Es läuft bereits eine Übersetzung. Warten Sie, bis sie fertig ist, oder brechen Sie sie ab.',
  'admin.i18n.error.job_finished': 'Dieser Auftrag ist bereits abgeschlossen.',
  'admin.i18n.error.not_stale': 'Diese Übersetzung ist bereits aktuell.',
  'admin.i18n.error.glossary_duplicate': 'Diesen Begriff gibt es im Glossar schon.',
  'admin.i18n.error.glossary_builtin': 'Standardbegriffe können geändert, aber nicht gelöscht werden.',
  'admin.i18n.error.import_invalid': 'Die Datei ist kein Übersetzungs-Export von weblion.one.',
} as const;
