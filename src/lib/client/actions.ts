'use server';

/**
 * Actions de l'espace client — phase 4I-1.
 *
 * Une seule écriture, étroite : le client met à jour son nom, son téléphone,
 * son WhatsApp et sa préférence de contact. Elle passe par
 * `update_my_client_profile`, qui identifie le compte par `auth.uid()` —
 * aucun identifiant ne vient du navigateur — et qui refuse un compte
 * suspendu, désactivé ou supprimé, en base.
 *
 * L'adresse e-mail n'est pas modifiable ici (décision 5 du 2026-10-02) :
 * c'est l'adresse d'authentification, seule source de vérité.
 */

import { revalidatePath } from 'next/cache';

import type { AdminActionState } from '@/lib/admin/actions';
import { getServerSupabaseClient } from '@/lib/supabase/server';

import { readClientProfile } from './profile';

const ko = (message: string): AdminActionState => ({ status: 'error', message });
const ok = (message: string): AdminActionState => ({ status: 'ok', message });

export async function updateMyClientProfile(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const checked = readClientProfile({
    nom: formData.get('nom'),
    telephone: formData.get('telephone'),
    whatsapp: formData.get('whatsapp'),
    memeNumero: formData.get('meme_numero'),
    preference: formData.get('preference'),
  });
  if (!checked.ok) return ko(checked.message);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible. Réessayez dans un instant.');

  const { error } = await supabase.rpc('update_my_client_profile', {
    p_full_name: checked.value.fullName,
    p_phone: checked.value.phone,
    p_whatsapp: checked.value.whatsapp,
    p_contact_preference: checked.value.contactPreference,
  });

  if (error) {
    // Les messages de la base sont rédigés pour le client (23514) ; tout le
    // reste reste générique : ni code, ni détail technique à l'écran (§ 95).
    if (error.code === '23514' && error.message.length < 200) return ko(error.message);
    if (error.code === '42501') return ko('Votre profil ne peut pas être modifié pour le moment. Contactez MORA Shawiri.');
    return ko('Votre profil n’a pas pu être enregistré. Réessayez dans un instant.');
  }

  revalidatePath('/espace-client/', 'layout');
  return ok('Votre profil est enregistré.');
}
