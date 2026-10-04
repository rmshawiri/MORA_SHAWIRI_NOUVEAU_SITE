/**
 * Contrôle des branchements des notifications — phase 4J-2.
 *
 *   npm run notifications:branchements -- --env shared
 *
 * À lancer par l'entrée npm (le lanceur restitue la suite MORA-CLI).
 *
 * Chaque scénario passe par les VRAIES fonctions métier, avec de vraies
 * sessions `.test` quand l'acte appartient à un client, un affilié ou un
 * administrateur : demande et devis, rendez-vous, commandes, paiements,
 * remboursement, facture, prospects, coordonnées, candidature, file 4H. Les
 * notifications sont ensuite lues en base et sous session.
 *
 * Ce que l'on établit : le bon type, le bon destinataire, une seule fois ;
 * l'auteur exclu ; un administrateur sans la permission d'agir, ou suspendu,
 * jamais destinataire ; la résolution automatique (traitée ≠ lue) ; la
 * séparation des boîtes d'un compte CLIENT + AFFILIÉ ; un client ou affilié
 * suspendu qui reçoit, ne voit pas, puis retrouve ; l'idempotence en
 * concurrence ; une panne du moteur qui n'annule pas l'acte, consignée puis
 * rejouée sans doublon.
 *
 * Aucun e-mail : les fonctions appelées n'en envoient pas (les e-mails
 * partent des actions serveur, jamais appelées ici) ; le journal des
 * e-mails est comparé avant / après. Comptes `@mora-shawiri.test` seulement.
 * Les commissions réelles (chaîne complète de 4H) sont contrôlées dans
 * `verify-affiliation.mjs`, qui les produit.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, hasFlag, log, resolveAccessToken, resolveTarget, runSql } from './lib/config.mjs';

const BASELINE_FILE = resolve(tmpdir(), 'mora-shawiri-notifications-4j2-avant.json');

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
const PREFIX = 'verif-n4j2';
const PASSWORD = `Verif-4J2-${randomUUID()}`;
const RUN = randomUUID().slice(0, 8);
const SEQUENCES = ['DMCL', 'DVCL', 'RVCL', 'CMCL', 'FACL'];

const hash = () => `${PREFIX}-${randomUUID()}`;

function sessionClient(target) {
  return createClient(target.url, target.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(target, email) {
  const client = sessionClient(target);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`connexion impossible pour ${email} : ${error.message}`);
  return client;
}

async function createAccount(admin, { roles = [], label, grants = [] }) {
  const email = `${PREFIX}-${label}-${RUN}@${TEST_DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`création de ${label} : ${error?.message}`);
  const userId = data.user.id;
  for (const code of roles) {
    const { data: role } = await admin.from('roles').select('id').eq('code', code).single();
    const written = await admin.from('user_roles').upsert({ user_id: userId, role_id: role.id }, { onConflict: 'user_id,role_id' });
    if (written.error) throw new Error(written.error.message);
  }
  if (grants.length > 0) {
    const { data: permissions } = await admin.from('permissions').select('id, code').in('code', grants);
    const written = await admin.from('user_permissions').upsert(
      permissions.map((row) => ({ user_id: userId, permission_id: row.id, effect: 'OCTROI' })),
      { onConflict: 'user_id,permission_id' },
    );
    if (written.error) throw new Error(written.error.message);
  }
  return { userId, email };
}

/** Notifications d'un type sur une ressource, groupées par destinataire. */
async function notes(admin, type, entityId) {
  const { data } = await admin.from('notifications').select('*').eq('type_code', type).eq('entity_id', entityId);
  const byRecipient = new Map();
  for (const row of data ?? []) byRecipient.set(row.recipient_id, [...(byRecipient.get(row.recipient_id) ?? []), row]);
  return { rows: data ?? [], count: (account) => (byRecipient.get(account.userId) ?? []).length, of: (account) => byRecipient.get(account.userId)?.[0] };
}

async function visible(client, audience) {
  const { data } = await client.from('notifications').select('id, type_code').eq('audience', audience);
  return data ?? [];
}

const one = (n, account) => n.count(account) === 1;
const none = (n, account) => n.count(account) === 0;

/* -------------------------------------------------------------------------- */

async function seed(ctx) {
  log.step('Comptes de contrôle');
  const { admin, target, state } = ctx;
  const A = state.accounts = {};
  A.root = await createAccount(admin, { roles: ['SUPER_ADMIN'], label: 'super' });
  A.verif = await createAccount(admin, { roles: ['ADMIN'], label: 'verificateur', grants: ['payments.verify', 'orders.update', 'orders.view'] });
  A.verif2 = await createAccount(admin, { roles: ['ADMIN'], label: 'verificateur2', grants: ['payments.verify'] });
  A.noPerm = await createAccount(admin, { roles: ['ADMIN'], label: 'sans-droit' });
  A.susAdmin = await createAccount(admin, { roles: ['ADMIN'], label: 'admin-suspendu', grants: ['payments.verify', 'quotes.manage', 'appointments.update'] });
  A.rembourseur = await createAccount(admin, { roles: ['ADMIN'], label: 'rembourseur', grants: ['payments.refund'] });
  A.refundBoth = await createAccount(admin, { roles: ['ADMIN'], label: 'deux-permissions', grants: ['payments.refund', 'orders.refund'] });
  A.orderRefundOnly = await createAccount(admin, { roles: ['ADMIN'], label: 'orders-refund', grants: ['orders.refund'] });
  // Un administrateur suspendu n'est plus un destinataire opérationnel.
  const suspended = await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', A.susAdmin.userId);
  if (suspended.error) throw new Error(suspended.error.message);

  A.clientA = await createAccount(admin, { roles: ['CLIENT'], label: 'client-a' });
  A.clientB = await createAccount(admin, { roles: ['CLIENT'], label: 'client-b' });
  A.both = await createAccount(admin, { roles: ['CLIENT', 'AFFILIE'], label: 'client-affilie' });
  A.susClient = await createAccount(admin, { roles: ['CLIENT'], label: 'client-suspendu' });
  A.affA = await createAccount(admin, { roles: ['AFFILIE'], label: 'affilie-a' });
  A.susAff = await createAccount(admin, { roles: ['AFFILIE'], label: 'affilie-suspendu' });

  const code = `ZZ_VERIF_4J2_${RUN.toUpperCase().replace(/[^A-Z]/g, 'X')}`;
  const { data: category, error } = await admin.from('affiliate_categories').insert({ code, label: 'Contrôle 4J-2' }).select().single();
  if (error) throw new Error(`catégorie de contrôle : ${error.message}`);
  const base = 9200 + Math.floor(Math.random() * 700);
  state.affiliates = {};
  let index = 0;
  for (const key of ['affA', 'both', 'susAff']) {
    index += 1;
    const { data: row, error: affError } = await admin.from('affiliates').insert({
      slug: `${PREFIX}-${index}-${RUN}`, reference: `MORA-AFIL-ZZ${base + index}`, status: 'ACTIF', category_id: category.id,
      display_name: `Partenaire contrôle ${index}`, contact_email: A[key].email, user_id: A[key].userId, started_on: '2026-10-01',
    }).select('id').single();
    if (affError) throw new Error(`affilié de contrôle : ${affError.message}`);
    state.affiliates[key] = row.id;
  }

  state.s = {};
  for (const key of ['root', 'verif', 'verif2', 'rembourseur', 'clientA', 'clientB', 'both', 'susClient', 'affA', 'susAff']) {
    state.s[key] = await signIn(target, A[key].email);
  }
  check('quatorze comptes de contrôle, tous en @mora-shawiri.test ; un administrateur suspendu', true);
}

