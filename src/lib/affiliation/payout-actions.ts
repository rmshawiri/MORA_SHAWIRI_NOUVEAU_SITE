'use server';

/**
 * Versements — phase 4H-6 : préparer, retirer une ligne, annuler un
 * brouillon, confirmer, rattacher le justificatif.
 *
 * Mêmes barrières que partout : permission (refus journalisé) → validation →
 * fonction en base sous la session, qui revérifie la permission, verrouille,
 * interdit à l'affilié d'agir sur son propre versement et refuse tout double
 * paiement → retour par la page, avec un code de résultat fermé.
 *
 * Le justificatif est le seul fichier : il est vérifié (taille, signature
 * réelle), déposé par le serveur dans un bucket privé, puis rattaché par la
 * base, une seule fois.
 */

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
import { kmf } from '@/lib/affiliation/commissions';
import { isIsoDate, proofPath } from '@/lib/affiliation/payouts';
import { sniffProof } from '@/lib/commerce/proof-format';
import { archiveIssuedAffiliateDocument } from '@/lib/documents/affiliate-documents';
import { renderPayoutConfirmed } from '@/lib/emails/affiliation';
import { sendLoggedEmail } from '@/lib/emails/send';
import { getSiteUrl } from '@/lib/env';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getServerSupabaseClient } from '@/lib/supabase/server';

const ko = (message: string): AdminActionState => ({ status: 'error', message });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DENIED = 'Vous n’avez pas le droit d’effectuer cette action.';
const UNEXPECTED = 'L’opération n’a pas abouti. Réessayez dans un instant.';
const BUCKET = 'affiliation-justificatifs';

function field(formData: FormData, name: string, max = 1000): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function describe(error: { code?: string; message?: string }): string {
  if (error.code === '42501') return error.message && error.message.length < 200 ? error.message : DENIED;
  if (error.code === '23505') return 'Un versement est déjà en préparation, ou une commission est déjà dans un versement.';
  const message = error.message ?? '';
  if ((error.code === '23514' || error.code === 'P0002') && message.length > 0 && message.length < 240) return message;
  return UNEXPECTED;
}

function refresh(): void {
  revalidatePath('/administration/affiliation/', 'layout');
  revalidatePath('/espace-affilie/');
}

const payoutPath = (id: string) => `/administration/affiliation/versements/${id}/`;

