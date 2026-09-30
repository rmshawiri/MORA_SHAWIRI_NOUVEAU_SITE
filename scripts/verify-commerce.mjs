/**
 * Vérification du commerce contre la base réelle — phase 4G.
 *
 *   node scripts/verify-commerce.mjs --env shared
 *
 * ## Pourquoi ce script existe
 *
 * `tests/unit/commerce.test.ts` lit le SQL ; il ne l'exécute pas. Le défaut le
 * plus grave de la phase 4E-1 — un garde déclaré `SECURITY DEFINER`, donc
 * inopérant — se lisait correctement et s'installait sans une erreur. Seule
 * une exécution avec de vraies sessions l'a révélé.
 *
 * Ce script éprouve donc chaque profil contre la vraie base :
 *
 *   * anonyme — ne lit rien, n'écrit rien ;
 *   * CLIENT A — sa commande, ses paiements, son justificatif ;
 *   * CLIENT B — jamais ceux de CLIENT A, quel que soit le chemin ;
 *   * AFFILIE — rien, parce qu'être affilié n'ouvre rien ici ;
 *   * ADMIN sans permission — rien non plus ;
 *   * ADMIN `orders.view` — lit, ne décide pas ;
 *   * ADMIN `+ orders.update` — traite, **ne confirme aucun paiement** ;
 *   * ADMIN `+ orders.cancel` — annule ;
 *   * ADMIN `payments.verify` — confirme et rejette ;
 *   * ADMIN `payments.refund` — rembourse.
 *
 * La distinction entre les deux avant-derniers est le cœur de D-10 : traiter
 * une commande de bout en bout et confirmer un franc sont deux droits, et le
 * second est critique.
 *
 * ## Les suites documentaires
 *
 * Les contrôles émettent de vraies pièces CMCL et FACL, donc consomment de
 * vrais numéros. La phase 4F a appris ce que cela coûte : ses premiers essais
 * avaient percé trois suites de production. Le démontage restitue donc les
 * compteurs à leur valeur d'avant — ce qui n'est légitime que parce que les
 * documents qui portaient ces numéros viennent d'être supprimés — et le
 * script le **vérifie** ensuite, explicitement.
 *
 * ## Données de test
 *
 * Comptes en `@mora-shawiri.test`, commandes reconnaissables à leur client
 * `Contrôle Commerce`. Tout est supprimé en fin d'exécution, et l'absence de
 * résidu est contrôlée. Le journal d'audit garde ses traces : c'est son
 * fonctionnement normal.
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

/** Une lecture est vide si elle lève, ou si elle ne rend rien. */
function empty(result) {
  return Boolean(result.error) || (result.data ?? []).length === 0;
}

const TEST_DOMAIN = 'mora-shawiri.test';
const PREFIX = 'verif-commerce';
const CUSTOMER = 'Contrôle Commerce';
const PASSWORD = `Verif-4G-${randomUUID()}`;

/**
 * Les suites que ces contrôles touchent, et qu'il faut donc rendre.
 *
 * `CMCL` et `FACL` sont consommées par les commandes et la facture de
 * contrôle. `DVCL` et `DMCL` le sont par le scénario « devis accepté →
 * commande », qui a besoin d'une vraie demande et d'un vrai devis pour être
 * autre chose qu'une simulation.
 *
 * `DMCL` manquait à la première version de cette liste, et trois numéros de
 * demande y avaient été perdus. C'est exactement l'erreur que la phase 4F
 * avait déjà commise sur trois suites : elle se reproduit dès qu'on raisonne
 * sur ce que la phase *crée* plutôt que sur ce que ses contrôles *consomment*.
 */
const SEQUENCES = ['CMCL', 'FACL', 'DVCL', 'DMCL'];

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

  await admin
    .from('user_roles')
    .upsert({ user_id: userId, role_id: role.id }, { onConflict: 'user_id,role_id' });

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

/**
 * Crée une commande de contrôle, comme l'administration le ferait.
 *
 * Passe par `create_manual_order` — le chemin réel — avec une ligne hors
 * catalogue, pour ne dépendre d'aucune offre publiée et ne rien perturber du
 * catalogue réel.
 */
async function makeOrder(admin, userId, amount = 10000) {
  const { data, error } = await admin.rpc('create_manual_order', {
    p_user_id: userId,
    p_items: [
      {
        designation: `${PREFIX} prestation de contrôle`,
        unit_price: amount,
        quantity: 1,
        item_reference: PREFIX,
      },
    ],
    p_fees: 0,
    p_note: `${PREFIX} — donnée de contrôle, à supprimer`,
  });

  if (error) throw new Error(`création de commande : ${error.message}`);
  return data;
}

/* ========================================================================== */
/*  1. Le visiteur anonyme                                                    */
/* ========================================================================== */

async function checkAnonymous(target, state) {
  log.step('Visiteur anonyme');

  const anon = sessionClient(target);

  for (const table of [
    'orders',
    'order_items',
    'payments',
    'payment_proofs',
    'refunds',
    'order_events',
    'order_status_history',
    'payment_methods',
  ]) {
    const read = await anon.from(table).select('*').limit(1);
    check(`un anonyme ne lit pas ${table}`, empty(read), read.error ? '' : 'lecture acceptée');
  }

  const declared = await anon.rpc('declare_payment', {
    p_order_id: state.orderA.id,
    p_method_code: 'MVOLA',
    p_amount: 1000,
    p_transaction_reference: `${PREFIX}-anon`,
  });
  check('un anonyme ne déclare aucun paiement', Boolean(declared.error), declared.error ? '' : 'accepté');

  const methods = await anon.rpc('active_payment_methods');
  check(
    'un anonyme n’obtient pas la liste des moyens actifs',
    Boolean(methods.error),
    methods.error ? '' : 'liste servie',
  );

  const forged = await anon.from('orders').insert({ reference: 'MORA-CMCL-Z9999' }).select('id');
  check('un anonyme ne crée aucune commande', refused(forged));
}

/* ========================================================================== */
/*  2. Le client et sa commande                                               */
/* ========================================================================== */

async function checkClient(sessions, state) {
  log.step('Le client sur sa commande');

  const own = await sessions.clientA.from('orders').select('reference').eq('id', state.orderA.id);
  check('le client lit sa commande', !own.error && (own.data ?? []).length === 1, own.error?.message);

  const items = await sessions.clientA
    .from('order_items')
    .select('designation, unit_price, line_total')
    .eq('order_id', state.orderA.id);
  check('le client lit les lignes de sa commande', (items.data ?? []).length === 1);
  check(
    'le montant de la ligne est celui calculé par la base',
    Number(items.data?.[0]?.line_total) === 10000,
    items.data?.[0]?.line_total,
  );

  const methods = await sessions.clientA.rpc('active_payment_methods');
  check('le client obtient les moyens actifs', !methods.error, methods.error?.message);

  const codes = (methods.data ?? []).map((row) => row.code);
  check('Wakati n’est pas proposé : son service n’a pas été lancé', !codes.includes('WAKATI'));
  check('le virement n’est pas proposé : ses coordonnées manquent', !codes.includes('VIREMENT'));
  check('PayPal n’est pas proposé : aucune intégration n’est décidée', !codes.includes('PAYPAL'));
  check('Mvola est proposé', codes.includes('MVOLA'));
  check('les espèces sont proposées', codes.includes('ESPECES'));

  /* --- Ce que le client ne peut pas faire ----------------------------- */

  const statusForced = await sessions.clientA
    .from('orders')
    .update({ status: 'TERMINEE' })
    .eq('id', state.orderA.id)
    .select('id');
  check('le client ne change pas le statut de sa commande', refused(statusForced));

  const settlementForced = await sessions.clientA
    .from('orders')
    .update({ paid_amount: 10000, settlement_status: 'SOLDEE' })
    .eq('id', state.orderA.id)
    .select('id');
  check('le client ne se déclare pas soldé lui-même', refused(settlementForced));

  const priceForced = await sessions.clientA
    .from('order_items')
    .update({ unit_price: 1 })
    .eq('order_id', state.orderA.id)
    .select('id');
  check('le client ne change pas le prix de sa commande', refused(priceForced));

  const inserted = await sessions.clientA
    .from('payments')
    .insert({
      order_id: state.orderA.id,
      method_code: 'MVOLA',
      amount: 10000,
      status: 'PAYE',
    })
    .select('id');
  check('le client n’insère pas un paiement déjà confirmé', refused(inserted));
}

