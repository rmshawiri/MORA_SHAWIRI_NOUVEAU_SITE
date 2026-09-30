/**
 * Vérification de la relation client contre la base réelle — phase 4F.
 *
 *   node scripts/verify-relation.mjs --env shared
 *
 * ## Pourquoi ce script existe, et pourquoi les tests unitaires ne suffisent pas
 *
 * `tests/unit/relation.test.ts` lit le SQL ; il ne l'exécute pas. Le défaut le
 * plus grave de la phase 4E-1 — un garde déclaré `SECURITY DEFINER`, donc
 * inopérant — se lisait **correctement** et s'installait sans une erreur.
 * Seule une exécution avec de vraies sessions l'a révélé.
 *
 * Ce script éprouve donc chaque profil du point 16 du cadrage contre la vraie
 * base, avec de vrais comptes et de vraies permissions :
 *
 *   * visiteur anonyme — soumet, et ne lit rien ;
 *   * CLIENT A et CLIENT B — chacun ses demandes, jamais celles de l'autre ;
 *   * AFFILIE — rien, parce qu'être affilié n'ouvre rien ici ;
 *   * ADMIN sans permission — rien non plus ;
 *   * ADMIN `quotes.view` — lit tout, n'écrit rien ;
 *   * ADMIN `+ quotes.update` — affecte, ne décide pas du statut ;
 *   * ADMIN `+ quotes.manage` — décide, dans les limites du graphe ;
 *   * ADMIN `appointments.update` — confirme, ne peut pas annuler ;
 *   * ADMIN `+ appointments.cancel` — annule ;
 *   * ADMIN `+ appointments.manage` — administre les disponibilités.
 *
 * ## Données de test
 *
 * Les comptes portent `@mora-shawiri.test`, les demandes un sujet préfixé
 * `verif-relation`. Tout est supprimé en fin d'exécution, et le script vérifie
 * ensuite qu'aucun résidu ne reste. Le journal d'audit conserve ses traces :
 * c'est son fonctionnement normal, et le point 31 du cadrage l'autorise.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import {
  describeTarget,
  log,
  resolveAccessToken,
  resolveTarget,
  runSql,
} from './lib/config.mjs';

const results = { passed: 0, failed: 0 };

function check(label, condition, detail = '') {
  if (condition) {
    results.passed += 1;
    log.ok(label);
  } else {
    results.failed += 1;
    log.fail(`${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Une écriture est refusée si elle lève, ou si elle n'a touché aucune ligne. */
function refused(result) {
  return Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0);
}

const TEST_DOMAIN = 'mora-shawiri.test';
const PREFIX = 'verif-relation';
const PASSWORD = `Verif-4F-${randomUUID()}`;

/** Empreinte distincte par scénario : les compteurs de fréquence ne se mêlent pas. */
const hash = () => randomUUID().replace(/-/g, '');

function sessionClient(target) {
  return createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(target, email) {
  const client = sessionClient(target);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`connexion impossible pour ${email} : ${error.message}`);
  return client;
}

