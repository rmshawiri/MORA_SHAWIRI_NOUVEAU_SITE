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
    if (base) await http(ctx, base);
    else log.skip('Écrans non contrôlés (aucun --base)');
  } catch (error) {
    results.failed += 1;
    log.fail(`interruption : ${error.message}`);
  } finally {
    await cleanup(ctx);
  }

  log.step(`${results.passed} réussi(s), ${results.failed} échec(s)`);
  if (results.failed > 0) process.exitCode = 1;
}

main();
