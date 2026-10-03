/**
 * Contrôle du socle des notifications — phase 4J-1.
 *
 *   npm run notifications:verify -- --env shared
 *
 * À lancer **par l'entrée npm** : le lanceur `run-with-client-sequence.mjs`
 * relève la suite MORA-CLI avant, la restitue après et le prouve (ce contrôle
 * crée des comptes CLIENT).
 *
 * Ce que ce contrôle établit contre la base réelle, avec de vraies sessions :
 *   * aucune session ne crée, ne résout, ne modifie ni ne supprime une
 *     notification ; seul « marquer comme lue » lui est ouvert ;
 *   * CLIENT A ne voit jamais les notifications de CLIENT B, AFFILIÉ A jamais
 *     celles d'AFFILIÉ B ; un compte CLIENT + AFFILIÉ a deux boîtes ;
 *   * ADMINISTRATION : seuls les administrateurs qui détiennent la permission
 *     du type la reçoivent et la voient ; un retrait de permission la masque ;
 *     l'auteur de l'acte n'est pas notifié ;
 *   * un profil suspendu, un client bloqué ne voient plus rien ;
 *   * lue et traitée sont indépendantes ;
 *   * l'unicité destinataire / espace / type / événement tient en
 *     concurrence.
 *
 * Données de contrôle : comptes `@mora-shawiri.test` (le SMTP refuse ce
 * domaine : aucun e-mail ne peut partir — et rien ici n'en envoie),
 * notifications d'origine `verif_4j1`, références `MORA-…-ZZ….`. La diffusion
 * administrative atteint aussi, quelques secondes, les vrais administrateurs
 * (arbitrage N21) : leurs notifications de contrôle sont supprimées au
 * démontage, et l'on prouve qu'il n'en reste aucune.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, log, resolveAccessToken, resolveTarget, runSql } from './lib/config.mjs';

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

const TEST_DOMAIN = 'mora-shawiri.test';
const PREFIX = 'verif-notif';
const SOURCE = 'verif_4j1';
const PASSWORD = `Verif-4J-${randomUUID()}`;
const RUN = randomUUID().slice(0, 8);

const uuid = () => randomUUID();
let serial = 0;
const source = () => `${RUN}-${(serial += 1)}`;

function sessionClient(target) {
  return createClient(target.url, target.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(target, email) {
  const client = sessionClient(target);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`connexion impossible pour ${email} : ${error.message}`);
  return client;
}

async function roleId(admin, code) {
  const { data } = await admin.from('roles').select('id').eq('code', code).single();
  return data.id;
}

async function createAccount(admin, { roles = [], label, grants = [] }) {
  const email = `${PREFIX}-${label}-${RUN}@${TEST_DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`création de ${label} : ${error?.message}`);
  const userId = data.user.id;
  for (const code of roles) {
    const written = await admin.from('user_roles').upsert({ user_id: userId, role_id: await roleId(admin, code) }, { onConflict: 'user_id,role_id' });
    if (written.error) throw new Error(written.error.message);
  }
  if (grants.length > 0) await grant(admin, userId, grants);
  return { userId, email };
}

async function grant(admin, userId, codes) {
  const { data: permissions } = await admin.from('permissions').select('id, code').in('code', codes);
  const written = await admin.from('user_permissions').upsert(
    permissions.map((row) => ({ user_id: userId, permission_id: row.id, effect: 'OCTROI' })),
    { onConflict: 'user_id,permission_id' },
  );
  if (written.error) throw new Error(written.error.message);
}

async function ungrant(admin, userId, code) {
  const { data: permission } = await admin.from('permissions').select('id').eq('code', code).single();
  const removed = await admin.from('user_permissions').delete().eq('user_id', userId).eq('permission_id', permission.id);
  if (removed.error) throw new Error(removed.error.message);
}

/** Création interne, par la clé de service — le chemin des déclencheurs de 4J-2. */
async function create(admin, type, recipient, entityType, params = {}, options = {}) {
  const { data, error } = await admin.rpc('notifications_create', {
    p_type: type,
    p_recipient: recipient,
    p_entity_type: entityType,
    p_entity_id: options.entityId ?? uuid(),
    p_params: params,
    p_source_table: SOURCE,
    p_source_id: options.sourceId ?? source(),
    p_actor: options.actor ?? null,
  });
  if (error) throw new Error(`création ${type} : ${error.message}`);
  return data;
}