async function createAccount(admin, { roleCode, grants = [], label }) {
  const email = `${PREFIX}-${label}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });

  if (error || !data.user) throw new Error(`création de ${label} : ${error?.message}`);
  const userId = data.user.id;

  const { data: role } = await admin.from('roles').select('id').eq('code', roleCode).maybeSingle();
  if (!role) throw new Error(`rôle ${roleCode} introuvable`);

  await admin.from('user_roles').upsert(
    { user_id: userId, role_id: role.id },
    { onConflict: 'user_id,role_id' },
  );

  if (grants.length > 0) {
    const { data: permissions } = await admin
      .from('permissions')
      .select('id, code')
      .in('code', grants);

    if ((permissions ?? []).length !== grants.length) {
      throw new Error(`catalogue de permissions incomplet pour ${label}`);
    }

    const written = await admin.from('user_permissions').upsert(
      permissions.map((row) => ({ user_id: userId, permission_id: row.id, effect: 'OCTROI' })),
      { onConflict: 'user_id,permission_id' },
    );

    if (written.error) throw new Error(written.error.message);
  }

  return { userId, email };
}

/** Soumission d'une demande, telle que la route publique l'émet. */
function submitQuote(client, overrides = {}) {
  return client.rpc('submit_quote_request', {
    p_full_name: 'Contrôle Relation',
    p_email: `${PREFIX}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`,
    p_phone: '+269 000 00 00',
    p_organisation: null,
    p_subject: `${PREFIX} besoin`,
    p_budget: null,
    p_message: `${PREFIX} message de contrôle.`,
    p_service_slug: null,
    p_offer_title: null,
    p_details: [],
    p_source: 'contact',
    p_client_hash: hash(),
    ...overrides,
  });
}

function submitAppointment(client, overrides = {}) {
  return client.rpc('submit_appointment_request', {
    p_full_name: 'Contrôle Rendez-vous',
    p_email: `${PREFIX}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`,
    p_phone: '+269 000 00 00',
    p_organisation: null,
    p_subject: `${PREFIX} rendez-vous`,
    p_channel_label: 'Appel téléphonique',
    p_requested_date: '2027-03-15',
    p_requested_slot: 'Matin (08H – 12H)',
    p_budget: null,
    p_message: `${PREFIX} contexte.`,
    p_service_slug: null,
    p_details: [],
    p_source: 'rendez-vous',
    p_client_hash: hash(),
    ...overrides,
  });
}

/* ========================================================================== */
/*  1. Le visiteur anonyme                                                    */
/* ========================================================================== */

async function checkAnonymous(target, admin, state) {
  log.step('Visiteur anonyme');

  const anon = sessionClient(target);

  const email = `${PREFIX}-visiteur-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;
  const created = await submitQuote(anon, { p_email: email });

  check(
    'un visiteur peut déposer une demande',
    !created.error && created.data?.[0]?.reference,
    created.error?.message,
  );

  const reference = created.data?.[0]?.reference ?? null;
  state.anonymousReference = reference;
  state.anonymousEmail = email;

  check(
    'la référence suit la nomenclature D-2 pour une demande',
    /^MORA-DMCL-[A-Z]+\d{4}$/.test(reference ?? ''),
    reference ?? 'aucune référence',
  );

  // § 99 et point E du cadrage : la même demande, deux fois, n'en fait qu'une.
  const again = await submitQuote(anon, {
    p_email: email,
    p_full_name: 'Contrôle Relation',
    p_subject: `${PREFIX} besoin`,
    p_message: `${PREFIX} message de contrôle.`,
  });

  check(
    'une seconde soumission identique ne crée pas de doublon',
    again.data?.[0]?.duplicate === true && again.data?.[0]?.reference === reference,
    again.error?.message,
  );

  const { count } = await admin
    .from('quote_requests')
    .select('id', { count: 'exact', head: true })
    .eq('reference', reference);

  check('une seule ligne existe pour cette référence', count === 1, `${count} ligne(s)`);

  // Limitation de fréquence partagée : cinq par fenêtre, la sixième refusée.
  const shared = hash();
  let blocked = false;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const burst = await submitQuote(anon, { p_client_hash: shared });
    if (burst.error) {
      blocked = true;
      break;
    }
    state.burstReferences.push(burst.data?.[0]?.reference);
  }
  check('une rafale depuis la même connexion finit par être refusée', blocked);

  // Validation : un message vide n'est pas une demande.
  const empty = await submitQuote(anon, { p_message: '   ' });
  check('une demande sans message est refusée', Boolean(empty.error));

  const noSubject = await submitQuote(anon, { p_subject: '' });
  check('une demande sans sujet est refusée', Boolean(noSubject.error));

  const badEmail = await submitQuote(anon, { p_email: 'pas-une-adresse' });
  check('une adresse invalide est refusée', Boolean(badEmail.error));

  // Rendez-vous.
  const rdv = await submitAppointment(anon);
  check('un visiteur peut demander un rendez-vous', !rdv.error && rdv.data?.[0]?.created === true,
    rdv.error?.message);

  /* --- Et maintenant : il ne lit rien. --------------------------------- */

  for (const table of [
    'leads',
    'quote_requests',
    'quotes',
    'quote_request_events',
    'appointments',
    'appointment_events',
    'appointment_availabilities',
    'relation_notes',
  ]) {
    const read = await anon.from(table).select('*').limit(1);
    check(
      `un visiteur anonyme ne lit rien dans ${table}`,
      Boolean(read.error) || (read.data ?? []).length === 0,
      read.error ? '' : 'des lignes lui parviennent',
    );
  }

  // Connaître la référence ne donne rien : ce n'est pas un masquage, la ligne
  // n'existe pas pour cette session.
  const direct = await anon.from('quote_requests').select('id').eq('reference', reference);
  check(
    'connaître une référence ne donne aucun accès',
    Boolean(direct.error) || (direct.data ?? []).length === 0,
  );

  // Aucune écriture directe : la fonction est la seule porte.
  const write = await anon
    .from('quote_requests')
    .update({ status: 'ACCEPTEE' })
    .eq('reference', reference)
    .select('id');
  check('un visiteur anonyme ne modifie aucune demande', refused(write));
}

/* ========================================================================== */
/*  2. CLIENT A contre CLIENT B                                               */
/* ========================================================================== */

