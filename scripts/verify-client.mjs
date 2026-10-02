/**
 * Contrôle de l'espace client — phase 4I.
 *
 *   npm run client:verify -- --env shared [--base http://localhost:3100]
 *
 * À lancer **par l'entrée npm** : le lanceur `run-with-client-sequence.mjs`
 * relève la suite MORA-CLI avant, la restitue après et le prouve. Ce contrôle
 * crée des comptes CLIENT, donc consomme des numéros CLI le temps de son
 * exécution — jamais au-delà.
 *
 * Comptes en `@mora-shawiri.test` uniquement (le SMTP refuse ce domaine :
 * aucun e-mail ne peut partir). Aucun identifiant réel, aucune adresse
 * réelle. Aucune autre suite documentaire n'est touchée — vérifié à la fin.
 *
 * Lot 4I-1 : attribution de la référence, immuabilité, RLS de la fiche,
 * écriture du profil, compte suspendu ; avec `--base`, l'espace lui-même
 * (tableau de bord, profil, passerelle affilié, session suspendue).
 *
 * Lot 4I-2 (avec `--base`) : commandes, paiements, justificatifs,
 * remboursements et factures — IDOR A / B et compte CLIENT + ADMIN, dont les
 * droits d'administration ne doivent jamais élargir son espace client ;
 * passerelle espace affilié ↔ espace client. Suites CMCL / FACL rendues.
 *
 * Lot 4I-3 (avec `--base`) : demandes, devis (acceptation, refus,
 * transitions, concurrence avec l'administration), rendez-vous (annulation),
 * chronologies client filtrées, rattachement des demandes hors connexion
 * (adresse confirmée seulement, idempotent, antérieures par acte
 * administratif). Suites DMCL / DVCL / RVCL rendues ; aucune donnée réelle
 * touchée (MORA-DMCL-A0001 comparée avant / après).
 *
 * Lot 4I-4 (avec `--base`) : administration Clients (permissions des six
 * profils, liste paginée et recherches, notes en ajout seul, blocage et
 * déblocage), accès propriétaire refusés en base à une session ouverte avant
 * la suspension, compte CLIENT + ADMIN, rattachement historique par type de
 * permission, détection en lecture seule sur la fiche réelle MORA-CLI-A0001.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, log, readFlag, resolveAccessToken, resolveTarget, runSql } from './lib/config.mjs';

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
const PREFIX = 'verif-client';
const PASSWORD = `Verif-4I-${randomUUID()}`;
const REFERENCE = /^MORA-CLI-[A-Z]+\d{4}$/;
const MAX_CHUNK = 3180;

function sessionClient(target) {
  return createClient(target.url, target.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(target, email) {
  const client = sessionClient(target);
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`connexion impossible pour ${email} : ${error.message}`);
  return { client, session: data.session };
}

async function roleId(admin, code) {
  const { data } = await admin.from('roles').select('id').eq('code', code).single();
  return data.id;
}

async function createAccount(admin, { roles = [], label, confirmed = true, fullName, grants = [] }) {
  const email = `${PREFIX}-${label}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: confirmed });
  if (error || !data.user) throw new Error(`création de ${label} : ${error?.message}`);
  const userId = data.user.id;
  if (fullName) await admin.from('profiles').update({ full_name: fullName }).eq('id', userId);
  for (const code of roles) {
    const written = await admin.from('user_roles').upsert({ user_id: userId, role_id: await roleId(admin, code) }, { onConflict: 'user_id,role_id' });
    if (written.error) throw new Error(written.error.message);
  }
  if (grants.length > 0) {
    const { data: permissions } = await admin.from('permissions').select('id, code').in('code', grants);
    await admin.from('user_permissions').upsert(
      permissions.map((row) => ({ user_id: userId, permission_id: row.id, effect: 'OCTROI' })),
      { onConflict: 'user_id,permission_id' },
    );
  }
  return { userId, email };
}

async function clientRow(admin, userId) {
  const { data } = await admin.from('clients').select('*').eq('user_id', userId).maybeSingle();
  return data;
}

async function cliSequence(target, accessToken) {
  const rows = await runSql(target, accessToken, `select series, last_number, allocated_count from public.document_sequences where doc_type = 'CLI';`);
  return rows?.[0] ?? null;
}

function sessionCookieHeader(storageKey, session) {
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  if (value.length <= MAX_CHUNK) return `${storageKey}=${value}`;
  const parts = [];
  for (let index = 0; index * MAX_CHUNK < value.length; index += 1) {
    parts.push(`${storageKey}.${index}=${value.slice(index * MAX_CHUNK, (index + 1) * MAX_CHUNK)}`);
  }
  return parts.join('; ');
}

async function visit(base, path, cookie) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  // React sépare texte et valeurs interpolées par des commentaires vides dans
  // le HTML servi : on les retire pour comparer le texte tel qu'il s'affiche.
  const body = response.status === 200 ? (await response.text()).replace(/<!-- -->/g, '') : '';
  return { status: response.status, location: response.headers.get('location'), body };
}

/* -------------------------------------------------------------------------- */

async function attribution(ctx) {
  log.step('Attribution de la référence MORA-CLI');
  const { admin, target, accessToken, state } = ctx;

  const before = await cliSequence(target, accessToken);
  state.a = await createAccount(admin, { roles: ['CLIENT'], label: 'a', fullName: 'Contrôle Client A' });
  const rowA = await clientRow(admin, state.a.userId);
  check('un compte CLIENT confirmé reçoit sa référence', REFERENCE.test(rowA?.reference ?? ''), rowA?.reference);
  const afterA = await cliSequence(target, accessToken);
  check('la référence vient du moteur 4D (suite CLI avancée d’un cran)',
    afterA && rowA && afterA.allocated_count === (before?.allocated_count ?? 0) + 1 &&
      rowA.reference.endsWith(String(afterA.last_number).padStart(4, '0')),
    `${JSON.stringify(before)} → ${JSON.stringify(afterA)}`);
  state.a.reference = rowA?.reference;

  state.b = await createAccount(admin, { roles: ['CLIENT'], label: 'b', fullName: 'Contrôle Client B' });
  state.b.reference = (await clientRow(admin, state.b.userId))?.reference;
  check('deux clients, deux références distinctes', state.b.reference && state.b.reference !== state.a.reference);

  // Inscription non confirmée : aucun numéro tant que l'adresse n'est pas prouvée.
  const seqU0 = await cliSequence(target, accessToken);
  state.u = await createAccount(admin, { roles: ['CLIENT'], label: 'non-confirme', confirmed: false });
  check('une inscription non confirmée ne reçoit aucune référence', (await clientRow(admin, state.u.userId)) === null);
  check('… et ne consomme aucun numéro', JSON.stringify(await cliSequence(target, accessToken)) === JSON.stringify(seqU0));
  await admin.auth.admin.updateUserById(state.u.userId, { email_confirm: true });
  const rowU = await clientRow(admin, state.u.userId);
  check('la confirmation de l’adresse attribue la référence', REFERENCE.test(rowU?.reference ?? ''), rowU?.reference);

  // Comptes sans rôle CLIENT.
  state.aff = await createAccount(admin, { roles: ['AFFILIE'], label: 'affilie-seul', fullName: 'Contrôle Affilié' });
  check('un affilié seul n’a pas de fiche client', (await clientRow(admin, state.aff.userId)) === null);
  state.adm = await createAccount(admin, { roles: ['ADMIN'], label: 'admin-sans-droit' });
  check('un administrateur n’a pas de fiche client', (await clientRow(admin, state.adm.userId)) === null);

  // Concurrence : rôle attribué et cinq demandes d'attribution simultanées.
  state.c = await createAccount(admin, { roles: [], label: 'concurrence' });
  const seqC0 = await cliSequence(target, accessToken);
  const clientRole = await roleId(admin, 'CLIENT');
  await Promise.all([
    admin.from('user_roles').insert({ user_id: state.c.userId, role_id: clientRole }),
    ...Array.from({ length: 5 }, () => admin.rpc('ensure_client_reference', { p_user: state.c.userId })),
  ]);
  const { data: rowsC } = await admin.from('clients').select('reference').eq('user_id', state.c.userId);
  const seqC1 = await cliSequence(target, accessToken);
  check('attributions simultanées : une seule fiche', (rowsC ?? []).length === 1, JSON.stringify(rowsC));
  check('attributions simultanées : un seul numéro consommé',
    seqC1.allocated_count === (seqC0?.allocated_count ?? 0) + 1, `${JSON.stringify(seqC0)} → ${JSON.stringify(seqC1)}`);
  const again = await admin.rpc('ensure_client_reference', { p_user: state.c.userId });
  check('attribution idempotente : même référence, aucun numéro de plus',
    again.data === rowsC?.[0]?.reference && JSON.stringify(await cliSequence(target, accessToken)) === JSON.stringify(seqC1));
}

async function immutability(ctx) {
  log.step('Référence définitive, aucune écriture directe');
  const { admin, target, state } = ctx;

  const forced = await admin.from('clients').update({ reference: 'MORA-CLI-ZZ9999' }).eq('user_id', state.a.userId).select();
  check('la clé de service ne peut pas changer une référence', refused(forced), forced.error?.message);
  const moved = await admin.from('clients').update({ user_id: state.b.userId }).eq('user_id', state.a.userId).select();
  check('… ni rattacher la fiche à un autre compte', refused(moved));
  const removed = await admin.from('clients').delete().eq('user_id', state.a.userId).select();
  check('… ni supprimer la fiche d’un compte existant', refused(removed), removed.error?.message);
  check('la référence de A est inchangée', (await clientRow(admin, state.a.userId))?.reference === state.a.reference);

  const { client: a } = await signIn(target, state.a.email);
  state.sessionA = a;
  check('le client ne peut pas écrire sa fiche directement',
    refused(await a.from('clients').update({ whatsapp: '+269 000 00 00' }).eq('user_id', state.a.userId).select()));
  check('… ni en créer une', refused(await a.from('clients').insert({ user_id: state.a.userId, reference: 'MORA-CLI-ZZ0001' }).select()));
  check('… ni la supprimer', refused(await a.from('clients').delete().eq('user_id', state.a.userId).select()));
  check('… ni appeler l’allocateur pour un autre compte',
    Boolean((await a.rpc('ensure_client_reference', { p_user: state.b.userId })).error));
}

async function rls(ctx) {
  log.step('Lecture de la fiche (RLS)');
  const { admin, target, state } = ctx;
  const a = state.sessionA;

  const own = await a.from('clients').select('user_id, reference');
  check('A ne lit que sa propre fiche', (own.data ?? []).length === 1 && own.data[0].user_id === state.a.userId, JSON.stringify(own.data));
  const foreign = await a.from('clients').select('reference').eq('user_id', state.b.userId);
  check('A ne lit jamais la fiche de B', (foreign.data ?? []).length === 0);
  const byRef = await a.from('clients').select('user_id').eq('reference', state.b.reference);
  check('… même en cherchant par sa référence', (byRef.data ?? []).length === 0);
  const anon = await sessionClient(target).from('clients').select('reference');
  check('un visiteur anonyme ne lit rien', Boolean(anon.error) || (anon.data ?? []).length === 0);

  const { client: adm } = await signIn(target, state.adm.email);
  const noRight = await adm.from('clients').select('reference');
  check('un administrateur sans users.view ne lit aucune fiche', (noRight.data ?? []).length === 0);

  state.viewer = await createAccount(admin, { roles: ['ADMIN'], label: 'admin-lecteur', grants: ['users.view'] });
  const { client: viewer } = await signIn(target, state.viewer.email);
  const all = await viewer.from('clients').select('reference').in('user_id', [state.a.userId, state.b.userId]);
  check('un administrateur détenteur de users.view lit les fiches', (all.data ?? []).length === 2);
  check('… sans pouvoir les écrire', refused(await viewer.from('clients').update({ whatsapp: '+269 000 00 01' }).eq('user_id', state.a.userId).select()));
}

