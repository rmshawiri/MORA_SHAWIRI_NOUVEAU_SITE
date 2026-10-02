'use server';

/**
 * Actions de l'espace affilié — phase 4H.
 *
 * Ce qu'un affilié peut faire lui-même, et rien d'autre : demander de
 * nouvelles coordonnées de versement (validées ensuite par MORA Shawiri,
 * décision J) et créer ses propres liens de campagne. Aucune ne touche un
 * taux, une commission, un versement ou une attribution.
 *
 * Les fonctions en base identifient l'affilié par `auth.uid()` : aucun
 * identifiant d'affilié ne vient du navigateur pour la demande de
 * coordonnées, et la campagne revérifie la propriété.
 */

import { revalidatePath } from 'next/cache';

import type { AdminActionState } from '@/lib/admin/actions';
import { getServerSupabaseClient } from '@/lib/supabase/server';

import { validateProspect } from './prospects';

const ko = (message: string): AdminActionState => ({ status: 'error', message });
const ok = (message: string): AdminActionState => ({ status: 'ok', message });

function field(formData: FormData, name: string, max = 200): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function requestPayoutChange(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');
  const method = field(formData, 'method', 24);
  const details: Record<string, string> = {};
  for (const key of ['numero', 'titulaire', 'banque', 'compte', 'email', 'ordre']) {
    const value = field(formData, key, 120);
    if (value) details[key] = value;
  }
  const { error } = await supabase.rpc('request_payout_account', { p_method: method, p_details: details });
  if (error) {
    if (error.code === '23514') return ko('Coordonnées incomplètes pour ce moyen de versement.');
    if (error.code === '42501') return ko('Aucune affiliation active pour ce compte.');
    return ko('Votre demande n’a pas pu être enregistrée. Réessayez dans un instant.');
  }
  revalidatePath('/espace-affilie/', 'layout');
  return ok('Votre demande est enregistrée. Vos coordonnées actuelles restent valables jusqu’à sa validation par MORA Shawiri.');
}

export async function createOwnCampaign(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');
  const label = field(formData, 'label', 80);
  const code = field(formData, 'code', 32).toLowerCase();
  if (!label || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(code) || code.length < 2) {
    return ko('Un nom de campagne, et un code en minuscules, chiffres et tirets.');
  }
  const { data: me } = await supabase.auth.getUser();
  const { data: affiliate } = await supabase
    .from('affiliates')
    .select('id')
    .eq('user_id', me.user?.id ?? '')
    .maybeSingle();
  if (!affiliate) return ko('Aucune affiliation active pour ce compte.');
  const { error } = await supabase.rpc('create_affiliate_campaign', {
    p_affiliate_id: affiliate.id,
    p_code: code,
    p_label: label,
  });
  if (error) {
    if (error.code === '23505') return ko('Vous avez déjà une campagne avec ce code.');
    return ko('La campagne n’a pas pu être créée.');
  }
  revalidatePath('/espace-affilie/', 'layout');
  return ok('Votre nouveau lien de campagne est prêt.');
}

export async function declareProspect(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');
  const draft = {
    fullName: field(formData, 'full_name', 120),
    company: field(formData, 'company', 160),
    phone: field(formData, 'phone', 40),
    email: field(formData, 'email', 160),
    need: field(formData, 'need', 1000),
    comment: field(formData, 'comment', 1000),
    consent: formData.get('consent') === '1',
  };
  const errors = validateProspect(draft);
  const first = Object.values(errors)[0];
  if (first) return ko(first);
  const { error } = await supabase.rpc('declare_affiliate_prospect', {
    p_full_name: draft.fullName,
    p_company: draft.company || null,
    p_phone: draft.phone,
    p_email: draft.email || null,
    p_need: draft.need,
    p_comment: draft.comment || null,
    p_consent: draft.consent,
  });
  if (error) {
    if (error.code === '23514' && error.message && error.message.length < 200) return ko(error.message);
    if (error.code === '54000') return ko('Trop de déclarations aujourd’hui : réessayez demain.');
    if (error.code === '42501') return ko('Seul un affilié actif peut déclarer un prospect.');
    return ko('La déclaration n’a pas pu être enregistrée.');
  }
  revalidatePath('/espace-affilie/', 'layout');
  return ok('Votre prospect est déclaré. MORA Shawiri vérifie son origine : vous suivez la décision ici.');
}

export async function cancelProspect(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');
  const id = field(formData, 'prospect', 40);
  const { error } = await supabase.rpc('cancel_affiliate_prospect', { p_prospect_id: id });
  if (error) return ko('Cette déclaration ne peut plus être annulée.');
  revalidatePath('/espace-affilie/', 'layout');
  return ok('La déclaration est annulée.');
}

/**
 * Coordonnées de contact (phase 4H-8) : téléphone, ville, pays — et rien
 * d'autre. La base identifie l'affilié par sa session, refuse une affiliation
 * terminée et journalise l'avant et l'après.
 */
export async function updateMyContact(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');
  const phone = field(formData, 'telephone', 40);
  const city = field(formData, 'ville', 80);
  const country = field(formData, 'pays', 80);
  if (phone && !/^[+0-9 ().-]{6,40}$/.test(phone)) return ko('Numéro de téléphone invalide.');
  const { error } = await supabase.rpc('update_my_affiliate_contact', { p_phone: phone, p_city: city, p_country: country });
  if (error) {
    if (error.code === '23514' && error.message.length < 200) return ko(error.message);
    if (error.code === '42501') return ko('Aucune affiliation n’est rattachée à ce compte.');
    return ko('Vos coordonnées n’ont pas pu être enregistrées. Réessayez dans un instant.');
  }
  revalidatePath('/espace-affilie/', 'layout');
  return ok('Vos coordonnées sont enregistrées.');
}