/* ========================================================================== */
/*  3. La déclaration de paiement — le cœur de D-10                           */
/* ========================================================================== */

async function checkDeclaration(admin, sessions, state) {
  log.step('Déclaration et vérification (D-10)');

  /* --- Ce qui est refusé à la déclaration ----------------------------- */

  const inactive = await sessions.clientA.rpc('declare_payment', {
    p_order_id: state.orderA.id,
    p_method_code: 'WAKATI',
    p_amount: 1000,
    p_transaction_reference: `${PREFIX}-wakati`,
  });
  check('un moyen désactivé est refusé (Wakati)', Boolean(inactive.error), inactive.error ? '' : 'accepté');

  const negative = await sessions.clientA.rpc('declare_payment', {
    p_order_id: state.orderA.id,
    p_method_code: 'MVOLA',
    p_amount: -5000,
    p_transaction_reference: `${PREFIX}-negatif`,
  });
  check('un montant négatif est refusé', Boolean(negative.error));

  const noReference = await sessions.clientA.rpc('declare_payment', {
    p_order_id: state.orderA.id,
    p_method_code: 'MVOLA',
    p_amount: 1000,
    p_transaction_reference: null,
  });
  check('Mvola exige la référence de transaction', Boolean(noReference.error));

  const foreign = await sessions.clientB.rpc('declare_payment', {
    p_order_id: state.orderA.id,
    p_method_code: 'MVOLA',
    p_amount: 1000,
    p_transaction_reference: `${PREFIX}-intrus`,
  });
  check('un client ne déclare pas sur la commande d’un autre', Boolean(foreign.error));

  /* --- La déclaration légitime ---------------------------------------- */

  const reference = `${PREFIX}-${randomUUID().slice(0, 8)}`.toUpperCase();

  const declared = await sessions.clientA.rpc('declare_payment', {
    p_order_id: state.orderA.id,
    p_method_code: 'MVOLA',
    p_amount: 4000,
    p_transaction_reference: reference,
    p_client_note: `${PREFIX} note`,
  });

  check('le client déclare son paiement', !declared.error, declared.error?.message);
  state.paymentId = declared.data?.id ?? null;
  state.transactionReference = reference;

  check(
    'une déclaration naît « en vérification », jamais « payé »',
    declared.data?.status === 'EN_VERIFICATION',
    declared.data?.status,
  );

  const { data: afterDeclare } = await admin
    .from('orders')
    .select('paid_amount, settlement_status')
    .eq('id', state.orderA.id)
    .maybeSingle();

  check(
    'une déclaration non vérifiée ne crédite pas la commande',
    Number(afterDeclare?.paid_amount) === 0 && afterDeclare?.settlement_status === 'NON_PAYEE',
    `${afterDeclare?.paid_amount} / ${afterDeclare?.settlement_status}`,
  );

  /* --- L'idempotence --------------------------------------------------- */

  const again = await sessions.clientA.rpc('declare_payment', {
    p_order_id: state.orderA.id,
    p_method_code: 'MVOLA',
    p_amount: 4000,
    p_transaction_reference: reference,
  });

  check(
    'la même référence de transaction ne crée pas un second paiement',
    !again.error && again.data?.id === state.paymentId,
    again.error?.message ?? `${again.data?.id} ≠ ${state.paymentId}`,
  );

  const { count: declarations } = await admin
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', state.orderA.id);
  check('un seul paiement existe après double soumission', declarations === 1, String(declarations));

  // La même référence sur une autre commande est un conflit, pas un doublon.
  const crossed = await sessions.clientA.rpc('declare_payment', {
    p_order_id: state.orderC.id,
    p_method_code: 'MVOLA',
    p_amount: 1000,
    p_transaction_reference: reference,
  });
  check(
    'la même référence sur une autre commande est refusée',
    Boolean(crossed.error),
    crossed.error ? '' : 'acceptée à tort',
  );

  /* --- La vérification -------------------------------------------------- */

  const byClient = await sessions.clientA.rpc('verify_payment', { p_payment_id: state.paymentId });
  check('un client ne confirme pas son propre paiement', Boolean(byClient.error));

  const byTraitant = await sessions.traitant.rpc('verify_payment', {
    p_payment_id: state.paymentId,
  });
  check(
    'un administrateur qui traite les commandes ne confirme pas un paiement',
    Boolean(byTraitant.error),
    byTraitant.error ? '' : 'confirmé à tort — D-10 serait rompue',
  );

  const forcedStatus = await sessions.traitant
    .from('payments')
    .update({ status: 'PAYE' })
    .eq('id', state.paymentId)
    .select('id');
  check(
    'le statut « payé » ne s’écrit pas directement sans payments.verify',
    refused(forcedStatus),
    forcedStatus.error?.message ?? 'accepté à tort',
  );

  const verified = await sessions.verificateur.rpc('verify_payment', {
    p_payment_id: state.paymentId,
    p_admin_note: `${PREFIX} reçu constaté`,
  });
  check('payments.verify confirme le paiement', !verified.error, verified.error?.message);
  check('le paiement est « payé »', verified.data?.status === 'PAYE', verified.data?.status);
  check('la confirmation porte sa date', Boolean(verified.data?.confirmed_at));
  check('la confirmation porte son auteur', Boolean(verified.data?.verified_by));

  const { data: afterVerify } = await admin
    .from('orders')
    .select('paid_amount, settlement_status')
    .eq('id', state.orderA.id)
    .maybeSingle();

  check(
    'la commande est créditée du montant confirmé',
    Number(afterVerify?.paid_amount) === 4000,
    afterVerify?.paid_amount,
  );
  check(
    'un règlement partiel se dit « partiellement réglée »',
    afterVerify?.settlement_status === 'PARTIELLE',
    afterVerify?.settlement_status,
  );

  /* --- La double confirmation ------------------------------------------ */

  const twice = await sessions.verificateur.rpc('verify_payment', {
    p_payment_id: state.paymentId,
  });
  check('confirmer deux fois ne lève pas', !twice.error, twice.error?.message);

  const { data: afterTwice } = await admin
    .from('orders')
    .select('paid_amount')
    .eq('id', state.orderA.id)
    .maybeSingle();
  check(
    'confirmer deux fois ne double pas le montant',
    Number(afterTwice?.paid_amount) === 4000,
    afterTwice?.paid_amount,
  );

  /* --- Le montant incohérent -------------------------------------------- */

  const tooMuch = await sessions.clientA.rpc('declare_payment', {
    p_order_id: state.orderA.id,
    p_method_code: 'ESPECES',
    p_amount: 99000,
  });
  // La déclaration passe — elle n'est pas confirmée ; c'est sa confirmation
  // qui se heurterait au total. On vérifie donc le refus à la confirmation.
  if (!tooMuch.error && tooMuch.data?.id) {
    const confirmTooMuch = await sessions.verificateur.rpc('verify_payment', {
      p_payment_id: tooMuch.data.id,
    });
    check(
      'un paiement qui dépasserait le total ne se confirme pas',
      Boolean(confirmTooMuch.error),
      confirmTooMuch.error ? '' : 'confirmé à tort',
    );
    state.excessPaymentId = tooMuch.data.id;
  } else {
    check('un montant excessif est refusé', true);
  }

  /* --- Espèces sans reçu ------------------------------------------------- */

  const cash = await sessions.clientA.rpc('declare_payment', {
    p_order_id: state.orderB.id,
    p_method_code: 'ESPECES',
    p_amount: 2000,
    p_transaction_reference: null,
  });
  check(
    'les espèces se déclarent sans référence ni reçu',
    !cash.error,
    cash.error?.message,
  );
  state.cashPaymentId = cash.data?.id ?? null;

  const cheque = await sessions.clientA.rpc('declare_payment', {
    p_order_id: state.orderB.id,
    p_method_code: 'CHEQUE',
    p_amount: 1000,
    p_transaction_reference: null,
  });
  check('le chèque se déclare sans référence ni reçu', !cheque.error, cheque.error?.message);

  /* --- Le rejet ---------------------------------------------------------- */

  const rejected = await sessions.verificateur.rpc('reject_payment', {
    p_payment_id: cheque.data?.id,
    p_reason: `${PREFIX} chèque sans provision`,
  });
  check('payments.verify rejette une déclaration', !rejected.error, rejected.error?.message);
  check('le paiement rejeté est en échec', rejected.data?.status === 'ECHEC');

  const noReason = await sessions.verificateur.rpc('reject_payment', {
    p_payment_id: state.cashPaymentId,
    p_reason: '',
  });
  check('un rejet sans motif est refusé', Boolean(noReason.error));
}

