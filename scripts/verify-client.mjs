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
  return { status: response.status, location: response.headers.get('location'), body: response.status === 200 ? await response.text() : '' };
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
}

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();
  const base = readFlag('base')?.replace(/\/$/, '');
  log.step(`Espace client — ${describeTarget(target)}`);

  const admin = createClient(target.url, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { count: clients } = await admin.from('clients').select('user_id', { count: 'exact', head: true });
  const sequences = await runSql(target, accessToken, `select doc_type, series, last_number, allocated_count from public.document_sequences where doc_type <> 'CLI' order by doc_type;`);
  const ctx = { admin, target, accessToken, state: {}, before: { clients, sequences } };

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
    } else log.skip('Écrans non contrôlés (aucun --base)');
  } catch (error) {
    results.failed += 1;
    log.fail(`interruption : ${error.message}`);
  } finally {
    await cleanupCommerce(ctx).catch((error) => log.fail(`démontage commerce : ${error.message}`));
    await cleanup(ctx);
  }

  log.step(`${results.passed} réussi(s), ${results.failed} échec(s)`);
  if (results.failed > 0) process.exitCode = 1;
}

main();