async function newClients(ctx) {
  log.step('Nouveau client (administration)');
  const { admin, state } = ctx;
  const A = state.accounts;
  const n = await notes(admin, 'admin.client.nouveau', A.clientA.userId);
  check('nouveau client : le SUPER_ADMIN est notifié une fois', one(n, A.root), String(n.count(A.root)));
  check('nouveau client : l’administrateur suspendu ne l’est pas', none(n, A.susAdmin));
  check('nouveau client : le client lui-même ne l’est pas', none(n, A.clientA));
  check('nouveau client : niveau Information, référence MORA-CLI seule',
    n.of(A.root)?.level === 'INFORMATION' && /^MORA-CLI-/.test(n.of(A.root)?.params?.reference ?? '') && Object.keys(n.of(A.root)?.params ?? {}).length === 1);
}

async function submitQuoteRequest(client, email) {
  const { data, error } = await client.rpc('submit_quote_request', {
    p_full_name: 'Contrôle Notifications', p_email: email, p_phone: null, p_organisation: null,
    p_subject: `${PREFIX} demande ${RUN}`, p_budget: null, p_message: `${PREFIX} message de contrôle.`,
    p_service_slug: null, p_offer_title: null, p_details: [], p_source: 'contact', p_client_hash: hash(),
  });
  if (error) throw new Error(`demande : ${error.message}`);
  return data?.[0]?.reference;
}

async function draftAndSend(ctx, requestId) {
  const { admin } = ctx;
  const { data: draft, error } = await admin.from('quotes').insert({
    quote_request_id: requestId, amount: 7500, currency: 'KMF', summary: `${PREFIX} prestation devisée`,
  }).select('id').single();
  if (error) throw new Error(`brouillon : ${error.message}`);
  ctx.state.quotes.push(draft.id);
  const sent = await admin.rpc('send_quote', { p_quote_id: draft.id });
  if (sent.error) throw new Error(`émission du devis : ${sent.error.message}`);
  return { id: draft.id, reference: sent.data?.reference };
}

async function quotes(ctx) {
  log.step('Demandes et devis');
  const { admin, state } = ctx;
  const A = state.accounts;
  state.quotes = [];

  const refA = await submitQuoteRequest(state.s.clientA, A.clientA.email);
  const { data: reqA } = await admin.from('quote_requests').select('id, user_id, status').eq('reference', refA).single();
  state.requests = [reqA.id];
  check('la demande du client connecté lui est rattachée', reqA.user_id === A.clientA.userId);
  let n = await notes(admin, 'admin.demande.nouvelle', reqA.id);
  check('nouvelle demande : SUPER_ADMIN notifié (quotes.manage), une fois', one(n, A.root));
  check('nouvelle demande : administrateur suspendu exclu', none(n, A.susAdmin));
  check('nouvelle demande : le demandeur (auteur) exclu', none(n, A.clientA));
  check('nouvelle demande : ni montant ni coordonnée, seulement la référence DMCL',
    JSON.stringify(n.of(A.root)?.params) === JSON.stringify({ reference: refA }));

  // Un brouillon ne notifie personne ; l'émission, si.
  const { data: draftOnly } = await admin.from('quotes').insert({
    quote_request_id: reqA.id, amount: 1, currency: 'KMF', summary: `${PREFIX} brouillon seul`,
  }).select('id').single();
  state.quotes.push(draftOnly.id);
  check('un devis en brouillon ne notifie pas le client', (await notes(admin, 'client.devis.disponible', draftOnly.id)).rows.length === 0);
  await admin.from('quotes').delete().eq('id', draftOnly.id);

  const qA = await draftAndSend(ctx, reqA.id);
  n = await notes(admin, 'client.devis.disponible', qA.id);
  check('devis émis : le client est notifié une fois (À traiter)', one(n, A.clientA) && n.of(A.clientA)?.level === 'A_TRAITER');
  check('devis émis : la référence est celle du devis', n.of(A.clientA)?.params?.reference === qA.reference);
  const resent = await admin.rpc('send_quote', { p_quote_id: qA.id });
  check('réémettre le même devis ne crée rien', (await notes(admin, 'client.devis.disponible', qA.id)).rows.length === 1, resent.error?.message);
  const demandeAfter = await notes(admin, 'admin.demande.nouvelle', reqA.id);
  check('la demande quittée « nouvelle » : son « à traiter » est résolu', Boolean(demandeAfter.of(A.root)?.resolved_at) && demandeAfter.of(A.root)?.read_at === null);

  const accepted = await state.s.clientA.rpc('respond_to_my_quote', { p_quote_id: qA.id, p_decision: 'ACCEPTE', p_reason: null });
  check('le client accepte son devis', !accepted.error, accepted.error?.message);
  n = await notes(admin, 'admin.devis.accepte', reqA.id);
  check('devis accepté : SUPER_ADMIN et l’ADMIN qui peut créer la commande (orders.update) notifiés',
    one(n, A.root) && one(n, A.verif), `${n.count(A.root)}/${n.count(A.verif)}`);
  check('devis accepté : un ADMIN sans orders.update ne l’est pas', none(n, A.verif2) && none(n, A.noPerm));
  check('devis accepté : le client (auteur) ne l’est pas', none(n, A.clientA));
  const dispo = await notes(admin, 'client.devis.disponible', qA.id);
  check('devis accepté : « devis disponible » est traité, sans être lu', Boolean(dispo.of(A.clientA)?.resolved_at) && dispo.of(A.clientA)?.read_at === null);
  const twice = await state.s.clientA.rpc('respond_to_my_quote', { p_quote_id: qA.id, p_decision: 'ACCEPTE', p_reason: null });
  check('seconde réponse (refusée ou idempotente) : aucune notification de plus', (await notes(admin, 'admin.devis.accepte', reqA.id)).rows.length === n.rows.length, twice.error?.message ?? 'idempotente');

  const placed = await state.s.verif.rpc('place_order_from_quote', { p_quote_id: qA.id });
  check('l’administrateur crée la commande depuis le devis', !placed.error, placed.error?.message);
  state.orderFromQuote = placed.data;
  state.orders = [placed.data.id];
  const acc = await notes(admin, 'admin.devis.accepte', reqA.id);
  check('commande créée : « commande à créer » est traité pour tous ses destinataires', acc.rows.every((row) => row.resolved_at));
  const created = await notes(admin, 'client.commande.enregistree', placed.data.id);
  check('commande créée : le client est notifié une fois', one(created, A.clientA));
  check('… l’auteur (ADMIN) ne reçoit rien sur sa propre commande', created.rows.length === 1);

  // Refus par un autre client.
  const refB = await submitQuoteRequest(state.s.clientB, A.clientB.email);
  const { data: reqB } = await admin.from('quote_requests').select('id').eq('reference', refB).single();
  state.requests.push(reqB.id);
  const qB = await draftAndSend(ctx, reqB.id);
  const refused = await state.s.clientB.rpc('respond_to_my_quote', { p_quote_id: qB.id, p_decision: 'REFUSE', p_reason: 'Contrôle' });
  check('le client B refuse son devis', !refused.error, refused.error?.message);
  n = await notes(admin, 'admin.devis.refuse', reqB.id);
  check('devis refusé : SUPER_ADMIN notifié (Information)', one(n, A.root) && n.of(A.root)?.level === 'INFORMATION');
  check('devis refusé : un ADMIN sans quotes.manage ne l’est pas', none(n, A.verif));
  check('devis refusé : aucune donnée du motif dans la notification', !JSON.stringify(n.rows).includes('Contrôle'));
}