async function checkClients(target, admin, accounts, state) {
  log.step('CLIENT A contre CLIENT B');

  const clientA = await signIn(target, accounts.clientA.email);
  const clientB = await signIn(target, accounts.clientB.email);

  const submittedA = await submitQuote(clientA, { p_email: accounts.clientA.email });
  check(
    'un CLIENT connecté peut déposer une demande',
    !submittedA.error && submittedA.data?.[0]?.reference,
    submittedA.error?.message,
  );

  const refA = submittedA.data?.[0]?.reference;
  state.clientAReference = refA;

  const { data: rowA } = await admin
    .from('quote_requests')
    .select('id, user_id, lead_id')
    .eq('reference', refA)
    .maybeSingle();

  check(
    'la demande est rattachée au compte connecté, côté serveur',
    rowA?.user_id === accounts.clientA.userId,
    `user_id = ${rowA?.user_id}`,
  );

  const submittedB = await submitQuote(clientB, { p_email: accounts.clientB.email });
  const refB = submittedB.data?.[0]?.reference;
  state.clientBReference = refB;

  /* --- Le cas indispensable du point 16 ------------------------------- */

  const { data: seenByA } = await clientA.from('quote_requests').select('reference');
  const referencesA = (seenByA ?? []).map((row) => row.reference);

  check('CLIENT A voit sa propre demande', referencesA.includes(refA));
  check(
    'CLIENT A ne voit jamais la demande de CLIENT B',
    !referencesA.includes(refB),
    'la demande d’un autre client lui parvient',
  );

  const targeted = await clientA.from('quote_requests').select('id').eq('reference', refB);
  check(
    'CLIENT A n’obtient rien en visant la référence de CLIENT B',
    Boolean(targeted.error) || (targeted.data ?? []).length === 0,
  );

  const hijack = await clientA
    .from('quote_requests')
    .update({ status: 'ACCEPTEE' })
    .eq('reference', refB)
    .select('id');
  check('CLIENT A ne modifie pas la demande de CLIENT B', refused(hijack));

  const ownUpdate = await clientA
    .from('quote_requests')
    .update({ status: 'ACCEPTEE' })
    .eq('reference', refA)
    .select('id');
  check('CLIENT A ne modifie pas non plus sa propre demande', refused(ownUpdate));

  /* --- L'usurpation par l'adresse ------------------------------------- */

  // CLIENT A dépose une demande en saisissant l'adresse de CLIENT B. Le
  // rattachement de la fiche prospect ne doit pas lui être accordé : sans cela
  // il lirait le nom et le téléphone d'un tiers.
  const spoof = await submitQuote(clientA, { p_email: accounts.clientB.email });
  state.spoofReference = spoof.data?.[0]?.reference;

  const { data: spoofedLead } = await admin
    .from('leads')
    .select('user_id')
    .eq('email', accounts.clientB.email.toLowerCase())
    .maybeSingle();

  check(
    'saisir l’adresse d’un tiers ne rattache pas sa fiche prospect',
    spoofedLead?.user_id !== accounts.clientA.userId,
    `user_id = ${spoofedLead?.user_id}`,
  );

  const leadsByA = await clientA.from('leads').select('email').limit(5);
  check(
    'un CLIENT ne lit aucune fiche prospect',
    Boolean(leadsByA.error) || (leadsByA.data ?? []).length === 0,
  );

  const notesByA = await clientA.from('relation_notes').select('body').limit(5);
  check(
    'un CLIENT ne lit aucune note interne',
    Boolean(notesByA.error) || (notesByA.data ?? []).length === 0,
  );

  return { clientA, clientB };
}

/* ========================================================================== */
/*  3. AFFILIE et ADMIN sans permission                                       */
/* ========================================================================== */

async function checkNoAccess(target, accounts) {
  log.step('AFFILIE et ADMIN sans permission');

  for (const [label, account] of [
    ['un AFFILIE', accounts.affilie],
    ['un ADMIN sans permission', accounts.adminNu],
  ]) {
    const client = await signIn(target, account.email);

    for (const table of ['leads', 'quote_requests', 'quotes', 'appointments', 'relation_notes']) {
      const read = await client.from(table).select('*').limit(1);
      check(
        `${label} ne lit rien dans ${table}`,
        Boolean(read.error) || (read.data ?? []).length === 0,
        read.error ? '' : 'des lignes lui parviennent',
      );
    }

    const availability = await client
      .from('appointment_availabilities')
      .insert({ kind: 'OUVERTURE', weekday: 1, starts_at: '08:00', ends_at: '12:00' })
      .select('id');
    check(`${label} ne déclare aucune disponibilité`, refused(availability));
  }
}

/* ========================================================================== */
/*  4. Les degrés de permission sur une demande                               */
/* ========================================================================== */

async function checkQuotePermissions(target, admin, accounts, state) {
  log.step('Demandes — consulter, modifier, décider');

  const reference = state.anonymousReference;

  const lecteur = await signIn(target, accounts.quotesView.email);
  const modificateur = await signIn(target, accounts.quotesUpdate.email);
  const gestionnaire = await signIn(target, accounts.quotesManage.email);

  const { data: seen } = await lecteur.from('quote_requests').select('reference').limit(200);
  check(
    'un ADMIN quotes.view lit les demandes de tous',
    (seen ?? []).some((row) => row.reference === reference),
  );

  const readOnly = await lecteur
    .from('quote_requests')
    .update({ status: 'EN_ETUDE' })
    .eq('reference', reference)
    .select('id');
  check('quotes.view seul n’écrit rien', refused(readOnly));

  // Modifier n'est pas décider : c'est la règle du point 11 du cadrage.
  const statusByUpdater = await modificateur
    .from('quote_requests')
    .update({ status: 'EN_ETUDE' })
    .eq('reference', reference)
    .select('id');
  check(
    'quotes.update ne suffit pas à changer un statut',
    refused(statusByUpdater),
    statusByUpdater.error ? '' : 'le statut a changé',
  );

  const assign = await modificateur
    .from('quote_requests')
    .update({ assigned_to: accounts.quotesManage.userId })
    .eq('reference', reference)
    .select('id');
  check('quotes.update affecte une demande', !refused(assign), assign.error?.message);

  const legal = await gestionnaire
    .from('quote_requests')
    .update({ status: 'EN_ETUDE' })
    .eq('reference', reference)
    .select('status');
  check(
    'quotes.manage change un statut légal',
    !refused(legal) && legal.data?.[0]?.status === 'EN_ETUDE',
    legal.error?.message,
  );

  // Le graphe est fermé : on ne saute pas une étape.
  const illegal = await gestionnaire
    .from('quote_requests')
    .update({ status: 'DEVIS_ENVOYE' })
    .eq('reference', reference)
    .select('id');
  check(
    '« Devis envoyé » est refusé tant qu’aucun devis n’est émis',
    refused(illegal),
    illegal.error?.message ?? 'accepté à tort',
  );

  // La référence est immuable, et hors de portée d'une session.
  const rewrite = await gestionnaire
    .from('quote_requests')
    .update({ reference: 'MORA-DMCL-Z9999' })
    .eq('reference', reference)
    .select('id');
  check('une session ne réécrit pas une référence', refused(rewrite));

  // Le message est conservé intégralement : il n'est modifiable par personne.
  const rewriteMessage = await gestionnaire
    .from('quote_requests')
    .update({ message: 'effacé' })
    .eq('reference', reference)
    .select('id');
  check('le message libre n’est modifiable par aucune session', refused(rewriteMessage));

  const { data: intact } = await admin
    .from('quote_requests')
    .select('message')
    .eq('reference', reference)
    .maybeSingle();
  check(
    'le message est conservé intégralement',
    intact?.message === `${PREFIX} message de contrôle.`,
    intact?.message,
  );

  return { lecteur, modificateur, gestionnaire };
}