async function profile(ctx) {
  log.step('Profil écrit par le client');
  const { admin, target, accessToken, state } = ctx;
  const a = state.sessionA;
  const startedAt = new Date().toISOString();

  const okCall = await a.rpc('update_my_client_profile', {
    p_full_name: 'Contrôle Client A modifié',
    p_phone: '+269 321 00 01',
    p_whatsapp: '+33 6 00 00 00 01',
    p_contact_preference: 'WHATSAPP',
  });
  check('le client met à jour son profil', !okCall.error, okCall.error?.message);
  const { data: profA } = await admin.from('profiles').select('full_name, phone, status, username').eq('id', state.a.userId).single();
  const rowA = await clientRow(admin, state.a.userId);
  check('nom et téléphone enregistrés sur le profil', profA.full_name === 'Contrôle Client A modifié' && profA.phone === '+269 321 00 01');
  check('WhatsApp distinct et préférence enregistrés', rowA.whatsapp === '+33 6 00 00 00 01' && rowA.contact_preference === 'WHATSAPP');
  check('ni statut ni identifiant touchés', profA.status === 'ACTIF' && profA.username === null);

  const audit = await runSql(target, accessToken, `
    select actor_id, resource_id, metadata from public.audit_logs
     where action = 'clients.profil.modification' and resource_id = '${state.a.reference}' and created_at >= '${startedAt}';`);
  check('la modification est journalisée, avec son auteur et l’avant / après',
    audit?.length === 1 && audit[0].actor_id === state.a.userId && audit[0].metadata?.apres?.whatsapp === '+33 6 00 00 00 01',
    JSON.stringify(audit));

  const same = await a.rpc('update_my_client_profile', {
    p_full_name: 'Contrôle Client A modifié', p_phone: '+269 321 00 01', p_whatsapp: '+33 6 00 00 00 01', p_contact_preference: 'WHATSAPP',
  });
  const audit2 = await runSql(target, accessToken, `
    select count(*)::int as n from public.audit_logs
     where action = 'clients.profil.modification' and resource_id = '${state.a.reference}' and created_at >= '${startedAt}';`);
  check('un enregistrement sans changement n’ajoute rien au journal', !same.error && audit2?.[0]?.n === 1);

  const cases = [
    ['préférence inconnue', { p_contact_preference: 'SMS' }],
    ['WhatsApp préféré sans numéro WhatsApp', { p_whatsapp: null, p_contact_preference: 'WHATSAPP' }],
    ['téléphone préféré sans téléphone', { p_phone: null, p_contact_preference: 'TELEPHONE' }],
    ['nom vide', { p_full_name: '  ' }],
    ['téléphone invalide', { p_phone: 'abc' }],
    ['WhatsApp invalide', { p_whatsapp: '12', p_contact_preference: null }],
  ];
  for (const [label, override] of cases) {
    const result = await a.rpc('update_my_client_profile', {
      p_full_name: 'Contrôle Client A modifié', p_phone: '+269 321 00 01', p_whatsapp: '+33 6 00 00 00 01', p_contact_preference: 'EMAIL', ...override,
    });
    check(`refusé en base : ${label}`, result.error?.code === '23514', result.error?.message ?? 'accepté');
  }

  const rowB = await clientRow(admin, state.b.userId);
  check('la fiche de B n’a pas bougé', rowB.whatsapp === null && rowB.contact_preference === null);

  const anon = await sessionClient(target).rpc('update_my_client_profile', {
    p_full_name: 'x y', p_phone: null, p_whatsapp: null, p_contact_preference: null,
  });
  check('un visiteur anonyme ne peut rien écrire', Boolean(anon.error));

  const { client: aff } = await signIn(target, state.aff.email);
  const affCall = await aff.rpc('update_my_client_profile', { p_full_name: 'Contrôle Affilié', p_phone: null, p_whatsapp: null, p_contact_preference: null });
  check('un compte sans espace client est refusé', affCall.error?.code === '42501', affCall.error?.message);

  // Compte suspendu : sa session reste techniquement valide, la base refuse.
  await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', state.a.userId);
  const suspended = await a.rpc('update_my_client_profile', {
    p_full_name: 'Tentative suspendu', p_phone: null, p_whatsapp: null, p_contact_preference: 'EMAIL',
  });
  check('un compte suspendu, session encore ouverte, ne peut plus rien écrire', suspended.error?.code === '42501', suspended.error?.message);
  const { data: afterSuspended } = await admin.from('profiles').select('full_name').eq('id', state.a.userId).single();
  check('… et son profil est intact', afterSuspended.full_name === 'Contrôle Client A modifié');
  await admin.from('profiles').update({ status: 'ACTIF' }).eq('id', state.a.userId);
}

async function http(ctx, base) {
  log.step(`L'espace client — ${base}`);
  const { admin, target, state } = ctx;
  const storageKey = `sb-${new URL(target.url).hostname.split('.')[0]}-auth-token`;

  const { session: sA } = await signIn(target, state.a.email);
  const cookieA = sessionCookieHeader(storageKey, sA);

  const dash = await visit(base, '/espace-client/', cookieA);
  check('le client ouvre son tableau de bord', dash.status === 200, `HTTP ${dash.status} ${dash.location ?? ''}`);
  check('… qui affiche son nom et sa référence client', dash.body.includes('Contrôle Client A modifié') && dash.body.includes(state.a.reference));
  check('… des états vides explicites, sans donnée d’exemple',
    dash.body.includes('Vous n’avez encore aucune commande.') && dash.body.includes('Aucune demande en cours.') && dash.body.includes('Aucun rendez-vous à venir.'));
  check('… les coordonnées officielles de MORA Shawiri', dash.body.includes('+269 430 63 06') && dash.body.includes('href="mailto:'));
  check('… aucune passerelle affilié pour un client seul', !dash.body.includes('href="/espace-affilie/"'));
  check('… jamais la référence d’un autre client', !dash.body.includes(state.b.reference));
  check('… aucune classe de l’administration', !/class="[^"]*\badmin-/.test(dash.body));

  const prof = await visit(base, '/espace-client/profil/', cookieA);
  check('la page profil s’ouvre', prof.status === 200);
  check('… avec la référence, l’adresse de connexion et la préférence',
    prof.body.includes(state.a.reference) && prof.body.includes(state.a.email) && prof.body.includes('WhatsApp'));
  check('… sans champ e-mail modifiable', !/name="email"/.test(prof.body));
  check('… des dates lisibles, jamais d’horodatage brut', !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(prof.body.replace(/<script[\s\S]*?<\/script>/g, '')) && !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dash.body.replace(/<script[\s\S]*?<\/script>/g, '')));

  // Client et affilié : passerelle vers l'espace affilié, espaces séparés.
  state.both = await createAccount(admin, { roles: ['CLIENT', 'AFFILIE'], label: 'client-affilie', fullName: 'Contrôle Client Affilié' });
  const { session: sBoth } = await signIn(target, state.both.email);
  const both = await visit(base, '/espace-client/', sessionCookieHeader(storageKey, sBoth));
  check('client + affilié : son espace client propose la passerelle', both.status === 200 && both.body.includes('href="/espace-affilie/"'));
  // Seul le contenu de l'espace compte : l'en-tête et le pied du site citent le
  // programme d'affiliation, et la carte de passerelle le nomme.
  const bothMain = (both.body.match(/<main[\s\S]*?<\/main>/)?.[0] ?? '').replace(/vos liens, commissions et versements/i, '');
  check('… et n’affiche aucune donnée d’affiliation',
    bothMain !== '' && !/MORA-AFIL-|MORA-COMAF-|Mes commissions|Déjà versé/.test(bothMain));

  const { session: sAff } = await signIn(target, state.aff.email);
  const affOnly = await visit(base, '/espace-client/', sessionCookieHeader(storageKey, sAff));
  check('affilié seul : pas d’espace client, accès à son espace affilié',
    affOnly.status === 200 && affOnly.body.includes('ne comporte pas d’espace client') && affOnly.body.includes('href="/espace-affilie/"'));
  const affProfile = await visit(base, '/espace-client/profil/', sessionCookieHeader(storageKey, sAff));
  check('… et aucune page profil client', affProfile.status === 200 && !affProfile.body.includes('Mes coordonnées'));

  // Session déjà ouverte, puis suspension.
  await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', state.a.userId);
  const cut = await visit(base, '/espace-client/', cookieA);
  check('compte suspendu avec une session ouverte : renvoyé à la connexion', cut.status >= 300 && cut.status < 400 && (cut.location ?? '').includes('/connexion/'),
    `HTTP ${cut.status} → ${cut.location}`);
  const cutProfile = await visit(base, '/espace-client/profil/', cookieA);
  check('… toutes les rubriques, pas seulement l’accueil', (cutProfile.location ?? '').includes('/connexion/'));
  await admin.from('profiles').update({ status: 'ACTIF' }).eq('id', state.a.userId);
  const back = await visit(base, '/espace-client/', cookieA);
  check('débloqué : l’espace rouvre, historique intact', back.status === 200 && back.body.includes(state.a.reference));

  const anon = await visit(base, '/espace-client/profil/', null);
  check('un visiteur est renvoyé à la connexion', (anon.location ?? '').includes('/connexion/'));
}


/* -------------------------------------------------------------------------- */
/* Lot 4I-2 — commandes, paiements, documents ; passerelle affilié            */
/* -------------------------------------------------------------------------- */

const ORDER_LINES = [{ designation: `${PREFIX} — prestation de contrôle`, unit_price: 20000, quantity: 1 }];

async function seedCommerce(ctx) {
  log.step('Données commerce de contrôle (A, B, et un compte CLIENT + ADMIN)');
  const { admin, target, state } = ctx;
  state.startedAt = new Date().toISOString();

  // Le cas découvert en 4I-1 : un compte client qui détient aussi tous les
  // droits commerce. C'est lui qui traite le dossier de B.
  state.ca = await createAccount(admin, {
    roles: ['CLIENT', 'ADMIN'],
    label: 'client-admin',
    fullName: 'Contrôle Client Admin',
    grants: ['orders.view', 'orders.update', 'payments.view', 'payments.verify', 'payments.refund', 'orders.refund', 'invoices.issue'],
  });
  const { client: ca } = await signIn(target, state.ca.email);
  const { client: b } = await signIn(target, state.b.email);
  state.sessionCA = ca;

  const order = async (userId) => {
    const { data, error } = await admin.rpc('create_manual_order', { p_user_id: userId, p_items: ORDER_LINES, p_fees: 0, p_note: `${PREFIX} — contrôle` });
    if (error) throw new Error(`commande de contrôle : ${error.message}`);
    return data;
  };
  state.orderA = await order(state.a.userId);
  state.orderB = await order(state.b.userId);
  state.orderCA = await order(state.ca.userId);

  // B : un paiement vérifié puis partiellement remboursé, un paiement en
  // vérification avec justificatif, une facture émise.
  state.trxB = `${PREFIX}-B-${randomUUID().slice(0, 8)}`.toUpperCase();
  const paidB = await b.rpc('declare_payment', { p_order_id: state.orderB.id, p_method_code: 'MVOLA', p_amount: 15000, p_transaction_reference: state.trxB, p_client_note: null });
  if (paidB.error) throw new Error(`paiement B : ${paidB.error.message}`);
  const verified = await ca.rpc('verify_payment', { p_payment_id: paidB.data.id, p_admin_note: `${PREFIX} note interne` });
  if (verified.error) throw new Error(`vérification B : ${verified.error.message}`);
  const refund = await ca.rpc('record_refund', { p_order_id: state.orderB.id, p_amount: 3000, p_reason: `${PREFIX} motif interne`, p_payment_id: paidB.data.id, p_method_code: null });
  if (refund.error) throw new Error(`remboursement B : ${refund.error.message}`);
  state.refundB = refund.data;

  const pendingB = await b.rpc('declare_payment', { p_order_id: state.orderB.id, p_method_code: 'ESPECES', p_amount: 2000, p_transaction_reference: null, p_client_note: null });
  if (pendingB.error) throw new Error(`second paiement B : ${pendingB.error.message}`);
  state.paymentB = pendingB.data;
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0]);
  const path = `${state.orderB.id}/${state.paymentB.id}/${randomUUID()}.jpg`;
  const uploaded = await b.storage.from('paiements-justificatifs').upload(path, jpeg, { contentType: 'image/jpeg' });
  if (uploaded.error) throw new Error(`justificatif B : ${uploaded.error.message}`);
  const proof = await b.rpc('attach_payment_proof', { p_payment_id: state.paymentB.id, p_storage_path: path, p_mime_type: 'image/jpeg', p_file_size: jpeg.byteLength, p_checksum: 'a'.repeat(64), p_original_name: 'recu.jpg' });
  if (proof.error) throw new Error(`rattachement B : ${proof.error.message}`);
  state.proofB = proof.data;

  const invoice = await ca.rpc('issue_order_invoice', { p_order_id: state.orderB.id });
  if (invoice.error) throw new Error(`facture B : ${invoice.error.message}`);
  state.invoiceB = invoice.data.reference;

  // A et le compte CLIENT + ADMIN : un paiement déclaré chacun.
  const { client: a } = await signIn(target, state.a.email);
  state.trxA = `${PREFIX}-A-${randomUUID().slice(0, 8)}`.toUpperCase();
  const paidA = await a.rpc('declare_payment', { p_order_id: state.orderA.id, p_method_code: 'MVOLA', p_amount: 5000, p_transaction_reference: state.trxA, p_client_note: null });
  if (paidA.error) throw new Error(`paiement A : ${paidA.error.message}`);
  state.trxCA = `${PREFIX}-C-${randomUUID().slice(0, 8)}`.toUpperCase();
  const paidCA = await ca.rpc('declare_payment', { p_order_id: state.orderCA.id, p_method_code: 'MVOLA', p_amount: 4000, p_transaction_reference: state.trxCA, p_client_note: null });
  if (paidCA.error) throw new Error(`paiement CLIENT + ADMIN : ${paidCA.error.message}`);

  check('données de contrôle prêtes (commandes, paiements, remboursement, justificatif, facture)',
    Boolean(state.orderA && state.orderB && state.orderCA && state.refundB && state.proofB && state.invoiceB));

  // Le scénario reproduit bien le défaut : par l'API, avec ses droits
  // d'administration, ce compte lit la commande de B. C'est légitime pour
  // l'administration ; c'est son espace client qui ne doit jamais la montrer.
  const raw = await ca.from('orders').select('reference').eq('id', state.orderB.id);
  check('scénario reproduit : par ses droits d’administration, le compte CLIENT + ADMIN lit la commande de B',
    (raw.data ?? []).length === 1);
}