/* ========================================================================== */
/*  4. L'isolement entre clients                                              */
/* ========================================================================== */

async function checkIsolation(sessions, state) {
  log.step('Isolement — CLIENT A, CLIENT B, AFFILIE');

  const foreignOrder = await sessions.clientB
    .from('orders')
    .select('reference')
    .eq('id', state.orderA.id);
  check('CLIENT B ne voit pas la commande de CLIENT A', empty(foreignOrder));

  // Par référence aussi : c'est la porte qu'un curieux essaierait.
  const byReference = await sessions.clientB
    .from('orders')
    .select('reference')
    .eq('reference', state.orderA.reference);
  check('CLIENT B ne trouve pas la commande de CLIENT A par sa référence', empty(byReference));

  const foreignItems = await sessions.clientB
    .from('order_items')
    .select('designation')
    .eq('order_id', state.orderA.id);
  check('CLIENT B ne voit pas les lignes de CLIENT A', empty(foreignItems));

  const foreignPayments = await sessions.clientB
    .from('payments')
    .select('amount')
    .eq('order_id', state.orderA.id);
  check('CLIENT B ne voit pas les paiements de CLIENT A', empty(foreignPayments));

  const foreignProofs = await sessions.clientB
    .from('payment_proofs')
    .select('storage_path')
    .eq('payment_id', state.paymentId);
  check('CLIENT B ne voit pas les justificatifs de CLIENT A', empty(foreignProofs));

  const foreignEvents = await sessions.clientB
    .from('order_events')
    .select('summary')
    .eq('order_id', state.orderA.id);
  check('CLIENT B ne voit pas l’historique de CLIENT A', empty(foreignEvents));

  const foreignDocs = await sessions.clientB
    .from('documents')
    .select('reference')
    .eq('entity_id', state.orderA.id);
  check('CLIENT B ne voit pas les pièces de CLIENT A', empty(foreignDocs));

  /* --- L'affilié, qui n'a rien à voir ici ------------------------------- */

  for (const table of ['orders', 'payments', 'payment_proofs', 'refunds', 'order_events']) {
    const read = await sessions.affilie.from(table).select('*').limit(1);
    check(`AFFILIE ne lit pas ${table}`, empty(read), read.error ? '' : 'lecture acceptée');
  }

  /* --- L'administrateur sans permission --------------------------------- */

  for (const table of ['orders', 'payments', 'payment_proofs', 'refunds']) {
    const read = await sessions.nu.from(table).select('*').limit(1);
    check(`ADMIN sans permission ne lit pas ${table}`, empty(read), read.error ? '' : 'accepté');
  }

  /* --- L'administrateur en lecture seule -------------------------------- */

  const read = await sessions.lecteur.from('orders').select('reference').eq('id', state.orderA.id);
  check('orders.view lit la commande', !read.error && (read.data ?? []).length === 1);

  const write = await sessions.lecteur
    .from('orders')
    .update({ status: 'CONFIRMEE' })
    .eq('id', state.orderA.id)
    .select('id');
  check('orders.view n’écrit pas', refused(write));

  const readPayments = await sessions.lecteur.from('payments').select('amount').limit(1);
  check(
    'orders.view seul ne lit pas les paiements',
    empty(readPayments),
    readPayments.error ? '' : 'lecture acceptée',
  );
}

/* ========================================================================== */
/*  5. Les transitions de la commande                                         */
/* ========================================================================== */

async function checkTransitions(admin, sessions, state) {
  log.step('Transitions de la commande');

  const illegal = await sessions.traitant
    .from('orders')
    .update({ status: 'TERMINEE' })
    .eq('id', state.orderA.id)
    .select('id');
  check(
    'une commande nouvelle ne saute pas à « terminée »',
    refused(illegal),
    illegal.error?.message ?? 'accepté à tort',
  );

  const legal = await sessions.traitant
    .from('orders')
    .update({ status: 'CONFIRMEE' })
    .eq('id', state.orderA.id)
    .select('status');
  check('orders.update confirme la commande', !legal.error, legal.error?.message);

  const cancelByTraitant = await sessions.traitant.rpc('cancel_order', {
    p_order_id: state.orderC.id,
    p_reason: `${PREFIX} essai`,
  });
  check(
    'orders.update seul n’annule pas',
    Boolean(cancelByTraitant.error),
    cancelByTraitant.error ? '' : 'annulé à tort',
  );

  const cancelWithoutReason = await sessions.annulateur.rpc('cancel_order', {
    p_order_id: state.orderC.id,
    p_reason: '',
  });
  check('une annulation sans motif est refusée', Boolean(cancelWithoutReason.error));

  const cancelled = await sessions.annulateur.rpc('cancel_order', {
    p_order_id: state.orderC.id,
    p_reason: `${PREFIX} commande de contrôle`,
  });
  check('orders.cancel annule la commande', !cancelled.error, cancelled.error?.message);
  check('la commande annulée porte sa date', Boolean(cancelled.data?.cancelled_at));

  const again = await sessions.annulateur.rpc('cancel_order', {
    p_order_id: state.orderC.id,
    p_reason: `${PREFIX} seconde fois`,
  });
  check('annuler deux fois ne lève pas', !again.error, again.error?.message);

  const revive = await sessions.traitant
    .from('orders')
    .update({ status: 'CONFIRMEE' })
    .eq('id', state.orderC.id)
    .select('id');
  check('une commande annulée ne repart pas', refused(revive));

  const payCancelled = await sessions.clientA.rpc('declare_payment', {
    p_order_id: state.orderC.id,
    p_method_code: 'ESPECES',
    p_amount: 500,
  });
  check('on ne paie pas une commande annulée', Boolean(payCancelled.error));

  /* --- L'identité d'une commande est immuable ---------------------------- */

  const renamed = await sessions.traitant
    .from('orders')
    .update({ reference: 'MORA-CMCL-Z9999' })
    .eq('id', state.orderA.id)
    .select('id');
  check('la référence d’une commande ne se change pas', refused(renamed));

  const reassigned = await sessions.traitant
    .from('orders')
    .update({ user_id: state.clientB.userId })
    .eq('id', state.orderA.id)
    .select('id');
  check('une commande ne change pas de titulaire', refused(reassigned));

  /* --- Le total est recalculé, jamais reçu ------------------------------- */

  const forgedTotal = await sessions.traitant
    .from('orders')
    .update({ total_amount: 1 })
    .eq('id', state.orderA.id)
    .select('id');

  const { data: afterForge } = await admin
    .from('orders')
    .select('total_amount')
    .eq('id', state.orderA.id)
    .maybeSingle();

  check(
    'un total forgé ne s’applique pas',
    refused(forgedTotal) || afterForge?.total_amount === '10000.00',
    `${forgedTotal.error?.message ?? ''} — total ${afterForge?.total_amount}`,
  );
}