/* ========================================================================== */
/*  5. Le devis et le Moteur de Documents                                     */
/* ========================================================================== */

async function checkQuotes(target, admin, accounts, clients, sessions, state) {
  log.step('Devis et Moteur de Documents');

  const reference = state.anonymousReference;

  const { data: request } = await admin
    .from('quote_requests')
    .select('id')
    .eq('reference', reference)
    .maybeSingle();

  // Un brouillon, créé par un compte habilité.
  const draft = await sessions.gestionnaire
    .from('quotes')
    .insert({
      quote_request_id: request.id,
      amount: '150000.00',
      summary: `${PREFIX} périmètre de contrôle`,
      status: 'BROUILLON',
    })
    .select('id, reference, status')
    .maybeSingle();

  check('un devis se crée en brouillon', !draft.error && draft.data?.status === 'BROUILLON',
    draft.error?.message);
  check('un brouillon ne consomme aucun numéro', draft.data?.reference === null);

  state.quoteId = draft.data?.id ?? null;

  // Un brouillon n'est pas visible du client : § 27 de l'espace client.
  const seenByClient = await clients.clientA.from('quotes').select('id').eq('id', state.quoteId);
  check(
    'un brouillon de devis n’est pas visible du demandeur',
    Boolean(seenByClient.error) || (seenByClient.data ?? []).length === 0,
  );

  // Sortir du brouillon sans passer par send_quote est impossible : la colonne
  // `reference` est hors de portée, et la contrainte l'exige.
  const forced = await sessions.gestionnaire
    .from('quotes')
    .update({ status: 'ENVOYE' })
    .eq('id', state.quoteId)
    .select('id');
  check(
    'une session ne fait pas sortir un devis du brouillon elle-même',
    refused(forced),
    forced.error?.message ?? 'accepté à tort',
  );

  // Sans second facteur, l'émission est refusée — le contrôle AAL2 de 4C.
  const withoutMfa = await sessions.gestionnaire.rpc('send_quote', { p_quote_id: state.quoteId });
  check(
    'une session sans second facteur n’émet pas de devis',
    Boolean(withoutMfa.error),
    withoutMfa.error ? '' : 'émission acceptée à tort',
  );

  // Sans quotes.manage non plus.
  const withoutPermission = await sessions.lecteur.rpc('send_quote', { p_quote_id: state.quoteId });
  check('quotes.view seul n’émet pas de devis', Boolean(withoutPermission.error));

  // Le chemin réel, côté serveur : le contrôle a eu lieu dans l'action.
  const issued = await admin.rpc('send_quote', { p_quote_id: state.quoteId });
  check('le devis est émis par le Moteur de Documents', !issued.error, issued.error?.message);
  check(
    'la référence du devis suit la nomenclature documentaire',
    /^MORA-DVCL-[A-Z]+\d{4}$/.test(issued.data?.reference ?? ''),
    issued.data?.reference,
  );

  state.quoteReference = issued.data?.reference ?? null;
  state.documentId = issued.data?.document_id ?? null;

  const { data: document } = await admin
    .from('documents')
    .select('reference, doc_type, entity_type, entity_id, metadata')
    .eq('id', state.documentId)
    .maybeSingle();

  check('une pièce DVCL a été émise', document?.doc_type === 'DVCL');
  check('la pièce porte la même référence que le devis', document?.reference === state.quoteReference);
  check('la pièce est reliée au devis', document?.entity_id === state.quoteId);

  // Point 17 : les métadonnées documentaires ne recopient pas de coordonnées.
  const metadata = JSON.stringify(document?.metadata ?? {});
  check(
    'la pièce ne porte ni adresse, ni téléphone, ni message',
    !/@|\+269|message/.test(metadata),
    metadata,
  );

  const { data: followed } = await admin
    .from('quote_requests')
    .select('status')
    .eq('reference', reference)
    .maybeSingle();
  check('la demande passe à « Devis envoyé »', followed?.status === 'DEVIS_ENVOYE');

  // Émettre deux fois consommerait un second numéro pour la même pièce.
  const twice = await admin.rpc('send_quote', { p_quote_id: state.quoteId });
  check('un devis déjà émis ne se réémet pas', Boolean(twice.error));

  // Les deux codes de numérotation métier n'émettent aucun document.
  for (const code of ['DMCL', 'RVCL']) {
    const attempt = await admin.rpc('issue_document', { p_type: code });
    check(`le code ${code} n’émet aucun document`, Boolean(attempt.error));
  }

  /* --- L'historique métier, et l'audit, sont deux choses -------------- */

  const { data: events } = await admin
    .from('quote_request_events')
    .select('kind, from_status, to_status, quote_reference')
    .eq('quote_request_id', request.id)
    .order('created_at', { ascending: true });

  const kinds = (events ?? []).map((event) => event.kind);
  check('l’historique métier consigne la création', kinds.includes('CREATION'));
  check('l’historique métier consigne le changement de statut', kinds.includes('STATUT'));
  check('l’historique métier consigne la création du devis', kinds.includes('DEVIS_CREE'));
  check('l’historique métier consigne l’émission du devis', kinds.includes('DEVIS_STATUT'));
  check('l’historique métier consigne l’affectation', kinds.includes('AFFECTATION'));

  const { data: audit } = await admin
    .from('audit_logs')
    .select('action, metadata')
    .eq('resource_type', 'quote_requests')
    .eq('resource_id', request.id)
    .order('created_at', { ascending: false })
    .limit(20);

  check('le journal d’audit a reçu les mêmes faits', (audit ?? []).length > 0);

  const auditText = JSON.stringify(audit ?? []);
  check(
    'le journal d’audit ne recopie ni message, ni adresse, ni téléphone',
    !auditText.includes(`${PREFIX} message de contrôle.`) &&
      !auditText.includes('@mora-shawiri.test') &&
      !auditText.includes('+269'),
  );

  check(
    'le journal d’audit reste distinct de l’historique métier',
    (audit ?? []).every((row) => row.action.startsWith('relation.')),
  );

  /* --- Un devis émis est visible de son demandeur --------------------- */

  const { data: clientRequest } = await admin
    .from('quote_requests')
    .select('id')
    .eq('reference', state.clientAReference)
    .maybeSingle();

  const clientQuote = await admin
    .from('quotes')
    .insert({
      quote_request_id: clientRequest.id,
      amount: '90000.00',
      summary: `${PREFIX} devis du client`,
      status: 'BROUILLON',
    })
    .select('id')
    .maybeSingle();

  state.clientQuoteId = clientQuote.data?.id ?? null;

  const hiddenDraft = await clients.clientA.from('quotes').select('id').eq('id', state.clientQuoteId);
  check(
    'le demandeur ne voit pas son devis tant qu’il est en brouillon',
    (hiddenDraft.data ?? []).length === 0,
  );

  await admin.rpc('send_quote', { p_quote_id: state.clientQuoteId });

  const visible = await clients.clientA.from('quotes').select('id').eq('id', state.clientQuoteId);
  check('le demandeur voit son devis une fois émis', (visible.data ?? []).length === 1);

  const otherQuote = await clients.clientB.from('quotes').select('id').eq('id', state.clientQuoteId);
  check('CLIENT B ne voit pas le devis de CLIENT A', (otherQuote.data ?? []).length === 0);
}