export async function preparePayout(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('payouts.manage', 'affiliation.versement.preparation');
    const affiliateId = field(formData, 'affiliate', 40);
    const period = field(formData, 'period', 80) || null;
    const selected = formData.getAll('commission').filter((v): v is string => typeof v === 'string' && UUID.test(v));
    if (!UUID.test(affiliateId)) return ko('Affilié introuvable.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { data, error } = await supabase.rpc('prepare_affiliate_payout', {
      p_affiliate_id: affiliateId,
      p_commission_ids: selected.length > 0 ? selected : null,
      p_period_label: period,
    });
    if (error || !data) return ko(error ? describe(error) : UNEXPECTED);
    refresh();
    destination = `${payoutPath(data.id)}?resultat=PREPARE`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function removePayoutItem(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('payouts.manage', 'affiliation.versement.ligne');
    const payoutId = field(formData, 'payout', 40);
    const itemId = field(formData, 'item', 40);
    if (!UUID.test(payoutId) || !UUID.test(itemId)) return ko('Ligne introuvable.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('remove_payout_item', { p_item_id: itemId });
    if (error) return ko(describe(error));
    refresh();
    destination = `${payoutPath(payoutId)}?resultat=LIGNE_RETIREE`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function cancelPayout(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('payouts.manage', 'affiliation.versement.annulation');
    const payoutId = field(formData, 'payout', 40);
    const reason = field(formData, 'reason');
    if (!UUID.test(payoutId)) return ko('Versement introuvable.');
    if (!reason) return ko('Une annulation se motive.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('cancel_affiliate_payout', { p_payout_id: payoutId, p_reason: reason });
    if (error) return ko(describe(error));
    refresh();
    destination = `${payoutPath(payoutId)}?resultat=ANNULE`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function confirmPayout(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    const context = await assertPermission('payouts.manage', 'affiliation.versement.confirmation');
    const payoutId = field(formData, 'payout', 40);
    const method = field(formData, 'method', 40);
    const transaction = field(formData, 'transaction', 120) || null;
    const paidOn = field(formData, 'paid_on', 10);
    const note = field(formData, 'note') || null;
    const notify = formData.get('notify') === 'on' || formData.get('notify') === '1';
    if (!UUID.test(payoutId)) return ko('Versement introuvable.');
    if (!/^[A-Z_]{2,40}$/.test(method)) return ko('Choisissez le moyen réellement utilisé.');
    if (!isIsoDate(paidOn)) return ko('Indiquez la date du versement.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { data: payout, error } = await supabase.rpc('confirm_affiliate_payout', {
      p_payout_id: payoutId, p_method_code: method, p_transaction_reference: transaction, p_paid_on: paidOn, p_note: note,
    });
    if (error || !payout) return ko(error ? describe(error) : UNEXPECTED);
    // Le relevé RVAF est émis avec son instantané par la base ; le serveur en
    // rend le PDF et l'archive aussitôt (rattrapé au premier téléchargement
    // si le stockage est indisponible).
    if (payout.reference) await archiveIssuedAffiliateDocument(payout.reference);

    let mail = 'skipped';
    if (notify) {
      const [{ data: affiliate }, { count }, { data: methods }] = await Promise.all([
        supabase.from('affiliates').select('display_name, contact_email').eq('id', payout.affiliate_id).maybeSingle(),
        supabase.from('affiliate_payout_items').select('id', { count: 'exact', head: true }).eq('payout_id', payout.id),
        supabase.rpc('affiliate_payout_methods'),
      ]);
      if (affiliate) {
        const email = renderPayoutConfirmed({
          firstName: affiliate.display_name.split(/\s+/)[0] ?? affiliate.display_name,
          reference: payout.reference ?? '',
          amount: kmf(payout.total_amount),
          paidOn: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Indian/Comoro' }).format(new Date(`${paidOn}T12:00:00+03:00`)),
          methodLabel: (methods ?? []).find((row) => row.code === method)?.label ?? method,
          transaction,
          lines: count ?? 0,
          spaceUrl: new URL('/espace-affilie/', getSiteUrl()).toString(),
        });
        const outcome = await sendLoggedEmail({
          template: 'affiliation.versement.confirme',
          to: affiliate.contact_email,
          subject: email.subject,
          rendered: email.rendered,
          entityType: 'affiliate_payout',
          entityId: payout.id,
          createdBy: context.access.userId,
        });
        mail = outcome.state;
      }
    }
    refresh();
    destination = `${payoutPath(payoutId)}?resultat=CONFIRME&mail=${mail}`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function attachPayoutProof(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('payouts.manage', 'affiliation.versement.justificatif');
    const payoutId = field(formData, 'payout', 40);
    const file = formData.get('proof');
    if (!UUID.test(payoutId)) return ko('Versement introuvable.');
    if (!(file instanceof File) || file.size === 0) return ko('Choisissez le justificatif (PDF ou image).');
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const sniffed = sniffProof(bytes, file.size);
    if (!sniffed.ok) {
      return ko(sniffed.reason === 'taille' ? 'Le justificatif dépasse 5 Mo.' : 'Format refusé : PDF, PNG, JPEG ou WebP uniquement.');
    }
    const path = proofPath(payoutId, randomUUID(), sniffed.extension);
    if (!path) return ko('Format refusé : PDF, PNG, JPEG ou WebP uniquement.');
    const mime = sniffed.mimeType;
    const content = new Uint8Array(await file.arrayBuffer());

    const supabase = await getServerSupabaseClient();
    const privileged = getAdminSupabaseClient();
    if (!supabase || !privileged) return ko(UNEXPECTED);
    // La base vérifie d'abord que le versement accepte un justificatif.
    const { data: current } = await supabase.from('affiliate_payouts').select('status').eq('id', payoutId).maybeSingle();
    if (current?.status !== 'CONFIRME') return ko('Un justificatif se rattache à un versement confirmé.');
    const upload = await privileged.storage.from(BUCKET).upload(path, content, { contentType: mime, upsert: false });
    if (upload.error) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('attach_payout_proof', { p_payout_id: payoutId, p_path: path });
    if (error) {
      await privileged.storage.from(BUCKET).remove([path]);
      return ko(describe(error));
    }
    refresh();
    destination = `${payoutPath(payoutId)}?resultat=JUSTIFICATIF`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}