/* ========================================================================== */
/*  6. Le devis accepté devient une commande, une seule fois                  */
/* ========================================================================== */

async function checkQuoteConversion(admin, sessions, state) {
  log.step('Devis accepté → commande');

  // Une demande, puis un devis, comme la phase 4F les produit.
  const submitted = await admin.rpc('submit_quote_request', {
    p_full_name: CUSTOMER,
    p_email: state.clientA.email,
    p_phone: null,
    p_organisation: null,
    p_subject: `${PREFIX} demande de contrôle`,
    p_budget: null,
    p_message: `${PREFIX} message de contrôle.`,
    p_service_slug: null,
    p_offer_title: null,
    p_details: [],
    p_source: 'contact',
    p_client_hash: randomUUID().replace(/-/g, ''),
  });

  if (submitted.error) {
    check('une demande de contrôle est créée', false, submitted.error.message);
    return;
  }

  state.requestReference = submitted.data?.[0]?.reference ?? null;

  const { data: request } = await admin
    .from('quote_requests')
    .select('id, user_id')
    .eq('reference', state.requestReference)
    .maybeSingle();

  // La demande doit être rattachée au compte pour que la commande puisse
  // exister : décision du propriétaire, toute commande appartient à un compte.
  await admin
    .from('quote_requests')
    .update({ user_id: state.clientA.userId })
    .eq('id', request.id);

  const { data: draft, error: draftError } = await admin
    .from('quotes')
    .insert({
      quote_request_id: request.id,
      amount: 7500,
      currency: 'KMF',
      summary: `${PREFIX} prestation devisée`,
    })
    .select('id')
    .maybeSingle();

  if (draftError) {
    check('un devis de contrôle est créé', false, draftError.message);
    return;
  }

  state.quoteId = draft.id;

  const sent = await admin.rpc('send_quote', { p_quote_id: draft.id });
  check('le devis de contrôle est émis', !sent.error, sent.error?.message);
  state.quoteReference = sent.data?.reference ?? null;

  /* --- Un devis non accepté ne devient pas une commande ------------------ */

  const tooEarly = await admin.rpc('place_order_from_quote', { p_quote_id: draft.id });
  check(
    'un devis envoyé mais non accepté ne devient pas une commande',
    Boolean(tooEarly.error),
    tooEarly.error ? '' : 'transformé à tort',
  );

  await admin.from('quotes').update({ status: 'ACCEPTE' }).eq('id', draft.id);

  /* --- Sans permission ---------------------------------------------------- */

  const byLecteur = await sessions.lecteur.rpc('place_order_from_quote', { p_quote_id: draft.id });
  check('orders.view seul ne transforme pas un devis', Boolean(byLecteur.error));

  /* --- La transformation, et son idempotence ------------------------------ */

  const placed = await admin.rpc('place_order_from_quote', { p_quote_id: draft.id });
  check('le devis accepté devient une commande', !placed.error, placed.error?.message);
  state.orderFromQuote = placed.data ?? null;

  check(
    'la commande porte une référence CMCL conforme',
    /^MORA-CMCL-[A-Z]+\d{4}$/.test(placed.data?.reference ?? ''),
    placed.data?.reference,
  );
  check(
    'la commande reprend le montant du devis',
    Number(placed.data?.total_amount) === 7500,
    placed.data?.total_amount,
  );
  check('la commande naît « nouvelle », non payée', placed.data?.status === 'NOUVELLE');
  check(
    'la commande naît sans règlement',
    placed.data?.settlement_status === 'NON_PAYEE',
    placed.data?.settlement_status,
  );
  check('le lien avec le devis est conservé', placed.data?.quote_id === draft.id);

  const { data: sequenceBefore } = await runSql(
    state.target,
    state.accessToken,
    `select last_number from public.document_sequences where doc_type = 'CMCL';`,
  ).then((rows) => ({ data: rows?.[0] ?? null }));

  const replayed = await admin.rpc('place_order_from_quote', { p_quote_id: draft.id });
  check('rejouer la transformation ne lève pas', !replayed.error, replayed.error?.message);
  check(
    'rejouer la transformation rend la même commande',
    replayed.data?.id === placed.data?.id,
    `${replayed.data?.id} ≠ ${placed.data?.id}`,
  );

  const sequenceAfter = await runSql(
    state.target,
    state.accessToken,
    `select last_number from public.document_sequences where doc_type = 'CMCL';`,
  );
  check(
    'rejouer la transformation ne consomme aucun numéro',
    sequenceAfter?.[0]?.last_number === sequenceBefore?.last_number,
    `${sequenceBefore?.last_number} → ${sequenceAfter?.[0]?.last_number}`,
  );

  const { count: orders } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('quote_id', draft.id);
  check('une seule commande existe pour ce devis', orders === 1, String(orders));

  /* --- Le devis n'est pas retouché ---------------------------------------- */

  const { data: quoteAfter } = await admin
    .from('quotes')
    .select('amount, reference, status')
    .eq('id', draft.id)
    .maybeSingle();

  check(
    'le devis conserve son montant après transformation',
    Number(quoteAfter?.amount) === 7500,
    quoteAfter?.amount,
  );
  check(
    'le devis conserve sa référence',
    quoteAfter?.reference === state.quoteReference,
    quoteAfter?.reference,
  );
}

/* ========================================================================== */
/*  7. Les documents commerciaux                                              */
/* ========================================================================== */

