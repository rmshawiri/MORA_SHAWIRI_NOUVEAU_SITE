'use server';

/**
 * Attribution d'une affaire, prospects, codes appliqués — phase 4H-4.
 *
 * Mêmes barrières que partout : permission (refus journalisé) → validation →
 * fonction en base sous la session, qui revérifie permission, verrou des
 * attributions validées et auto-affiliation → retour par la page, avec un code
 * de résultat fermé.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
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
  if (error.code === '23505') return 'Une attribution est déjà en cours sur cette affaire, ou ce prospect est déjà reconnu.';
  const message = error.message ?? '';
  if ((error.code === '23514' || error.code === 'P0002') && message.length > 0 && message.length < 240) return message;
  return UNEXPECTED;
}

/** Page d'où vient l'acte : une liste fermée de chemins internes. */
function returnPath(formData: FormData): string {
  const value = field(formData, 'return', 200);
  return /^\/administration\/(commandes|demandes|affiliation)\/[A-Za-z0-9/_-]*$/.test(value) ? value : '/administration/affiliation/';
}

function done(path: string, result: string): string {
  revalidatePath(path);
  revalidatePath('/administration/affiliation/', 'layout');
  revalidatePath('/espace-affilie/', 'layout');
  return `${path}${path.endsWith('/') ? '' : '/'}?affiliation=${result}`;
}

export async function attributeAffair(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_attributions.manage', 'affiliation.attribution.manuelle');
    const target = field(formData, 'target', 10);
    const id = field(formData, 'id', 40);
    const affiliateId = field(formData, 'affiliate_id', 40);
    const reason = field(formData, 'reason');
    if (!['ORDER', 'REQUEST'].includes(target) || !UUID.test(id) || !UUID.test(affiliateId)) return ko('Choisissez l’affilié.');
    if (!reason) return ko('Une attribution manuelle se justifie : indiquez la preuve.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('attribute_affair', {
      p_target_type: target as 'ORDER' | 'REQUEST', p_target_id: id, p_affiliate_id: affiliateId, p_reason: reason,
    });
    if (error) return ko(describe(error));
    destination = done(returnPath(formData), 'ATTRIBUEE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function validateAttribution(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_attributions.manage', 'affiliation.attribution.validation');
    const id = field(formData, 'attribution', 40);
    if (!UUID.test(id)) return ko('Attribution introuvable.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('validate_attribution', { p_attribution_id: id });
    if (error) return ko(describe(error));
    destination = done(returnPath(formData), 'VALIDEE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function revokeAttribution(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_attributions.manage', 'affiliation.attribution.revocation');
    const id = field(formData, 'attribution', 40);
    const reason = field(formData, 'reason');
    if (!UUID.test(id)) return ko('Attribution introuvable.');
    if (!reason) return ko('Une révocation se justifie.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('revoke_attribution', { p_attribution_id: id, p_reason: reason });
    if (error) return ko(describe(error));
    destination = done(returnPath(formData), 'REVOQUEE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function applyCode(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_codes.manage', 'affiliation.code.application');
    await assertPermission('orders.update', 'affiliation.code.application');
    const orderId = field(formData, 'order', 40);
    const code = field(formData, 'code', 24).toUpperCase();
    if (!UUID.test(orderId) || !code) return ko('Indiquez le code communiqué par le client.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('apply_affiliate_code', {
      p_order_id: orderId, p_code: code, p_reason: field(formData, 'reason') || null,
    });
    if (error) return ko(describe(error));
    destination = done(returnPath(formData), 'CODE_APPLIQUE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function removeCode(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_codes.manage', 'affiliation.code.retrait');
    await assertPermission('orders.update', 'affiliation.code.retrait');
    const orderId = field(formData, 'order', 40);
    const reason = field(formData, 'reason');
    if (!UUID.test(orderId)) return ko('Commande introuvable.');
    if (!reason) return ko('Un motif est requis.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('remove_affiliate_code', { p_order_id: orderId, p_reason: reason });
    if (error) return ko(describe(error));
    destination = done(returnPath(formData), 'CODE_RETIRE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}

export async function reviewProspect(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_attributions.manage', 'affiliation.prospect.decision');
    const id = field(formData, 'prospect', 40);
    const status = field(formData, 'status', 20);
    if (!UUID.test(id) || !['A_VERIFIER', 'RECONNU', 'REFUSE'].includes(status)) return ko('Décision inconnue.');
    const reason = field(formData, 'reason') || null;
    if (status === 'REFUSE' && !reason) return ko('Un refus se motive.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { error } = await supabase.rpc('review_affiliate_prospect', {
      p_prospect_id: id, p_status: status, p_reason: reason, p_lead_email: field(formData, 'lead_email', 160) || null,
    });
    if (error) return ko(describe(error));
    destination = done(returnPath(formData), `PROSPECT_${status}`);
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}