async function commerceHttp(ctx, base) {
  log.step(`Espace client — commandes, paiements, documents (${base})`);
  const { target, state } = ctx;
  const storageKey = `sb-${new URL(target.url).hostname.split('.')[0]}-auth-token`;
  const cookie = async (account) => sessionCookieHeader(storageKey, (await signIn(target, account.email)).session);
  const cA = await cookie(state.a);
  const cB = await cookie(state.b);
  const cCA = await cookie(state.ca);
  const foreignOfCA = [state.orderA.reference, state.orderB.reference, state.trxA, state.trxB, state.invoiceB];

  // --- Le compte CLIENT + ADMIN : seulement ses propres données.
  for (const path of ['/espace-client/', '/espace-client/commandes/', '/espace-client/paiements/', '/espace-client/documents/']) {
    const page = await visit(base, path, cCA);
    const leaked = foreignOfCA.filter((marker) => page.body.includes(marker));
    check(`CLIENT + ADMIN ${path} : ses données seulement`, page.status === 200 && leaked.length === 0, `HTTP ${page.status} ${leaked.join(', ')}`);
  }
  check('CLIENT + ADMIN : sa propre commande est bien listée', (await visit(base, '/espace-client/commandes/', cCA)).body.includes(state.orderCA.reference));
  check('CLIENT + ADMIN : son propre paiement est bien listé', (await visit(base, '/espace-client/paiements/', cCA)).body.includes(state.trxCA));
  check('CLIENT + ADMIN : la fiche de A par URL directe est introuvable', (await visit(base, `/espace-client/commandes/${state.orderA.reference}/`, cCA)).status === 404);
  check('CLIENT + ADMIN : la fiche de B par URL directe est introuvable', (await visit(base, `/espace-client/commandes/${state.orderB.reference}/`, cCA)).status === 404);
  const caInvoice = await visit(base, `/api/documents/${state.invoiceB}/?espace=client`, cCA);
  check('CLIENT + ADMIN : la facture de B est refusée en mode espace client', caInvoice.status === 404, `HTTP ${caInvoice.status}`);
  const caProof = await visit(base, `/api/justificatifs/${state.proofB.id}/?espace=client`, cCA);
  check('CLIENT + ADMIN : le justificatif de B est refusé en mode espace client', caProof.status === 404, `HTTP ${caProof.status}`);

  // --- L'administration n'est pas cassée : mêmes droits, contexte administratif.
  const adminInvoice = await visit(base, `/api/documents/${state.invoiceB}/`, cCA);
  check('administration intacte : avec orders.view, la facture de B reste lisible hors espace client', adminInvoice.status === 200, `HTTP ${adminInvoice.status}`);
  const adminProof = await visit(base, `/api/justificatifs/${state.proofB.id}/`, cCA);
  check('administration intacte : avec payments.view, le justificatif de B reste lisible hors espace client', adminProof.status === 307, `HTTP ${adminProof.status}`);
  const adminOrder = await visit(base, `/administration/commandes/${state.orderB.reference}/`, cCA);
  check('administration intacte : la fiche administrative de la commande de B s’ouvre', adminOrder.status === 200, `HTTP ${adminOrder.status}`);

  // --- Client A contre client B.
  const aPages = [];
  for (const path of ['/espace-client/commandes/', '/espace-client/paiements/', '/espace-client/documents/']) aPages.push(await visit(base, path, cA));
  check('A ne voit aucune donnée de B dans ses rubriques',
    aPages.every((page) => page.status === 200 && ![state.orderB.reference, state.trxB, state.invoiceB].some((marker) => page.body.includes(marker))));
  check('A voit sa commande et son paiement', aPages[0].body.includes(state.orderA.reference) && aPages[1].body.includes(state.trxA));
  check('A n’ouvre pas la fiche de B par URL directe', (await visit(base, `/espace-client/commandes/${state.orderB.reference}/`, cA)).status === 404);
  check('A n’obtient pas la facture de B (mode espace client)', (await visit(base, `/api/documents/${state.invoiceB}/?espace=client`, cA)).status === 404);
  check('A n’obtient pas la facture de B (route sans mode)', (await visit(base, `/api/documents/${state.invoiceB}/`, cA)).status === 404);
  check('A n’obtient pas le justificatif de B (mode espace client)', (await visit(base, `/api/justificatifs/${state.proofB.id}/?espace=client`, cA)).status === 404);
  check('A n’obtient pas le justificatif de B (route sans mode)', (await visit(base, `/api/justificatifs/${state.proofB.id}/`, cA)).status === 404);

  // --- B voit tout ce qui est à lui.
  const bOrder = await visit(base, `/espace-client/commandes/${state.orderB.reference}/`, cB);
  check('B : sa fiche commande s’ouvre dans le nouveau gabarit', bOrder.status === 200 && bOrder.body.includes('aff-nav--side'), `HTTP ${bOrder.status}`);
  check('B : lignes, paiements, remboursement et carte facture conservés',
    bOrder.body.includes('prestation de contrôle') && bOrder.body.includes(state.trxB) && bOrder.body.includes('Remboursements') &&
      bOrder.body.includes('Votre facture') && bOrder.body.includes(state.invoiceB));
  check('B : aucune note ni motif interne n’apparaît', !bOrder.body.includes('note interne') && !bOrder.body.includes('motif interne'));
  check('B : la carte facture et le justificatif passent en mode espace client',
    bOrder.body.includes(`/api/documents/${state.invoiceB}/?espace=client`) && bOrder.body.includes(`/api/justificatifs/${state.proofB.id}/?espace=client`));
  const bPay = await visit(base, '/espace-client/paiements/', cB);
  check('B : ses paiements avec leur état réel, et son remboursement',
    bPay.body.includes(state.trxB) && bPay.body.includes('En vérification') && bPay.body.includes('Mes remboursements'));
  const bDocs = await visit(base, '/espace-client/documents/', cB);
  check('B : sa facture dans Mes documents, avec Voir / Télécharger / Partager',
    bDocs.body.includes(state.invoiceB) && bDocs.body.includes('espace=client') && bDocs.body.includes('Partager le PDF'));
  const pdf = await fetch(`${base}/api/documents/${state.invoiceB}/?espace=client`, { headers: { cookie: cB } });
  check('B : le vrai PDF de sa facture est servi', pdf.status === 200 && (pdf.headers.get('content-type') ?? '').includes('application/pdf'), `HTTP ${pdf.status}`);
  check('B : son justificatif est servi par URL signée', (await visit(base, `/api/justificatifs/${state.proofB.id}/?espace=client`, cB)).status === 307);
  check('un visiteur n’obtient aucune facture', (await visit(base, `/api/documents/${state.invoiceB}/?espace=client`, null)).status === 404);
}

async function affiliateGateway(ctx, base) {
  log.step('Passerelle espace affilié ↔ espace client');
  const { admin, target, state } = ctx;
  const storageKey = `sb-${new URL(target.url).hostname.split('.')[0]}-auth-token`;
  const run = randomUUID().slice(0, 6).toUpperCase().replace(/[^A-Z]/g, 'X');
  const { data: category, error } = await admin.from('affiliate_categories').insert({ code: `ZZ_VERIF_4I_${run}`, label: 'Contrôle 4I' }).select().single();
  if (error) throw new Error(`catégorie de contrôle : ${error.message}`);
  state.gatewaySeeded = true;
  const affiliate = async (account, serial) => {
    const inserted = await admin.from('affiliates').insert({
      slug: `${PREFIX}-${serial}-${run.toLowerCase()}`, reference: `MORA-AFIL-ZZ${serial}`, status: 'ACTIF', category_id: category.id,
      display_name: `Partenaire ${serial}`, contact_email: account.email, user_id: account.userId, started_on: '2026-10-01',
    });
    if (inserted.error) throw new Error(`affilié de contrôle : ${inserted.error.message}`);
  };
  const serial = 9400 + Math.floor(Math.random() * 90);
  await affiliate(state.both, String(serial));
  await affiliate(state.aff, String(serial + 1));

  const cBoth = sessionCookieHeader(storageKey, (await signIn(target, state.both.email)).session);
  const cAff = sessionCookieHeader(storageKey, (await signIn(target, state.aff.email)).session);
  const bothAff = await visit(base, '/espace-affilie/', cBoth);
  check('CLIENT + AFFILIE : l’espace affilié propose le retour vers l’espace client', bothAff.status === 200 && bothAff.body.includes('href="/espace-client/"'), `HTTP ${bothAff.status}`);
  const bothCli = await visit(base, '/espace-client/', cBoth);
  check('CLIENT + AFFILIE : l’espace client propose l’espace affilié', bothCli.status === 200 && bothCli.body.includes('href="/espace-affilie/"'));
  const affOnly = await visit(base, '/espace-affilie/', cAff);
  check('AFFILIE seul : aucun lien vers un espace client', affOnly.status === 200 && affOnly.body.includes('aff-nav--side') && !affOnly.body.includes('href="/espace-client/"'),
    `HTTP ${affOnly.status}`);
}

async function cleanupCommerce(ctx) {
  const { admin, target, accessToken, state } = ctx;
  if (!state.startedAt && !state.gatewaySeeded) return;
  log.step('Démontage des données commerce et affiliation de contrôle');

  // Affiliés de contrôle : leur journal est en ajout seul ; la garde n'est
  // levée que dans cette transaction, et l'on vérifie qu'elle est rétablie.
  await runSql(target, accessToken, `
    begin;
    alter table public.affiliate_events disable trigger affiliate_events_append_only;
    delete from public.affiliate_events
     where affiliate_id in (select id from public.affiliates where slug like '${PREFIX}-%')
        or category_id in (select id from public.affiliate_categories where code like 'ZZ_VERIF_4I_%');
    delete from public.affiliates where slug like '${PREFIX}-%';
    delete from public.affiliate_categories where code like 'ZZ_VERIF_4I_%';
    alter table public.affiliate_events enable trigger affiliate_events_append_only;
    commit;`).catch((error) => log.fail(`démontage affiliation : ${error.message}`));
  const guard = await runSql(target, accessToken, `select tgenabled from pg_trigger where tgname = 'affiliate_events_append_only';`).catch(() => null);
  check('la garde du journal d’affiliation est rétablie', guard?.[0]?.tgenabled === 'O');

  // Justificatifs, puis archives de factures, puis commandes, puis pièces
  // (annulées avant d'être supprimées : règle de 4D).
  const orderIds = [state.orderA, state.orderB, state.orderCA].filter(Boolean).map((order) => order.id);
  for (const orderId of orderIds) {
    const { data: folders } = await admin.storage.from('paiements-justificatifs').list(orderId, { limit: 100 });
    for (const folder of folders ?? []) {
      const { data: files } = await admin.storage.from('paiements-justificatifs').list(`${orderId}/${folder.name}`, { limit: 100 });
      if ((files ?? []).length > 0) await admin.storage.from('paiements-justificatifs').remove(files.map((file) => `${orderId}/${folder.name}/${file.name}`));
    }
  }
  const since = state.startedAt ? `'${state.startedAt}'::timestamptz` : `now()`;
  const docs = (await runSql(target, accessToken, `select id from public.documents where doc_type = 'FACL' and issued_at >= ${since};`).catch(() => [])) ?? [];
  if (docs.length > 0) await admin.storage.from('documents-officiels').remove(docs.map((row) => `FACL/${row.id}.pdf`));
  if (orderIds.length > 0) {
    await admin.from('refunds').delete().in('order_id', orderIds);
    await admin.from('payments').delete().in('order_id', orderIds);
    await admin.from('order_events').delete().in('order_id', orderIds);
    await admin.from('order_status_history').delete().in('order_id', orderIds);
    await admin.from('order_items').delete().in('order_id', orderIds);
    await admin.from('orders').delete().in('id', orderIds);
  }
  await runSql(target, accessToken, `update public.documents set status = 'ANNULE' where doc_type in ('CMCL', 'FACL') and issued_at >= ${since};`).catch((error) => log.warn(error.message));
  await runSql(target, accessToken, `delete from public.documents where doc_type in ('CMCL', 'FACL') and issued_at >= ${since};`).catch((error) => log.warn(error.message));

  // Toutes les suites hors CLI (que le lanceur rend lui-même) : rendues telles
  // qu'elles ont été relevées.
  const before = ctx.before.sequences ?? [];
  const now = (await runSql(target, accessToken, `select doc_type from public.document_sequences where doc_type <> 'CLI';`).catch(() => [])) ?? [];
  for (const row of now) {
    const initial = before.find((entry) => entry.doc_type === row.doc_type);
    await runSql(target, accessToken, initial
      ? `update public.document_sequences set series = '${initial.series}', last_number = ${initial.last_number}, allocated_count = ${initial.allocated_count} where doc_type = '${row.doc_type}';`
      : `delete from public.document_sequences where doc_type = '${row.doc_type}';`).catch((error) => log.fail(error.message));
  }

  const idList = orderIds.map((id) => `'${id}'::uuid`).join(',') || 'null::uuid';
  const residue = (await runSql(target, accessToken, `
    select (select count(*) from public.orders where id = any(array[${idList}]))::int as orders,
           (select count(*) from public.payments where order_id = any(array[${idList}]))::int as payments,
           (select count(*) from public.refunds where order_id = any(array[${idList}]))::int as refunds,
           (select count(*) from public.documents where issued_at >= ${since})::int as documents,
           (select count(*) from public.affiliates where slug like '${PREFIX}-%')::int as affiliates;`).catch(() => null))?.[0];
  check('aucune commande, paiement, remboursement, pièce ni affilié de contrôle ne subsiste',
    residue && Object.values(residue).every((value) => value === 0), JSON.stringify(residue));
  const objects = [];
  for (const orderId of orderIds) objects.push(await admin.storage.from('paiements-justificatifs').list(orderId, { limit: 10 }));
  check('aucun justificatif de contrôle ne subsiste', objects.every((result) => (result.data ?? []).length === 0));
  const archives = docs.length === 0 ? [] : (await admin.storage.from('documents-officiels').list('FACL', { limit: 1000 })).data ?? [];
  check('aucune archive de facture de contrôle ne subsiste', !docs.some((row) => archives.some((file) => file.name === `${row.id}.pdf`)));
}