async function checkDocuments(admin, sessions, state) {
  log.step('Documents commerciaux');

  const { data: cmcl } = await admin
    .from('documents')
    .select('reference, doc_type, entity_type, entity_id')
    .eq('entity_id', state.orderA.id)
    .eq('doc_type', 'CMCL')
    .maybeSingle();

  check('une pièce CMCL accompagne la commande', Boolean(cmcl), 'aucune pièce');
  check('la pièce porte la référence de la commande', cmcl?.reference === state.orderA.reference);
  check('la pièce désigne son entité', cmcl?.entity_type === 'order');

  /* --- DMCL et RVCL restent des codes de numérotation --------------------- */

  const dmcl = await admin.rpc('issue_document', {
    p_type: 'DMCL',
    p_entity_type: 'quote_request',
    p_entity_id: null,
    p_owner_id: null,
    p_subject_name: CUSTOMER,
    p_metadata: {},
    p_replaces: null,
  });
  check(
    'issue_document refuse toujours DMCL — la garde de 4F tient',
    Boolean(dmcl.error),
    dmcl.error ? '' : 'pièce émise à tort',
  );

  const rvcl = await admin.rpc('issue_document', {
    p_type: 'RVCL',
    p_entity_type: 'appointment',
    p_entity_id: null,
    p_owner_id: null,
    p_subject_name: CUSTOMER,
    p_metadata: {},
    p_replaces: null,
  });
  check('issue_document refuse toujours RVCL', Boolean(rvcl.error));

  /* --- La facture ---------------------------------------------------------- */

  const byLecteur = await sessions.lecteur.rpc('issue_order_invoice', {
    p_order_id: state.orderA.id,
  });
  check('orders.view seul n’émet pas de facture', Boolean(byLecteur.error));

  const invoice = await admin.rpc('issue_order_invoice', { p_order_id: state.orderA.id });
  check('la facture est émise', !invoice.error, invoice.error?.message);
  check(
    'la facture suit la nomenclature FACL',
    /^MORA-FACL-[A-Z]+\d{4}$/.test(invoice.data?.reference ?? ''),
    invoice.data?.reference,
  );
  state.invoiceReference = invoice.data?.reference ?? null;

  const before = await runSql(
    state.target,
    state.accessToken,
    `select last_number from public.document_sequences where doc_type = 'FACL';`,
  );

  const twice = await admin.rpc('issue_order_invoice', { p_order_id: state.orderA.id });
  check('émettre deux fois rend la même facture', twice.data?.reference === invoice.data?.reference);

  const after = await runSql(
    state.target,
    state.accessToken,
    `select last_number from public.document_sequences where doc_type = 'FACL';`,
  );
  check(
    'émettre deux fois ne consomme pas un second numéro',
    after?.[0]?.last_number === before?.[0]?.last_number,
    `${before?.[0]?.last_number} → ${after?.[0]?.last_number}`,
  );

  const onCancelled = await admin.rpc('issue_order_invoice', { p_order_id: state.orderC.id });
  check('une commande annulée ne se facture pas', Boolean(onCancelled.error));

  /* --- Le client lit sa facture, pas celle d'un autre ---------------------- */

  const own = await sessions.clientA
    .from('documents')
    .select('reference')
    .eq('reference', state.invoiceReference);
  check('le client lit sa propre facture', (own.data ?? []).length === 1, own.error?.message);

  const foreign = await sessions.clientB
    .from('documents')
    .select('reference')
    .eq('reference', state.invoiceReference);
  check('un autre client ne lit pas cette facture', empty(foreign));
}

/* ========================================================================== */
/*  8. Les justificatifs et le bucket privé                                   */
/* ========================================================================== */

async function checkStorage(target, admin, sessions, state) {
  log.step('Justificatifs — bucket privé');

  const { data: bucket } = await admin.storage.getBucket('paiements-justificatifs');
  check('le bucket des justificatifs existe', Boolean(bucket));
  check('le bucket n’est pas public', bucket?.public === false, String(bucket?.public));
  check(
    'la taille est limitée à 5 Mo',
    bucket?.file_size_limit === 5242880,
    String(bucket?.file_size_limit),
  );

  // Un JPEG minimal, reconnaissable à sa signature.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0]);
  const path = `${state.orderA.id}/${state.paymentId}/${randomUUID()}.jpg`;

  const uploaded = await sessions.clientA.storage
    .from('paiements-justificatifs')
    .upload(path, jpeg, { contentType: 'image/jpeg' });
  check('le client dépose son justificatif', !uploaded.error, uploaded.error?.message);
  state.proofPath = uploaded.error ? null : path;

  if (state.proofPath) {
    const attached = await sessions.clientA.rpc('attach_payment_proof', {
      p_payment_id: state.paymentId,
      p_storage_path: path,
      p_mime_type: 'image/jpeg',
      p_file_size: jpeg.byteLength,
      p_checksum: 'a'.repeat(64),
      p_original_name: 'recu.jpg',
    });
    check('le justificatif est rattaché au paiement', !attached.error, attached.error?.message);
    state.proofId = attached.data?.id ?? null;

    const again = await sessions.clientA.rpc('attach_payment_proof', {
      p_payment_id: state.paymentId,
      p_storage_path: path,
      p_mime_type: 'image/jpeg',
      p_file_size: jpeg.byteLength,
      p_checksum: 'a'.repeat(64),
      p_original_name: 'recu.jpg',
    });
    check(
      'le même justificatif ne se rattache pas deux fois',
      !again.error && again.data?.id === state.proofId,
      again.error?.message,
    );
  }

  /* --- Ce que le chemin n'autorise pas ------------------------------------ */

  const intruder = `${state.orderA.id}/${state.paymentId}/${randomUUID()}.jpg`;
  const byOther = await sessions.clientB.storage
    .from('paiements-justificatifs')
    .upload(intruder, jpeg, { contentType: 'image/jpeg' });
  check(
    'CLIENT B ne dépose rien dans le dossier de CLIENT A',
    Boolean(byOther.error),
    byOther.error ? '' : 'dépôt accepté',
  );

  const badMime = `${state.orderA.id}/${state.paymentId}/${randomUUID()}.txt`;
  const textUpload = await sessions.clientA.storage
    .from('paiements-justificatifs')
    .upload(badMime, new Uint8Array([0x68, 0x69]), { contentType: 'text/plain' });
  check(
    'un type MIME interdit est refusé par le bucket',
    Boolean(textUpload.error),
    textUpload.error ? '' : 'accepté',
  );

  const forgedPath = await sessions.clientA.rpc('attach_payment_proof', {
    p_payment_id: state.paymentId,
    p_storage_path: `../${state.orderA.id}/x.jpg`,
    p_mime_type: 'image/jpeg',
    p_file_size: 12,
    p_checksum: 'b'.repeat(64),
    p_original_name: 'forge.jpg',
  });
  check('un chemin forgé est refusé', Boolean(forgedPath.error));

  /* --- La lecture ---------------------------------------------------------- */

  if (state.proofPath) {
    const ownRead = await sessions.clientA.storage
      .from('paiements-justificatifs')
      .createSignedUrl(state.proofPath, 60);
    check('le client obtient une URL signée de son reçu', !ownRead.error, ownRead.error?.message);

    const foreignRead = await sessions.clientB.storage
      .from('paiements-justificatifs')
      .createSignedUrl(state.proofPath, 60);
    check(
      'CLIENT B n’obtient aucune URL du reçu de CLIENT A',
      Boolean(foreignRead.error),
      foreignRead.error ? '' : 'URL servie',
    );

    const affilieRead = await sessions.affilie.storage
      .from('paiements-justificatifs')
      .createSignedUrl(state.proofPath, 60);
    check('AFFILIE n’obtient aucune URL', Boolean(affilieRead.error));

    const nuRead = await sessions.nu.storage
      .from('paiements-justificatifs')
      .createSignedUrl(state.proofPath, 60);
    check('ADMIN sans payments.view n’obtient aucune URL', Boolean(nuRead.error));

    const verifieurRead = await sessions.verificateur.storage
      .from('paiements-justificatifs')
      .createSignedUrl(state.proofPath, 60);
    check(
      'payments.verify obtient l’URL pour vérifier',
      !verifieurRead.error,
      verifieurRead.error?.message,
    );

    // Et l'URL publique, celle que le bucket ne sert jamais.
    const publicUrl = sessions.clientA.storage
      .from('paiements-justificatifs')
      .getPublicUrl(state.proofPath).data.publicUrl;

    const fetched = await fetch(publicUrl);
    check(
      'aucune URL publique ne sert le justificatif',
      !fetched.ok,
      `HTTP ${fetched.status}`,
    );
  }

  /* --- Deviner une adresse ne donne rien ---------------------------------- */

  const guessed = `${state.orderA.id}/${state.paymentId}/${randomUUID()}.jpg`;
  const guessedRead = await sessions.clientB.storage
    .from('paiements-justificatifs')
    .createSignedUrl(guessed, 60);
  check('une adresse devinée ne donne rien', Boolean(guessedRead.error));
}