/* ========================================================================== */
/*  6. Rendez-vous : confirmation, chevauchement, annulation                  */
/* ========================================================================== */

async function checkAppointments(target, admin, accounts, state) {
  log.step('Rendez-vous — confirmation, chevauchement, annulation');

  const confirmateur = await signIn(target, accounts.rdvUpdate.email);
  const annulateur = await signIn(target, accounts.rdvCancel.email);

  const first = await submitAppointment(sessionClient(target));
  const second = await submitAppointment(sessionClient(target));
  check('deux demandes de rendez-vous sont enregistrées', !first.error && !second.error);

  const { data: pending } = await admin
    .from('appointments')
    .select('id, status, reference')
    .ilike('subject', `${PREFIX}%`)
    .order('created_at', { ascending: true });

  check('une demande de rendez-vous naît « En attente »', pending?.[0]?.status === 'EN_ATTENTE');
  check('une demande de rendez-vous ne consomme aucun numéro', pending?.[0]?.reference === null);

  state.appointmentIds = (pending ?? []).map((row) => row.id);

  const [firstId, secondId] = state.appointmentIds;

  // Confirmer directement, sans passer par la fonction, est impossible : la
  // colonne `reference` est hors de portée et la contrainte l'exige.
  const forced = await confirmateur
    .from('appointments')
    .update({
      status: 'CONFIRME',
      scheduled_at: '2027-03-15T06:00:00Z',
      scheduled_end: '2027-03-15T07:00:00Z',
    })
    .eq('id', firstId)
    .select('id');
  check(
    'une session ne confirme pas un rendez-vous par mise à jour directe',
    refused(forced),
    forced.error?.message ?? 'accepté à tort',
  );

  // Sans second facteur, la confirmation est refusée.
  const withoutMfa = await confirmateur.rpc('confirm_appointment', {
    p_appointment_id: firstId,
    p_scheduled_at: '2027-03-15T06:00:00Z',
    p_scheduled_end: '2027-03-15T07:00:00Z',
  });
  check(
    'une session sans second facteur ne confirme pas',
    Boolean(withoutMfa.error),
    withoutMfa.error ? '' : 'confirmation acceptée à tort',
  );

  // Le chemin réel, côté serveur.
  const confirmed = await admin.rpc('confirm_appointment', {
    p_appointment_id: firstId,
    p_scheduled_at: '2027-03-15T06:00:00Z',
    p_scheduled_end: '2027-03-15T07:00:00Z',
  });

  check('le rendez-vous est confirmé', !confirmed.error, confirmed.error?.message);
  check(
    'la référence suit la nomenclature D-2 pour un rendez-vous',
    /^MORA-RVCL-[A-Z]+\d{4}$/.test(confirmed.data?.reference ?? ''),
    confirmed.data?.reference,
  );
  state.appointmentReference = confirmed.data?.reference ?? null;

  /* --- Le test central : aucun créneau réservé deux fois -------------- */

  const overlap = await admin.rpc('confirm_appointment', {
    p_appointment_id: secondId,
    p_scheduled_at: '2027-03-15T06:30:00Z',
    p_scheduled_end: '2027-03-15T07:30:00Z',
  });
  check(
    'un créneau qui chevauche un rendez-vous confirmé est refusé',
    Boolean(overlap.error),
    overlap.error ? '' : 'double réservation acceptée',
  );

  const adjacent = await admin.rpc('confirm_appointment', {
    p_appointment_id: secondId,
    p_scheduled_at: '2027-03-15T07:00:00Z',
    p_scheduled_end: '2027-03-15T08:00:00Z',
  });
  check(
    'un créneau qui commence à la fin du précédent est accepté',
    !adjacent.error,
    adjacent.error?.message,
  );

  /* --- Les permissions d'annulation ---------------------------------- */

  const cancelByUpdater = await confirmateur
    .from('appointments')
    .update({ status: 'ANNULE' })
    .eq('id', firstId)
    .select('id');
  check(
    'appointments.update ne suffit pas à annuler',
    refused(cancelByUpdater),
    cancelByUpdater.error ? '' : 'annulation acceptée à tort',
  );

  const cancelled = await annulateur
    .from('appointments')
    .update({ status: 'ANNULE', cancel_reason: `${PREFIX} motif` })
    .eq('id', firstId)
    .select('status');
  check(
    'appointments.cancel annule le rendez-vous',
    !refused(cancelled) && cancelled.data?.[0]?.status === 'ANNULE',
    cancelled.error?.message,
  );

  // § 64 : le créneau libéré redevient disponible.
  const third = await submitAppointment(sessionClient(target));
  check('une troisième demande est enregistrée', !third.error);

  const { data: rows } = await admin
    .from('appointments')
    .select('id, created_at')
    .ilike('subject', `${PREFIX}%`)
    .order('created_at', { ascending: true });

  const thirdId = rows?.[rows.length - 1]?.id;
  state.appointmentIds = (rows ?? []).map((row) => row.id);

  const reuse = await admin.rpc('confirm_appointment', {
    p_appointment_id: thirdId,
    p_scheduled_at: '2027-03-15T06:00:00Z',
    p_scheduled_end: '2027-03-15T07:00:00Z',
  });
  check(
    'le créneau d’un rendez-vous annulé redevient disponible',
    !reuse.error,
    reuse.error?.message,
  );

  // Un état final le reste.
  const reopen = await admin
    .from('appointments')
    .update({ status: 'CONFIRME' })
    .eq('id', firstId)
    .select('id');
  check('un rendez-vous annulé ne se rouvre pas', refused(reopen));

  return { confirmateur, annulateur, thirdId };
}