/* -------------------------------------------------------------------------- */
/* Lot 4I-3 — demandes, devis, rendez-vous ; rattachement                      */
/* -------------------------------------------------------------------------- */

const HASHES = [];
const hashOf = () => {
  const value = randomUUID().replace(/-/g, '');
  HASHES.push(value);
  return value;
};

async function grant(admin, userId, codes) {
  const { data: permissions } = await admin.from('permissions').select('id, code').in('code', codes);
  await admin.from('user_permissions').upsert(
    permissions.map((row) => ({ user_id: userId, permission_id: row.id, effect: 'OCTROI' })),
    { onConflict: 'user_id,permission_id' },
  );
}

function submitRequest(client, email, overrides = {}) {
  const hash = hashOf();
  return client.rpc('submit_quote_request', {
    p_full_name: 'Contrôle Relation 4I', p_email: email, p_phone: '+269 000 11 22', p_organisation: null,
    p_subject: `${PREFIX} demande ${hash.slice(0, 6)}`, p_budget: null,
    p_message: `${PREFIX} message de contrôle ${hash.slice(0, 10)}\nseconde ligne`, p_service_slug: null,
    p_offer_title: null, p_details: [], p_source: 'contact', p_client_hash: hash, ...overrides,
  });
}

function submitAppointment(client, email, overrides = {}) {
  const hash = hashOf();
  return client.rpc('submit_appointment_request', {
    p_full_name: 'Contrôle Relation 4I', p_email: email, p_phone: '+269 000 11 22', p_organisation: null,
    p_subject: `${PREFIX} rendez-vous ${hash.slice(0, 6)}`, p_channel_label: 'Appel téléphonique',
    p_requested_date: '2027-04-12', p_requested_slot: 'Matin (08H – 12H)', p_budget: null,
    p_message: `${PREFIX} contexte ${hash.slice(0, 10)}`, p_service_slug: null, p_details: [], p_source: 'rendez-vous',
    p_client_hash: hash, ...overrides,
  });
}

async function requestByRef(admin, reference) {
  const { data } = await admin.from('quote_requests').select('*').eq('reference', reference).single();
  return data;
}

async function seedRelation(ctx) {
  log.step('Données relation de contrôle (demandes, devis, rendez-vous)');
  const { admin, target, state } = ctx;
  state.relationStartedAt = new Date().toISOString();
  await grant(admin, state.ca.userId, ['quotes.view', 'quotes.create', 'quotes.manage', 'appointments.view', 'appointments.update', 'appointments.cancel', 'users.view', 'users.update']);
  const { client: a } = await signIn(target, state.a.email);
  const { client: b } = await signIn(target, state.b.email);
  const { client: ca } = await signIn(target, state.ca.email);
  Object.assign(state, { relA: a, relB: b, relCA: ca });

  const subA = await submitRequest(a, state.a.email);
  if (subA.error) throw new Error(`demande A : ${subA.error.message}`);
  state.reqA = await requestByRef(admin, subA.data[0].reference);
  const subB = await submitRequest(b, state.b.email);
  if (subB.error) throw new Error(`demande B : ${subB.error.message}`);
  state.reqB = await requestByRef(admin, subB.data[0].reference);
  const subCA = await submitRequest(ca, state.ca.email);
  if (subCA.error) throw new Error(`demande CLIENT + ADMIN : ${subCA.error.message}`);
  state.reqCA = await requestByRef(admin, subCA.data[0].reference);
  check('demandes déposées connecté : rattachées directement à leur auteur',
    state.reqA.user_id === state.a.userId && state.reqB.user_id === state.b.userId && state.reqCA.user_id === state.ca.userId);

  // Affectation interne (événement que le client ne doit jamais voir).
  await ca.from('quote_requests').update({ assigned_to: state.ca.userId }).eq('id', state.reqA.id);
  await ca.from('quote_requests').update({ status: 'EN_ETUDE' }).eq('id', state.reqA.id);

  const draft = async (requestId, extra = {}) => {
    const { data, error } = await ca.from('quotes').insert({
      quote_request_id: requestId, amount: 150000, currency: 'KMF', summary: `${PREFIX} — site vitrine\nCinq pages, hébergement un an.`, status: 'BROUILLON', ...extra,
    }).select('id').single();
    if (error) throw new Error(`brouillon : ${error.message}`);
    return data.id;
  };
  const sent = async (requestId, extra = {}) => {
    const id = await draft(requestId, extra);
    const { data, error } = await ca.rpc('send_quote', { p_quote_id: id });
    if (error) throw new Error(`émission : ${error.message}`);
    return { id, reference: data.reference };
  };
  state.q = {
    accept: await sent(state.reqA.id),
    refuse: await sent(state.reqA.id),
    expired: await sent(state.reqA.id, { valid_until: '2026-01-31' }),
    cancelled: await sent(state.reqA.id),
    double: await sent(state.reqA.id),
    race1: await sent(state.reqA.id),
    race2: await sent(state.reqA.id),
    draft: { id: await draft(state.reqA.id), reference: null },
    abandoned: { id: await draft(state.reqA.id), reference: null },
    b: await sent(state.reqB.id),
  };
  await ca.from('quotes').update({ status: 'ANNULE' }).eq('id', state.q.cancelled.id);
  await ca.from('quotes').update({ status: 'ANNULE' }).eq('id', state.q.abandoned.id);

  // Rendez-vous de A (connecté) : en attente, à venir, commencé, terminé, concurrence.
  const appt = async (client, email) => {
    const before = await admin.from('appointments').select('id').eq('user_id', (await client.auth.getUser()).data.user.id);
    const res = await submitAppointment(client, email);
    if (res.error) throw new Error(`rendez-vous : ${res.error.message}`);
    const after = await admin.from('appointments').select('id').eq('user_id', (await client.auth.getUser()).data.user.id).order('created_at', { ascending: false });
    return after.data.find((row) => !(before.data ?? []).some((old) => old.id === row.id)).id;
  };
  const confirm = async (id, startIso, endIso) => {
    const { error } = await ca.rpc('confirm_appointment', { p_appointment_id: id, p_scheduled_at: startIso, p_scheduled_end: endIso });
    if (error) throw new Error(`confirmation : ${error.message}`);
  };
  const base = Date.UTC(2027, 3, 12, 5, 0) + Math.floor(Math.random() * 200) * 86400000;
  const slot = (n) => [new Date(base + n * 7200000).toISOString(), new Date(base + n * 7200000 + 3600000).toISOString()];
  state.ap = {
    pending: await appt(a, state.a.email),
    future: await appt(a, state.a.email),
    started: await appt(a, state.a.email),
    done: await appt(a, state.a.email),
    race1: await appt(a, state.a.email),
    race2: await appt(a, state.a.email),
    b: await appt(b, state.b.email),
  };
  await confirm(state.ap.future, ...slot(0));
  const startedAt = new Date(Date.now() - 30 * 60000);
  await confirm(state.ap.started, startedAt.toISOString(), new Date(startedAt.getTime() + 3600000).toISOString());
  await confirm(state.ap.done, ...slot(1));
  await ca.from('appointments').update({ status: 'TERMINE' }).eq('id', state.ap.done);
  await confirm(state.ap.race1, ...slot(2));
  await confirm(state.ap.race2, ...slot(3));
  await confirm(state.ap.b, ...slot(4));
  await ca.from('appointments').update({ assigned_to: state.ca.userId }).eq('id', state.ap.future);
  check('données relation prêtes', Object.values(state.q).length === 10 && Object.values(state.ap).every(Boolean));
}

async function quoteDecisions(ctx) {
  log.step('Devis : acceptation, refus, transitions');
  const { admin, target, accessToken, state } = ctx;
  const a = state.relA;
  const respond = (client, quote, decision, reason = null) => client.rpc('respond_to_my_quote', { p_quote_id: quote.id, p_decision: decision, p_reason: reason });
  const statusOf = async (quote) => (await admin.from('quotes').select('status, responded_by, responded_at, client_response_reason').eq('id', quote.id).single()).data;
  const transitions = async (quote, to) => (await runSql(target, accessToken,
    `select count(*)::int as n from public.quote_request_events where quote_reference = '${quote.reference}' and kind = 'DEVIS_STATUT' and from_status = 'ENVOYE'${to ? ` and to_status = '${to}'` : ''};`))?.[0]?.n;
  const { count: ordersBefore } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', state.a.userId);

  const accepted = await respond(a, state.q.accept, 'ACCEPTE');
  const sAcc = await statusOf(state.q.accept);
  check('A accepte son devis : ACCEPTÉ, horodaté, attribué à A', !accepted.error && sAcc.status === 'ACCEPTE' && sAcc.responded_by === state.a.userId && Boolean(sAcc.responded_at), accepted.error?.message);
  const { count: ordersAfter } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', state.a.userId);
  check('accepter ne crée aucune commande', ordersAfter === ordersBefore, `${ordersBefore} → ${ordersAfter}`);
  const again = await respond(a, state.q.accept, 'ACCEPTE');
  check('double clic : la même décision est acceptée sans second événement', !again.error && (await transitions(state.q.accept)) === 1);
  check('un devis accepté ne peut plus être refusé', (await respond(a, state.q.accept, 'REFUSE', 'trop tard')).error?.code === '23514');

  const refused = await respond(a, state.q.refuse, 'REFUSE', 'Budget insuffisant pour cette année');
  const sRef = await statusOf(state.q.refuse);
  check('A refuse avec un motif : REFUSÉ, motif conservé', !refused.error && sRef.status === 'REFUSE' && sRef.client_response_reason === 'Budget insuffisant pour cette année');
  const { data: adminEvents } = await state.relCA.from('quote_request_events').select('note, actor_id').eq('quote_reference', state.q.refuse.reference).eq('to_status', 'REFUSE');
  check('l’administration lit le motif du client dans l’historique', adminEvents?.[0]?.note === 'Budget insuffisant pour cette année' && adminEvents?.[0]?.actor_id === state.a.userId);
  check('un devis refusé ne peut plus être accepté', (await respond(a, state.q.refuse, 'ACCEPTE')).error?.code === '23514');
  check('motif de plus de 1 000 caractères refusé', (await respond(a, state.q.double, 'REFUSE', 'x'.repeat(1001))).error?.code === '23514');

  check('brouillon : introuvable pour le client', (await respond(a, state.q.draft, 'ACCEPTE')).error?.code === 'P0002');
  check('brouillon abandonné (annulé sans référence) : introuvable', (await respond(a, state.q.abandoned, 'ACCEPTE')).error?.code === 'P0002');
  check('devis expiré (validité dépassée) : refusé', (await respond(a, state.q.expired, 'ACCEPTE')).error?.code === '23514');
  check('devis annulé : refusé', (await respond(a, state.q.cancelled, 'ACCEPTE')).error?.code === '23514');
  check('décision inconnue : refusée', (await a.rpc('respond_to_my_quote', { p_quote_id: state.q.double.id, p_decision: 'EXPIRE', p_reason: null })).error?.code === '23514');
  check('B ne répond pas au devis de A', (await respond(state.relB, state.q.double, 'ACCEPTE')).error?.code === 'P0002');
  check('CLIENT + ADMIN ne répond pas au devis de A par la fonction client', (await respond(state.relCA, state.q.double, 'ACCEPTE')).error?.code === 'P0002');
  check('un visiteur ne répond à rien', Boolean((await respond(sessionClient(target), state.q.double, 'ACCEPTE')).error));
  check('A ne change pas le statut par écriture directe', refused2(await a.from('quotes').update({ status: 'ACCEPTE' }).eq('id', state.q.double.id).select()));
  check('l’administration ne peut pas faire passer une décision pour celle du client',
    refused2(await state.relCA.from('quotes').update({ responded_by: state.a.userId }).eq('id', state.q.double.id).select()));

  // Concurrence : cinq acceptations simultanées.
  const burst = await Promise.all(Array.from({ length: 5 }, () => respond(a, state.q.double, 'ACCEPTE')));
  check('cinq acceptations simultanées : une seule transition', burst.every((r) => !r.error) && (await transitions(state.q.double)) === 1, burst.map((r) => r.error?.message ?? 'ok').join(' | '));

  // Client contre administration.
  const [c1, a1] = await Promise.all([
    respond(a, state.q.race1, 'ACCEPTE'),
    state.relCA.from('quotes').update({ status: 'ANNULE' }).eq('id', state.q.race1.id).select('id'),
  ]);
  const s1 = await statusOf(state.q.race1);
  check('client accepte pendant que l’administration annule : un seul gagnant, état cohérent',
    ['ACCEPTE', 'ANNULE'].includes(s1.status) && (await transitions(state.q.race1)) === 1 &&
      (s1.status === 'ACCEPTE' ? s1.responded_by === state.a.userId : s1.responded_by === null),
    `${s1.status} — client ${c1.error?.message ?? 'ok'}, admin ${a1.error?.message ?? 'ok'}`);
  const [c2, a2] = await Promise.all([
    respond(a, state.q.race2, 'REFUSE', 'Concurrence'),
    state.relCA.from('quotes').update({ status: 'EXPIRE' }).eq('id', state.q.race2.id).select('id'),
  ]);
  const s2 = await statusOf(state.q.race2);
  check('client refuse pendant que l’administration expire : un seul gagnant, état cohérent',
    ['REFUSE', 'EXPIRE'].includes(s2.status) && (await transitions(state.q.race2)) === 1,
    `${s2.status} — client ${c2.error?.message ?? 'ok'}, admin ${a2.error?.message ?? 'ok'}`);

  // Compte suspendu, session encore ouverte.
  await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', state.a.userId);
  const susp = await respond(a, state.q.expired, 'REFUSE');
  const tl = await a.rpc('my_request_timeline', { p_request_id: state.reqA.id });
  await admin.from('profiles').update({ status: 'ACTIF' }).eq('id', state.a.userId);
  check('compte suspendu (session ouverte) : aucune décision, aucune chronologie', susp.error?.code === '42501' && (tl.data ?? []).length === 0);
}