async function orderSteps(ctx) {
  log.step('Commandes : étapes significatives');
  const { admin, state } = ctx;
  const A = state.accounts;
  const id = state.orderFromQuote.id;
  const move = async (status) => {
    const r = await state.s.verif.from('orders').update({ status }).eq('id', id).select('status');
    return !r.error && r.data?.length === 1;
  };
  const expectations = [
    ['CONFIRMEE', 'client.commande.confirmee'],
    ['EN_ATTENTE_INFO', 'client.commande.attente_information'],
    ['EN_TRAITEMENT', null],
    ['PRETE', 'client.commande.prete'],
    ['TERMINEE', 'client.commande.terminee'],
  ];
  for (const [status, type] of expectations) {
    const moved = await move(status);
    if (!moved) {
      check(`transition vers ${status} acceptée par le métier`, false);
      continue;
    }
    if (type) check(`commande ${status} : le client est notifié une fois`, one(await notes(admin, type, id), A.clientA));
    else check(`commande ${status} : aucune notification (pas de type au catalogue)`,
      (await admin.from('notifications').select('id').eq('entity_id', id).ilike('type_code', '%traitement%')).data?.length === 0);
    if (status === 'EN_TRAITEMENT') {
      const info = await notes(admin, 'client.commande.attente_information', id);
      check('sortie de « en attente d’information » : l’action client est traitée', Boolean(info.of(A.clientA)?.resolved_at));
    }
  }
  const box = await visible(state.s.clientA, 'CLIENT');
  check('la boîte client de A contient ses notifications de commande, jamais une d’administration',
    box.some((row) => row.type_code === 'client.commande.terminee') && box.every((row) => row.type_code.startsWith('client.')));
}

async function makeManualOrder(ctx, account) {
  const { data, error } = await ctx.admin.rpc('create_manual_order', {
    p_user_id: account.userId,
    p_items: [{ designation: `${PREFIX} prestation`, unit_price: 10000, quantity: 1, item_reference: PREFIX }],
    p_fees: 0, p_note: `${PREFIX} — donnée de contrôle`,
  });
  if (error) throw new Error(`commande manuelle : ${error.message}`);
  ctx.state.orders.push(data.id);
  return data;
}

async function payments(ctx) {
  log.step('Paiements : à vérifier, confirmé, rejeté, annulé');
  const { admin, state } = ctx;
  const A = state.accounts;
  const order = await makeManualOrder(ctx, A.clientA);
  state.paidOrder = order;
  check('commande manuelle : le client est notifié (enregistrée)', one(await notes(admin, 'client.commande.enregistree', order.id), A.clientA));

  // Cinq déclarations simultanées identiques : la base n'en garde qu'une.
  const declare = (amount) => state.s.clientA.rpc('declare_payment', {
    p_order_id: order.id, p_method_code: 'ESPECES', p_amount: amount, p_transaction_reference: null, p_client_note: null,
  });
  const burst = await Promise.all(Array.from({ length: 5 }, () => declare(10000)));
  const ids = [...new Set(burst.map((r) => r.data?.id).filter(Boolean))];
  check('cinq déclarations simultanées : un seul paiement', ids.length === 1, JSON.stringify(burst.map((r) => r.error?.message ?? r.data?.id)));
  const paymentId = ids[0];
  let n = await notes(admin, 'admin.paiement.a_verifier', paymentId);
  check('paiement déclaré : SUPER_ADMIN notifié une fois', one(n, A.root));
  check('paiement déclaré : chaque ADMIN avec payments.verify notifié une fois', one(n, A.verif) && one(n, A.verif2));
  check('paiement déclaré : ADMIN sans payments.verify — rien', none(n, A.noPerm) && none(n, A.rembourseur));
  check('paiement déclaré : ADMIN suspendu — rien', none(n, A.susAdmin));
  check('paiement déclaré : le client déclarant — rien', none(n, A.clientA));
  check('paiement déclaré : aucun montant dans la notification', !Object.keys(n.of(A.root)?.params ?? {}).some((k) => k !== 'reference'));
  const sessionCount = (await visible(state.s.verif2, 'ADMINISTRATION')).filter((r) => r.type_code === 'admin.paiement.a_verifier').length;
  check('l’ADMIN autorisé la voit sous sa session', sessionCount >= 1);

  const verified = await state.s.verif.rpc('verify_payment', { p_payment_id: paymentId, p_admin_note: null });
  check('le vérificateur confirme le paiement', !verified.error, verified.error?.message);
  n = await notes(admin, 'admin.paiement.a_verifier', paymentId);
  check('paiement confirmé : toutes les copies « à vérifier » sont traitées, non lues', n.rows.length > 0 && n.rows.every((r) => r.resolved_at && !r.read_at));
  check('paiement confirmé : le client est notifié une fois', one(await notes(admin, 'client.paiement.confirme', paymentId), A.clientA));
  const again = await state.s.verif.rpc('verify_payment', { p_payment_id: paymentId, p_admin_note: null });
  check('confirmer deux fois : aucune notification de plus', (await notes(admin, 'client.paiement.confirme', paymentId)).rows.length === 1, again.error?.message);
  state.paymentId = paymentId;

  const second = await declare(3000);
  const rejected = await state.s.verif2.rpc('reject_payment', { p_payment_id: second.data.id, p_reason: 'Contrôle — référence introuvable' });
  check('le second vérificateur rejette une déclaration', !rejected.error, rejected.error?.message);
  check('paiement rejeté : le client est notifié (Attention)', (await notes(admin, 'client.paiement.rejete', second.data.id)).of(A.clientA)?.level === 'ATTENTION');
  check('paiement rejeté : l’« à vérifier » est traité, y compris chez l’auteur du rejet',
    (await notes(admin, 'admin.paiement.a_verifier', second.data.id)).rows.every((r) => r.resolved_at));
  check('paiement rejeté : le motif n’entre pas dans la notification',
    !JSON.stringify((await notes(admin, 'client.paiement.rejete', second.data.id)).rows).includes('introuvable'));

  // Correctif 4G (rapport 22) : annuler une commande clôt ses déclarations en
  // attente. L'administration voit son « à vérifier » traité ; le client ne
  // reçoit qu'une notification, « Commande annulée ».
  const order2 = await makeManualOrder(ctx, A.clientA);
  const pending = await state.s.clientA.rpc('declare_payment', {
    p_order_id: order2.id, p_method_code: 'ESPECES', p_amount: 10000, p_transaction_reference: null, p_client_note: null,
  });
  check('déclaration en attente : « à vérifier » ouvert', (await notes(admin, 'admin.paiement.a_verifier', pending.data.id)).rows.some((r) => !r.resolved_at));
  const cancelledOrder = await admin.rpc('cancel_order', { p_order_id: order2.id, p_reason: 'Contrôle 4J-2' });
  check('annulation d’une commande avec déclaration en attente : réussie', !cancelledOrder.error, cancelledOrder.error?.message);
  const { data: closed } = await admin.from('payments').select('status').eq('id', pending.data.id).single();
  check('… la déclaration est close (ANNULE)', closed?.status === 'ANNULE');
  check('… l’« à vérifier » administratif est traité', (await notes(admin, 'admin.paiement.a_verifier', pending.data.id)).rows.every((r) => r.resolved_at));
  check('… le client reçoit « Commande annulée » (Attention), une fois', one(await notes(admin, 'client.commande.annulee', order2.id), A.clientA)
    && (await notes(admin, 'client.commande.annulee', order2.id)).of(A.clientA)?.level === 'ATTENTION');
  check('… et PAS « Paiement annulé » (une seule notification client)', (await notes(admin, 'client.paiement.annule', pending.data.id)).rows.length === 0);
  const recancel = await admin.rpc('cancel_order', { p_order_id: order2.id, p_reason: 'Contrôle 4J-2' });
  check('… une seconde annulation ne produit aucune notification de plus', !recancel.error
    && (await notes(admin, 'client.commande.annulee', order2.id)).rows.length === 1);

  // Une annulation de paiement indépendante (événement réel distinct) notifie
  // toujours le client : le type « Paiement annulé » reste branché.
  const order3 = await makeManualOrder(ctx, A.clientA);
  const lone = await state.s.clientA.rpc('declare_payment', {
    p_order_id: order3.id, p_method_code: 'ESPECES', p_amount: 10000, p_transaction_reference: null, p_client_note: null,
  });
  const direct = await admin.from('payments').update({ status: 'ANNULE' }).eq('id', lone.data.id).select('status');
  check('annulation indépendante d’un paiement (transition réelle)', !direct.error && direct.data?.[0]?.status === 'ANNULE', direct.error?.message);
  check('… le client est notifié « Paiement annulé », une fois', one(await notes(admin, 'client.paiement.annule', lone.data.id), A.clientA));
  check('… l’« à vérifier » est traité', (await notes(admin, 'admin.paiement.a_verifier', lone.data.id)).rows.every((r) => r.resolved_at));
}

