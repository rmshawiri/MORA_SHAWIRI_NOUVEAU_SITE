'use server';

/**
 * Actions des modules Commandes et Paiements — phase 4G.
 *
 * Même discipline que 4C, 4E et 4F, dans le même ordre :
 *
 *   1. **permission** — `assertPermission()`, qui journalise le refus ;
 *   2. **validation** — les valeurs reçues du navigateur sont revalidées,
 *      jamais crues ;
 *   3. **écriture sous RLS** — par le client de session, jamais par la clé à
 *      privilèges ;
 *   4. **audit et historique** — assurés par les déclencheurs de la migration
 *      0009, qui voient passer toute écriture quel qu'en soit le chemin.
 *
 * ## Pourquoi presque tout passe par une fonction de base
 *
 * Créer une commande, confirmer un paiement, émettre une facture, rembourser :
 * chacun de ces actes touche plusieurs tables et doit être idempotent. Confier
 * cela à une action serveur reviendrait à parier que deux requêtes simultanées
 * ne se croiseront pas. Les fonctions de la migration font le travail dans une
 * transaction, sous verrou, et regardent d'abord si l'acte a déjà eu lieu.
 *
 * L'action serveur, ici, vérifie la permission, valide la saisie, appelle, et
 * traduit le refus en français.
 *
 * ## Ce que le navigateur ne décide jamais
 *
 * Le titulaire d'une commande, son total, le statut d'un paiement, l'identité
 * du vérificateur, la date de confirmation. Aucun n'est lu depuis un
 * formulaire : les uns sont calculés, les autres imposés par déclencheur
 * depuis `auth.uid()`. Un champ caché forgé n'a aucune prise.
 *
 * Références : `06_PAIEMENTS.md` § 8, § 15-16, § 105-110, § 128-130 ;
 * `09_ADMINISTRATION/02` § 35, § 56-62, § 85-90.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
import { archiveIssuedCommercialDocument } from '@/lib/documents/commercial-documents';
import { archiveIssuedInvoice } from '@/lib/documents/invoices';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { OrderStatus } from '@/lib/supabase/types';

import { ORDER_STATUS_LABELS } from './labels';

const ok = (message: string): AdminActionState => ({ status: 'ok', message });
const ko = (message: string): AdminActionState => ({ status: 'error', message });

/** Messages génériques : le § 129 interdit d'exposer une cause technique. */
const MESSAGES = {
  denied: 'Vous n’avez pas le droit d’effectuer cette action.',
  unexpected: 'L’opération n’a pas abouti. Réessayez dans un instant.',
  noSupabase: 'La base de données est momentanément indisponible.',
  unknownOrder: 'Cette commande est introuvable.',
  unknownPayment: 'Ce paiement est introuvable.',
  unknownQuote: 'Ce devis est introuvable.',
  badStatus: 'Ce changement de statut n’est pas possible depuis l’état actuel.',
  badAmount: 'Le montant doit être un nombre supérieur à zéro.',
  reasonRequired: 'Indiquez le motif : il reste attaché à l’opération.',
  quoteNotAccepted:
    'Seul un devis accepté devient une commande. Enregistrez d’abord la réponse du client.',
  noAccount:
    'Cette demande n’est rattachée à aucun compte client. Le client doit créer son compte avant que la commande puisse être établie.',
  cancelWithPayment:
    'Cette commande a encaissé un paiement. Enregistrez le remboursement avant de l’annuler.',
  orderCancelled: 'Cette commande est annulée : aucun paiement ne peut plus y être rattaché.',
  amountTooHigh: 'Ce montant dépasse ce qui reste à régler sur cette commande.',
  refundTooHigh: 'Ce montant dépasse ce qui a été encaissé.',
  methodInactive: 'Ce moyen de paiement n’est pas disponible.',
  duplicateTransaction:
    'Cette référence de transaction est déjà enregistrée sur une autre commande.',
  proofRequired: 'Ce moyen de paiement demande la référence de la transaction.',
  invoiceOnCancelled: 'Une commande annulée ne se facture pas.',
  invoiceEmpty: 'Une commande sans ligne ni montant ne se facture pas.',
  instructionsRequired:
    'Un moyen actif doit porter des instructions : le client doit savoir où et comment payer.',
} as const;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function refresh(): void {
  revalidatePath('/administration/commandes');
  revalidatePath('/administration/paiements');
  revalidatePath('/espace-client');
}

const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];

/**
 * Traduit un refus de la base en message lisible.
 *
 * Les fonctions de la migration lèvent des exceptions dont le texte est écrit
 * pour être lu. On ne le renvoie pas tel quel — le § 129 interdit d'exposer
 * une cause technique — mais on s'en sert pour choisir le bon message parmi
 * ceux qu'on a prévus.
 */
