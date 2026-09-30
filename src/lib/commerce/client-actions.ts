'use server';

/**
 * Les deux actes qu'un client pose sur sa propre commande — phase 4G.
 *
 * Déclarer un paiement, et joindre un justificatif. C'est tout, et c'est
 * délibérément tout : le § 178 de `06_PAIEMENTS.md` énumère ce qu'un client ne
 * doit jamais pouvoir faire — modifier le montant, confirmer son propre
 * paiement, consulter celui d'un autre, changer le statut de sa commande,
 * déclencher un remboursement. Aucune de ces cinq choses n'a d'action ici, et
 * la base les refuserait de toute façon.
 *
 * ## Ce que le formulaire n'envoie pas
 *
 * Ni `user_id`, ni le statut, ni la date de confirmation, ni le total de la
 * commande. Le montant, lui, est saisi — un client peut régler en plusieurs
 * fois — mais il est borné par la base : la somme confirmée ne peut jamais
 * dépasser le total dû, et c'est un déclencheur qui le vérifie, pas ce
 * fichier.
 *
 * ## La déclaration ne confirme rien
 *
 * `declare_payment` crée le paiement en EN_VERIFICATION. Le client voit
 * « en vérification », pas « payé », et le message le dit en toutes lettres.
 * C'est D-10, rendue visible : la parole du client est enregistrée, elle n'est
 * pas prise pour argent comptant.
 */

import { revalidatePath } from 'next/cache';

import type { AdminActionState } from '@/lib/admin/actions';
import { requirePrivateAccess } from '@/lib/auth/guards';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import { getServerSupabaseClient } from '@/lib/supabase/server';

import { PROOF_MAX_BYTES } from './labels';
import { uploadPaymentProof } from './proofs';

const ok = (message: string): AdminActionState => ({ status: 'ok', message });
const ko = (message: string): AdminActionState => ({ status: 'error', message });

const MESSAGES = {
  unexpected: 'Votre déclaration n’a pas pu être enregistrée. Réessayez dans un instant.',
  noSupabase: 'Le service est momentanément indisponible.',
  unknownOrder: 'Cette commande est introuvable.',
  badAmount: 'Indiquez le montant que vous avez réglé, en chiffres.',
  badMethod: 'Choisissez un moyen de paiement.',
  methodInactive: 'Ce moyen de paiement n’est pas disponible actuellement.',
  referenceRequired:
    'Indiquez la référence de la transaction : elle figure sur le message reçu de l’opérateur.',
  duplicate:
    'Cette référence de transaction est déjà enregistrée. Vérifiez-la, ou contactez-nous.',
  tooHigh: 'Ce montant dépasse ce qui reste à régler sur cette commande.',
  cancelled: 'Cette commande est annulée : aucun paiement ne peut plus y être rattaché.',
  proofTooBig: 'Le fichier dépasse 5 Mo. Envoyez une capture plutôt qu’une photo brute.',
  proofBadType: 'Formats acceptés : JPEG, PNG, WebP ou PDF.',
  proofRefused: 'Ce justificatif n’a pas pu être enregistré.',
  declaredWithoutProof:
    'Votre paiement est déclaré, mais le justificatif n’a pas pu être joint. Vous pouvez le renvoyer depuis cette page.',
} as const;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function describe(error: { code?: string | null; message?: string }): string {
  const text = error.message ?? '';

  if (error.code === '42501') return MESSAGES.unknownOrder;
  if (error.code === '23505') return MESSAGES.duplicate;
  if (text.includes('déjà rattachée à une autre commande')) return MESSAGES.duplicate;
  if (text.includes('Montant incohérent')) return MESSAGES.tooHigh;
  if (text.includes('référence de la transaction')) return MESSAGES.referenceRequired;
  if (text.includes('annulée')) return MESSAGES.cancelled;
  if (text.includes('pas disponible')) return MESSAGES.methodInactive;

  return MESSAGES.unexpected;
}