function refused2(result) {
  return Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0);
}

async function appointmentCancels(ctx) {
  log.step('Rendez-vous : annulation par le client');
  const { admin, target, accessToken, state } = ctx;
  const a = state.relA;
  const cancel = (client, id, reason = 'Empêchement de dernière minute') => client.rpc('cancel_my_appointment', { p_appointment_id: id, p_reason: reason });
  const row = async (id) => (await admin.from('appointments').select('status, cancelled_by, cancel_reason, cancelled_at').eq('id', id).single()).data;
  const cancelEvents = async (id) => (await runSql(target, accessToken,
    `select count(*)::int as n from public.appointment_events where appointment_id = '${id}' and kind = 'STATUT' and to_status = 'ANNULE';`))?.[0]?.n;

  check('motif obligatoire', (await cancel(a, state.ap.future, '  ')).error?.code === '23514');
  const done = await cancel(a, state.ap.future);
  const r = await row(state.ap.future);
  check('A annule son rendez-vous confirmé à venir : ANNULÉ, horodaté, par A, motif conservé',
    !done.error && r.status === 'ANNULE' && r.cancelled_by === state.a.userId && Boolean(r.cancelled_at) && r.cancel_reason === 'Empêchement de dernière minute', done.error?.message);
  check('… le créneau confirmé est libéré par l’état ANNULÉ (aucune reprogrammation proposée)', r.status === 'ANNULE');
  check('double annulation : sans effet ni second événement', !(await cancel(a, state.ap.future)).error && (await cancelEvents(state.ap.future)) === 1);
  check('une demande de rendez-vous en attente s’annule aussi', !(await cancel(a, state.ap.pending)).error && (await row(state.ap.pending)).status === 'ANNULE');
  check('rendez-vous déjà commencé : refusé', (await cancel(a, state.ap.started)).error?.code === '23514');
  check('rendez-vous terminé : refusé', (await cancel(a, state.ap.done)).error?.code === '23514');
  check('B n’annule pas le rendez-vous de A', (await cancel(state.relB, state.ap.race1)).error?.code === 'P0002');
  check('CLIENT + ADMIN n’annule pas celui de A par la fonction client', (await cancel(state.relCA, state.ap.race1)).error?.code === 'P0002');
  check('A n’écrit pas cancelled_by directement', refused2(await a.from('appointments').update({ status: 'ANNULE' }).eq('id', state.ap.race1).select()));

  const [c1, a1] = await Promise.all([
    cancel(a, state.ap.race1),
    state.relCA.from('appointments').update({ status: 'ANNULE', cancel_reason: 'Créneau indisponible' }).eq('id', state.ap.race1).select('id'),
  ]);
  const r1 = await row(state.ap.race1);
  check('client et administration annulent en même temps : un seul événement d’annulation',
    r1.status === 'ANNULE' && (await cancelEvents(state.ap.race1)) === 1, `client ${c1.error?.message ?? 'ok'}, admin ${a1.error?.message ?? 'ok'}`);
  check('… et le motif enregistré est celui du gagnant, jamais réécrit par le second',
    r1.cancelled_by === state.a.userId ? r1.cancel_reason === 'Empêchement de dernière minute' : r1.cancel_reason === 'Créneau indisponible',
    `${r1.cancelled_by === state.a.userId ? 'client' : 'administration'} : ${r1.cancel_reason}`);
  check('une seconde annulation par l’administration ne réécrit pas l’annulation du client',
    Boolean((await state.relCA.from('appointments').update({ cancel_reason: 'Réécriture' }).eq('id', state.ap.future).select('id')).error) &&
      (await row(state.ap.future)).cancel_reason === 'Empêchement de dernière minute');
  const [c2, a2] = await Promise.all([
    cancel(a, state.ap.race2),
    state.relCA.from('appointments').update({ status: 'TERMINE' }).eq('id', state.ap.race2).select('id'),
  ]);
  const r2 = await row(state.ap.race2);
  check('client annule pendant que l’administration clôture : un seul gagnant, état cohérent',
    ['ANNULE', 'TERMINE'].includes(r2.status) && (r2.status === 'ANNULE' ? r2.cancelled_by === state.a.userId : r2.cancelled_by === null),
    `${r2.status} — client ${c2.error?.message ?? 'ok'}, admin ${a2.error?.message ?? 'ok'}`);
}

async function timelines(ctx) {
  log.step('Chronologies client : événements publics seulement');
  const { state } = ctx;
  const tl = await state.relA.rpc('my_request_timeline', { p_request_id: state.reqA.id });
  const kinds = (tl.data ?? []).map((row) => row.kind);
  check('chronologie de la demande lue par A', !tl.error && kinds.includes('CREATION') && kinds.includes('DEVIS_STATUT'), tl.error?.message);
  check('… sans affectation interne ni création de brouillon', !kinds.includes('AFFECTATION') && !kinds.includes('DEVIS_CREE'));
  check('… sans l’abandon d’un brouillon', !(tl.data ?? []).some((row) => row.from_status === 'BROUILLON' && row.to_status !== 'ENVOYE'));
  check('… aucune colonne d’acteur', (tl.data ?? []).every((row) => !('actor_id' in row) && !('actor_label' in row)));
  check('… sa propre décision est signalée, avec son motif', (tl.data ?? []).some((row) => row.by_me && row.to_status === 'REFUSE' && row.note === 'Budget insuffisant pour cette année'));
  check('… aucune note d’un autre acteur', (tl.data ?? []).every((row) => row.note === null || row.by_me));
  check('B ne lit pas la chronologie de A', ((await state.relB.rpc('my_request_timeline', { p_request_id: state.reqA.id })).data ?? []).length === 0);
  check('CLIENT + ADMIN ne lit pas la chronologie de A par la fonction client', ((await state.relCA.rpc('my_request_timeline', { p_request_id: state.reqA.id })).data ?? []).length === 0);
  check('A ne lit plus l’historique brut de sa demande', ((await state.relA.from('quote_request_events').select('id').eq('quote_request_id', state.reqA.id)).data ?? []).length === 0);
  check('A ne lit plus l’historique brut de son rendez-vous', ((await state.relA.from('appointment_events').select('id').eq('appointment_id', state.ap.future)).data ?? []).length === 0);
  check('l’administration lit toujours les historiques complets', ((await state.relCA.from('quote_request_events').select('kind').eq('quote_request_id', state.reqA.id)).data ?? []).some((row) => row.kind === 'AFFECTATION'));
  const at = await state.relA.rpc('my_appointment_timeline', { p_appointment_id: state.ap.future });
  check('chronologie du rendez-vous : création, confirmation, annulation par A avec son motif',
    (at.data ?? []).some((row) => row.kind === 'CREATION') && (at.data ?? []).some((row) => row.to_status === 'CONFIRME') &&
      (at.data ?? []).some((row) => row.to_status === 'ANNULE' && row.by_me && row.note === 'Empêchement de dernière minute'));
  check('… sans affectation interne', !(at.data ?? []).some((row) => row.kind === 'AFFECTATION'));
  check('B ne lit pas la chronologie du rendez-vous de A', ((await state.relB.rpc('my_appointment_timeline', { p_appointment_id: state.ap.future })).data ?? []).length === 0);
  const r1 = await state.relA.rpc('my_appointment_timeline', { p_appointment_id: state.ap.race1 });
  check('annulation par l’administration : le motif administratif n’est pas rendu au client',
    (r1.data ?? []).filter((row) => row.to_status === 'ANNULE').every((row) => row.by_me || row.note === null));
}