function describeDatabaseError(error: { code?: string | null; message?: string }): string {
  const text = error.message ?? '';

  if (error.code === '42501') return MESSAGES.denied;
  if (error.code === '23505') return MESSAGES.duplicateTransaction;

  if (text.includes('rattachée à aucun compte')) return MESSAGES.noAccount;
  if (text.includes('devis accepté')) return MESSAGES.quoteNotAccepted;
  if (text.includes('traitez le remboursement')) return MESSAGES.cancelWithPayment;
  if (text.includes('ne reçoit pas de paiement')) return MESSAGES.orderCancelled;
  if (text.includes('Montant incohérent')) return MESSAGES.amountTooHigh;
  if (text.includes('dépasseraient')) return MESSAGES.refundTooHigh;
  if (text.includes('n’est pas disponible') || text.includes("n'est pas disponible")) {
    return MESSAGES.methodInactive;
  }
  if (text.includes('référence de la transaction')) return MESSAGES.proofRequired;
  if (text.includes('annulée ne se facture')) return MESSAGES.invoiceOnCancelled;
  if (text.includes('sans ligne ne se facture') || text.includes('sans montant ne se facture')) {
    return MESSAGES.invoiceEmpty;
  }
  if (text.includes('Transition refusée')) return MESSAGES.badStatus;
  if (error.code === '23514') return MESSAGES.badStatus;

  return MESSAGES.unexpected;
}

/* ========================================================== COMMANDES === */

/**
 * Transforme un devis accepté en commande.
 *
 * `orders.update` — la permission que 4D a désignée comme celle qui émet une
 * pièce CMCL. Créer une commande, c'est en émettre une ; le second facteur est
 * exigé par `issue_document` lui-même.
 *
 * Rejouée, l'action renvoie la commande déjà créée : c'est la fonction de base
 * qui le garantit, sous l'unicité de `orders.quote_id`.
 */
