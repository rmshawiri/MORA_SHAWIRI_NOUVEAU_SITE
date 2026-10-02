/**
 * Profil client — règles pures (phase 4I-1).
 *
 * Les mêmes règles que `update_my_client_profile` en base : l'écran les
 * applique pour répondre vite et clairement, la base les applique pour de
 * bon. Aucun accès réseau ici : testable unitairement.
 */

import type { ContactPreference } from '@/lib/supabase/types-client';

export const CONTACT_PREFERENCES: readonly ContactPreference[] = ['WHATSAPP', 'TELEPHONE', 'EMAIL'];

export const CONTACT_PREFERENCE_LABELS: Record<ContactPreference, string> = {
  WHATSAPP: 'WhatsApp',
  TELEPHONE: 'Téléphone',
  EMAIL: 'E-mail',
};

export function isContactPreference(value: unknown): value is ContactPreference {
  return typeof value === 'string' && (CONTACT_PREFERENCES as readonly string[]).includes(value);
}

/** Même motif que la base (`clients_whatsapp_format`, `update_my_client_profile`). */
export const PHONE_PATTERN = /^[+0-9 ().-]{6,40}$/;

export type ClientProfileInput = {
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  contactPreference: ContactPreference | null;
};

export type ClientProfileCheck = { ok: true; value: ClientProfileInput } | { ok: false; message: string };

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed === '' ? null : trimmed;
}

/**
 * Lit et vérifie le formulaire. `sameAsPhone` : la case « Mon WhatsApp est
 * mon numéro de téléphone » recopie le téléphone — le numéro est alors
 * enregistré explicitement, jamais deviné plus tard.
 */
export function readClientProfile(raw: {
  nom: unknown;
  telephone: unknown;
  whatsapp: unknown;
  memeNumero: unknown;
  preference: unknown;
}): ClientProfileCheck {
  const fullName = clean(raw.nom, 120);
  const phone = clean(raw.telephone, 40);
  const sameAsPhone = raw.memeNumero === 'on' || raw.memeNumero === true;
  const whatsapp = sameAsPhone ? phone : clean(raw.whatsapp, 40);
  const preferenceRaw = clean(raw.preference, 20);

  if (!fullName || fullName.length < 2) return { ok: false, message: 'Indiquez votre nom (2 à 120 caractères).' };
  if (phone && !PHONE_PATTERN.test(phone)) return { ok: false, message: 'Numéro de téléphone invalide.' };
  if (sameAsPhone && !phone) {
    return { ok: false, message: 'Indiquez votre numéro de téléphone pour l’utiliser aussi sur WhatsApp.' };
  }
  if (whatsapp && !PHONE_PATTERN.test(whatsapp)) return { ok: false, message: 'Numéro WhatsApp invalide.' };
  if (preferenceRaw && !isContactPreference(preferenceRaw)) {
    return { ok: false, message: 'Préférence de contact inconnue.' };
  }
  const contactPreference = preferenceRaw && isContactPreference(preferenceRaw) ? preferenceRaw : null;
  if (contactPreference === 'WHATSAPP' && !whatsapp) {
    return { ok: false, message: 'Indiquez votre numéro WhatsApp pour être contacté par WhatsApp.' };
  }
  if (contactPreference === 'TELEPHONE' && !phone) {
    return { ok: false, message: 'Indiquez votre numéro de téléphone pour être contacté par téléphone.' };
  }

  return { ok: true, value: { fullName, phone, whatsapp, contactPreference } };
}

/** Premier mot du nom, pour la salutation. Jamais inventé : `null` sans nom. */
export function greetingName(fullName: string | null | undefined): string | null {
  const first = (fullName ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}