/* ========================================================================== */
/*  9. Le remboursement                                                       */
/* ========================================================================== */

async function checkRefund(admin, sessions, state) {
  log.step('Remboursements');

  const byTraitant = await sessions.traitant.rpc('record_refund', {
    p_order_id: state.orderA.id,
    p_amount: 1000,
    p_reason: `${PREFIX} essai`,
    p_payment_id: null,
    p_method_code: null,
  });
  check('orders.update seul ne rembourse pas', Boolean(byTraitant.error));

  const tooMuch = await sessions.rembourseur.rpc('record_refund', {
    p_order_id: state.orderA.id,
    p_amount: 999999,
    p_reason: `${PREFIX} excessif`,
    p_payment_id: state.paymentId,
    p_method_code: 'MVOLA',
  });
  // L'enregistrement est permis ; c'est sa constatation qui se heurte au
  // montant encaissé. On vérifie donc le refus au bon endroit.
  if (!tooMuch.error && tooMuch.data?.id) {
    const completed = await sessions.rembourseur.rpc('complete_refund', {
      p_refund_id: tooMuch.data.id,
    });
    check(
      'un remboursement supérieur à l’encaissé ne se constate pas',
      Boolean(completed.error),
      completed.error ? '' : 'constaté à tort',
    );
    await admin.from('refunds').delete().eq('id', tooMuch.data.id);
  }

  const recorded = await sessions.rembourseur.rpc('record_refund', {
    p_order_id: state.orderA.id,
    p_amount: 1500,
    p_reason: `${PREFIX} geste commercial`,
    p_payment_id: state.paymentId,
    p_method_code: 'MVOLA',
  });
  check('payments.refund enregistre un remboursement', !recorded.error, recorded.error?.message);
  state.refundId = recorded.data?.id ?? null;
  check('le remboursement naît « en cours »', recorded.data?.status === 'EN_COURS');

  const { data: beforeComplete } = await admin
    .from('orders')
    .select('refunded_amount')
    .eq('id', state.orderA.id)
    .maybeSingle();
  check(
    'un remboursement en cours ne réduit rien',
    Number(beforeComplete?.refunded_amount) === 0,
    beforeComplete?.refunded_amount,
  );

  const completed = await sessions.rembourseur.rpc('complete_refund', {
    p_refund_id: state.refundId,
  });
  check('le remboursement est constaté', !completed.error, completed.error?.message);

  const { data: afterComplete } = await admin
    .from('orders')
    .select('refunded_amount, settlement_status')
    .eq('id', state.orderA.id)
    .maybeSingle();
  check(
    'le montant remboursé est reporté sur la commande',
    Number(afterComplete?.refunded_amount) === 1500,
    afterComplete?.refunded_amount,
  );
  check(
    'la commande est « partiellement remboursée »',
    afterComplete?.settlement_status === 'PARTIELLEMENT_REMBOURSEE',
    afterComplete?.settlement_status,
  );

  const twice = await sessions.rembourseur.rpc('complete_refund', { p_refund_id: state.refundId });
  check('constater deux fois ne lève pas', !twice.error);

  const { data: afterTwice } = await admin
    .from('orders')
    .select('refunded_amount')
    .eq('id', state.orderA.id)
    .maybeSingle();
  check(
    'constater deux fois ne double pas le remboursement',
    Number(afterTwice?.refunded_amount) === 1500,
    afterTwice?.refunded_amount,
  );

  const { data: payment } = await admin
    .from('payments')
    .select('status')
    .eq('id', state.paymentId)
    .maybeSingle();
  check(
    'le paiement remboursé en partie le dit',
    payment?.status === 'PARTIELLEMENT_REMBOURSE',
    payment?.status,
  );
}

/* ========================================================================== */
/* 10. L'historique métier et l'audit                                         */
/* ========================================================================== */

async function checkJournal(admin, sessions, state) {
  log.step('Historique métier et audit');

  const { data: events } = await admin
    .from('order_events')
    .select('event_type, summary, amount')
    .eq('order_id', state.orderA.id)
    .order('occurred_at', { ascending: true });

  const types = (events ?? []).map((row) => row.event_type);

  for (const expected of [
    'COMMANDE_CREEE',
    'PAIEMENT_DECLARE',
    'PAIEMENT_CONFIRME',
    'STATUT_CHANGE',
    'REMBOURSEMENT_ENREGISTRE',
    'REMBOURSEMENT_EFFECTUE',
    'DOCUMENT_EMIS',
  ]) {
    check(`l’historique porte « ${expected} »`, types.includes(expected), types.join(', '));
  }

  // Le journal métier ne reprend ni le reçu, ni la référence de transaction.
  const leak = (events ?? []).some(
    (row) => row.summary?.includes(state.transactionReference) || row.summary?.includes('.jpg'),
  );
  check('l’historique ne recopie ni la référence bancaire ni le nom du reçu', !leak);

  const { data: history } = await admin
    .from('order_status_history')
    .select('from_status, to_status')
    .eq('order_id', state.orderA.id)
    .order('changed_at', { ascending: true });

  check('l’historique des statuts commence à « nouvelle »', history?.[0]?.to_status === 'NOUVELLE');
  check(
    'l’historique retient le passage à « confirmée »',
    (history ?? []).some((row) => row.to_status === 'CONFIRMEE'),
  );

  /* --- L'historique ne se modifie pas -------------------------------------- */

  const edited = await sessions.verificateur
    .from('order_events')
    .update({ summary: 'modifié' })
    .eq('order_id', state.orderA.id)
    .select('id');
  check('le journal métier ne se modifie pas', refused(edited));

  const deleted = await sessions.verificateur
    .from('order_status_history')
    .delete()
    .eq('order_id', state.orderA.id)
    .select('id');
  check('l’historique des statuts ne s’efface pas', refused(deleted));

  /* --- L'audit technique ---------------------------------------------------- */

  const { data: audit } = await admin
    .from('audit_logs')
    .select('action, resource_id, metadata')
    .eq('resource_id', state.orderA.reference)
    .order('created_at', { ascending: true });

  const actions = (audit ?? []).map((row) => row.action);
  check(
    'la confirmation d’un paiement laisse une trace d’audit',
    actions.includes('commerce.paiement.confirmation'),
    actions.join(', '),
  );
  check(
    'la création de la commande laisse une trace d’audit',
    actions.includes('commerce.commande.creation'),
  );

  const audited = JSON.stringify(audit ?? []);
  check(
    'l’audit ne contient pas la référence de transaction',
    !audited.includes(state.transactionReference),
  );
  check('l’audit ne contient pas de chemin de justificatif', !audited.includes('.jpg'));
}