async function visibleIds(client, audience) {
  const { data, error } = await client.from('notifications').select('id').eq('audience', audience);
  if (error) return { error };
  return new Set((data ?? []).map((row) => row.id));
}

async function counts(client, audience) {
  const { data, error } = await client.rpc('my_notification_counts', { p_audience: audience });
  if (error || !Array.isArray(data) || !data[0]) return { error: error?.message ?? 'aucune ligne' };
  return data[0];
}

async function rowOf(admin, id) {
  const { data } = await admin.from('notifications').select('*').eq('id', id).maybeSingle();
  return data;
}

/* -------------------------------------------------------------------------- */

async function seed(ctx) {
  log.step('Comptes de contrôle');
  const { admin, state } = ctx;
  state.root = await createAccount(admin, { roles: ['SUPER_ADMIN'], label: 'super' });
  state.adminPay = await createAccount(admin, { roles: ['ADMIN'], label: 'admin-paiement', grants: ['payments.verify'] });
  state.adminNo = await createAccount(admin, { roles: ['ADMIN'], label: 'admin-sans' });
  state.adminRevoked = await createAccount(admin, { roles: ['ADMIN'], label: 'admin-retire', grants: ['payments.verify'] });
  state.a = await createAccount(admin, { roles: ['CLIENT'], label: 'client-a' });
  state.b = await createAccount(admin, { roles: ['CLIENT'], label: 'client-b' });
  state.affA = await createAccount(admin, { roles: ['AFFILIE'], label: 'affilie-a' });
  state.affB = await createAccount(admin, { roles: ['AFFILIE'], label: 'affilie-b' });
  state.both = await createAccount(admin, { roles: ['CLIENT', 'AFFILIE'], label: 'client-affilie' });
  state.suspended = await createAccount(admin, { roles: ['CLIENT'], label: 'suspendu' });
  state.blocked = await createAccount(admin, { roles: ['CLIENT', 'AFFILIE'], label: 'bloque' });

  const code = `ZZ_VERIF_4J1_${RUN.toUpperCase().replace(/[^A-Z]/g, 'X')}`;
  const { data: category, error } = await admin.from('affiliate_categories').insert({ code, label: 'Contrôle 4J-1' }).select().single();
  if (error) throw new Error(`catégorie de contrôle : ${error.message}`);
  state.categoryCode = code;
  const base = 9100 + Math.floor(Math.random() * 800);
  let index = 0;
  for (const account of [state.affA, state.affB, state.both, state.blocked]) {
    index += 1;
    const inserted = await admin.from('affiliates').insert({
      slug: `${PREFIX}-${index}-${RUN}`,
      reference: `MORA-AFIL-ZZ${base + index}`,
      status: 'ACTIF',
      category_id: category.id,
      display_name: `Partenaire contrôle ${index}`,
      contact_email: account.email,
      user_id: account.userId,
      started_on: '2026-10-01',
    });
    if (inserted.error) throw new Error(`affilié de contrôle : ${inserted.error.message}`);
  }
  check('onze comptes de contrôle créés, tous en @mora-shawiri.test', true);
}

async function reservedCreation(ctx) {
  log.step('Création réservée au serveur');
  const { admin, target, state } = ctx;
  const anon = sessionClient(target);
  const clientA = await signIn(target, state.a.email);
  state.sessions = { a: clientA };

  const args = {
    p_type: 'client.commande.confirmee', p_recipient: state.a.userId, p_entity_type: 'order', p_entity_id: uuid(),
    p_params: {}, p_source_table: SOURCE, p_source_id: source(), p_actor: null,
  };
  check('anonyme : notifications_create refusée', Boolean((await anon.rpc('notifications_create', args)).error));
  check('client : notifications_create refusée (on ne s’envoie pas de notification)', Boolean((await clientA.rpc('notifications_create', args)).error));
  check('client : diffusion administrative refusée', Boolean((await clientA.rpc('notifications_create_for_admins', {
    p_type: 'admin.paiement.a_verifier', p_entity_type: 'payment', p_entity_id: uuid(), p_params: {}, p_source_table: SOURCE, p_source_id: source(), p_actor: null,
  })).error));
  check('client : résolution refusée', Boolean((await clientA.rpc('notifications_resolve', { p_types: ['client.devis.disponible'], p_entity_type: 'quote', p_entity_id: uuid() })).error));
  check('client : lecture des droits d’autrui refusée', Boolean((await clientA.rpc('user_has_effective_permission', { p_user_id: state.root.userId, p_permission: 'payments.verify' })).error));

  const inserted = await clientA.from('notifications').insert({
    recipient_id: state.a.userId, audience: 'CLIENT', type_code: 'client.commande.confirmee', level: 'INFORMATION',
    entity_type: 'order', entity_id: uuid(), params: {}, source_table: SOURCE, source_id: source(),
  }).select();
  check('client : insertion directe refusée', Boolean(inserted.error) || (inserted.data ?? []).length === 0);
  const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', state.a.userId);
  check('aucune notification n’a été créée par ces tentatives', count === 0, String(count));

  const anonRead = await anon.from('notifications').select('id');
  check('anonyme : aucune lecture', Boolean(anonRead.error) || (anonRead.data ?? []).length === 0);
  check('anonyme : compteur refusé', Boolean((await anon.rpc('my_notification_counts', { p_audience: 'CLIENT' })).error));
}