async function refundsAndInvoice(ctx) {
  log.step('Remboursement et facture');
  const { admin, state } = ctx;
  const A = state.accounts;
  const order = state.paidOrder;
  const recorded = await state.s.rembourseur.rpc('record_refund', {
    p_order_id: order.id, p_amount: 2000, p_reason: 'Contrôle 4J-2', p_payment_id: state.paymentId, p_method_code: 'ESPECES',
  });
  check('le rembourseur enregistre un remboursement', !recorded.error, recorded.error?.message);
  const refundId = recorded.data?.id;
  let n = await notes(admin, 'admin.remboursement.a_executer', refundId);
  check('remboursement à exécuter : ADMIN avec payments.refund ET orders.refund — une seule notification', one(n, A.refundBoth));
  check('remboursement à exécuter : SUPER_ADMIN notifié', one(n, A.root));
  check('remboursement à exécuter : ADMIN avec orders.refund seul — rien (l’application exige payments.refund)', none(n, A.orderRefundOnly));
  check('remboursement à exécuter : l’auteur — rien', none(n, A.rembourseur));
  const done = await state.s.rembourseur.rpc('complete_refund', { p_refund_id: refundId, p_external_reference: null });
  check('le remboursement est constaté', !done.error, done.error?.message);
  n = await notes(admin, 'admin.remboursement.a_executer', refundId);
  check('remboursement effectué : l’« à exécuter » est traité partout', n.rows.length > 0 && n.rows.every((r) => r.resolved_at));
  check('remboursement effectué : le client est notifié une fois', one(await notes(admin, 'client.remboursement.effectue', refundId), A.clientA));

  await state.s.verif.from('orders').update({ status: 'CONFIRMEE' }).eq('id', order.id);
  const invoice = await admin.rpc('issue_order_invoice', { p_order_id: order.id });
  check('une facture est émise', !invoice.error, invoice.error?.message);
  n = await notes(admin, 'client.facture.disponible', order.id);
  check('facture émise : le client est notifié une fois', one(n, A.clientA));
  check('facture : la notification cite la commande, pas la facture ni un montant', n.of(A.clientA)?.params?.reference === order.reference);
  const twice = await admin.rpc('issue_order_invoice', { p_order_id: order.id });
  check('réémission refusée ou idempotente : toujours une seule notification', (await notes(admin, 'client.facture.disponible', order.id)).rows.length === 1, twice.error?.message ?? '');
}

async function appointments(ctx) {
  log.step('Rendez-vous : nouveau, confirmé, reprogrammé, annulé');
  const { admin, state } = ctx;
  const A = state.accounts;
  const submit = (client, account) => client.rpc('submit_appointment_request', {
    p_full_name: 'Contrôle Rendez-vous', p_email: account.email, p_phone: '+269 000 00 00', p_organisation: null,
    p_subject: `${PREFIX} rendez-vous ${RUN}`, p_channel_label: 'Appel téléphonique', p_requested_date: '2027-11-23',
    p_requested_slot: 'Matin (08H – 12H)', p_budget: null, p_message: `${PREFIX} contexte.`, p_service_slug: null,
    p_details: [], p_source: 'rendez-vous', p_client_hash: hash(),
  });
  const sent = await submit(state.s.clientA, A.clientA);
  check('le client A demande un rendez-vous', !sent.error, sent.error?.message);
  const { data: apA } = await admin.from('appointments').select('id, user_id').eq('subject', `${PREFIX} rendez-vous ${RUN}`).eq('user_id', A.clientA.userId).single();
  state.appointments = [apA.id];
  let n = await notes(admin, 'admin.rendez_vous.nouveau', apA.id);
  check('nouveau rendez-vous : SUPER_ADMIN notifié une fois (appointments.update)', one(n, A.root));
  check('nouveau rendez-vous : ADMIN suspendu — rien', none(n, A.susAdmin));
  check('nouveau rendez-vous : ADMIN sans appointments.update — rien', none(n, A.verif));

  const minute = 10 + Math.floor(Math.random() * 40);
  const confirmed = await admin.rpc('confirm_appointment', {
    p_appointment_id: apA.id, p_scheduled_at: `2027-11-23T05:${minute}:00Z`, p_scheduled_end: `2027-11-23T05:${minute + 5}:00Z`,
  });
  check('le rendez-vous est confirmé', !confirmed.error, confirmed.error?.message);
  n = await notes(admin, 'client.rendez_vous.confirme', apA.id);
  check('rendez-vous confirmé : le client est notifié une fois, avec la date', one(n, A.clientA) && /^2027-11-23T05:/.test(n.of(A.clientA)?.params?.date ?? ''));
  check('rendez-vous confirmé : l’« à traiter » administratif est traité', (await notes(admin, 'admin.rendez_vous.nouveau', apA.id)).rows.every((r) => r.resolved_at));

  const moved = await admin.from('appointments').update({
    scheduled_at: `2027-11-24T05:${minute}:00Z`, scheduled_end: `2027-11-24T05:${minute + 5}:00Z`,
  }).eq('id', apA.id).select('id');
  check('le rendez-vous est reprogrammé', !moved.error, moved.error?.message);
  check('rendez-vous reprogrammé : le client est notifié une fois', one(await notes(admin, 'client.rendez_vous.reprogramme', apA.id), A.clientA));

  const cancelled = await state.s.clientA.rpc('cancel_my_appointment', { p_appointment_id: apA.id, p_reason: 'Contrôle 4J-2' });
  check('le client annule son rendez-vous', !cancelled.error, cancelled.error?.message);
  n = await notes(admin, 'admin.rendez_vous.annule_client', apA.id);
  check('annulation par le client : l’administration est notifiée', one(n, A.root));
  check('annulation par le client : le client (auteur) ne reçoit rien', (await notes(admin, 'client.rendez_vous.annule', apA.id)).rows.length === 0);
  check('aucun rappel temporel n’existe', (await admin.from('notifications').select('id').ilike('type_code', '%rappel%')).data?.length === 0);

  const sentB = await submit(state.s.clientB, A.clientB);
  check('le client B demande un rendez-vous', !sentB.error, sentB.error?.message);
  const { data: apB } = await admin.from('appointments').select('id').eq('subject', `${PREFIX} rendez-vous ${RUN}`).eq('user_id', A.clientB.userId).single();
  state.appointments.push(apB.id);
  const adminCancel = await admin.from('appointments').update({ status: 'ANNULE', cancel_reason: 'Contrôle 4J-2' }).eq('id', apB.id).select('id');
  check('MORA Shawiri annule le rendez-vous de B', !adminCancel.error, adminCancel.error?.message);
  n = await notes(admin, 'client.rendez_vous.annule', apB.id);
  check('annulation par MORA : le client est notifié (Attention), sans le motif',
    one(n, A.clientB) && n.of(A.clientB)?.level === 'ATTENTION' && !JSON.stringify(n.rows).includes('Contrôle'));
  check('annulation par MORA : pas de notification « annulé par le client »', (await notes(admin, 'admin.rendez_vous.annule_client', apB.id)).rows.length === 0);
}