/* ========================================================================== */
/* 11. Les moyens de paiement                                                 */
/* ========================================================================== */

async function checkMethods(sessions) {
  log.step('Configuration des moyens de paiement');

  const read = await sessions.clientA.from('payment_methods').select('code, is_active');
  const codes = (read.data ?? []).map((row) => row.code);
  check('le client ne voit que les moyens actifs', !codes.includes('WAKATI'), codes.join(', '));

  const write = await sessions.clientA
    .from('payment_methods')
    .update({ is_active: true })
    .eq('code', 'WAKATI')
    .select('code');
  check('le client n’active aucun moyen', refused(write));

  const byVerificateur = await sessions.verificateur
    .from('payment_methods')
    .update({ is_active: true })
    .eq('code', 'WAKATI')
    .select('code');
  check(
    'payments.verify n’active pas un moyen — c’est un réglage, pas une vérification',
    refused(byVerificateur),
  );

  const inserted = await sessions.parametreur
    .from('payment_methods')
    .insert({ code: 'INVENTE', label: 'Inventé', kind: 'ONLINE' })
    .select('code');
  check('aucun moyen ne s’ajoute depuis l’interface', refused(inserted));

  const withoutInstructions = await sessions.parametreur
    .from('payment_methods')
    .update({ is_active: true, instructions: '' })
    .eq('code', 'VIREMENT')
    .select('code');
  check(
    'un moyen ne s’active pas sans instructions',
    refused(withoutInstructions),
    withoutInstructions.error?.message ?? 'accepté à tort',
  );

  const secret = await sessions.parametreur
    .from('payment_methods')
    .update({ metadata: { api_key: 'sk_test_ne_doit_pas_entrer' } })
    .eq('code', 'MVOLA')
    .select('code');
  check(
    'une clé d’API ne se range pas dans un moyen de paiement',
    refused(secret),
    secret.error?.message ?? 'accepté à tort',
  );
}

/* ========================================================================== */
/*  Démontage                                                                 */
/* ========================================================================== */

async function teardown(target, accessToken, admin, state, before) {
  log.step('Nettoyage des données de contrôle');

  // Les objets Storage d'abord : ils ne dépendent de rien, et les laisser
  // ferait mentir le contrôle de résidu.
  const { data: folders } = await admin.storage
    .from('paiements-justificatifs')
    .list(state.orderA?.id ?? '', { limit: 100 });

  for (const folder of folders ?? []) {
    const { data: files } = await admin.storage
      .from('paiements-justificatifs')
      .list(`${state.orderA.id}/${folder.name}`, { limit: 100 });

    if ((files ?? []).length > 0) {
      await admin.storage
        .from('paiements-justificatifs')
        .remove(files.map((file) => `${state.orderA.id}/${folder.name}/${file.name}`));
    }
  }

  const orderIds = [state.orderA, state.orderB, state.orderC, state.orderFromQuote]
    .filter(Boolean)
    .map((order) => order.id);

  if (orderIds.length > 0) {
    await admin.from('refunds').delete().in('order_id', orderIds);
    await admin.from('payments').delete().in('order_id', orderIds);
    await admin.from('order_events').delete().in('order_id', orderIds);
    await admin.from('order_status_history').delete().in('order_id', orderIds);
    await admin.from('order_items').delete().in('order_id', orderIds);
    await admin.from('orders').delete().in('id', orderIds);
  }

  /*
   * Les pièces émises pendant l'exécution.
   *
   * Supprimées **après** les commandes, et désignées par leur date d'émission
   * plutôt que par leur entité : au moment où l'on arrive ici, les commandes
   * n'existent plus, et `documents.entity_id` ne pointe donc plus sur rien
   * qu'on puisse joindre. C'est ce que la première version de ce démontage
   * avait manqué — elle filtrait sur des identifiants de commandes déjà
   * effacées, ne supprimait rien, et laissait quatre pièces fantômes derrière
   * elle.
   *
   * La borne temporelle protège l'existant : seule une pièce émise depuis le
   * début de cette exécution peut être de contrôle.
   *
   * Un document émis ne se supprime pas ; il faut d'abord l'annuler. Règle de
   * 4D, que ce démontage s'applique à lui-même.
   */
  const since = `'${state.startedAt}'::timestamptz`;
  // DMCL n'émet aucune pièce — c'est un code de numérotation métier (4F).
  // Le chercher dans `documents` ne rendrait jamais rien.
  const docTypes = SEQUENCES.filter((code) => code !== 'DMCL')
    .map((code) => `'${code}'`)
    .join(', ');

  await runSql(
    target,
    accessToken,
    `update public.documents set status = 'ANNULE'
      where doc_type in (${docTypes}) and issued_at >= ${since};`,
  ).catch((error) => log.warn(`annulation des pièces de contrôle : ${error.message}`));

  await runSql(
    target,
    accessToken,
    `delete from public.documents
      where doc_type in (${docTypes}) and issued_at >= ${since};`,
  ).catch((error) => log.warn(`suppression des pièces de contrôle : ${error.message}`));

  // Le devis et la demande de contrôle, avec leur pièce DVCL.
  if (state.quoteId) {
    await runSql(
      target,
      accessToken,
      `update public.documents set status = 'ANNULE'
        where doc_type = 'DVCL' and entity_id = '${state.quoteId}';`,
    ).catch((error) => log.warn(`annulation du devis de contrôle : ${error.message}`));
    await runSql(
      target,
      accessToken,
      `delete from public.documents where doc_type = 'DVCL' and entity_id = '${state.quoteId}';`,
    ).catch((error) => log.warn(`suppression du devis de contrôle : ${error.message}`));
    await admin.from('quotes').delete().eq('id', state.quoteId);
  }

  await admin.from('quote_requests').delete().ilike('subject', `${PREFIX}%`);
  await admin.from('leads').delete().ilike('full_name', CUSTOMER);

  /*
   * Et l'on rend les compteurs tels qu'on les a trouvés.
   *
   * C'est la leçon de la phase 4F, dont les premiers essais avaient percé
   * trois suites de production. Ce n'est légitime que parce que les documents
   * qui portaient ces numéros viennent d'être supprimés : aucune référence
   * vivante ne les cite plus.
   */
  for (const [docType, sequence] of Object.entries(before.sequences)) {
    await runSql(
      target,
      accessToken,
      sequence === null
        ? `delete from public.document_sequences where doc_type = '${docType}';`
        : `update public.document_sequences
              set series = '${sequence.series}',
                  last_number = ${sequence.last_number},
                  allocated_count = ${sequence.allocated_count}
            where doc_type = '${docType}';`,
    ).catch(() => {});
  }

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

  /* --- Et l'on vérifie qu'il ne reste rien ------------------------------- */

  for (const table of ['orders', 'payments', 'refunds', 'order_events']) {
    const { count } = await admin.from(table).select('id', { count: 'exact', head: true });
    const expected = before.counts[table];
    check(
      `aucun résidu de contrôle dans ${table}`,
      count === expected,
      `${count} contre ${expected} au départ`,
    );
  }

  const { count: proofs } = await admin
    .from('payment_proofs')
    .select('id', { count: 'exact', head: true });
  check('aucun justificatif de contrôle ne subsiste', proofs === before.counts.payment_proofs);

  const { data: leftoverObjects } = await admin.storage
    .from('paiements-justificatifs')
    .list('', { limit: 100 });
  check(
    'aucun fichier de contrôle ne subsiste dans le bucket',
    (leftoverObjects ?? []).length === 0,
    `${(leftoverObjects ?? []).length} dossier(s)`,
  );

  const { data: accounts } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const remaining = (accounts?.users ?? []).filter((user) => user.email?.startsWith(PREFIX));
  check('aucun compte de contrôle ne subsiste', remaining.length === 0, String(remaining.length));

  // L'invariant qui compte le plus : la numérotation commerciale est
  // exactement celle d'avant. Aucun trou n'a été percé dans une suite réelle.
  const after = await runSql(
    target,
    accessToken,
    `select doc_type, series, last_number, allocated_count
       from public.document_sequences
      where doc_type in (${SEQUENCES.map((code) => `'${code}'`).join(', ')})
      order by doc_type;`,
  ).catch(() => null);

  const restored = Object.fromEntries((after ?? []).map((row) => [row.doc_type, row]));

  for (const docType of SEQUENCES) {
    const expected = before.sequences[docType] ?? null;
    const actual = restored[docType] ?? null;

    check(
      `la suite ${docType} est rendue telle qu’elle a été trouvée`,
      JSON.stringify(expected) === JSON.stringify(actual),
      `avant ${JSON.stringify(expected)} — après ${JSON.stringify(actual)}`,
    );
  }

  // Toute pièce émise depuis le début de l'exécution serait une pièce de
  // contrôle : il ne doit en rester aucune.
  const { data: ghosts } = await admin
    .from('documents')
    .select('reference, doc_type')
    .gte('issued_at', state.startedAt);
  check(
    'aucun document de contrôle ne subsiste',
    (ghosts ?? []).length === 0,
    (ghosts ?? []).map((row) => row.reference).join(', '),
  );
}