async function contract(ctx) {
  log.step('Contrat de la fonction de création');
  const { admin, state } = ctx;
  const call = (type, entityType, params, recipient = state.a.userId) => admin.rpc('notifications_create', {
    p_type: type, p_recipient: recipient, p_entity_type: entityType, p_entity_id: uuid(), p_params: params,
    p_source_table: SOURCE, p_source_id: source(), p_actor: null,
  });
  check('type inconnu : refusé', (await call('client.inconnu.type', 'order', {})).error?.code === '22023');
  check('ressource incompatible avec le type : refusée', (await call('client.commande.confirmee', 'quote', {})).error?.code === '22023');
  check('montant dans les données : refusé (N13)', (await call('client.commande.confirmee', 'order', { montant: '150000' })).error?.code === '22023');
  check('adresse e-mail dans les données : refusée (N13)', (await call('client.commande.confirmee', 'order', { email: `x@${TEST_DOMAIN}` })).error?.code === '22023');
  check('référence hors format : refusée', (await call('client.commande.confirmee', 'order', { reference: 'https://exemple.test/' })).error?.code === '22023');

  // Éligibilité : chaque espace a ses destinataires possibles.
  check('un affilié sans rôle CLIENT ne reçoit pas de notification client', (await call('client.commande.confirmee', 'order', {}, state.affA.userId)).data === null);
  check('un client sans affiliation ne reçoit pas de notification affilié', (await call('affilie.commission.acquise', 'affiliate_commission', {}, state.a.userId)).data === null);
  check('un client ne reçoit pas de notification d’administration', (await call('admin.paiement.a_verifier', 'payment', {}, state.a.userId)).data === null);
  check('un ADMIN sans payments.verify ne reçoit pas « paiement à vérifier »', (await call('admin.paiement.a_verifier', 'payment', {}, state.adminNo.userId)).data === null);
  check('l’auteur d’un acte n’est pas notifié de sa propre action (N5)',
    (await create(admin, 'client.commande.confirmee', state.a.userId, 'order', {}, { actor: state.a.userId })) === null);

  // Le catalogue fait foi : espace, niveau et permission ne se forcent pas.
  const forced = await admin.from('notifications').insert({
    recipient_id: state.b.userId, audience: 'ADMINISTRATION', type_code: 'client.commande.annulee', level: 'A_TRAITER',
    required_permission: 'admin.full_access', entity_type: 'order', entity_id: uuid(), params: {}, source_table: SOURCE, source_id: source(),
    read_at: new Date().toISOString(),
  }).select().single();
  check('insertion forcée : espace, niveau, permission et lecture repris du catalogue',
    forced.data?.audience === 'CLIENT' && forced.data?.level === 'ATTENTION' && forced.data?.required_permission === null && forced.data?.read_at === null,
    JSON.stringify(forced.error ?? forced.data));
  if (forced.data) await admin.from('notifications').delete().eq('id', forced.data.id);
}

