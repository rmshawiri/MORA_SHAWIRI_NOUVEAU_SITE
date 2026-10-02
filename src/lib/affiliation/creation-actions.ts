'use server';

/**
 * Ajout direct d'un affilié par l'administration — correctif de clôture 4H.
 *
 * Deux actes, sous `affiliates.create` (journalisée en cas de refus), revérifiée
 * par chaque fonction de la base :
 *
 *   1. `checkAffiliateEmail` — ce qui existe déjà pour l'adresse : compte,
 *      client, fiche affilié, candidature en cours. Rien n'est écrit ;
 *   2. `createAffiliateAction` — la fiche « en préparation », origine
 *      ADMINISTRATION, par `create_affiliate`, qui refuse les doublons ; un
 *      index unique sur l'adresse les refuse encore, même en cas de double
 *      envoi.
 *
 * **Aucun compte n'est créé ici.** Comme pour une candidature acceptée, le
 * compte est retrouvé — ou créé — à l'activation, par `activateAffiliate`.
 * Aucune candidature n'est fabriquée : l'origine est enregistrée telle quelle.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { AffiliateCreationCheck } from '@/lib/supabase/types-affiliation';

export type AffiliateCheckState = AdminActionState & { check?: AffiliateCreationCheck };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const DENIED = 'Ajouter un affilié exige la permission affiliates.create.';
const UNEXPECTED = 'L’opération n’a pas abouti. Réessayez dans un instant.';

function field(formData: FormData, name: string, max = 200): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function checkAffiliateEmail(
  _previous: AffiliateCheckState,
  formData: FormData,
): Promise<AffiliateCheckState> {
  try {
    await assertPermission('affiliates.create', 'affiliation.affilie.verification');
  } catch (error) {
    return { status: 'error', message: error instanceof PermissionDenied ? DENIED : UNEXPECTED };
  }
  const email = field(formData, 'email', 254).toLowerCase();
  if (!EMAIL.test(email)) return { status: 'error', message: 'Saisissez une adresse e-mail valide.' };

  const supabase = await getServerSupabaseClient();
  if (!supabase) return { status: 'error', message: 'La base de données est momentanément indisponible.' };
  const { data, error } = await supabase.rpc('affiliate_creation_check', { p_email: email });
  if (error || !data) return { status: 'error', message: error?.code === '42501' ? DENIED : UNEXPECTED };
  return { status: 'ok', message: '', check: data };
}

export async function createAffiliateAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliates.create', 'affiliation.affilie.ajout');

    const email = field(formData, 'email', 254).toLowerCase();
    const name = field(formData, 'display_name', 120);
    const party = field(formData, 'party_type', 20);
    const category = field(formData, 'category_id', 40);
    const signed = field(formData, 'contract_signed_on', 10);
    if (!EMAIL.test(email)) return { status: 'error', message: 'Adresse e-mail invalide.' };
    if (name.length < 2) return { status: 'error', message: 'Le nom de l’affilié est requis.' };
    if (party !== 'PERSONNE' && party !== 'ORGANISATION') return { status: 'error', message: 'Choisissez la nature : personne ou organisation.' };
    if (!UUID.test(category)) return { status: 'error', message: 'Choisissez une catégorie.' };
    if (signed && !DATE.test(signed)) return { status: 'error', message: 'Date de signature invalide.' };

    const supabase = await getServerSupabaseClient();
    if (!supabase) return { status: 'error', message: 'La base de données est momentanément indisponible.' };

    const { data, error } = await supabase.rpc('create_affiliate', {
      p_display_name: name,
      p_party_type: party,
      p_legal_name: field(formData, 'legal_name', 160) || null,
      p_email: email,
      p_phone: field(formData, 'contact_phone', 40) || null,
      p_country: field(formData, 'country', 80) || null,
      p_city: field(formData, 'city', 80) || null,
      p_category_id: category,
      p_contract_reference: field(formData, 'contract_reference', 80) || null,
      p_contract_signed_on: signed || null,
      p_reason: field(formData, 'reason', 1000) || null,
    });
    if (error || !data) {
      if (error?.code === '42501') return { status: 'error', message: DENIED };
      // L'index unique sur l'adresse : un second envoi, ou une fiche créée entre-temps.
      if (error?.code === '23505') return { status: 'error', message: 'Une fiche affilié existe déjà pour cette adresse.' };
      if (error?.code === '23514' && error.message.length < 240) return { status: 'error', message: error.message };
      return { status: 'error', message: UNEXPECTED };
    }

    revalidatePath('/administration/affiliation/', 'layout');
    destination = `/administration/affiliation/affilies/${data.id}/?resultat=CREE`;
  } catch (error) {
    if (error instanceof PermissionDenied) return { status: 'error', message: DENIED };
    console.error('[affiliation] ajout direct impossible');
    return { status: 'error', message: UNEXPECTED };
  }
  redirect(destination);
}