async function affiliation(ctx) {
  log.step('Affiliation : prospects, coordonnées, candidature, fiche');
  const { admin, target, state } = ctx;
  const A = state.accounts;
  const declare = (label) => state.s.affA.rpc('declare_affiliate_prospect', {
    p_full_name: `Prospect ${label}`, p_company: null, p_phone: `+269 777 ${10 + Math.floor(Math.random() * 89)} ${10 + Math.floor(Math.random() * 89)}`,
    p_email: `${PREFIX}-prospect-${label}-${RUN}@${TEST_DOMAIN}`, p_need: 'Un site', p_comment: null, p_consent: true,
  });
  const p1 = await declare('un');
  check('l’affilié déclare un prospect', !p1.error, p1.error?.message);
  let n = await notes(admin, 'admin.prospect.a_examiner', p1.data.id);
  check('prospect déclaré : SUPER_ADMIN notifié (affiliate_attributions.manage)', one(n, A.root));
  check('prospect déclaré : ADMIN sans la permission — rien', none(n, A.verif) && none(n, A.susAdmin));
  check('prospect déclaré : aucune donnée personnelle dans la notification', JSON.stringify(n.of(A.root)?.params) === '{}');
  const recognized = await state.s.root.rpc('review_affiliate_prospect', { p_prospect_id: p1.data.id, p_status: 'RECONNU', p_reason: null, p_lead_email: null });
  check('le prospect est reconnu', !recognized.error, recognized.error?.message);
  n = await notes(admin, 'affilie.prospect.valide', p1.data.id);
  check('prospect validé : l’affilié est notifié une fois, sans donnée du prospect', one(n, A.affA) && JSON.stringify(n.of(A.affA)?.params) === '{}');
  check('prospect validé : l’« à examiner » est traité', (await notes(admin, 'admin.prospect.a_examiner', p1.data.id)).rows.every((r) => r.resolved_at));

  const p2 = await declare('deux');
  const refusedP = await state.s.root.rpc('review_affiliate_prospect', { p_prospect_id: p2.data.id, p_status: 'REFUSE', p_reason: 'Contrôle', p_lead_email: null });
  check('un second prospect est refusé', !refusedP.error, refusedP.error?.message);
  check('prospect refusé : l’affilié est notifié (Attention)', (await notes(admin, 'affilie.prospect.refuse', p2.data.id)).of(A.affA)?.level === 'ATTENTION');

  const p3 = await declare('trois');
  const withdrawn = await state.s.affA.rpc('cancel_affiliate_prospect', { p_prospect_id: p3.data.id });
  check('un troisième prospect est retiré par l’affilié', !withdrawn.error, withdrawn.error?.message);
  check('prospect retiré : l’« à examiner » est traité', (await notes(admin, 'admin.prospect.a_examiner', p3.data.id)).rows.every((r) => r.resolved_at));
  state.prospects = [p1.data.id, p2.data.id, p3.data.id];

  // Coordonnées de versement : demande, refus, nouvelle demande, validation.
  const affId = state.affiliates.affA;
  const request = () => state.s.affA.rpc('request_payout_account', { p_method: 'HOLO', p_details: { numero: '321 00 00', titulaire: 'Contrôle' } });
  const r1 = await request();
  check('l’affilié soumet des coordonnées', !r1.error, r1.error?.message);
  n = await notes(admin, 'admin.coordonnees.a_examiner', affId);
  check('coordonnées à examiner : SUPER_ADMIN notifié (payouts.manage)', one(n, A.root) && none(n, A.verif));
  const refuse = await state.s.root.rpc('review_payout_account', { p_account_id: r1.data.id, p_approve: false, p_note: 'Contrôle' });
  check('l’administration refuse les coordonnées', !refuse.error, refuse.error?.message);
  n = await notes(admin, 'affilie.coordonnees.refusees', affId);
  check('coordonnées refusées : l’affilié est notifié (À traiter)', one(n, A.affA) && n.of(A.affA)?.level === 'A_TRAITER');
  check('coordonnées refusées : l’« à examiner » est traité', (await notes(admin, 'admin.coordonnees.a_examiner', affId)).rows.every((r) => r.resolved_at));
  const r2 = await request();
  check('l’affilié soumet de nouvelles coordonnées', !r2.error, r2.error?.message);
  check('nouvelle demande : l’action de l’affilié est traitée', Boolean((await notes(admin, 'affilie.coordonnees.refusees', affId)).of(A.affA)?.resolved_at));
  n = await notes(admin, 'admin.coordonnees.a_examiner', affId);
  check('nouvelle demande : un nouvel « à examiner » est ouvert', n.rows.filter((r) => r.recipient_id === A.root.userId && !r.resolved_at).length === 1);
  const approve = await state.s.root.rpc('review_payout_account', { p_account_id: r2.data.id, p_approve: true, p_note: null });
  check('l’administration valide les coordonnées', !approve.error, approve.error?.message);
  check('coordonnées validées : l’affilié est notifié une fois', one(await notes(admin, 'affilie.coordonnees.validees', affId), A.affA));

  // Candidature : dépôt public, examen.
  const anon = sessionClient(target);
  const applied = await anon.rpc('submit_affiliate_application', {
    p_first_name: 'Contrôle', p_last_name: `Notif ${RUN}`, p_email: `${PREFIX}-candidat-${RUN}@${TEST_DOMAIN}`, p_phone: '+269 000 00 00',
    p_country: 'Union des Comores', p_city: 'Moroni', p_profile: 'APPORTEUR', p_answers: { secteurs: 'Commerce' },
    p_motivation: 'Contrôle automatisé de la phase 4J-2.', p_idea: null, p_payout_method: 'MVOLA',
    p_payout_details: { numero: '000 00 00', titulaire: 'Contrôle' }, p_consent: true, p_consent_version: 'affiliation-candidature-1', p_client_hash: hash(),
  });
  const applicationId = applied.data?.[0]?.application_id;
  state.applications = applicationId ? [applicationId] : [];
  check('une candidature est déposée', Boolean(applicationId), applied.error?.message);
  n = await notes(admin, 'admin.candidature.nouvelle', applicationId);
  check('candidature : SUPER_ADMIN notifié, sans donnée du candidat', one(n, A.root) && JSON.stringify(n.of(A.root)?.params) === '{}');
  const study = await state.s.root.rpc('review_affiliate_application', { p_application_id: applicationId, p_status: 'EN_ETUDE', p_message: null, p_reason: null });
  check('la candidature passe à l’étude', !study.error, study.error?.message);
  check('candidature à l’étude : l’« à examiner » est traité', (await notes(admin, 'admin.candidature.nouvelle', applicationId)).rows.every((r) => r.resolved_at));

  // Fiche affilié : l'événement que 4H écrit à l'émission d'une FIAF, produit
  // par le journaliseur de 4H lui-même (l'émission réelle consomme un numéro
  // FIAF ; elle est contrôlée dans verify-affiliation.mjs).
  const logged = await admin.rpc('affiliation_log', {
    p_affiliate_id: affId, p_category_id: null, p_event_type: 'FICHE_EMISE',
    p_summary: 'Fiche officielle émise (contrôle 4J-2)', p_old: null, p_new: { document: 'MORA-FIAF-ZZ0001' },
  });
  check('fiche émise : événement écrit par le journal 4H', !logged.error, logged.error?.message);
  check('fiche mise à jour : l’affilié est notifié une fois', one(await notes(admin, 'affilie.fiche.mise_a_jour', affId), A.affA));
}