async function clientAndAffiliate(ctx) {
  log.step('RLS : client, affilié, multi-rôle');
  const { admin, target, state } = ctx;
  const n = state.n = {};
  n.a1 = await create(admin, 'client.commande.confirmee', state.a.userId, 'order', { reference: 'MORA-CMCL-ZZ9001' });
  n.a2 = await create(admin, 'client.devis.disponible', state.a.userId, 'quote', { reference: 'MORA-DVCL-ZZ9001' });
  n.b1 = await create(admin, 'client.paiement.confirme', state.b.userId, 'payment', { reference: 'MORA-CMCL-ZZ9002' });
  n.affA = await create(admin, 'affilie.commission.acquise', state.affA.userId, 'affiliate_commission', { reference: 'MORA-COMAF-ZZ9001' });
  n.affB = await create(admin, 'affilie.versement.confirme', state.affB.userId, 'affiliate_payout');
  n.bothClient = await create(admin, 'client.commande.terminee', state.both.userId, 'order', { reference: 'MORA-CMCL-ZZ9003' });
  n.bothAff = await create(admin, 'affilie.prospect.valide', state.both.userId, 'affiliate_prospect');
  check('sept notifications client / affilié créées', Object.values(n).every(Boolean));

  const a = state.sessions.a;
  const b = await signIn(target, state.b.email);
  const affA = await signIn(target, state.affA.email);
  const affB = await signIn(target, state.affB.email);
  const both = await signIn(target, state.both.email);
  Object.assign(state.sessions, { b, affA, affB, both });

  const aClient = await visibleIds(a, 'CLIENT');
  check('CLIENT A voit ses deux notifications client', aClient.size === 2 && aClient.has(n.a1) && aClient.has(n.a2), JSON.stringify([...aClient]));
  check('CLIENT A ne voit pas celle de CLIENT B, même par son identifiant', ((await a.from('notifications').select('id').eq('id', n.b1)).data ?? []).length === 0);
  check('CLIENT A ne voit aucune notification sans filtre d’espace hors des siennes', ((await a.from('notifications').select('id')).data ?? []).length === 2);
  const bClient = await visibleIds(b, 'CLIENT');
  check('CLIENT B ne voit que la sienne', bClient.size === 1 && bClient.has(n.b1));

  const aff = await visibleIds(affA, 'AFFILIE');
  check('AFFILIÉ A voit la sienne, pas celle d’AFFILIÉ B', aff.size === 1 && aff.has(n.affA) && !aff.has(n.affB));
  check('AFFILIÉ B ne voit pas celle d’AFFILIÉ A', !(await visibleIds(affB, 'AFFILIE')).has(n.affA));
  check('AFFILIÉ A n’a pas de boîte client', (await visibleIds(affA, 'CLIENT')).size === 0);

  const bothClient = await visibleIds(both, 'CLIENT');
  const bothAff = await visibleIds(both, 'AFFILIE');
  check('CLIENT + AFFILIÉ : la boîte client ne contient que la notification client', bothClient.size === 1 && bothClient.has(n.bothClient));
  check('CLIENT + AFFILIÉ : la boîte affilié ne contient que la notification affilié', bothAff.size === 1 && bothAff.has(n.bothAff));
  const [cc, ca] = [await counts(both, 'CLIENT'), await counts(both, 'AFFILIE')];
  check('CLIENT + AFFILIÉ : deux compteurs séparés (1 et 1)', cc.unread === 1 && ca.unread === 1, JSON.stringify({ cc, ca }));
  check('CLIENT + AFFILIÉ : aucune boîte d’administration', (await visibleIds(both, 'ADMINISTRATION')).size === 0);

  const ac = await counts(a, 'CLIENT');
  check('compteur CLIENT A : 2 non lues, 1 à traiter', ac.unread === 2 && ac.pending === 1, JSON.stringify(ac));
}