async function claims(ctx) {
  log.step('Rattachement des demandes faites hors connexion');
  const { admin, target, accessToken, state } = ctx;
  const anon = sessionClient(target);
  state.claimer = await createAccount(admin, { roles: ['CLIENT'], label: 'rattachement', fullName: 'Contrôle Rattachement' });
  state.other = await createAccount(admin, { roles: ['CLIENT'], label: 'autre', fullName: 'Contrôle Autre' });
  const { client: d } = await signIn(target, state.claimer.email);
  const { client: e } = await signIn(target, state.other.email);
  const submitted = async (email, overrides) => {
    const res = await submitRequest(anon, email, overrides);
    if (res.error) throw new Error(`demande hors connexion : ${res.error.message}`);
    return requestByRef(admin, res.data[0].reference);
  };

  const off1 = await submitted(state.claimer.email);
  const off2 = await submitted(state.claimer.email);
  check('une demande hors connexion n’a pas de titulaire', off1.user_id === null);
  const visible = await d.rpc('my_claimable_requests');
  check('le client à adresse confirmée voit ses demandes rattachables', (visible.data ?? []).filter((row) => row.item_kind === 'DEMANDE').length === 2, visible.error?.message);
  check('un autre client n’en voit aucune', ((await e.rpc('my_claimable_requests')).data ?? []).length === 0);
  const sameName = await submitted(`${PREFIX}-homonyme-${randomUUID().slice(0, 6)}@${TEST_DOMAIN}`, { p_full_name: 'Contrôle Rattachement', p_phone: '+269 000 11 22' });
  check('même nom et même téléphone, autre adresse : jamais rattachable', !((visible.data ?? []).some((row) => row.item_id === sameName.id)));

  const burst = await Promise.all(Array.from({ length: 5 }, () => d.rpc('claim_my_requests')));
  const total = burst.reduce((sum, res) => sum + (res.data?.demandes ?? 0), 0);
  const after1 = await requestByRef(admin, off1.reference);
  const after2 = await requestByRef(admin, off2.reference);
  check('cinq rattachements simultanés : chaque demande rattachée une seule fois', burst.every((res) => !res.error) && total === 2 && after1.user_id === state.claimer.userId && after2.user_id === state.claimer.userId,
    burst.map((res) => res.error?.message ?? JSON.stringify(res.data)).join(' | '));
  const lead = (await admin.from('leads').select('user_id').eq('email', state.claimer.email.toLowerCase()).single()).data;
  check('le prospect est rattaché au même compte', lead.user_id === state.claimer.userId);
  check('idempotent : un nouvel appel ne rattache rien', (await d.rpc('claim_my_requests')).data?.demandes === 0);
  check('l’homonyme reste sans titulaire', (await requestByRef(admin, sameName.reference)).user_id === null);
  const audit = await runSql(target, accessToken, `select count(*)::int as n from public.audit_logs where action = 'relation.rattachement' and actor_id = '${state.claimer.userId}';`);
  check('le rattachement est journalisé', audit?.[0]?.n >= 1);

  // Adresse non confirmée.
  const unconfirmedEmail = `${PREFIX}-nonconfirme-${randomUUID().slice(0, 6)}@${TEST_DOMAIN}`;
  const offU = await submitted(unconfirmedEmail);
  const { data: u } = await admin.auth.admin.createUser({ email: unconfirmedEmail, password: PASSWORD, email_confirm: false });
  await admin.from('user_roles').upsert({ user_id: u.user.id, role_id: await roleId(admin, 'CLIENT') }, { onConflict: 'user_id,role_id' });
  const peek = await admin.rpc('client_confirmed_email', { p_uid: u.user.id });
  check('adresse non confirmée : aucun rattachement possible', (await requestByRef(admin, offU.reference)).user_id === null && !peek.data);

  // Conflit : prospect déjà rattaché à un autre compte.
  const off3 = await submitted(state.claimer.email);
  await admin.from('leads').update({ user_id: state.other.userId }).eq('email', state.claimer.email.toLowerCase());
  const conflict = await d.rpc('claim_my_requests');
  check('conflit (prospect rattaché à un autre compte) : rien n’est rattaché, le conflit est compté',
    conflict.data?.conflits === 1 && (await requestByRef(admin, off3.reference)).user_id === null, JSON.stringify(conflict.data));
  await admin.from('leads').update({ user_id: state.claimer.userId }).eq('email', state.claimer.email.toLowerCase());

  // Compte suspendu.
  await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', state.claimer.userId);
  const suspended = await d.rpc('claim_my_requests');
  await admin.from('profiles').update({ status: 'ACTIF' }).eq('id', state.claimer.userId);
  check('compte suspendu : rattachement refusé', suspended.error?.code === '42501');

  // Demande antérieure à la mise en service : jamais rattachée par le client.
  const old = await submitted(state.claimer.email);
  await runSql(target, accessToken, `update public.quote_requests set created_at = '2026-09-29T10:00:00Z' where id = '${old.id}';`);
  check('demande antérieure : invisible et non rattachable par le client',
    !((await d.rpc('my_claimable_requests')).data ?? []).some((row) => row.item_id === old.id) &&
      (await d.rpc('claim_my_requests')).data?.references?.includes(old.reference) !== true &&
      (await requestByRef(admin, old.reference)).user_id === null);
  const detected = await state.relCA.rpc('historical_claimable_requests');
  check('… détectée par l’administration (users.view + quotes.view)', (detected.data ?? []).some((row) => row.item_id === old.id && row.client_user_id === state.claimer.userId), detected.error?.message);
  check('… détection refusée à un client', Boolean((await d.rpc('historical_claimable_requests')).error));
  check('… rattachement historique refusé sans permission', Boolean((await d.rpc('attach_historical_request', { p_kind: 'DEMANDE', p_item_id: old.id, p_reason: 'essai' })).error));
  check('… motif obligatoire', Boolean((await state.relCA.rpc('attach_historical_request', { p_kind: 'DEMANDE', p_item_id: old.id, p_reason: ' ' })).error));
  const attached = await state.relCA.rpc('attach_historical_request', { p_kind: 'DEMANDE', p_item_id: old.id, p_reason: 'Contrôle 4I-3' });
  check('… rattachée par l’acte administratif explicite', !attached.error && (await requestByRef(admin, old.reference)).user_id === state.claimer.userId, attached.error?.message);
  check('… et pas deux fois', Boolean((await state.relCA.rpc('attach_historical_request', { p_kind: 'DEMANDE', p_item_id: old.id, p_reason: 'Contrôle 4I-3' })).error));
}

async function relationHttp(ctx, base) {
  log.step(`Espace client — demandes, devis, rendez-vous (${base})`);
  const { target, state } = ctx;
  const storageKey = `sb-${new URL(target.url).hostname.split('.')[0]}-auth-token`;
  const cookie = async (account) => sessionCookieHeader(storageKey, (await signIn(target, account.email)).session);
  const cA = await cookie(state.a);
  const cB = await cookie(state.b);
  const cCA = await cookie(state.ca);

  const list = await visit(base, '/espace-client/demandes/', cA);
  check('A : Mes demandes liste sa demande', list.status === 200 && list.body.includes(state.reqA.reference));
  const fiche = await visit(base, `/espace-client/demandes/${state.reqA.reference}/`, cA);
  check('A : fiche demande avec message, devis envoyés et suivi', fiche.status === 200 && fiche.body.includes('message de contrôle') && fiche.body.includes(state.q.accept.reference) && fiche.body.includes('Suivi'));
  check('A : aucun agent, aucune affectation dans la fiche', !fiche.body.includes('Affectation') && !fiche.body.includes(state.ca.email.split('@')[0]));
  const devis = await visit(base, '/espace-client/devis/', cA);
  check('A : Mes devis sans brouillon ni brouillon abandonné', devis.status === 200 && devis.body.includes(state.q.double.reference) && !devis.body.includes('Sans numéro'));
  const quotePage = await visit(base, `/espace-client/devis/${state.q.expired.reference}/`, cA);
  check('A : un devis à la validité dépassée s’affiche « Expiré », sans boutons de réponse', quotePage.status === 200 && quotePage.body.includes('Expiré') && !quotePage.body.includes('Accepter le devis'));
  const rdv = await visit(base, '/espace-client/rendez-vous/', cA);
  check('A : Mes rendez-vous, à venir et passés', rdv.status === 200 && rdv.body.includes('Rendez-vous passés et clos'));
  const rdvPage = await visit(base, `/espace-client/rendez-vous/${state.ap.future}/`, cA);
  check('A : fiche rendez-vous annulé par lui, avec son motif', rdvPage.status === 200 && rdvPage.body.includes('Par vous') && rdvPage.body.includes('Empêchement de dernière minute'));
  const rdvAdmin = await visit(base, `/espace-client/rendez-vous/${state.ap.race1}/`, cA);
  check('A : annulation par MORA Shawiri sans motif administratif', rdvAdmin.status === 200 && !rdvAdmin.body.includes('Créneau indisponible'));
  const dash = await visit(base, '/espace-client/', cA);
  const openA = (list.body.match(/(\d+) en cours sur/) ?? [])[1];
  check('tableau de bord : « Demandes en cours » = rubrique', openA !== undefined && dash.body.includes(`Demandes en cours</dt><dd>${openA}</dd>`), `rubrique ${openA}`);

  for (const [label, cookieOf] of [['B', cB], ['CLIENT + ADMIN', cCA]]) {
    check(`${label} : la fiche demande de A est introuvable`, (await visit(base, `/espace-client/demandes/${state.reqA.reference}/`, cookieOf)).status === 404);
    check(`${label} : le devis de A est introuvable`, (await visit(base, `/espace-client/devis/${state.q.double.reference}/`, cookieOf)).status === 404);
    check(`${label} : le rendez-vous de A est introuvable`, (await visit(base, `/espace-client/rendez-vous/${state.ap.future}/`, cookieOf)).status === 404);
    const lists = [];
    for (const path of ['/espace-client/demandes/', '/espace-client/devis/', '/espace-client/rendez-vous/', '/espace-client/']) lists.push(await visit(base, path, cookieOf));
    check(`${label} : aucune donnée de A dans ses rubriques`, lists.every((page) => page.status === 200 && !page.body.includes(state.reqA.reference) && !page.body.includes(state.q.double.reference)));
  }
  check('CLIENT + ADMIN : sa propre demande est listée', (await visit(base, '/espace-client/demandes/', cCA)).body.includes(state.reqCA.reference));
  const adminReq = await visit(base, `/administration/demandes/${state.reqA.reference}/`, cCA);
  check('administration : la décision et le motif du client sont visibles', adminReq.status === 200 && adminReq.body.includes('Décision du client') && adminReq.body.includes('Budget insuffisant pour cette année'));
  const adminAppt = await visit(base, `/administration/rendez-vous/${state.ap.future}/`, cCA);
  check('administration : l’annulation par le client est visible', adminAppt.status === 200 && adminAppt.body.includes('Le client, depuis son espace'));
}

async function cleanupRelation(ctx) {
  const { target, accessToken, state } = ctx;
  if (!state.relationStartedAt) return;
  log.step('Démontage des données relation de contrôle');
  const since = `'${state.relationStartedAt}'::timestamptz`;
  const leads = `(select id from public.leads where email like '${PREFIX}-%@${TEST_DOMAIN}')`;
  await runSql(target, accessToken, `
    begin;
    delete from public.quotes where quote_request_id in (select id from public.quote_requests where lead_id in ${leads});
    delete from public.relation_notes where quote_request_id in (select id from public.quote_requests where lead_id in ${leads})
       or appointment_id in (select id from public.appointments where lead_id in ${leads});
    delete from public.quote_requests where lead_id in ${leads};
    delete from public.appointments where lead_id in ${leads};
    update public.documents set status = 'ANNULE' where doc_type = 'DVCL' and issued_at >= ${since};
    delete from public.documents where doc_type = 'DVCL' and issued_at >= ${since};
    delete from public.leads where email like '${PREFIX}-%@${TEST_DOMAIN}';
    delete from public.rate_limit_counters where bucket like 'relation.%' and subject_hash in (${HASHES.map((h) => `'${h}'`).join(',') || "''"});
    commit;`).catch((error) => log.fail(`démontage relation : ${error.message}`));
  const residue = (await runSql(target, accessToken, `
    select (select count(*) from public.leads where email like '${PREFIX}-%')::int as leads,
           (select count(*) from public.quote_requests where created_at >= ${since})::int as demandes,
           (select count(*) from public.appointments where created_at >= ${since})::int as rendez_vous,
           (select count(*) from public.documents where doc_type = 'DVCL' and issued_at >= ${since})::int as devis;`).catch(() => null))?.[0];
  check('aucune demande, devis, rendez-vous ni prospect de contrôle ne subsiste', residue && Object.values(residue).every((value) => value === 0), JSON.stringify(residue));
}


/* -------------------------------------------------------------------------- */
/* Lot 4I-4 — administration Clients ; durcissement des accès propriétaire     */
/* -------------------------------------------------------------------------- */

/** Lectures directes en base qu'un propriétaire fait de ses données privées. */
async function ownerReads(client, state, who) {
  const counts = {};
  const tables = who === 'A'
    ? { quote_requests: ['id', state.reqA.id], quotes: ['quote_request_id', state.reqA.id], appointments: ['id', state.ap.future], orders: ['id', state.orderA.id], payments: ['order_id', state.orderA.id], order_items: ['order_id', state.orderA.id], order_events: ['order_id', state.orderA.id], clients: ['user_id', state.a.userId] }
    : { orders: ['id', state.orderB.id], payments: ['order_id', state.orderB.id], payment_proofs: ['id', state.proofB.id], refunds: ['order_id', state.orderB.id], documents: ['reference', state.invoiceB], clients: ['user_id', state.b.userId] };
  for (const [table, [column, value]] of Object.entries(tables)) {
    const { data } = await client.from(table).select(column === 'id' || column === 'reference' || column === 'user_id' ? column : 'id').eq(column, value);
    counts[table] = (data ?? []).length;
  }
  return counts;
}