/**
 * Déclare un paiement, et joint le justificatif s'il y en a un.
 *
 * L'ordre compte : la déclaration d'abord, le fichier ensuite. Si le
 * téléversement échoue, le paiement est tout de même enregistré et le client
 * en est informé — perdre une déclaration parce qu'une photo était trop lourde
 * serait exactement le travers que la phase 4F avait corrigé sur les demandes.
 */
export async function declareMyPayment(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  // La session, et rien d'autre, désigne le déclarant. Aucun identifiant
  // d'utilisateur n'est lu dans le formulaire.
  await requirePrivateAccess(AUTH_ROUTES.clientArea);

  const orderId = field(formData, 'commande');
  const method = field(formData, 'moyen');
  const rawAmount = field(formData, 'montant').replace(/\s/g, '').replace(',', '.');
  const reference = field(formData, 'reference');
  const note = field(formData, 'note');

  if (!orderId) return ko(MESSAGES.unknownOrder);
  if (!method) return ko(MESSAGES.badMethod);

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) return ko(MESSAGES.badAmount);

  const proof = formData.get('justificatif');
  const hasProof = proof instanceof File && proof.size > 0;

  // Contrôlée avant la déclaration : inutile d'enregistrer un paiement pour
  // découvrir ensuite que le fichier était inacceptable.
  if (hasProof && proof.size > PROOF_MAX_BYTES) return ko(MESSAGES.proofTooBig);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.noSupabase);

  const { data: payment, error } = await supabase.rpc('declare_payment', {
    p_order_id: orderId,
    p_method_code: method,
    p_amount: amount,
    p_transaction_reference: reference === '' ? null : reference,
    p_client_note: note === '' ? null : note,
  });

  if (error) return ko(describe(error));
  if (!payment) return ko(MESSAGES.unexpected);

  revalidatePath('/espace-client');

  if (!hasProof) {
    return ok(
      'Votre paiement est enregistré et sera vérifié par MORA Shawiri. Vous serez informé dès qu’il sera confirmé.',
    );
  }

  const upload = await uploadPaymentProof({
    orderId,
    paymentId: payment.id,
    file: proof,
  });

  if (!upload.ok) {
    revalidatePath('/espace-client');

    if (upload.reason === 'taille') return ko(MESSAGES.proofTooBig);
    if (upload.reason === 'type' || upload.reason === 'vide') return ko(MESSAGES.proofBadType);
    return ko(MESSAGES.declaredWithoutProof);
  }

  revalidatePath('/espace-client');
  return ok(
    'Votre paiement et votre justificatif sont enregistrés. MORA Shawiri les vérifie et vous confirmera le règlement.',
  );
}

/**
 * Joint un justificatif à une déclaration déjà faite.
 *
 * Le cas du client qui a déclaré depuis son téléphone sans avoir le reçu sous
 * la main. La propriété du paiement est vérifiée par `attach_payment_proof`,
 * et le dépôt lui-même par la politique Storage.
 */
export async function attachMyProof(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requirePrivateAccess(AUTH_ROUTES.clientArea);

  const orderId = field(formData, 'commande');
  const paymentId = field(formData, 'paiement');
  const proof = formData.get('justificatif');

  if (!orderId || !paymentId) return ko(MESSAGES.unexpected);
  if (!(proof instanceof File) || proof.size === 0) return ko(MESSAGES.proofBadType);
  if (proof.size > PROOF_MAX_BYTES) return ko(MESSAGES.proofTooBig);

  const upload = await uploadPaymentProof({ orderId, paymentId, file: proof });

  if (!upload.ok) {
    if (upload.reason === 'taille') return ko(MESSAGES.proofTooBig);
    if (upload.reason === 'type' || upload.reason === 'vide') return ko(MESSAGES.proofBadType);
    return ko(MESSAGES.proofRefused);
  }

  revalidatePath('/espace-client');
  return ok('Votre justificatif est enregistré.');
}