async function readState(ctx) {
  log.step('Lu / non lu ; traité / non traité');
  const { admin, state } = ctx;
  const { a, b, both } = state.sessions;
  const n = state.n;

  const first = await a.rpc('mark_notification_read', { p_id: n.a1 });
  check('CLIENT A marque sa notification comme lue', first.data === true, JSON.stringify(first.error));
  const again = await a.rpc('mark_notification_read', { p_id: n.a1 });
  check('la marquer une seconde fois ne change rien', again.data === false);
  const foreign = await a.rpc('mark_notification_read', { p_id: n.b1 });
  check('CLIENT A ne peut pas marquer celle de CLIENT B (réponse indistincte)', foreign.data === false);
  check('celle de CLIENT B reste non lue', (await rowOf(admin, n.b1))?.read_at === null);
  check('identifiant inexistant : simple « faux »', (await a.rpc('mark_notification_read', { p_id: uuid() })).data === false);

  const direct = await b.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.b1).select();
  check('mise à jour directe par une session : refusée', Boolean(direct.error) || (direct.data ?? []).length === 0);
  const steal = await b.from('notifications').update({ recipient_id: state.a.userId }).eq('id', n.b1).select();
  check('changement de destinataire par une session : refusé', Boolean(steal.error) || (steal.data ?? []).length === 0);
  const del = await b.from('notifications').delete().eq('id', n.b1).select();
  check('suppression par une session : refusée', Boolean(del.error) || (del.data ?? []).length === 0);
  check('la notification de CLIENT B est intacte', (await rowOf(admin, n.b1))?.recipient_id === state.b.userId);

  const reassign = await admin.from('notifications').update({ recipient_id: state.a.userId }).eq('id', n.b1);
  check('même la clé de service ne change pas le destinataire (immuable)', Boolean(reassign.error));
  const unread = await admin.from('notifications').update({ read_at: null }).eq('id', n.a1);
  check('une lecture ne s’annule pas', Boolean(unread.error));

  const afterRead = await rowOf(admin, n.a1);
  check('lue n’implique pas traitée', afterRead?.read_at !== null && afterRead?.resolved_at === null);

  // Traité : posé par le moteur seul.
  const resolved = await admin.rpc('notifications_resolve', { p_types: ['client.devis.disponible'], p_entity_type: 'quote', p_entity_id: (await rowOf(admin, n.a2)).entity_id });
  check('résolution interne : une notification « à traiter » traitée', resolved.data === 1, JSON.stringify(resolved));
  const a2 = await rowOf(admin, n.a2);
  check('traitée n’implique pas lue', a2?.resolved_at !== null && a2?.read_at === null);
  const ac = await counts(a, 'CLIENT');
  check('compteur CLIENT A : 1 non lue, 0 à traiter', ac.unread === 1 && ac.pending === 0, JSON.stringify(ac));
  const info = await admin.rpc('notifications_resolve', { p_types: ['client.commande.confirmee'], p_entity_type: 'order', p_entity_id: afterRead.entity_id });
  check('une notification « information » ne devient jamais « traitée »', info.data === 0);
  const unresolve = await admin.from('notifications').update({ resolved_at: null }).eq('id', n.a2);
  check('un traitement ne s’annule pas', Boolean(unresolve.error));

  // Tout marquer comme lu, dans un seul espace.
  const all = await both.rpc('mark_all_notifications_read', { p_audience: 'CLIENT' });
  check('CLIENT + AFFILIÉ : « tout marquer comme lu » côté client marque 1 notification', all.data === 1, JSON.stringify(all));
  check('… et laisse la boîte affilié intacte', (await counts(both, 'AFFILIE')).unread === 1);
  check('… le compteur client tombe à 0', (await counts(both, 'CLIENT')).unread === 0);
  check('espace inconnu : refusé', Boolean((await both.rpc('mark_all_notifications_read', { p_audience: 'TOUT' })).error));
  const allA = await a.rpc('mark_all_notifications_read', { p_audience: 'CLIENT' });
  check('CLIENT A : « tout marquer » ne touche que ses notifications', allA.data === 1 && (await rowOf(admin, n.b1))?.read_at === null, JSON.stringify(allA));
}