/* ========================================================================== */

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();

  log.step(`Commerce — ${describeTarget(target)}`);

  const admin = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /* --- L'état d'avant, pour pouvoir le rendre ---------------------------- */

  const sequenceRows = await runSql(
    target,
    accessToken,
    `select doc_type, series, last_number, allocated_count
       from public.document_sequences
      where doc_type in (${SEQUENCES.map((code) => `'${code}'`).join(', ')});`,
  );

  const sequences = Object.fromEntries(SEQUENCES.map((code) => [code, null]));
  for (const row of sequenceRows ?? []) sequences[row.doc_type] = row;

  const counts = {};
  for (const table of ['orders', 'payments', 'refunds', 'order_events', 'payment_proofs']) {
    const { count } = await admin.from(table).select('id', { count: 'exact', head: true });
    counts[table] = count ?? 0;
  }

  const before = { sequences, counts };

  // Borne temporelle du démontage : seule une pièce émise après cet instant
  // peut venir de cette exécution.
  const state = { target, accessToken, startedAt: new Date().toISOString() };

  try {
    /* --- Les comptes ---------------------------------------------------- */

    log.step('Comptes de contrôle');

    state.clientA = await createAccount(admin, { roleCode: 'CLIENT', label: 'clienta' });
    state.clientB = await createAccount(admin, { roleCode: 'CLIENT', label: 'clientb' });
    state.affilie = await createAccount(admin, { roleCode: 'AFFILIE', label: 'affilie' });

    const accounts = {
      nu: { roleCode: 'ADMIN', grants: [], label: 'adminnu' },
      lecteur: { roleCode: 'ADMIN', grants: ['orders.view'], label: 'lecteur' },
      traitant: {
        roleCode: 'ADMIN',
        grants: ['orders.view', 'orders.update', 'payments.view'],
        label: 'traitant',
      },
      annulateur: {
        roleCode: 'ADMIN',
        grants: ['orders.view', 'orders.update', 'orders.cancel'],
        label: 'annulateur',
      },
      verificateur: {
        roleCode: 'ADMIN',
        grants: ['orders.view', 'payments.view', 'payments.verify'],
        label: 'verificateur',
      },
      rembourseur: {
        roleCode: 'ADMIN',
        grants: ['orders.view', 'payments.view', 'payments.refund', 'orders.refund'],
        label: 'rembourseur',
      },
      parametreur: {
        roleCode: 'ADMIN',
        grants: ['settings.view', 'settings.update'],
        label: 'parametreur',
      },
    };

    for (const [key, spec] of Object.entries(accounts)) {
      state[key] = await createAccount(admin, spec);
    }

    check('les comptes de contrôle sont créés', true);

    /* --- Les commandes de contrôle -------------------------------------- */

    state.orderA = await makeOrder(admin, state.clientA.userId, 10000);
    state.orderB = await makeOrder(admin, state.clientA.userId, 3000);
    state.orderC = await makeOrder(admin, state.clientB.userId, 5000);

    check(
      'une commande saisie porte une référence CMCL conforme',
      /^MORA-CMCL-[A-Z]+\d{4}$/.test(state.orderA.reference),
      state.orderA.reference,
    );
    check(
      'une commande saisie est marquée comme telle',
      state.orderA.is_manual === true,
      String(state.orderA.is_manual),
    );
    check(
      'le total est calculé par la base',
      Number(state.orderA.total_amount) === 10000,
      state.orderA.total_amount,
    );

    // Une prestation sur devis ne se commande pas au prix zéro.
    const { data: quoteOnly } = await admin
      .from('services')
      .select('id, title')
      .is('price_amount', null)
      .limit(1)
      .maybeSingle();

    if (quoteOnly) {
      const forced = await admin.rpc('create_manual_order', {
        p_user_id: state.clientA.userId,
        p_items: [{ service_id: quoteOnly.id, quantity: 1 }],
        p_fees: 0,
        p_note: null,
      });
      check(
        'une prestation sur devis ne se commande pas directement',
        Boolean(forced.error),
        forced.error ? '' : `« ${quoteOnly.title} » commandée à tort`,
      );
    }

    const badQuantity = await admin.rpc('create_manual_order', {
      p_user_id: state.clientA.userId,
      p_items: [{ designation: `${PREFIX} quantité`, unit_price: 100, quantity: -3 }],
      p_fees: 0,
      p_note: null,
    });
    check('une quantité négative est refusée', Boolean(badQuantity.error));

    /* --- Les sessions ---------------------------------------------------- */

    const sessions = {};
    for (const key of [
      'clientA',
      'clientB',
      'affilie',
      'nu',
      'lecteur',
      'traitant',
      'annulateur',
      'verificateur',
      'rembourseur',
      'parametreur',
    ]) {
      sessions[key] = await signIn(target, state[key].email);
    }

    /* --- Les contrôles ---------------------------------------------------- */

    await checkAnonymous(target, state);
    await checkClient(sessions, state);
    await checkDeclaration(admin, sessions, state);
    await checkStorage(target, admin, sessions, state);
    await checkIsolation(sessions, state);
    await checkTransitions(admin, sessions, state);
    await checkQuoteConversion(admin, sessions, state);
    await checkDocuments(admin, sessions, state);
    await checkRefund(admin, sessions, state);
    await checkJournal(admin, sessions, state);
    await checkMethods(sessions);
  } catch (error) {
    results.failed += 1;
    log.fail(`interruption : ${error.message}`);
  } finally {
    await teardown(target, accessToken, admin, state, before).catch((error) => {
      results.failed += 1;
      log.fail(`nettoyage incomplet : ${error.message}`);
    });
  }

  log.step('Bilan');
  console.log(`  ${results.passed} contrôle(s) réussi(s), ${results.failed} en échec.`);

  if (results.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  log.fail(error.message);
  process.exitCode = 1;
});