async function queue(ctx) {
  log.step('File 4H : consommation, rejeu, concurrence');
  const { admin, target, accessToken, state } = ctx;
  const A = state.accounts;
  const affId = state.affiliates.affA;
  const entity = randomUUID();
  state.queueEntities = [entity];
  const produced = await admin.rpc('affiliation_notify', {
    p_affiliate_id: affId, p_event: 'affiliation.commission.ajustee', p_entity_type: 'affiliate_commission',
    p_entity_id: entity, p_payload: { reference: 'MORA-COMAF-ZZ0001', ajustement: -500 },
  });
  check('4H met un événement en file (producteur réel)', !produced.error, produced.error?.message);
  const { data: event } = await admin.from('notification_events').select('*').eq('entity_id', entity).single();
  check('l’événement est consommé (TRAITE)', event?.status === 'TRAITE' && Boolean(event?.processed_at));
  let n = await notes(admin, 'affilie.commission.ajustee', entity);
  check('commission ajustée : l’affilié est notifié une fois', one(n, A.affA));
  check('… sans le montant de l’ajustement', JSON.stringify(n.of(A.affA)?.params) === JSON.stringify({ reference: 'MORA-COMAF-ZZ0001' }));

  // Rejeu : l'événement remis en attente et consommé six fois en parallèle.
  await admin.from('notification_events').update({ status: 'EN_ATTENTE', processed_at: null }).eq('id', event.id);
  await Promise.all(Array.from({ length: 6 }, () => runSql(target, accessToken,
    `select public.notifications_route_queue_event(e) from public.notification_events e where e.id = ${event.id};`).catch(() => null)));
  n = await notes(admin, 'affilie.commission.ajustee', entity);
  check('rejeu concurrent d’un même événement 4H : toujours une seule notification', n.rows.length === 1, String(n.rows.length));

  const unknown = randomUUID();
  state.queueEntities.push(unknown);
  await admin.rpc('affiliation_notify', {
    p_affiliate_id: affId, p_event: 'affiliation.evenement.inconnu', p_entity_type: 'affiliate_commission', p_entity_id: unknown, p_payload: {},
  });
  const { data: ignored } = await admin.from('notification_events').select('status').eq('entity_id', unknown).single();
  check('un événement de file inconnu est marqué IGNORE, sans notification',
    ignored?.status === 'IGNORE' && (await admin.from('notifications').select('id').eq('entity_id', unknown)).data?.length === 0);

  const payout = randomUUID();
  state.queueEntities.push(payout);
  await admin.rpc('affiliation_notify', {
    p_affiliate_id: affId, p_event: 'affiliation.versement.confirme', p_entity_type: 'affiliate_payout', p_entity_id: payout, p_payload: { reference: 'MORA-RVAF-ZZ0001', montant: 20000 },
  });
  check('versement confirmé (file) : l’affilié est notifié une fois', one(await notes(admin, 'affilie.versement.confirme', payout), A.affA));
}

async function multiRoleAndSuspension(ctx) {
  log.step('Multi-rôle ; client et affilié suspendus');
  const { admin, state } = ctx;
  const A = state.accounts;

  const order = await makeManualOrder(ctx, A.both);
  await admin.rpc('affiliation_log', {
    p_affiliate_id: state.affiliates.both, p_category_id: null, p_event_type: 'FICHE_EMISE',
    p_summary: 'Fiche officielle émise (contrôle 4J-2)', p_old: null, p_new: { document: 'MORA-FIAF-ZZ0002' },
  });
  const clientBox = await visible(state.s.both, 'CLIENT');
  const affBox = await visible(state.s.both, 'AFFILIE');
  check('CLIENT + AFFILIÉ : boîte client = la seule notification client',
    clientBox.length === 1 && clientBox[0].type_code === 'client.commande.enregistree', JSON.stringify(clientBox));
  check('CLIENT + AFFILIÉ : boîte affilié = la seule notification affilié',
    affBox.length === 1 && affBox[0].type_code === 'affilie.fiche.mise_a_jour', JSON.stringify(affBox));
  check('CLIENT + AFFILIÉ : aucun doublon', (await notes(admin, 'client.commande.enregistree', order.id)).rows.length === 1);

  // Client suspendu : reçoit, ne voit pas, retrouve.
  await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', A.susClient.userId);
  const sOrder = await makeManualOrder(ctx, A.susClient);
  const stored = await notes(admin, 'client.commande.enregistree', sOrder.id);
  check('client suspendu : la notification de son événement existe en base', one(stored, A.susClient));
  check('client suspendu : invisible pour sa session', (await visible(state.s.susClient, 'CLIENT')).length === 0);
  await admin.from('profiles').update({ status: 'ACTIF' }).eq('id', A.susClient.userId);
  check('client réactivé : la notification redevient visible', (await visible(state.s.susClient, 'CLIENT')).some((r) => r.type_code === 'client.commande.enregistree'));

  // Affilié suspendu : même règle.
  await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', A.susAff.userId);
  await admin.rpc('affiliation_log', {
    p_affiliate_id: state.affiliates.susAff, p_category_id: null, p_event_type: 'FICHE_EMISE',
    p_summary: 'Fiche officielle émise (contrôle 4J-2)', p_old: null, p_new: { document: 'MORA-FIAF-ZZ0003' },
  });
  check('affilié suspendu : la notification existe en base', one(await notes(admin, 'affilie.fiche.mise_a_jour', state.affiliates.susAff), A.susAff));
  check('affilié suspendu : invisible pour sa session', (await visible(state.s.susAff, 'AFFILIE')).length === 0);
  await admin.from('profiles').update({ status: 'ACTIF' }).eq('id', A.susAff.userId);
  check('affilié réactivé : la notification redevient visible', (await visible(state.s.susAff, 'AFFILIE')).length === 1);

  // Administrateur : aucune notification n'a jamais été créée pour lui.
  const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', A.susAdmin.userId);
  check('administrateur suspendu : aucune notification distribuée de tout le contrôle', count === 0, String(count));

  // Permission retirée après création (comportement 4J-1 inchangé).
  const before = (await visible(state.s.verif2, 'ADMINISTRATION')).length;
  const { data: perm } = await admin.from('permissions').select('id').eq('code', 'payments.verify').single();
  await admin.from('user_permissions').delete().eq('user_id', A.verif2.userId).eq('permission_id', perm.id);
  check('permission retirée après création : notifications de paiement masquées',
    before > 0 && (await visible(state.s.verif2, 'ADMINISTRATION')).length === 0, `${before} avant`);
}