async function administration(ctx) {
  log.step('RLS : administration et permissions');
  const { admin, target, state } = ctx;
  const { data: realAdmins } = await admin.from('user_roles').select('user_id, roles!inner(is_admin_role)').eq('roles.is_admin_role', true);
  const testIds = new Set([state.root, state.adminPay, state.adminNo, state.adminRevoked].map((acc) => acc.userId));
  state.realAdminIds = [...new Set((realAdmins ?? []).map((row) => row.user_id))].filter((id) => !testIds.has(id));

  const paymentId = uuid();
  const src = source();
  const fan = await admin.rpc('notifications_create_for_admins', {
    p_type: 'admin.paiement.a_verifier', p_entity_type: 'payment', p_entity_id: paymentId,
    p_params: { reference: 'MORA-CMCL-ZZ9004' }, p_source_table: SOURCE, p_source_id: src, p_actor: state.adminPay.userId,
  });
  check('diffusion « paiement à vérifier » effectuée', typeof fan.data === 'number' && fan.data >= 2, JSON.stringify(fan));
  const { data: rows } = await admin.from('notifications').select('id, recipient_id').eq('source_table', SOURCE).eq('source_id', src);
  const recipients = new Set((rows ?? []).map((row) => row.recipient_id));
  check('SUPER_ADMIN de contrôle destinataire', recipients.has(state.root.userId));
  check('ADMIN avec payments.verify destinataire', recipients.has(state.adminRevoked.userId));
  check('ADMIN sans payments.verify : aucune ligne créée', !recipients.has(state.adminNo.userId));
  check('l’auteur (ADMIN qui a agi) n’est pas destinataire (N5)', !recipients.has(state.adminPay.userId));
  check('aucun client ni affilié destinataire', ![state.a, state.b, state.affA, state.both].some((acc) => recipients.has(acc.userId)));
  const again = await admin.rpc('notifications_create_for_admins', {
    p_type: 'admin.paiement.a_verifier', p_entity_type: 'payment', p_entity_id: paymentId,
    p_params: { reference: 'MORA-CMCL-ZZ9004' }, p_source_table: SOURCE, p_source_id: src, p_actor: state.adminPay.userId,
  });
  check('rejouer la même diffusion ne crée rien (idempotence)', again.data === 0, JSON.stringify(again));
  check('diffusion vers un type non administratif : refusée', Boolean((await admin.rpc('notifications_create_for_admins', {
    p_type: 'client.commande.confirmee', p_entity_type: 'order', p_entity_id: uuid(), p_params: {}, p_source_table: SOURCE, p_source_id: source(), p_actor: null,
  })).error));

  // Une notification pour l'ADMIN avec permission, créée hors diffusion.
  const own = await create(admin, 'admin.paiement.a_verifier', state.adminPay.userId, 'payment', { reference: 'MORA-CMCL-ZZ9005' });
  const root = await signIn(target, state.root.email);
  const pay = await signIn(target, state.adminPay.email);
  const no = await signIn(target, state.adminNo.email);
  const revoked = await signIn(target, state.adminRevoked.email);

  const rootIds = await visibleIds(root, 'ADMINISTRATION');
  check('SUPER_ADMIN voit sa notification d’administration', rootIds.size === 1);
  check('SUPER_ADMIN n’a aucune boîte client', (await visibleIds(root, 'CLIENT')).size === 0);
  check('ADMIN avec permission voit la sienne', (await visibleIds(pay, 'ADMINISTRATION')).has(own));
  const noIds = await visibleIds(no, 'ADMINISTRATION');
  check('ADMIN sans permission : aucune notification visible', noIds.size === 0);
  const noCounts = await counts(no, 'ADMINISTRATION');
  check('ADMIN sans permission : compteur 0 / 0', noCounts.unread === 0 && noCounts.pending === 0, JSON.stringify(noCounts));
  check('ADMIN sans permission : ne peut marquer celle d’un autre', (await no.rpc('mark_notification_read', { p_id: own })).data === false);
  check('CLIENT A ne voit aucune notification d’administration', (await visibleIds(state.sessions.a, 'ADMINISTRATION')).size === 0);

  // Retrait de permission après création (N8).
  const revokedRow = (rows ?? []).find((row) => row.recipient_id === state.adminRevoked.userId);
  check('avant retrait : l’ADMIN voit la notification', (await visibleIds(revoked, 'ADMINISTRATION')).has(revokedRow?.id));
  await ungrant(admin, state.adminRevoked.userId, 'payments.verify');
  check('après retrait : la notification n’est plus révélée', (await visibleIds(revoked, 'ADMINISTRATION')).size === 0);
  const rc = await counts(revoked, 'ADMINISTRATION');
  check('après retrait : compteur 0 / 0', rc.unread === 0 && rc.pending === 0, JSON.stringify(rc));
  check('après retrait : marquer comme lue est sans effet', (await revoked.rpc('mark_notification_read', { p_id: revokedRow?.id })).data === false);
  check('après retrait : « tout marquer » ne touche rien', (await revoked.rpc('mark_all_notifications_read', { p_audience: 'ADMINISTRATION' })).data === 0);
  check('après retrait : la ligne reste non lue en base', (await rowOf(admin, revokedRow?.id))?.read_at === null);
  await grant(admin, state.adminRevoked.userId, ['payments.verify']);
  check('permission rendue : la notification redevient visible (aucun droit n’a été figé)', (await visibleIds(revoked, 'ADMINISTRATION')).has(revokedRow?.id));

  // Résolution d'une notification d'administration : traitée, pas lue.
  const resolved = await admin.rpc('notifications_resolve', { p_types: ['admin.paiement.a_verifier'], p_entity_type: 'payment', p_entity_id: paymentId });
  check('résolution : toutes les copies « à traiter » du paiement sont traitées', resolved.data === (rows ?? []).length, JSON.stringify(resolved));
  const rootCounts = await counts(root, 'ADMINISTRATION');
  check('SUPER_ADMIN : toujours 1 non lue, plus rien à traiter', rootCounts.unread === 1 && rootCounts.pending === 0, JSON.stringify(rootCounts));

  state.realAdminTouched = state.realAdminIds.filter((id) => recipients.has(id)).length;
  log.skip(`diffusion : ${state.realAdminTouched} vrai(s) administrateur(s) atteint(s) le temps du contrôle — supprimé au démontage`);
}

