import type { storageDe } from './storage.de';

export const storageNl: Partial<Record<keyof typeof storageDe, string>> = {
  'nav.cloud': 'Cloudopslag',
  'storage.subtitle':
    "Nextcloud-accounts voor de bestanden, agenda's en contacten van uw team, met opslagruimte uit uw quotum.",
  'storage.open': 'Nextcloud openen',
  'storage.create': 'Account aanmaken',
  'storage.noAccess': 'U heeft geen toegang tot de cloudopslag van deze organisatie.',
  'storage.none.title': 'Nog geen cloudopslag afgenomen',
  'storage.none.text':
    'Cloudopslag (Nextcloud) neemt u af via weblion.one. Zodra er een opslagquotum voor uw organisatie is ingericht, maakt u hier accounts voor uw team aan.',
  'storage.none.textReseller':
    'Cloudopslag (Nextcloud) neemt u af via {reseller}. Zodra er een opslagquotum voor uw organisatie is ingericht, maakt u hier accounts voor uw team aan.',
  'storage.noAllowanceAccounts':
    'Voor deze organisatie is geen opslagquotum meer ingericht. Bestaande accounts blijven werken, nieuwe kunnen niet worden aangemaakt.',
  'storage.limit.accounts':
    'Alle accounts van uw quotum zijn in gebruik. U kunt een account verwijderen of uw quotum uitbreiden om er meer aan te maken.',
  'storage.limit.storage':
    'Uw opslagquotum is volledig aan accounts toegewezen. Verklein een account of breid uw quotum uit om er meer aan te maken.',
  'storage.allowance': 'Opslagquotum',
  'storage.allowanceText':
    'Opslag die u over uw accounts verdeelt. In gebruik is wat de accounts werkelijk innemen.',
  'storage.toCustomers': 'Daarvan aan uw klanten toegekend: {size} en {n} accounts',
  'storage.figure.booked': 'Afgenomen',
  'storage.figure.allocated': 'Toegewezen',
  'storage.figure.used': 'In gebruik',
  'storage.figure.accounts': 'Accounts',
  'storage.accounts.of': '{n} van {max}',
  'storage.accounts.ofUnlimited': '{n} (onbeperkt)',
  'storage.meter.label': '{allocated} toegewezen, {used} in gebruik, van {quota}',
  'storage.meter.used': 'In gebruik',
  'storage.meter.allocated': 'Toegewezen',
  'storage.meter.free': 'Vrij',
  'storage.instance': 'Instantie',
  'storage.loginAt': 'Inloggen op',
  'storage.dashboardSub': '{allocated} van {quota} toegewezen',
  'storage.accounts': 'Accounts',
  'storage.accountsText': 'Elk account heeft een eigen opslagquotum en logt in met zijn inlognaam.',
  'storage.lastSync': 'Verbruik laatst bijgewerkt {when}',
  'storage.search': 'Account, naam of e-mail zoeken…',
  'storage.empty': 'Nog geen accounts',
  'storage.emptyText': 'Maak een account aan voor iedere persoon die Nextcloud moet gebruiken.',
  'storage.col.login': 'Inlognaam',
  'storage.col.name': 'Naam',
  'storage.col.email': 'E-mail',
  'storage.col.storage': 'Opslag',
  'storage.col.status': 'Status',
  'storage.col.lastLogin': 'Laatst ingelogd',
  'storage.copyLogin': 'Inlognaam kopiëren',
  'storage.usage.of': '{used} van {quota}',
  'storage.usage.unlimited': '{used} in gebruik, onbeperkt',
  'storage.usage.over': 'Quotum overschreden, uploads geblokkeerd',
  'storage.status.active': 'Actief',
  'storage.status.disabled': 'Gedeactiveerd',
  'storage.status.missing': 'Niet gevonden in Nextcloud',
  'storage.lastLogin.never': 'Nog nooit',
  'storage.createTitle': 'Cloudaccount aanmaken',
  'storage.createText': 'Een Nextcloud-account voor één persoon van uw team, met een eigen opslagquotum.',
  'storage.name': 'Gebruikersnaam',
  'storage.name.placeholder': 'anna',
  'storage.name.preview': 'Inlognaam:',
  'storage.name.hint':
    'Kleine letters, cijfers, punt, koppelteken en underscore. Kan later niet meer worden gewijzigd.',
  'storage.name.invalid':
    'Alleen kleine letters, cijfers, punt, koppelteken en underscore, aan het begin en eind een letter of een cijfer (maximaal 32 tekens).',
  'storage.name.tooLong': 'De inlognaam mag maximaal {max} tekens lang zijn.',
  'storage.name.taken': 'Dit account bestaat al.',
  'storage.displayName': 'Weergavenaam',
  'storage.displayName.placeholder': 'Anna Muster',
  'storage.email': 'E-mailadres',
  'storage.email.required': 'Vereist voor de uitnodiging.',
  'storage.email.invalid': 'Geen geldig e-mailadres.',
  'storage.email.needsPassword':
    'Alleen te wijzigen met het recht om wachtwoorden opnieuw in te stellen: uitnodigingen en links om het wachtwoord opnieuw in te stellen gaan naar dit adres.',
  'storage.email.changeHint': 'Nextcloud stuurt meldingen en uitnodigingen voortaan naar het nieuwe adres.',
  'storage.quota': 'Opslagquotum',
  'storage.quota.freeHint': 'Nog vrij in het quotum: {free}',
  'storage.quota.maxHint': 'Maximaal {max} (nog vrij in het quotum: {free})',
  'storage.quota.invalid': 'Voer een geheel getal vanaf 1 GB in.',
  'storage.quota.step':
    'Vanaf 1024 GB alleen in stappen van 512 GB (1024, 1536, 2048 …), andere waarden rondt Nextcloud af.',
  'storage.quota.tooLarge': 'Maximaal {max} past in het quotum.',
  'storage.quota.current': 'Momenteel {quota}. Leeg laten om dit te behouden.',
  'storage.quota.currentUnlimited': 'Momenteel onbeperkt. Leeg laten om dit zo te houden.',
  'storage.quota.used': 'In gebruik: {used}',
  'storage.quota.belowUsageTitle': 'Kleiner dan de gebruikte opslag',
  'storage.quota.belowUsage':
    'Het account gebruikt al {used}. Alle bestanden blijven bewaard, maar er kunnen geen nieuwe worden geüpload tot er bestanden worden verwijderd.',
  'storage.delivery': 'Toegang',
  'storage.delivery.password': 'Wachtwoord nu genereren',
  'storage.delivery.passwordText':
    'Het wachtwoord wordt één keer getoond. U geeft het zelf door. Met een e-mailadres stuurt Nextcloud daarnaast een welkomstmail.',
  'storage.delivery.invite': 'Uitnodiging per e-mail',
  'storage.delivery.inviteText': 'Nextcloud stuurt een link waarmee de persoon zelf een wachtwoord instelt.',
  'storage.delivery.needsEmail': 'Voor een uitnodiging is een e-mailadres nodig.',
  'storage.created': 'Account {username} aangemaakt',
  'storage.createdInvite': 'Account aangemaakt, uitnodiging verstuurd naar {email}',
  'storage.createdTitle': 'Account aangemaakt',
  'storage.editTitle': '{username} bewerken',
  'storage.updated': '{username} opgeslagen',
  'storage.disable': 'Deactiveren',
  'storage.enable': 'Activeren',
  'storage.disableTitle': '{username} deactiveren?',
  'storage.disableText':
    'De persoon kan niet meer inloggen en de apparaten van deze persoon synchroniseren niet meer. Bestanden en quotum blijven bewaard.',
  'storage.enableTitle': '{username} activeren?',
  'storage.enableText': 'De persoon kan weer inloggen.',
  'storage.enabledToast': '{username} geactiveerd',
  'storage.disabledToast': '{username} gedeactiveerd',
  'storage.resetPassword': 'Nieuw wachtwoord instellen',
  'storage.passwordTitle': 'Nieuw wachtwoord voor {username}?',
  'storage.passwordText':
    'Het huidige wachtwoord werkt daarna niet meer. Het nieuwe wachtwoord wordt één keer getoond.',
  'storage.passwordNewTitle': 'Nieuw wachtwoord',
  'storage.resendInvite': 'Uitnodiging opnieuw versturen',
  'storage.invitedToast': 'Uitnodiging verstuurd naar {email}',
  'storage.deleteTitle': '{username} verwijderen?',
  'storage.deleteConfirm': 'Definitief verwijderen',
  'storage.deleteWarningTitle': 'Alle bestanden worden verwijderd',
  'storage.deleteWarning':
    "Het account wordt in Nextcloud verwijderd, met alle bestanden ({used}), agenda's, contacten en shares. Dit kan niet ongedaan worden gemaakt.",
  'storage.deletedToast': '{username} verwijderd',
  'storage.allowance.setUp': 'Inrichten',
  'storage.allowance.setUpTitle': 'Cloudopslag voor {name} inrichten',
  'storage.allowance.editTitle': 'Cloudopslag van {name}',
  'storage.allowance.dialogText': 'Totale opslag en aantal accounts die de organisatie zelf verdeelt.',
  'storage.allowance.instanceHint': 'Alle accounts van de organisatie staan op deze Nextcloud-instantie.',
  'storage.allowance.instanceLocked':
    'De instantie kan alleen worden gewijzigd zolang er geen accounts op staan.',
  'storage.allowance.instanceLockedCustomers':
    'De instantie kan alleen worden gewijzigd zolang geen klanten van de reseller er een quotum op hebben.',
  'storage.allowance.quota': 'Totale opslag',
  'storage.allowance.allocatedHint': 'Al toegewezen: {size}',
  'storage.allowance.belowAllocated': 'Minimaal {size}, zoveel is al toegewezen.',
  'storage.allowance.maxAccounts': 'Maximaal aantal accounts',
  'storage.allowance.maxAccountsHint': 'Leeg laten voor een onbeperkt aantal accounts.',
  'storage.allowance.maxInvalid': 'Voer een geheel getal vanaf 1 in of laat het veld leeg.',
  'storage.allowance.maxBelowAccounts': 'Minimaal {n}, zoveel accounts bestaan er al.',
  'storage.allowance.unlimited': 'onbeperkt',
  'storage.allowance.enableModuleHint':
    '{org} ziet de cloudopslag alleen in de console als de module actief is.',
  'storage.allowance.moduleOff': 'Zonder de module "{module}" ziet de organisatie het quotum niet.',
  'storage.allowance.resellerHint':
    'Een reseller verdeelt dit quotum over eigen accounts en over zijn klanten.',
  'storage.allowance.saved': 'Opslagquotum opgeslagen',
  'storage.allowance.remove': 'Quotum verwijderen',
  'storage.allowance.removeTitle': 'Cloudopslag van {name} verwijderen?',
  'storage.allowance.removeText':
    'De organisatie kan daarna geen Nextcloud-accounts meer aanmaken. De module blijft actief tot u deze uitschakelt.',
  'storage.allowance.removeBlocked':
    'Alleen mogelijk zonder accounts. U kunt de accounts verwijderen of aan een andere organisatie toewijzen.',
  'storage.allowance.removeBlockedCustomers':
    'Alleen mogelijk zonder klantquota. Verwijder eerst de quota van de {n} klanten.',
  'storage.allowance.removed': 'Opslagquotum verwijderd',
  'storage.admin.tab': 'Cloudaccounts',
  'storage.admin.tabHint':
    'Opslagquota richt u bij de klant in, de accounts maken de klanten zelf aan. Gebruikers die rechtstreeks in Nextcloud zijn aangemaakt, neemt u hieronder over.',
  'storage.admin.search': 'Inlognaam, naam of e-mail zoeken…',
  'storage.admin.filterCustomer': 'Filteren op klant',
  'storage.admin.allCustomers': 'Alle klanten',
  'storage.admin.filterInstance': 'Filteren op instantie',
  'storage.admin.allInstances': 'Alle instanties',
  'storage.admin.empty': 'Geen cloudaccounts',
  'storage.admin.emptyText':
    'Accounts verschijnen hier zodra klanten ze aanmaken of u gebruikers van een instantie overneemt.',
  'storage.admin.synced': '{seen} cloudaccounts gesynchroniseerd, {missing} ontbreken',
  'storage.admin.cardText': 'Opslag die de organisatie over Nextcloud-accounts kan verdelen.',
  'storage.admin.none': 'Geen cloudopslag',
  'storage.admin.noneText': 'Richt een quotum in, zodat de organisatie Nextcloud-accounts kan aanmaken.',
  'storage.admin.showAccounts': 'Accounts tonen',
  'storage.admin.noInstance': 'Er is nog geen Nextcloud-instantie als provider gekoppeld.',
  'storage.admin.noModule': 'zonder cloudopslag',
  'storage.admin.needsAllowance': 'De klant heeft een opslagquotum op dezelfde instantie nodig.',
  'storage.admin.assignText': 'Het account staat op {instance}. De klant beheert het daarna in zijn console.',
  'storage.admin.assignQuotaHint':
    'Het quotum van het account telt daarna mee voor het opslagquotum van de klant, ook als het dat overschrijdt.',
  'storage.admin.unassignText':
    '{org} ziet het account daarna niet meer. Het account en zijn bestanden blijven in Nextcloud bestaan.',
  'storage.unmanaged.title': 'Niet-beheerde gebruikers',
  'storage.unmanaged.text':
    'Gebruikers die rechtstreeks in Nextcloud zijn aangemaakt. Overgenomen gebruikers behouden hun naam en quotum.',
  'storage.unmanaged.load': 'Gebruikers ophalen',
  'storage.unmanaged.reload': 'Opnieuw laden',
  'storage.unmanaged.hint':
    'Haalt de gebruikers van {instance} op en toont de gebruikers die de console nog niet beheert. Beheerders van de instantie verschijnen nooit.',
  'storage.unmanaged.empty': 'Alle gebruikers van {instance} worden beheerd',
  'storage.unmanaged.import': 'Overnemen',
  'storage.unmanaged.importTitle': '{username} overnemen',
  'storage.unmanaged.importText':
    'De console beheert de gebruiker daarna. Naam, quotum en bestanden blijven ongewijzigd.',
  'storage.unmanaged.noCustomer': '– aan geen klant toewijzen –',
  'storage.unmanaged.unlimitedHint':
    'De gebruiker heeft geen quotum (onbeperkt). Bij de klant telt hij mee met de gebruikte opslag, tot er een quotum is ingesteld.',
  'storage.unmanaged.imported': '{username} overgenomen',
  'storage.reseller.cardText': 'Opslag uit uw quotum die de klant over eigen Nextcloud-accounts verdeelt.',
  'storage.reseller.none': 'Geen cloudopslag toegekend',
  'storage.reseller.noneText':
    'Ken de klant een deel van uw quotum toe, zodat hij Nextcloud-accounts kan aanmaken.',
  'storage.reseller.pool': 'Uw quotum: {free} van {quota} vrij',
  'storage.reseller.noPool':
    'Uw organisatie heeft nog geen quotum voor cloudopslag. Neem contact op met weblion.one om opslag af te nemen.',
  'storage.reseller.dialogText':
    'Uit uw quotum op {instance}. De klant verdeelt de opslag zelf over zijn accounts.',
  'storage.reseller.quotaHint': 'Maximaal {max} uit uw quotum',
  'storage.reseller.accountsLeft': 'Maximaal {n} uit uw quotum',
  'storage.reseller.maxRequired': 'Uw quotum heeft een maximumaantal accounts. Voer maximaal {n} in.',
  'storage.reseller.maxTooHigh': 'In uw quotum zijn nog maar {n} accounts vrij.',
  'storage.reseller.enablesModule': 'Dit activeert ook de module Cloudopslag voor de klant.',
  'storage.reseller.removeText':
    'De klant kan daarna geen Nextcloud-accounts meer aanmaken. De opslag gaat terug naar uw quotum.',
  'storage.reseller.removeBlocked':
    'Alleen mogelijk zonder accounts. De klant moet eerst zijn accounts verwijderen.',
  'providers.nextcloud.help':
    'Maak in Nextcloud een eigen beheerdersaccount voor de console aan (lid van de groep "admin") en maak daarvoor onder Persoonlijke instellingen > Beveiliging een app-wachtwoord aan. Voor uitnodigingen moet de instantie e-mails kunnen versturen (Beheer > Basisinstellingen > E-mailserver).',
  'providers.nextcloud.url': 'URL van de instantie',
  'providers.nextcloud.urlHint': 'Het adres waarop gebruikers inloggen, bijv. https://cloud.weblion.one',
  'providers.nextcloud.username': 'Admin-gebruiker',
  'providers.nextcloud.usernameHint':
    'Inlognaam van het beheerdersaccount voor de console, niet uw persoonlijke account.',
  'providers.nextcloud.appPassword': 'App-wachtwoord',
  'providers.nextcloud.appPasswordHint':
    'Persoonlijke instellingen > Beveiliging > Apparaten & sessies > Nieuw app-wachtwoord aanmaken.',
  'providers.nextcloud.groupPrefix': 'Groepsprefix',
  'providers.nextcloud.groupPrefixHint':
    "Optioneel. Elke organisatie krijgt de groep <prefix><afkorting>, zodat collega's onderling kunnen delen. Standaard: {prefix}",
  'providers.nextcloud.groupPrefixChange':
    'Standaard: {prefix}. Een nieuw prefix geldt alleen voor nieuwe accounts, bestaande blijven in hun groepen.',
  'providers.nextcloud.groupPrefixInvalid':
    'Kleine letters, cijfers, punt, koppelteken en underscore, maximaal 31 tekens.',
  'providers.nextcloud.accountsText':
    'Accounts van deze instantie, toewijzing aan klanten en overname van gebruikers die rechtstreeks in Nextcloud zijn aangemaakt.',
  'providers.nextcloud.toAccounts': 'Naar de cloudaccounts',
  'explorer.nextcloudPath':
    'OCS-paden, bijv. /ocs/v2.php/cloud/users?search=anna. Wachtwoorden in antwoorden worden verborgen, app-wachtwoorden kunnen hier niet worden beheerd.',
  'explorer.nextcloudBodyHint':
    'GET en DELETE sturen de parameters als query, POST en PUT als formulier, bijv. { "key": "quota", "value": "10 GB" }.',
};