/* ========================================================================== */
/*  7. Les disponibilités                                                     */
/* ========================================================================== */

async function checkAvailabilities(target, admin, accounts, state, appointments) {
  log.step('Disponibilités');

  const gestionnaire = await signIn(target, accounts.rdvManage.email);

  // Avant toute déclaration, aucun créneau n'est refusé : le § 86 interdit
  // d'inventer un calendrier, et « on ne sait pas » n'est pas « c'est fermé ».
  const openBefore = await admin.rpc('appointment_slot_is_open', {
    p_start: '2027-04-20T02:00:00Z',
    p_end: '2027-04-20T03:00:00Z',
  });
  check('sans disponibilité déclarée, aucun créneau n’est refusé', openBefore.data === true);

  const created = await gestionnaire
    .from('appointment_availabilities')
    .insert({
      kind: 'OUVERTURE',
      // 2027-04-20 est un mardi.
      weekday: 2,
      starts_at: '08:00',
      ends_at: '12:00',
      label: `${PREFIX} ouverture`,
    })
    .select('id')
    .maybeSingle();

  check('appointments.manage déclare une ouverture', !created.error, created.error?.message);
  state.availabilityIds.push(created.data?.id);

  // 05:00 UTC = 08:00 à Moroni ; 08:00 UTC = 11:00.
  const inside = await admin.rpc('appointment_slot_is_open', {
    p_start: '2027-04-20T05:00:00Z',
    p_end: '2027-04-20T06:00:00Z',
  });
  check('un créneau dans l’ouverture déclarée est accepté', inside.data === true);

  const outside = await admin.rpc('appointment_slot_is_open', {
    p_start: '2027-04-20T12:00:00Z',
    p_end: '2027-04-20T13:00:00Z',
  });
  check('un créneau hors de l’ouverture est refusé', outside.data === false);

  const otherDay = await admin.rpc('appointment_slot_is_open', {
    // 2027-04-21 est un mercredi : aucune ouverture n'y est déclarée.
    p_start: '2027-04-21T05:00:00Z',
    p_end: '2027-04-21T06:00:00Z',
  });
  check('un jour sans ouverture déclarée est refusé', otherDay.data === false);

  // Un blocage sur la journée ferme même une plage ouverte (§ 87).
  const blocage = await gestionnaire
    .from('appointment_availabilities')
    .insert({ kind: 'BLOCAGE', on_date: '2027-04-20', label: `${PREFIX} congé` })
    .select('id')
    .maybeSingle();

  check('appointments.manage déclare une indisponibilité', !blocage.error, blocage.error?.message);
  state.availabilityIds.push(blocage.data?.id);

  const blocked = await admin.rpc('appointment_slot_is_open', {
    p_start: '2027-04-20T05:00:00Z',
    p_end: '2027-04-20T06:00:00Z',
  });
  check('un blocage ferme une plage pourtant ouverte', blocked.data === false);

  // Et le garde refuse réellement la confirmation.
  const refusedSlot = await admin.rpc('confirm_appointment', {
    p_appointment_id: appointments.thirdId,
    p_scheduled_at: '2027-04-20T05:00:00Z',
    p_scheduled_end: '2027-04-20T06:00:00Z',
  });
  check(
    'un créneau hors disponibilités est refusé à la confirmation',
    Boolean(refusedSlot.error),
    refusedSlot.error ? '' : 'créneau accepté à tort',
  );

  // Une ouverture exceptionnelle rouvre une date (§ 88).
  const exception = await gestionnaire
    .from('appointment_availabilities')
    .insert({
      kind: 'EXCEPTION',
      // 2027-04-24 est un samedi.
      on_date: '2027-04-24',
      starts_at: '09:00',
      ends_at: '11:00',
      label: `${PREFIX} samedi exceptionnel`,
    })
    .select('id')
    .maybeSingle();

  state.availabilityIds.push(exception.data?.id);

  const saturday = await admin.rpc('appointment_slot_is_open', {
    p_start: '2027-04-24T06:00:00Z',
    p_end: '2027-04-24T07:00:00Z',
  });
  check('une ouverture exceptionnelle rouvre une date', saturday.data === true);

  // Formes invalides refusées par les contraintes, pas par le code appelant.
  const malformed = await gestionnaire
    .from('appointment_availabilities')
    .insert({ kind: 'OUVERTURE', on_date: '2027-04-20', starts_at: '08:00', ends_at: '12:00' })
    .select('id');
  check('une ouverture portant une date au lieu d’un jour est refusée', refused(malformed));

  const inverted = await gestionnaire
    .from('appointment_availabilities')
    .insert({ kind: 'OUVERTURE', weekday: 3, starts_at: '12:00', ends_at: '08:00' })
    .select('id');
  check('une plage dont la fin précède le début est refusée', refused(inverted));
}