async function adminClients(ctx, base) {
  log.step('Administration Clients : permissions, liste, notes, blocage, sessions ouvertes');
  const { admin, target, accessToken, state } = ctx;
  const storageKey = `sb-${new URL(target.url).hostname.split('.')[0]}-auth-token`;

  // Profils d'administration.
  await grant(admin, state.ca.userId, ['users.view', 'users.update', 'users.disable', 'affiliates.view']);
  state.gest = await createAccount(admin, { roles: ['ADMIN'], label: 'gestion-clients', grants: ['users.view', 'users.update', 'users.disable', 'orders.view', 'quotes.view', 'appointments.view'] });
  state.reader = await createAccount(admin, { roles: ['ADMIN'], label: 'lecteur-clients', grants: ['users.view'] });
  state.bare = await createAccount(admin, { roles: ['ADMIN'], label: 'admin-nu' });
  state.root = await createAccount(admin, { roles: ['SUPER_ADMIN'], label: 'super' });
  const { client: gest } = await signIn(target, state.gest.email);
  const { client: reader } = await signIn(target, state.reader.email);
  const { client: bare } = await signIn(target, state.bare.email);
  const { client: root } = await signIn(target, state.root.email);
  const { client: aff } = await signIn(target, state.aff.email);
  const anon = sessionClient(target);

  // --- Liste : permissions, recherche, filtres, pagination.
  const list = (client, extra = {}) => client.rpc('admin_list_clients', { p_search: null, p_state: null, p_preference: null, p_sort: 'recent', p_limit: 25, p_offset: 0, ...extra });
  check('liste : SUPER_ADMIN autorisé', !(await list(root)).error);
  check('liste : ADMIN avec users.view autorisé', !(await list(reader)).error);
  for (const [label, client] of [['ADMIN sans permission', bare], ['CLIENT', state.relA], ['AFFILIE', aff], ['anonyme', anon]]) {
    check(`liste : ${label} refusé`, Boolean((await list(client)).error));
  }
  const byRef = await list(reader, { p_search: state.a.reference });
  check('recherche par MORA-CLI', (byRef.data ?? []).length === 1 && byRef.data[0].user_id === state.a.userId);
  const byMail = await list(reader, { p_search: state.b.email.toUpperCase() });
  check('recherche par e-mail (casse ignorée)', (byMail.data ?? []).some((row) => row.user_id === state.b.userId));
  const byName = await list(reader, { p_search: 'Contrôle Client B' });
  check('recherche par nom', (byName.data ?? []).some((row) => row.user_id === state.b.userId));
  const byPhone = await list(reader, { p_search: '321 00 01' });
  check('recherche par téléphone (chiffres)', (byPhone.data ?? []).some((row) => row.user_id === state.a.userId));
  const byOrder = await list(reader, { p_search: state.orderB.reference });
  check('recherche par référence de commande', (byOrder.data ?? []).length === 1 && byOrder.data[0].user_id === state.b.userId);
  const pageOne = await list(reader, { p_search: PREFIX, p_limit: 2, p_offset: 0 });
  const pageTwo = await list(reader, { p_search: PREFIX, p_limit: 2, p_offset: 2 });
  check('pagination côté serveur : pages distinctes, total commun',
    (pageOne.data ?? []).length === 2 && (pageTwo.data ?? []).length >= 1 && Number(pageOne.data[0].total_count) === Number(pageTwo.data[0].total_count) &&
      !pageTwo.data.some((row) => pageOne.data.some((first) => first.user_id === row.user_id)));
  check('aucun lead sans compte dans la liste', !((await list(reader, { p_search: 'homonyme' })).data ?? []).length);

  // --- Notes internes.
  check('note : refusée sans users.update', Boolean((await reader.rpc('add_client_note', { p_user_id: state.a.userId, p_body: 'Essai', p_corrects: null })).error));
  check('note : refusée à un client', Boolean((await state.relA.rpc('add_client_note', { p_user_id: state.a.userId, p_body: 'Essai', p_corrects: null })).error));
  const note = await gest.rpc('add_client_note', { p_user_id: state.a.userId, p_body: 'Préfère être rappelée le matin.', p_corrects: null });
  check('note ajoutée par un ADMIN autorisé, auteur imposé', !note.error && note.data?.author_id === state.gest.userId, note.error?.message);
  const fix = await gest.rpc('add_client_note', { p_user_id: state.a.userId, p_body: 'Correction : plutôt l’après-midi.', p_corrects: note.data?.id });
  check('correction traçable, liée à la note d’origine', !fix.error && fix.data?.corrects_note_id === note.data?.id);
  check('note : aucune modification, même par la clé de service', refused2(await admin.from('client_notes').update({ body: 'réécrit' }).eq('id', note.data?.id).select()));
  check('note : aucune suppression, même par la clé de service', refused2(await admin.from('client_notes').delete().eq('id', note.data?.id).select()));
  check('note : jamais visible du client', ((await state.relA.from('client_notes').select('id')).data ?? []).length === 0);
  const noteAudit = await runSql(target, accessToken, `select count(*)::int as n from public.audit_logs where action = 'clients.note' and actor_id = '${state.gest.userId}';`);
  check('note journalisée (qui, quand, quoi)', noteAudit?.[0]?.n === 2);

  // --- Blocage : permissions et règles.
  check('blocage : refusé sans users.disable', Boolean((await reader.rpc('block_client', { p_user_id: state.a.userId, p_reason: 'Essai de blocage' })).error));
  check('blocage : refusé à un client et à un anonyme',
    Boolean((await state.relB.rpc('block_client', { p_user_id: state.a.userId, p_reason: 'Essai de blocage' })).error) &&
      Boolean((await anon.rpc('block_client', { p_user_id: state.a.userId, p_reason: 'Essai de blocage' })).error));
  check('blocage : motif obligatoire', (await gest.rpc('block_client', { p_user_id: state.a.userId, p_reason: ' ' })).error?.code === '23514');
  check('blocage : on ne se bloque pas soi-même', (await state.sessionCA.rpc('block_client', { p_user_id: state.ca.userId, p_reason: 'Essai sur soi' })).error?.code === '23514');

  // --- Sessions ouvertes AVANT la suspension.
  const cookieA = sessionCookieHeader(storageKey, (await signIn(target, state.a.email)).session);
  const cookieB = sessionCookieHeader(storageKey, (await signIn(target, state.b.email)).session);
  const beforeA = await ownerReads(state.relA, state, 'A');
  const beforeB = await ownerReads(state.relB, state, 'B');
  check('avant blocage : A lit ses données privées', Object.values(beforeA).every((n) => n >= 1), JSON.stringify(beforeA));
  check('avant blocage : B lit ses données privées', Object.values(beforeB).every((n) => n >= 1), JSON.stringify(beforeB));

  const blockA = await gest.rpc('block_client', { p_user_id: state.a.userId, p_reason: 'Contrôle 4I-4 : impayés' });
  const blockB = await gest.rpc('block_client', { p_user_id: state.b.userId, p_reason: 'Contrôle 4I-4 : abus' });
  const profA = (await admin.from('profiles').select('status').eq('id', state.a.userId).single()).data;
  check('blocage d’un client seul : fiche bloquée et compte suspendu', !blockA.error && blockA.data?.profile_suspended_by_block === true && profA.status === 'SUSPENDU', blockA.error?.message);
  check('blocage de B (client seul) effectué', !blockB.error && blockB.data?.profile_suspended_by_block === true, blockB.error?.message);
  check('déjà bloqué : second blocage refusé', (await gest.rpc('block_client', { p_user_id: state.a.userId, p_reason: 'Encore' })).error?.code === '23514');

  const afterA = await ownerReads(state.relA, state, 'A');
  const afterB = await ownerReads(state.relB, state, 'B');
  check('RLS : A suspendu, session ouverte — aucune donnée privée lue en base', Object.values(afterA).every((n) => n === 0), JSON.stringify(afterA));
  check('RLS : B suspendu, session ouverte — ni commande, ni paiement, ni justificatif, ni remboursement, ni facture', Object.values(afterB).every((n) => n === 0), JSON.stringify(afterB));
  const snaps = await state.relB.from('document_snapshots').select('document_id');
  check('RLS : instantanés de facture refusés', (snaps.data ?? []).length === 0);
  const proofFile = await state.relB.storage.from('paiements-justificatifs').download(state.proofB.storage_path);
  check('stockage : justificatif refusé au propriétaire suspendu', Boolean(proofFile.error));
  const docId = (await admin.from('documents').select('id').eq('reference', state.invoiceB).single()).data?.id;
  const archive = docId ? await state.relB.storage.from('documents-officiels').download(`FACL/${docId}.pdf`) : { error: true };
  check('stockage : archive de facture refusée au propriétaire suspendu', Boolean(archive.error));
  check('fonctions client refusées (décision, chronologie, rattachement, profil, paiement)',
    Boolean((await state.relA.rpc('respond_to_my_quote', { p_quote_id: state.q.expired.id, p_decision: 'REFUSE', p_reason: null })).error) &&
      ((await state.relA.rpc('my_request_timeline', { p_request_id: state.reqA.id })).data ?? []).length === 0 &&
      Boolean((await state.relA.rpc('update_my_client_profile', { p_full_name: 'Tentative', p_phone: null, p_whatsapp: null, p_contact_preference: null })).error) &&
      Boolean((await state.relA.rpc('declare_payment', { p_order_id: state.orderA.id, p_method_code: 'ESPECES', p_amount: 100, p_transaction_reference: null, p_client_note: null })).error));
  if (base) {
    for (const path of ['/espace-client/', '/espace-client/demandes/', '/espace-client/devis/', '/espace-client/rendez-vous/', '/espace-client/commandes/', '/espace-client/paiements/', '/espace-client/documents/']) {
      const page = await visit(base, path, cookieA);
      check(`écran ${path} : ancienne session refusée`, page.status >= 300 && page.status < 400 && (page.location ?? '').includes('/connexion/'), `HTTP ${page.status}`);
    }
    check('API facture : ancienne session de B refusée', (await visit(base, `/api/documents/${state.invoiceB}/?espace=client`, cookieB)).status === 404);
    check('API justificatif : ancienne session de B refusée', (await visit(base, `/api/justificatifs/${state.proofB.id}/?espace=client`, cookieB)).status === 404);
  }

  // --- Déblocage : reprise normale, même session.
  const unblockA = await gest.rpc('unblock_client', { p_user_id: state.a.userId, p_reason: 'Situation régularisée' });
  await gest.rpc('unblock_client', { p_user_id: state.b.userId, p_reason: null });
  const profA2 = (await admin.from('profiles').select('status').eq('id', state.a.userId).single()).data;
  check('déblocage : fiche débloquée, compte réactivé', !unblockA.error && profA2.status === 'ACTIF', unblockA.error?.message);
  const backA = await ownerReads(state.relA, state, 'A');
  check('après déblocage : A relit ses données avec la même session', Object.values(backA).every((n) => n >= 1), JSON.stringify(backA));
  if (base) check('après déblocage : l’espace rouvre', (await visit(base, '/espace-client/', cookieA)).status === 200);
  check('déblocage d’un client non bloqué : refusé', (await gest.rpc('unblock_client', { p_user_id: state.a.userId, p_reason: null })).error?.code === '23514');
  const events = (await admin.from('client_status_events').select('kind, reason, actor_id').eq('client_user_id', state.a.userId).order('created_at')).data ?? [];
  check('historique : blocage puis déblocage, avec auteur et motif',
    events.length === 2 && events[0].kind === 'BLOCAGE' && events[0].reason === 'Contrôle 4I-4 : impayés' && events[1].kind === 'DEBLOCAGE' && events[0].actor_id === state.gest.userId);
  check('historique en ajout seul', refused2(await admin.from('client_status_events').delete().eq('client_user_id', state.a.userId).select()));
  const blockAudit = await runSql(target, accessToken, `select action, metadata->>'motif' as motif from public.audit_logs where resource_id = '${state.a.reference}' and actor_id = '${state.gest.userId}' and action in ('clients.blocage','clients.deblocage') order by created_at;`);
  check('audit : blocage et déblocage journalisés avec leur motif', blockAudit?.length === 2 && blockAudit[0].motif === 'Contrôle 4I-4 : impayés');

  // --- Compte CLIENT + ADMIN : bloquer le client ne retire pas l'administration.
  const blockCA = await gest.rpc('block_client', { p_user_id: state.ca.userId, p_reason: 'Contrôle multi-rôles' });
  const profCA = (await admin.from('profiles').select('status').eq('id', state.ca.userId).single()).data;
  check('CLIENT + ADMIN bloqué : compte NON suspendu (autres rôles conservés)', !blockCA.error && blockCA.data?.profile_suspended_by_block === false && profCA.status === 'ACTIF', blockCA.error?.message);
  const caOwn = await state.sessionCA.rpc('my_request_timeline', { p_request_id: state.reqCA.id });
  check('… ses accès propriétaire sont refusés (fonctions client)', (caOwn.data ?? []).length === 0 && Boolean((await state.sessionCA.rpc('claim_my_requests')).error));
  const caOwnRow = await state.sessionCA.from('clients').select('user_id').eq('user_id', state.ca.userId);
  check('… sa propre fiche reste lisible au titre de users.view seulement', (caOwnRow.data ?? []).length === 1);
  check('… son administration reste ouverte (liste des clients)', !(await state.sessionCA.rpc('admin_list_clients', { p_search: null, p_state: null, p_preference: null, p_sort: 'recent', p_limit: 5, p_offset: 0 })).error);
  if (base) {
    const cookieCA = sessionCookieHeader(storageKey, (await signIn(target, state.ca.email)).session);
    const space = await visit(base, '/espace-client/', cookieCA);
    check('… son espace client affiche « suspendu », sans aucune donnée', space.status === 200 && space.body.includes('Votre espace client est suspendu') && !space.body.includes(state.orderCA.reference) && !space.body.includes(state.reqCA.reference));
    const fiche = await visit(base, `/espace-client/demandes/${state.reqCA.reference}/`, cookieCA);
    check('… même par URL directe', !fiche.body.includes('message de contrôle'));
    check('… et l’administration répond toujours', (await visit(base, '/administration/clients/', cookieCA)).status === 200);
  }
  await gest.rpc('unblock_client', { p_user_id: state.ca.userId, p_reason: null });

  // --- Compte CLIENT + AFFILIE : bloquer la qualité CLIENT ne casse pas l'espace affilié.
  const blockBoth = await gest.rpc('block_client', { p_user_id: state.both.userId, p_reason: 'Contrôle client + affilié' });
  const { client: bothSession } = await signIn(target, state.both.email);
  const ownAffiliate = await bothSession.from('affiliates').select('id').eq('user_id', state.both.userId);
  check('CLIENT + AFFILIE bloqué comme client : profil actif, affiliation toujours lisible',
    !blockBoth.error && blockBoth.data?.profile_suspended_by_block === false && (ownAffiliate.data ?? []).length === 1, blockBoth.error?.message);
  if (base) {
    const cookieBoth = sessionCookieHeader(storageKey, (await signIn(target, state.both.email)).session);
    const affSpace = await visit(base, '/espace-affilie/', cookieBoth);
    check('… son espace affilié reste ouvert', affSpace.status === 200 && affSpace.body.includes('aff-nav--side'));
    const cliSpace = await visit(base, '/espace-client/', cookieBoth);
    check('… son espace client est fermé', cliSpace.status === 200 && cliSpace.body.includes('Votre espace client est suspendu'));
  }
  await gest.rpc('unblock_client', { p_user_id: state.both.userId, p_reason: null });
  // Profil réellement suspendu : les deux espaces privés se ferment.
  await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', state.both.userId);
  check('profil suspendu : l’affiliation n’est plus lisible avec l’ancienne session',
    ((await bothSession.from('affiliates').select('id').eq('user_id', state.both.userId)).data ?? []).length === 0);
  await admin.from('profiles').update({ status: 'ACTIF' }).eq('id', state.both.userId);

  // --- Compte déjà suspendu par ailleurs : le déblocage client ne le réactive pas.
  await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', state.other.userId);
  const blockOther = await gest.rpc('block_client', { p_user_id: state.other.userId, p_reason: 'Contrôle double suspension' });
  await gest.rpc('unblock_client', { p_user_id: state.other.userId, p_reason: null });
  const profOther = (await admin.from('profiles').select('status').eq('id', state.other.userId).single()).data;
  check('un compte suspendu par ailleurs n’est pas réactivé par le déblocage client', !blockOther.error && blockOther.data?.profile_suspended_by_block === false && profOther.status === 'SUSPENDU');
  await admin.from('profiles').update({ status: 'ACTIF' }).eq('id', state.other.userId);

  // --- Rattachement historique : chaque type sous sa permission 4F.
  const oldAppt = await submitAppointment(anon, state.claimer.email);
  if (oldAppt.error) throw new Error(`rendez-vous historique : ${oldAppt.error.message}`);
  const { data: apRows } = await admin.from('appointments').select('id').is('user_id', null).order('created_at', { ascending: false }).limit(1);
  const oldApptId = apRows[0].id;
  await runSql(target, accessToken, `update public.appointments set created_at = '2026-09-29T11:00:00Z' where id = '${oldApptId}';`);
  state.rdvOnly = await createAccount(admin, { roles: ['ADMIN'], label: 'rdv-seul', grants: ['users.view', 'users.update', 'appointments.view'] });
  state.quotesOnly = await createAccount(admin, { roles: ['ADMIN'], label: 'devis-seul', grants: ['users.view', 'users.update', 'quotes.view', 'quotes.manage'] });
  const { client: rdvOnly } = await signIn(target, state.rdvOnly.email);
  const { client: quotesOnly } = await signIn(target, state.quotesOnly.email);
  const seenRdv = (await rdvOnly.rpc('historical_claimable_requests')).data ?? [];
  check('détection : appointments.view voit le rendez-vous historique, pas les demandes', seenRdv.some((row) => row.item_id === oldApptId) && seenRdv.every((row) => row.item_kind === 'RENDEZ_VOUS'));
  const seenQuotes = (await quotesOnly.rpc('historical_claimable_requests')).data ?? [];
  check('détection : quotes.view ne voit pas les rendez-vous', !seenQuotes.some((row) => row.item_kind === 'RENDEZ_VOUS'));
  check('détection en lecture seule : rien n’est rattaché', (await admin.from('appointments').select('user_id').eq('id', oldApptId).single()).data.user_id === null);
  check('rattachement d’un rendez-vous refusé sans appointments.update (quotes.manage ne suffit pas)',
    Boolean((await quotesOnly.rpc('attach_historical_request', { p_kind: 'RENDEZ_VOUS', p_item_id: oldApptId, p_reason: 'Essai' })).error));
  check('rattachement d’un rendez-vous refusé sans appointments.update (lecture seule)',
    Boolean((await rdvOnly.rpc('attach_historical_request', { p_kind: 'RENDEZ_VOUS', p_item_id: oldApptId, p_reason: 'Essai' })).error));
  await grant(admin, state.rdvOnly.userId, ['appointments.update']);
  const attachedRdv = await rdvOnly.rpc('attach_historical_request', { p_kind: 'RENDEZ_VOUS', p_item_id: oldApptId, p_reason: 'Contrôle 4I-4' });
  check('rattachement d’un rendez-vous avec users.update + appointments.update', !attachedRdv.error && (await admin.from('appointments').select('user_id').eq('id', oldApptId).single()).data.user_id === state.claimer.userId, attachedRdv.error?.message);

  if (base) {
    const cookieGest = sessionCookieHeader(storageKey, (await signIn(target, state.gest.email)).session);
    const listPage = await visit(base, `/administration/clients/?q=${encodeURIComponent(state.a.reference)}`, cookieGest);
    check('écran liste : recherche servie côté serveur', listPage.status === 200 && listPage.body.includes(state.a.reference) && !listPage.body.includes(state.b.reference));
    const fiche = await visit(base, `/administration/clients/${state.a.reference}/`, cookieGest);
    check('écran fiche : profil, activité, commandes, demandes, rendez-vous, notes, blocage',
      fiche.status === 200 && ['Profil', 'Activité', 'Commandes', 'Demandes et devis', 'Rendez-vous', 'Notes internes', 'Blocage', 'Payé et vérifié', 'Remboursé'].every((t) => fiche.body.includes(t)));
    check('écran fiche : notes et correction affichées', fiche.body.includes('Préfère être rappelée le matin.') && fiche.body.includes('corrige la note'));
    // Le remboursement de B n'était qu'enregistré : 4G ne le compte qu'une
    // fois effectué. On le finalise, comme l'administration le ferait.
    const completed = await state.sessionCA.rpc('complete_refund', { p_refund_id: state.refundB.id, p_external_reference: null });
    check('remboursement de B finalisé par l’administration', !completed.error, completed.error?.message);
    const ficheB = await visit(base, `/administration/clients/${state.b.reference}/`, cookieGest);
    // 15 000 payés et vérifiés, 3 000 remboursés : deux vérités 4G distinctes.
    const stat = (label, digits) => new RegExp(`${label}</p><p class="admin-stat__value">${digits}[\\s\\u00a0\\u202f]000`);
    check('écran fiche : payé vérifié et remboursé distincts (15 000 payés, 3 000 remboursés)',
      stat('Payé et vérifié', '15').test(ficheB.body) && stat('Remboursé', '3').test(ficheB.body));
    const cookieReader = sessionCookieHeader(storageKey, (await signIn(target, state.reader.email)).session);
    const ficheReader = await visit(base, `/administration/clients/${state.a.reference}/`, cookieReader);
    check('écran fiche : sans orders.view, le bloc commandes est réservé', ficheReader.status === 200 && ficheReader.body.includes('La permission orders.view est nécessaire') && !ficheReader.body.includes(state.orderA.reference));
    check('écran fiche : sans users.disable ni users.update, aucun bouton d’acte', !ficheReader.body.includes('Bloquer le client') && !ficheReader.body.includes('Ajouter la note'));
    const cookieBare = sessionCookieHeader(storageKey, (await signIn(target, state.bare.email)).session);
    check('écran : ADMIN sans users.view — module introuvable', (await visit(base, '/administration/clients/', cookieBare)).status === 404);
    check('écran : un client — administration fermée', (await visit(base, `/administration/clients/${state.a.reference}/`, cookieA)).status !== 200);
    const cookieRoot = sessionCookieHeader(storageKey, (await signIn(target, state.root.email)).session);
    check('écran : SUPER_ADMIN ouvre la fiche', (await visit(base, `/administration/clients/${state.b.reference}/`, cookieRoot)).status === 200);

    // Cas réel MORA-CLI-A0001 (lecture seule, aucun clic). Depuis la clôture
    // 4I-5, MORA-DMCL-A0001 et le rendez-vous réel lui sont rattachés, sur
    // décision du propriétaire et par l'interface : la fiche les montre comme
    // siens, et plus rien n'est en attente de rattachement.
    const real = await visit(base, '/administration/clients/MORA-CLI-A0001/', cookieGest);
    check('cas réel (lecture seule) : MORA-DMCL-A0001 figure dans les demandes de MORA-CLI-A0001',
      real.status === 200 && real.body.includes('/administration/demandes/MORA-DMCL-A0001/'), `HTTP ${real.status}`);
    check('cas réel (lecture seule) : plus aucun élément historique en attente sur MORA-CLI-A0001', real.body.includes('Aucun élément historique rattachable'));
    for (const [label, account] of [['A', state.a], ['B', state.b], ['CLIENT + ADMIN', state.ca]]) {
      const cookie = sessionCookieHeader(storageKey, (await signIn(target, account.email)).session);
      const page = await visit(base, '/espace-client/demandes/', cookie);
      check(`cas réel : MORA-DMCL-A0001 n’apparaît pas chez le client de contrôle ${label}`, page.status === 200 && !page.body.includes('MORA-DMCL-A0001'));
    }
  }
}