async function failure(ctx) {
  log.step('Panne du moteur : l’acte métier tient, l’échec est consigné, la reprise sans doublon');
  const { admin, target, accessToken, state } = ctx;
  const A = state.accounts;
  const order = await makeManualOrder(ctx, A.clientB);
  // Transaction d'outillage isolée : la panne n'existe que dans celle-ci.
  await runSql(target, accessToken, `
    begin;
    set local mora.notifications_panne = 'on';
    update public.orders set status = 'CONFIRMEE' where id = '${order.id}';
    commit;`);
  const { data: row } = await admin.from('orders').select('status').eq('id', order.id).single();
  check('panne simulée : la commande est bien confirmée (acte conservé)', row?.status === 'CONFIRMEE');
  check('panne simulée : aucune notification créée', (await notes(admin, 'client.commande.confirmee', order.id)).rows.length === 0);
  const { data: history } = await admin.from('order_status_history').select('id').eq('order_id', order.id).eq('to_status', 'CONFIRMEE').single();
  const { data: failed } = await admin.from('notification_failures').select('*').eq('source_table', 'order_status_history').eq('source_id', String(history.id)).maybeSingle();
  check('panne simulée : l’échec est consigné (observable)', Boolean(failed) && !failed.resolved_at && /Panne simulée/.test(failed.error_message ?? ''), JSON.stringify(failed));
  state.failureIds = failed ? [failed.id] : [];
  const retried = await admin.rpc('notifications_retry_failures', { p_limit: 100 });
  check('reprise : l’événement est rejoué', (retried.data ?? 0) >= 1, JSON.stringify(retried));
  check('reprise : la notification existe, une fois', one(await notes(admin, 'client.commande.confirmee', order.id), A.clientB));
  await admin.from('notification_failures').update({ resolved_at: null }).eq('id', failed?.id);
  await admin.rpc('notifications_retry_failures', { p_limit: 100 });
  check('reprise répétée : toujours une seule notification', (await notes(admin, 'client.commande.confirmee', order.id)).rows.length === 1);
}

/* -------------------------------------------------------------------------- */

async function teardown(ctx) {
  log.step('Démontage');
  const { admin, target, accessToken, state, before } = ctx;

  // Tout se retrouve par préfixe en base : un démontage repris après une
  // interruption (--nettoyage-seul) n'a besoin d'aucun état en mémoire.
  const users = `(select id from auth.users where email like '${PREFIX}-%@${TEST_DOMAIN}')`;
  const orders = `(select id from public.orders where user_id in ${users})`;
  const requests = `(select id from public.quote_requests where subject like '${PREFIX} %')`;
  const quotes = `(select id from public.quotes where quote_request_id in ${requests})`;
  const appointments = `(select id from public.appointments where subject like '${PREFIX} %')`;

  await runSql(target, accessToken, `
    begin;
    delete from public.notification_failures
     where (source_table = 'order_status_history' and source_id in (select id::text from public.order_status_history where order_id in ${orders}))
        or (source_table = 'order_events' and source_id in (select id::text from public.order_events where order_id in ${orders}));
    create temporary table zz_orders on commit drop as select id from public.orders where id in ${orders};
    create temporary table zz_quotes on commit drop as select id from public.quotes where id in ${quotes};
    create temporary table zz_docs on commit drop as
      select d.id from public.documents d
       where d.entity_id in (select id from zz_orders) or d.entity_id in (select id from zz_quotes) or d.entity_id in ${appointments}
          or d.id in (select document_id from public.orders where id in (select id from zz_orders) and document_id is not null)
          or d.id in (select document_id from public.quotes where id in (select id from zz_quotes) and document_id is not null)
          or d.id in (select document_id from public.refunds where order_id in (select id from zz_orders) and document_id is not null);
    alter table public.order_items disable trigger order_items_closed_order;
    delete from public.refunds where order_id in (select id from zz_orders);
    delete from public.payments where order_id in (select id from zz_orders);
    delete from public.order_events where order_id in (select id from zz_orders);
    delete from public.order_status_history where order_id in (select id from zz_orders);
    delete from public.order_items where order_id in (select id from zz_orders);
    delete from public.orders where id in (select id from zz_orders);
    alter table public.order_items enable trigger order_items_closed_order;
    alter table public.quotes disable trigger quotes_content_frozen;
    alter table public.quote_items disable trigger quote_items_draft_only;
    delete from public.quote_items where quote_id in (select id from zz_quotes);
    delete from public.quotes where id in (select id from zz_quotes);
    alter table public.quotes enable trigger quotes_content_frozen;
    alter table public.quote_items enable trigger quote_items_draft_only;
    update public.documents set status = 'ANNULE' where id in (select id from zz_docs);
    delete from public.documents where id in (select id from zz_docs);
    delete from public.quote_requests where id in ${requests};
    delete from public.appointments where id in ${appointments};
    commit;`).catch((error) => log.fail(`démontage commerce / relation : ${error.message}`));

  await runSql(target, accessToken, `
    begin;
    alter table public.affiliate_events disable trigger affiliate_events_append_only;
    alter table public.affiliate_payout_accounts disable trigger affiliate_payout_accounts_guard;
    alter table public.affiliate_prospects disable trigger affiliate_prospects_guard;
    alter table public.affiliate_application_events disable trigger affiliate_application_events_append_only;
    delete from public.notification_events where recipient_id in ${users};
    delete from public.affiliate_events
     where affiliate_id in (select id from public.affiliates where slug like '${PREFIX}-%')
        or category_id in (select id from public.affiliate_categories where code like 'ZZ_VERIF_4J2_%');
    delete from public.affiliate_payout_accounts where affiliate_id in (select id from public.affiliates where slug like '${PREFIX}-%');
    delete from public.affiliate_prospects where affiliate_id in (select id from public.affiliates where slug like '${PREFIX}-%');
    delete from public.affiliates where slug like '${PREFIX}-%';
    delete from public.affiliate_categories where code like 'ZZ_VERIF_4J2_%';
    delete from public.affiliate_application_events where application_id in (select id from public.affiliate_applications where email like '${PREFIX}-%');
    delete from public.affiliate_applications where email like '${PREFIX}-%';
    delete from public.leads where email like '${PREFIX}-%@${TEST_DOMAIN}';
    alter table public.affiliate_events enable trigger affiliate_events_append_only;
    alter table public.affiliate_payout_accounts enable trigger affiliate_payout_accounts_guard;
    alter table public.affiliate_prospects enable trigger affiliate_prospects_guard;
    alter table public.affiliate_application_events enable trigger affiliate_application_events_append_only;
    commit;`).catch((error) => log.fail(`démontage affiliation : ${error.message}`));

  await runSql(target, accessToken,
    `delete from public.rate_limit_counters where window_start >= '${state.startedAt}' and (bucket like 'relation.%' or bucket like 'affiliation.%');`)
    .catch((error) => log.fail(`démontage des compteurs de limitation : ${error.message}`));

  // Une suite n'est rendue que si aucune référence réelle n'est née pendant
  // le contrôle : jamais un vrai numéro n'est rembobiné.
  const realSince = {
    DMCL: `select 1 from public.quote_requests where created_at >= '${state.startedAt}'`,
    RVCL: `select 1 from public.appointments where reference is not null and confirmed_at >= '${state.startedAt}'`,
  };
  for (const [docType, sequence] of Object.entries(before.sequences)) {
    const guard = `not exists (select 1 from public.documents where doc_type = '${docType}' and issued_at >= '${state.startedAt}')`
      + (realSince[docType] ? ` and not exists (${realSince[docType]})` : '');
    await runSql(target, accessToken, sequence === null
      ? `delete from public.document_sequences where doc_type = '${docType}' and ${guard};`
      : `update public.document_sequences set series = '${sequence.series}', last_number = ${sequence.last_number}, allocated_count = ${sequence.allocated_count}
          where doc_type = '${docType}' and ${guard};`)
      .catch((error) => log.fail(`restitution ${docType} : ${error.message}`));
  }

  const { data: accounts } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of accounts?.users ?? []) {
    if (user.email?.startsWith(`${PREFIX}-`) && user.email.endsWith(`@${TEST_DOMAIN}`)) {
      const removed = await admin.auth.admin.deleteUser(user.id);
      if (removed.error) log.fail(`suppression de ${user.email} : ${removed.error.message}`);
    }
  }

  const end = (await runSql(target, accessToken, snapshotSql()))?.[0]?.etat;
  check('aucun compte de contrôle ne subsiste', end?.comptes_test === 0, String(end?.comptes_test));
  check('aucune notification ne subsiste (vrais administrateurs compris)', end?.notifications === before.notifications, `${end?.notifications} contre ${before.notifications}`);
  check('file 4H et journal des échecs revenus à leur état', end?.file_4h === before.file_4h && end?.echecs === before.echecs, JSON.stringify({ f: end?.file_4h, e: end?.echecs }));
  check('suites documentaires rendues à l’identique', JSON.stringify(end?.suites) === JSON.stringify(before.suitesJson), JSON.stringify(end?.suites));
  if (before.reel) {
    check('données réelles intactes (comptes, clients, commandes, paiements, devis, demandes, rendez-vous, affiliés, prospects, candidatures, pièces)',
      JSON.stringify(end?.reel) === JSON.stringify(before.reel), JSON.stringify(end?.reel));
  } else {
    log.skip('données réelles : état de départ non relevé (reprise) — à comparer séparément');
  }
  check('aucun e-mail journalisé pendant le contrôle', end?.emails === before.emails, `${end?.emails} contre ${before.emails}`);
  check('les gardes en ajout seul sont rétablies', end?.gardes === before.gardes, JSON.stringify(end?.gardes));
}