/* ========================================================================== */
/*  8. Les notes internes                                                     */
/* ========================================================================== */

async function checkNotes(target, admin, accounts, sessions, clients, state) {
  log.step('Notes internes');

  const { data: request } = await admin
    .from('quote_requests')
    .select('id')
    .eq('reference', state.anonymousReference)
    .maybeSingle();

  const byViewer = await sessions.lecteur
    .from('relation_notes')
    .insert({ quote_request_id: request.id, body: `${PREFIX} note refusée` })
    .select('id');
  check('quotes.view seul n’écrit aucune note', refused(byViewer));

  // L'auteur est imposé : la valeur envoyée est ignorée, pas validée.
  const written = await sessions.modificateur
    .from('relation_notes')
    .insert({
      quote_request_id: request.id,
      body: `${PREFIX} note de contrôle`,
      author_id: accounts.quotesManage.userId,
      author_label: 'Quelqu’un d’autre',
    })
    .select('id, author_id, author_label')
    .maybeSingle();

  check('quotes.update écrit une note', !written.error, written.error?.message);
  check(
    'l’auteur envoyé par le navigateur est écrasé',
    written.data?.author_id === accounts.quotesUpdate.userId,
    `author_id = ${written.data?.author_id}`,
  );

  state.noteId = written.data?.id ?? null;

  const seenByClient = await clients.clientA.from('relation_notes').select('id');
  check(
    'le demandeur ne voit aucune note, même sur sa propre demande',
    (seenByClient.data ?? []).length === 0,
  );

  // Un administrateur ne supprime pas la note d'un collègue par simple droit
  // de modification.
  const foreignDelete = await sessions.gestionnaire
    .from('relation_notes')
    .delete()
    .eq('id', state.noteId)
    .select('id');
  check(
    'une note ne se supprime pas par simple droit de modification',
    refused(foreignDelete),
    foreignDelete.error ? '' : 'suppression acceptée à tort',
  );

  const ownDelete = await sessions.modificateur
    .from('relation_notes')
    .delete()
    .eq('id', state.noteId)
    .select('id');
  check('son auteur supprime sa propre note', !refused(ownDelete), ownDelete.error?.message);
  if (!refused(ownDelete)) state.noteId = null;
}

/* ========================================================================== */
/*  9. Nettoyage                                                              */
/* ========================================================================== */