async function cleanup(ctx) {
  log.step('Démontage');
  const { admin, target, accessToken, before } = ctx;
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data?.users ?? []) {
    if (user.email?.startsWith(`${PREFIX}-`) && user.email.endsWith(`@${TEST_DOMAIN}`)) {
      const removed = await admin.auth.admin.deleteUser(user.id);
      if (removed.error) log.fail(`suppression de ${user.email} : ${removed.error.message}`);
    }
  }
  const { data: after } = await admin.auth.admin.listUsers({ perPage: 1000 });
  check('aucun compte de contrôle ne subsiste', !(after?.users ?? []).some((user) => user.email?.startsWith(`${PREFIX}-`)));
  const { count } = await admin.from('clients').select('user_id', { count: 'exact', head: true });
  check('les fiches de contrôle ont disparu avec leurs comptes', count === before.clients, `${count} contre ${before.clients}`);
  const sequences = await runSql(target, accessToken, `select doc_type, series, last_number, allocated_count from public.document_sequences where doc_type <> 'CLI' order by doc_type;`);
  check('aucune autre suite documentaire n’a bougé', JSON.stringify(sequences) === JSON.stringify(before.sequences), JSON.stringify(sequences));
  const real = (await runSql(target, accessToken, REAL_DATA_SQL))?.[0]?.etat;
  check('données réelles intactes (MORA-DMCL-A0001, rendez-vous et prospect réels, MORA-CLI-A0001/A0002)',
    JSON.stringify(real) === JSON.stringify(before.real), JSON.stringify(real));
}

const REAL_DATA_SQL = `
  select json_build_object(
    'demandes', (select json_agg(json_build_object('ref', reference, 'user', user_id, 'status', status, 'maj', updated_at) order by reference) from public.quote_requests where reference not like 'MORA-DMCL-ZZ%' and created_at < '2026-10-02T00:00:00Z'),
    'rendez_vous', (select json_agg(json_build_object('user', user_id, 'status', status, 'maj', updated_at) order by created_at) from public.appointments where created_at < '2026-10-02T00:00:00Z'),
    'prospects', (select json_agg(json_build_object('user', user_id, 'maj', updated_at) order by created_at) from public.leads where created_at < '2026-10-02T00:00:00Z'),
    'clients', (select json_agg(json_build_object('ref', reference, 'wa', whatsapp, 'pref', contact_preference) order by reference) from public.clients where reference in ('MORA-CLI-A0001', 'MORA-CLI-A0002'))
  ) as etat;`;

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();
  const base = readFlag('base')?.replace(/\/$/, '');
  log.step(`Espace client — ${describeTarget(target)}`);

  const admin = createClient(target.url, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { count: clients } = await admin.from('clients').select('user_id', { count: 'exact', head: true });
  const sequences = await runSql(target, accessToken, `select doc_type, series, last_number, allocated_count from public.document_sequences where doc_type <> 'CLI' order by doc_type;`);
  const real = (await runSql(target, accessToken, REAL_DATA_SQL))?.[0]?.etat;
  const ctx = { admin, target, accessToken, state: {}, before: { clients, sequences, real } };

  try {
    await attribution(ctx);
    await immutability(ctx);
    await rls(ctx);
    await profile(ctx);
    if (base) {
      await http(ctx, base);
      await seedCommerce(ctx);
      await commerceHttp(ctx, base);
      await affiliateGateway(ctx, base);
      await seedRelation(ctx);
      await quoteDecisions(ctx);
      await appointmentCancels(ctx);
      await timelines(ctx);
      await claims(ctx);
      await relationHttp(ctx, base);
      await adminClients(ctx, base);
    } else log.skip('Écrans non contrôlés (aucun --base)');
  } catch (error) {
    results.failed += 1;
    log.fail(`interruption : ${error.message}`);
  } finally {
    await cleanupRelation(ctx).catch((error) => log.fail(`démontage relation : ${error.message}`));
    await cleanupCommerce(ctx).catch((error) => log.fail(`démontage commerce : ${error.message}`));
    await cleanup(ctx);
  }

  log.step(`${results.passed} réussi(s), ${results.failed} échec(s)`);
  if (results.failed > 0) process.exitCode = 1;
}

main();