export async function convertQuoteToOrder(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('orders.update', 'commerce.commande.creation');

    const quoteId = field(formData, 'devis');
    if (!quoteId) return ko(MESSAGES.unknownQuote);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase.rpc('place_order_from_quote', {
      p_quote_id: quoteId,
    });

    if (error) return ko(describeDatabaseError(error));
    if (!data) return ko(MESSAGES.unknownQuote);

    refresh();
    return ok(`La commande ${data.reference} a été établie à partir de ce devis.`);
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    console.error('[commerce] transformation du devis impossible');
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Change le statut d'une commande.
 *
 * Le graphe légal est celui du déclencheur, et lui seul. L'action ne le
 * réécrit pas : elle vérifie que la valeur reçue est un statut connu, puis
 * laisse la base juger de la transition. Deux listes de transitions
 * finiraient par diverger.
 */
export async function updateOrderStatus(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('orders.update', 'commerce.commande.statut');

    const reference = field(formData, 'reference');
    const status = field(formData, 'status') as OrderStatus;

    if (!ORDER_STATUSES.includes(status)) return ko(MESSAGES.badStatus);
    // L'annulation a sa propre action : elle exige un motif et une autre
    // permission. La proposer ici contournerait les deux.
    if (status === 'ANNULEE') return ko(MESSAGES.badStatus);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('reference', reference)
      .select('reference');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unknownOrder);

    refresh();
    return ok(`La commande est désormais « ${ORDER_STATUS_LABELS[status]} ».`);
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Annule une commande, avec motif.
 *
 * `orders.cancel`, distincte d'`orders.update` : le § 16 du cadrage range
 * l'annulation parmi les actes sensibles, et 4A leur avait donné deux
 * permissions séparées. Un administrateur peut traiter une commande sans
 * pouvoir l'annuler.
 */
export async function cancelOrder(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('orders.cancel', 'commerce.commande.annulation');

    const orderId = field(formData, 'commande');
    const reason = field(formData, 'motif');

    if (!orderId) return ko(MESSAGES.unknownOrder);
    if (reason.length < 3) return ko(MESSAGES.reasonRequired);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { error } = await supabase.rpc('cancel_order', {
      p_order_id: orderId,
      p_reason: reason,
    });

    if (error) return ko(describeDatabaseError(error));

    refresh();
    return ok('La commande a été annulée. Elle reste consultable dans l’historique.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/** Note administrative interne (§ 42). Aucun effet sur le cycle commercial. */
export async function updateOrderNote(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('orders.update', 'commerce.commande.note');

    const reference = field(formData, 'reference');
    const note = field(formData, 'note');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('orders')
      .update({ admin_note: note === '' ? null : note.slice(0, 4000) })
      .eq('reference', reference)
      .select('reference');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unknownOrder);

    refresh();
    return ok('La note a été enregistrée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/* =========================================================== PAIEMENTS === */

/**
 * Confirme un paiement après vérification humaine.
 *
 * C'est l'acte central de D-10. `payments.verify` est une permission critique
 * au sens du § 142, absente du modèle proposé à la création d'un compte
 * administrateur : il faut l'accorder explicitement.
 *
 * La vérification elle-même n'est pas automatisable et ne l'est pas ici :
 * l'opérateur a regardé le reçu, la référence, ou le message reçu sur la ligne
 * Mvola — puis il confirme. Le système enregistre sa décision, il ne la prend
 * pas.
 */
export async function verifyPayment(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('payments.verify', 'commerce.paiement.confirmation');

    const paymentId = field(formData, 'paiement');
    const note = field(formData, 'note');
    if (!paymentId) return ko(MESSAGES.unknownPayment);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { error } = await supabase.rpc('verify_payment', {
      p_payment_id: paymentId,
      p_admin_note: note === '' ? null : note,
    });

    if (error) return ko(describeDatabaseError(error));

    refresh();
    return ok('Le paiement est confirmé.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/** Rejette une déclaration. Le motif est obligatoire : le client doit savoir. */
export async function rejectPayment(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('payments.verify', 'commerce.paiement.rejet');

    const paymentId = field(formData, 'paiement');
    const reason = field(formData, 'motif');

    if (!paymentId) return ko(MESSAGES.unknownPayment);
    if (reason.length < 3) return ko(MESSAGES.reasonRequired);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { error } = await supabase.rpc('reject_payment', {
      p_payment_id: paymentId,
      p_reason: reason,
    });

    if (error) return ko(describeDatabaseError(error));

    refresh();
    return ok('La déclaration a été rejetée. Le client peut en soumettre une autre.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Enregistre un règlement reçu hors ligne (§ 104-105).
 *
 * Espèces remises au bureau, chèque encaissé : l'administration déclare et
 * confirme dans la foulée, parce qu'elle a constaté le règlement elle-même.
 * Les deux appels restent distincts — la déclaration puis la vérification —
 * pour que l'historique raconte la même chose que pour un paiement client.
 */
export async function recordOfflinePayment(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('payments.verify', 'commerce.paiement.horsligne');

    const orderId = field(formData, 'commande');
    const method = field(formData, 'moyen');
    const amount = Number(field(formData, 'montant').replace(',', '.'));
    const reference = field(formData, 'reference');
    const note = field(formData, 'note');

    if (!orderId || !method) return ko(MESSAGES.unknownOrder);
    if (!Number.isFinite(amount) || amount <= 0) return ko(MESSAGES.badAmount);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data: payment, error: declareError } = await supabase.rpc('declare_payment', {
      p_order_id: orderId,
      p_method_code: method,
      p_amount: amount,
      p_transaction_reference: reference === '' ? null : reference,
      p_client_note: null,
    });

    if (declareError) return ko(describeDatabaseError(declareError));
    if (!payment) return ko(MESSAGES.unexpected);

    const { error: verifyError } = await supabase.rpc('verify_payment', {
      p_payment_id: payment.id,
      p_admin_note: note === '' ? 'Règlement constaté par l’administration.' : note,
    });

    if (verifyError) return ko(describeDatabaseError(verifyError));

    refresh();
    return ok('Le règlement a été enregistré et confirmé.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/* ======================================================== FACTURATION === */

/**
 * Émet la facture d'une commande.
 *
 * `invoices.issue` — permission CRITIQUE, distincte d'`orders.update` depuis la
 * décision propriétaire du 1er octobre 2026. Gérer une commande n'emporte plus
 * le droit d'émettre une pièce comptable. La base revérifie la même permission
 * (`issue_order_invoice`, puis `issue_document` qui exige aussi l'AAL2) : un
 * appel direct à l'API n'y échappe pas.
 *
 * Décision du propriétaire en 4G : jamais automatique. Émettre deux fois rend
 * la première facture sans rien consommer — la commande est verrouillée et la
 * fonction regarde avant d'allouer.
 *
 * Le PDF est rendu depuis l'instantané et archivé dans la foulée. Si l'archive
 * échoue, la facture n'en est pas moins émise : le premier téléchargement la
 * rattrapera, à l'identique.
 */
export async function issueInvoice(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('invoices.issue', 'commerce.facture.emission');

    const orderId = field(formData, 'commande');
    if (!orderId) return ko(MESSAGES.unknownOrder);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase.rpc('issue_order_invoice', {
      p_order_id: orderId,
    });

    if (error) return ko(describeDatabaseError(error));
    if (!data) return ko(MESSAGES.unexpected);

    await archiveIssuedInvoice(data.reference);

    refresh();
    revalidatePath('/administration/commandes/factures');
    return ok(`La facture ${data.reference} est émise.`);
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Établit le document officiel d'une commande (remarques 01, A5).
 *
 * Le type documentaire est CMCL, celui de la commande depuis 4D : la pièce
 * existe déjà, avec la référence de la commande. L'acte fige son contenu
 * (lignes, totaux, règlement constaté) ; aucun numéro n'est consommé.
 * Permission : celle d'émission du type CMCL (`orders.update`), relue en base.
 */
export async function issueOrderDocument(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('orders.update', 'commerce.commande.document');

    const orderId = field(formData, 'commande');
    if (!orderId) return ko(MESSAGES.unknownOrder);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase.rpc('issue_order_document', { p_order_id: orderId });
    if (error) {
      if (error.code === '23514') return ko(error.message);
      return ko(describeDatabaseError(error));
    }
    if (!data) return ko(MESSAGES.unexpected);

    await archiveIssuedCommercialDocument(data.reference);

    refresh();
    destination = `/administration/commandes/${data.reference}/?resultat=bon-de-commande`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

/* ===================================================== REMBOURSEMENTS === */


/** Enregistre une décision de remboursement. N'affecte encore aucun montant. */
export async function recordRefund(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('payments.refund', 'commerce.remboursement.enregistrement');

    const orderId = field(formData, 'commande');
    const paymentId = field(formData, 'paiement');
    const method = field(formData, 'moyen');
    const amount = Number(field(formData, 'montant').replace(',', '.'));
    const reason = field(formData, 'motif');

    if (!orderId) return ko(MESSAGES.unknownOrder);
    if (!Number.isFinite(amount) || amount <= 0) return ko(MESSAGES.badAmount);
    if (reason.length < 3) return ko(MESSAGES.reasonRequired);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { error } = await supabase.rpc('record_refund', {
      p_order_id: orderId,
      p_amount: amount,
      p_reason: reason,
      p_payment_id: paymentId === '' ? null : paymentId,
      p_method_code: method === '' ? null : method,
    });

    if (error) return ko(describeDatabaseError(error));

    refresh();
    return ok('Le remboursement est enregistré. Confirmez-le une fois l’argent envoyé.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Constate qu'un remboursement a réellement eu lieu.
 *
 * Seul cet acte réduit le montant encaissé de la commande. Enregistrer une
 * décision et constater un mouvement sont deux choses différentes, et le § 96
 * interdit de simuler la seconde.
 */
export async function completeRefund(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('payments.refund', 'commerce.remboursement.execution');

    const refundId = field(formData, 'remboursement');
    const reference = field(formData, 'reference');
    if (!refundId) return ko(MESSAGES.unexpected);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { error } = await supabase.rpc('complete_refund', {
      p_refund_id: refundId,
      p_external_reference: reference === '' ? null : reference,
    });

    if (error) return ko(describeDatabaseError(error));

    refresh();
    return ok('Le remboursement est constaté.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/* ================================================ MOYENS DE PAIEMENT === */

/**
 * Configure un moyen de paiement (§ 11).
 *
 * `settings.update`, permission critique : activer un moyen, c'est le proposer
 * à tous les clients ; changer un numéro, c'est rediriger de l'argent.
 *
 * Aucun secret n'est saisissable ici, et la table refuserait de toute façon
 * les clés les plus évidentes (§ 192). Un moyen ne peut pas non plus être
 * activé sans instructions : le client doit savoir où payer.
 */
export async function updatePaymentMethod(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('settings.update', 'commerce.moyen.configuration');

    const code = field(formData, 'code');
    const active = formData.get('actif') === 'on';
    const instructions = field(formData, 'instructions');
    const accountNumber = field(formData, 'numero');
    const accountHolder = field(formData, 'titulaire');

    if (!code) return ko(MESSAGES.unexpected);
    if (active && instructions === '') return ko(MESSAGES.instructionsRequired);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('payment_methods')
      .update({
        is_active: active,
        instructions: instructions.slice(0, 2000),
        account_number: accountNumber === '' ? null : accountNumber.slice(0, 64),
        account_holder: accountHolder === '' ? null : accountHolder.slice(0, 120),
      })
      .eq('code', code)
      .select('code');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unexpected);

    refresh();
    revalidatePath('/administration/parametres');
    return ok(active ? 'Le moyen est activé.' : 'Le moyen est désactivé.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}