async function cleanUp(admin, target, accessToken, state, before) {
  log.step('Nettoyage des données de contrôle');

  // L'ordre suit les clés étrangères : notes, devis, historiques, demandes et
  // rendez-vous, puis prospects. Les `on delete cascade` font le reste.
  await admin.from('relation_notes').delete().ilike('body', `${PREFIX}%`);

  const { data: requests } = await admin
    .from('quote_requests')
    .select('id')
    .ilike('subject', `${PREFIX}%`);

  const requestIds = (requests ?? []).map((row) => row.id);

  if (requestIds.length > 0) {
    await admin.from('quotes').delete().in('quote_request_id', requestIds);
  }

  // Les documents émis pour ces devis : `documents` refuse la suppression d'un
  // document émis. On passe donc par la clé de service en SQL direct, comme la
  // phase 4D le fait pour ses propres contrôles.
  await runSql(
    target,
    accessToken,
    `delete from public.documents
      where doc_type = 'DVCL'
        and subject_name in ('Contrôle Relation', 'Contrôle Rendez-vous');`,
  ).catch(() => {});

  if (state.availabilityIds.length > 0) {
    await admin
      .from('appointment_availabilities')
      .delete()
      .in('id', state.availabilityIds.filter(Boolean));
  }

  await admin.from('appointments').delete().ilike('subject', `${PREFIX}%`);
  await admin.from('quote_requests').delete().ilike('subject', `${PREFIX}%`);
  await admin.from('leads').delete().ilike('email', `${PREFIX}%`);

  // Les compteurs de fréquence de contrôle.
  await runSql(
    target,
    accessToken,
    `delete from public.rate_limit_counters where bucket like 'relation.%';`,
  ).catch(() => {});

  // Les comptes.
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of users?.users ?? []) {
    if (user.email?.startsWith(PREFIX)) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }

  /* --- Et l'on vérifie qu'il ne reste rien ---------------------------- */

  const residue = await Promise.all(
    ['quote_requests', 'appointments', 'leads', 'relation_notes'].map(async (table) => {
      const column = table === 'leads' ? 'email' : table === 'relation_notes' ? 'body' : 'subject';
      const { count } = await admin
        .from(table)
        .select('id', { count: 'exact', head: true })
        .ilike(column, `${PREFIX}%`);
      return [table, count ?? 0];
    }),
  );

  for (const [table, count] of residue) {
    check(`aucun résidu de contrôle dans ${table}`, count === 0, `${count} ligne(s)`);
  }

  const { count: availabilities } = await admin
    .from('appointment_availabilities')
    .select('id', { count: 'exact', head: true });
  check(
    'les disponibilités réelles sont au même nombre qu’au départ',
    availabilities === before.availabilities,
    `${availabilities} contre ${before.availabilities}`,
  );

  const { count: quotes } = await admin
    .from('quotes')
    .select('id', { count: 'exact', head: true });
  check(
    'les devis réels sont au même nombre qu’au départ',
    quotes === before.quotes,
    `${quotes} contre ${before.quotes}`,
  );
}

/* ========================================================================== */

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();

  log.step(`Relation client — ${describeTarget(target)}`);

  if (!target.secretKey) {
    throw new Error('Ce contrôle exige la clé secrète : il crée et supprime des comptes.');
  }

  const admin = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // L'état d'avant, pour prouver que le nettoyage est complet.
  const [{ count: availabilitiesBefore }, { count: quotesBefore }] = await Promise.all([
    admin.from('appointment_availabilities').select('id', { count: 'exact', head: true }),
    admin.from('quotes').select('id', { count: 'exact', head: true }),
  ]);

  const before = { availabilities: availabilitiesBefore ?? 0, quotes: quotesBefore ?? 0 };

  const state = {
    burstReferences: [],
    availabilityIds: [],
    appointmentIds: [],
  };

  const accounts = {};

  try {
    log.step('Comptes de contrôle');

    accounts.clientA = await createAccount(admin, { roleCode: 'CLIENT', label: 'client-a' });
    accounts.clientB = await createAccount(admin, { roleCode: 'CLIENT', label: 'client-b' });
    accounts.affilie = await createAccount(admin, { roleCode: 'AFFILIE', label: 'affilie' });
    accounts.adminNu = await createAccount(admin, { roleCode: 'ADMIN', label: 'admin-nu' });

    accounts.quotesView = await createAccount(admin, {
      roleCode: 'ADMIN',
      grants: ['quotes.view'],
      label: 'quotes-view',
    });
    accounts.quotesUpdate = await createAccount(admin, {
      roleCode: 'ADMIN',
      grants: ['quotes.view', 'quotes.update'],
      label: 'quotes-update',
    });
    accounts.quotesManage = await createAccount(admin, {
      roleCode: 'ADMIN',
      grants: ['quotes.view', 'quotes.update', 'quotes.create', 'quotes.manage'],
      label: 'quotes-manage',
    });
    accounts.rdvUpdate = await createAccount(admin, {
      roleCode: 'ADMIN',
      grants: ['appointments.view', 'appointments.update'],
      label: 'rdv-update',
    });
    accounts.rdvCancel = await createAccount(admin, {
      roleCode: 'ADMIN',
      grants: ['appointments.view', 'appointments.cancel'],
      label: 'rdv-cancel',
    });
    accounts.rdvManage = await createAccount(admin, {
      roleCode: 'ADMIN',
      grants: ['appointments.view', 'appointments.manage'],
      label: 'rdv-manage',
    });

    log.ok(`${Object.keys(accounts).length} comptes créés`);

    await checkAnonymous(target, admin, state);
    const clients = await checkClients(target, admin, accounts, state);
    await checkNoAccess(target, accounts);
    const sessions = await checkQuotePermissions(target, admin, accounts, state);
    await checkQuotes(target, admin, accounts, clients, sessions, state);
    const appointments = await checkAppointments(target, admin, accounts, state);
    await checkAvailabilities(target, admin, accounts, state, appointments);
    await checkNotes(target, admin, accounts, sessions, clients, state);
  } finally {
    await cleanUp(admin, target, accessToken, state, before);
  }

  log.step('Bilan');
  console.log(`  ${results.passed} contrôle(s) réussi(s), ${results.failed} en échec.`);

  if (results.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  log.fail(error.message);
  process.exitCode = 1;
});