async function suspension(ctx) {
  log.step('Profil suspendu ; client bloqué');
  const { admin, target, state } = ctx;
  const sid = await create(admin, 'client.commande.confirmee', state.suspended.userId, 'order', { reference: 'MORA-CMCL-ZZ9006' });
  const session = await signIn(target, state.suspended.email);
  check('profil actif : la notification est visible', (await visibleIds(session, 'CLIENT')).has(sid));
  const suspended = await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', state.suspended.userId);
  check('profil passé à SUSPENDU (statut existant)', !suspended.error, suspended.error?.message);
  check('profil suspendu, jeton encore valide : plus rien de visible', (await visibleIds(session, 'CLIENT')).size === 0);
  check('profil suspendu : compteur 0', (await counts(session, 'CLIENT')).unread === 0);
  check('profil suspendu : marquer comme lue sans effet', (await session.rpc('mark_notification_read', { p_id: sid })).data === false);

  const cid = await create(admin, 'client.commande.annulee', state.blocked.userId, 'order', { reference: 'MORA-CMCL-ZZ9007' });
  const aid = await create(admin, 'affilie.commission.annulee', state.blocked.userId, 'affiliate_commission');
  const blocked = await signIn(target, state.blocked.email);
  check('avant blocage : boîte client visible', (await visibleIds(blocked, 'CLIENT')).has(cid));
  const block = await admin.from('clients').update({ blocked_at: new Date().toISOString(), block_reason: 'Contrôle 4J-1 — compte de test' }).eq('user_id', state.blocked.userId);
  check('fiche client de contrôle bloquée', !block.error, block.error?.message);
  check('client bloqué : boîte client fermée', (await visibleIds(blocked, 'CLIENT')).size === 0);
  check('client bloqué : boîte affilié toujours ouverte (règle 4I)', (await visibleIds(blocked, 'AFFILIE')).has(aid));
}

async function idempotence(ctx) {
  log.step('Idempotence en concurrence');
  const { admin, state } = ctx;
  const src = source();
  const entityId = uuid();
  const attempts = await Promise.all(Array.from({ length: 6 }, () => admin.rpc('notifications_create', {
    p_type: 'client.facture.disponible', p_recipient: state.b.userId, p_entity_type: 'order', p_entity_id: entityId,
    p_params: { reference: 'MORA-CMCL-ZZ9008' }, p_source_table: SOURCE, p_source_id: src, p_actor: null,
  })));
  const created = attempts.filter((attempt) => attempt.data).length;
  const errors = attempts.filter((attempt) => attempt.error).length;
  check('six créations simultanées du même événement : une seule réussit', created === 1 && errors === 0, JSON.stringify({ created, errors }));
  const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('source_table', SOURCE).eq('source_id', src);
  check('une seule ligne en base', count === 1, String(count));
  check('rejouer ensuite : aucune nouvelle ligne', (await create(admin, 'client.facture.disponible', state.b.userId, 'order', { reference: 'MORA-CMCL-ZZ9008' }, { sourceId: src, entityId })) === null);
  check('même événement, autre type : une notification distincte', Boolean(await create(admin, 'client.commande.terminee', state.b.userId, 'order', {}, { sourceId: src, entityId })));
  check('même type, autre événement : une notification distincte', Boolean(await create(admin, 'client.facture.disponible', state.b.userId, 'order', {}, { entityId })));
}

/* -------------------------------------------------------------------------- */