function snapshotSql() {
  return `
  select json_build_object(
    'notifications', (select count(*) from public.notifications),
    'file_4h', (select count(*) from public.notification_events),
    'echecs', (select count(*) from public.notification_failures),
    'emails', (select count(*) from public.email_outbox),
    'comptes_test', (select count(*) from auth.users where email like '${PREFIX}-%'),
    'gardes', (select string_agg(tgname::text || ':' || tgenabled::text, ',' order by tgname) from pg_trigger
                where tgname in ('affiliate_events_append_only', 'affiliate_application_events_append_only', 'quotes_content_frozen', 'quote_items_draft_only',
                                 'affiliate_payout_accounts_guard', 'affiliate_prospects_guard')),
    'suites', (select json_agg(json_build_object('t', doc_type, 's', series, 'n', last_number, 'c', allocated_count) order by doc_type)
                 from public.document_sequences where doc_type <> 'CLI'),
    'reel', json_build_object(
      'comptes', (select count(*) from public.profiles),
      'clients', (select json_agg(reference order by reference) from public.clients),
      'commandes', (select json_agg(json_build_object('r', reference, 's', status, 'm', updated_at) order by reference) from public.orders),
      'paiements', (select json_agg(json_build_object('s', status, 'm', updated_at) order by created_at) from public.payments),
      'devis', (select json_agg(json_build_object('r', reference, 's', status, 'm', updated_at) order by reference) from public.quotes),
      'demandes', (select json_agg(json_build_object('r', reference, 's', status, 'm', updated_at) order by reference) from public.quote_requests),
      'rendez_vous', (select json_agg(json_build_object('s', status, 'm', updated_at) order by created_at) from public.appointments),
      'affilies', (select json_agg(json_build_object('r', reference, 's', status, 'm', updated_at) order by reference) from public.affiliates),
      'prospects', (select count(*) from public.affiliate_prospects),
      'candidatures', (select count(*) from public.affiliate_applications),
      'pieces', (select json_agg(json_build_object('r', reference, 's', status) order by reference) from public.documents)
    )
  ) as etat;`;
}

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();
  log.step(`Notifications — branchements 4J-2 — ${describeTarget(target)}`);

  const admin = createClient(target.url, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // L'état de départ survit à une interruption : un démontage repris le relit.
  if (hasFlag('nettoyage-seul')) {
    if (!existsSync(BASELINE_FILE)) {
      log.fail('aucun état de départ enregistré : rien à reprendre');
      process.exitCode = 1;
      return;
    }
    const saved = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    await teardown({ admin, target, accessToken, before: saved.before, state: saved.state });
    if (results.failed === 0) rmSync(BASELINE_FILE, { force: true });
    log.step(`${results.passed} réussi(s), ${results.failed} échec(s)`);
    if (results.failed > 0) process.exitCode = 1;
    return;
  }
  if (existsSync(BASELINE_FILE)) {
    log.fail(`un démontage précédent est inachevé : lancez d'abord --nettoyage-seul (${BASELINE_FILE})`);
    process.exitCode = 1;
    return;
  }

  const snapshot = (await runSql(target, accessToken, snapshotSql()))?.[0]?.etat;
  const sequences = await runSql(target, accessToken,
    `select doc_type, series, last_number, allocated_count from public.document_sequences where doc_type in (${SEQUENCES.map((c) => `'${c}'`).join(', ')});`);
  const before = {
    ...snapshot,
    suitesJson: snapshot?.suites,
    sequences: Object.fromEntries(SEQUENCES.map((code) => [code, (sequences ?? []).find((row) => row.doc_type === code) ?? null])),
  };
  const ctx = { admin, target, accessToken, before, state: { startedAt: new Date(Date.now() - 1000).toISOString(), orders: [], quotes: [], requests: [], appointments: [] } };
  writeFileSync(BASELINE_FILE, JSON.stringify({ before, state: { startedAt: ctx.state.startedAt } }));

  try {
    await seed(ctx);
    await newClients(ctx);
    await quotes(ctx);
    await orderSteps(ctx);
    await payments(ctx);
    await refundsAndInvoice(ctx);
    await appointments(ctx);
    await affiliation(ctx);
    await queue(ctx);
    await multiRoleAndSuspension(ctx);
    await failure(ctx);
  } catch (error) {
    results.failed += 1;
    log.fail(`interruption : ${error.message}`);
  } finally {
    const failedBefore = results.failed;
    await teardown(ctx);
    if (results.failed === failedBefore) rmSync(BASELINE_FILE, { force: true });
  }

  log.step(`${results.passed} réussi(s), ${results.failed} échec(s)`);
  if (results.failed > 0) process.exitCode = 1;
}

main();
