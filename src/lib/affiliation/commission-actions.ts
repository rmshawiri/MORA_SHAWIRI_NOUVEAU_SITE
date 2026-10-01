'use server';

/**
 * Commissions — phase 4H-5 : validation manuelle, annulation, ajustement.
 *
 * Mêmes barrières que partout : permission (refus journalisé) → validation →
 * fonction en base sous la session, qui revérifie la permission, interdit à
 * l'affilié d'agir sur ses propres commissions et refuse toute réécriture →
 * retour par la page, avec un code de résultat fermé.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
import { parseAdjustmentAmount } from '@/lib/affiliation/commissions';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';

const ko = (message: string): AdminActionState => ({ status: 'error', message });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DENIED = 'Vous n’avez pas le droit d’effectuer cette action.';
const UNEXPECTED = 'L’opération n’a pas abouti. Réessayez dans un instant.';

function field(formData: FormData, name: string, max = 1000): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function describe(error: { code?: string; message?: string }): string {
  if (error.code === '42501') return error.message && error.message.length < 200 ? error.message : DENIED;
  const message = error.message ?? '';
  if ((error.code === '23514' || error.code === 'P0002') && message.length > 0 && message.length < 240) return message;
  return UNEXPECTED;
}

function returnPath(formData: FormData): string {
  const value = field(formData, 'return', 200);
  return /^\/administration\/affiliation\/[A-Za-z0-9/_-]*$/.test(value) ? value : '/administration/affiliation/commissions/';
}

function done(path: string, result: string): string {
  revalidatePath('/administration/affiliation/', 'layout');
  revalidatePath('/espace-affilie/');
  return `${path}${path.endsWith('/') ? '' : '/'}?resultat=${result}`;
}

export async function validateCommission(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('commissions.validate', 'affiliation.commission.validation');
    const id = field(formData, 'commission', 40);
    const reason = field(formData, 'reason');
    if (!UUID.test(id)) return ko('Commission introuvable.');
    if (!reason) return ko('Une validation manuelle se motive.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('validate_commission', { p_commission_id: id, p_reason: reason });
    if (error) return ko(describe(error));
    destination = done(returnPath(formData), 'COMMISSION_VALIDEE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function cancelCommission(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('commissions.manage', 'affiliation.commission.annulation');
    const id = field(formData, 'commission', 40);
    const reason = field(formData, 'reason');
    if (!UUID.test(id)) return ko('Commission introuvable.');
    if (!reason) return ko('Une annulation se motive.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('cancel_commission', { p_commission_id: id, p_reason: reason });
    if (error) return ko(describe(error));
    destination = done(returnPath(formData), 'COMMISSION_ANNULEE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function adjustCommission(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('commissions.manage', 'affiliation.commission.ajustement');
    const affiliateId = field(formData, 'affiliate', 40);
    const commissionId = field(formData, 'commission', 40);
    const amount = parseAdjustmentAmount(field(formData, 'amount', 20));
    const reason = field(formData, 'reason');
    if (!UUID.test(affiliateId) || (commissionId && !UUID.test(commissionId))) return ko('Affilié ou commission introuvable.');
    if (amount === null) return ko('Indiquez un montant en KMF, positif ou négatif, différent de zéro.');
    if (!reason) return ko('Un ajustement se motive.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('adjust_commission', {
      p_affiliate_id: affiliateId, p_commission_id: commissionId || null, p_amount: amount, p_reason: reason,
    });
    if (error) return ko(describe(error));
    destination = done(returnPath(formData), 'AJUSTEMENT');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}