async function cleanup(ctx) {
  log.step('Démontage');
  const { admin, target, accessToken, before } = ctx;

  await runSql(target, accessToken, `delete from public.notifications where source_table = '${SOURCE}';`)
    .catch((error) => log.fail(`suppression des notifications : ${error.message}`));

  await runSql(target, accessToken, `
    begin;
    alter table public.affiliate_events disable trigger affiliate_events_append_only;
    delete from public.affiliate_events
     where affiliate_id in (select id from public.affiliates where slug like '${PREFIX}-%')
        or category_id in (select id from public.affiliate_categories where code like 'ZZ_VERIF_4J1_%');
    delete from public.affiliates where slug like '${PREFIX}-%';
    delete from public.affiliate_categories where code like 'ZZ_VERIF_4J1_%';
    alter table public.affiliate_events enable trigger affiliate_events_append_only;
    commit;`).catch((error) => log.fail(`démontage affiliation : ${error.message}`));
  const guard = await runSql(target, accessToken, `select tgenabled from pg_trigger where tgname = 'affiliate_events_append_only';`).catch(() => null);
  check('la garde du journal d’affiliation est rétablie', guard?.[0]?.tgenabled === 'O');

  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data?.users ?? []) {
    if (user.email?.startsWith(`${PREFIX}-`) && user.email.endsWith(`@${TEST_DOMAIN}`)) {
      const removed = await admin.auth.admin.deleteUser(user.id);
      if (removed.error) log.fail(`suppression de ${user.email} : ${removed.error.message}`);
    }
  }
  const { data: after } = await admin.auth.admin.listUsers({ perPage: 1000 });
  check('aucun compte de contrôle ne subsiste', !(after?.users ?? []).some((user) => user.email?.startsWith(`${PREFIX}-`)));

  const end = (await runSql(target, accessToken, SNAPSHOT_SQL))?.[0]?.etat;
  check('aucune notification ne subsiste (boîtes vides, vrais administrateurs compris)', end?.notifications === 0 && end?.controle === 0, JSON.stringify({ n: end?.notifications, c: end?.controle }));
  check('aucune autre suite documentaire n’a bougé', JSON.stringify(end?.suites) === JSON.stringify(before?.suites), JSON.stringify(end?.suites));
  check('données réelles intactes (comptes, clients, commandes, paiements, devis, rendez-vous, affiliés, e-mails, file 4H, catalogue)',
    JSON.stringify(end?.reel) === JSON.stringify(before?.reel), JSON.stringify(end?.reel));
  check('aucun e-mail journalisé pendant le contrôle', end?.reel?.emails === before?.reel?.emails);
}

const SNAPSHOT_SQL = `
  select json_build_object(
    'notifications', (select count(*) from public.notifications),
    'controle', (select count(*) from public.notifications where source_table = '${SOURCE}'),
    'suites', (select json_agg(json_build_object('t', doc_type, 's', series, 'n', last_number, 'c', allocated_count) order by doc_type) from public.document_sequences where doc_type <> 'CLI'),
    'reel', json_build_object(
      'comptes', (select count(*) from public.profiles),
      'clients', (select json_agg(reference order by reference) from public.clients),
      'commandes', (select json_agg(json_build_object('r', reference, 's', status, 'm', updated_at) order by reference) from public.orders),
      'paiements', (select json_agg(json_build_object('s', status, 'm', updated_at) order by created_at) from public.payments),
      'devis', (select json_agg(json_build_object('r', reference, 's', status) order by reference) from public.quotes),
      'demandes', (select count(*) from public.quote_requests),
      'rendez_vous', (select json_agg(json_build_object('s', status, 'm', updated_at) order by created_at) from public.appointments),
      'affilies', (select json_agg(json_build_object('r', reference, 's', status) order by reference) from public.affiliates),
      'emails', (select count(*) from public.email_outbox),
      'file_4h', (select count(*) from public.notification_events),
      'types', (select count(*) from public.notification_types where active)
    )
  ) as etat;`;

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();
  log.step(`Notifications — socle 4J-1 — ${describeTarget(target)}`);

  const admin = createClient(target.url, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const before = (await runSql(target, accessToken, SNAPSHOT_SQL))?.[0]?.etat;
  check('état de départ : aucune notification en base (N16)', before?.notifications === 0, String(before?.notifications));
  const ctx = { admin, target, accessToken, state: {}, before };

  try {
    await seed(ctx);
    await reservedCreation(ctx);
    await contract(ctx);
    await clientAndAffiliate(ctx);
    await readState(ctx);
    await administration(ctx);
    await suspension(ctx);
    await idempotence(ctx);
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
