import 'server-only';

/**
 * Lecture des décisions d'authentification enregistrées en base.
 *
 * La phase 4A a créé deux paramètres pour que ces arbitrages puissent changer
 * sans modification de code (`09_ADMINISTRATION/10_PARAMETRES.md` § 32-34) :
 *
 *   * `auth.public_registration_enabled` — décision D-9 ;
 *   * `auth.admin_mfa_required`          — décision D-12.
 *
 * Tous deux sont de portée `PRIVE` : ni un visiteur anonyme ni un client ne
 * peuvent les lire. Leur lecture passe donc par la clé à privilèges, ce qui est
 * l'usage « tâche serveur sans utilisateur » prévu par `src/lib/supabase/admin.ts`.
 *
 * **Valeurs de repli.** Lorsqu'un paramètre est illisible — base injoignable,
 * clé absente —, le code ne suppose jamais la position la plus permissive :
 *
 *   * l'inscription publique est réputée **fermée** (§ 106 des rôles et
 *     permissions : refus par défaut) ;
 *   * le second facteur administrateur est réputé **obligatoire**.
 *
 * Une panne ne doit jamais ouvrir une porte.
 */

import { cache } from 'react';

import { getAdminSupabaseClient } from '@/lib/supabase/admin';

export const AUTH_SETTING_KEYS = {
  publicRegistration: 'auth.public_registration_enabled',
  adminMfaRequired: 'auth.admin_mfa_required',
} as const;

type AuthSettingKey = (typeof AUTH_SETTING_KEYS)[keyof typeof AUTH_SETTING_KEYS];

/**
 * Lit un paramètre booléen.
 *
 * Mémoïsé pour la durée de la requête : une page privée consulte la même valeur
 * depuis son garde, son rendu et parfois une action. Une seule lecture suffit.
 */
const readBooleanSetting = cache(
  async (key: AuthSettingKey, fallback: boolean): Promise<boolean> => {
    const client = getAdminSupabaseClient();
    if (!client) return fallback;

    try {
      const { data, error } = await client
        .from('settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();

      if (error || !data) return fallback;

      return data.value === true;
    } catch {
      return fallback;
    }
  },
);

/** Décision D-9. Fermée par défaut. */
export function isPublicRegistrationEnabled(): Promise<boolean> {
  return readBooleanSetting(AUTH_SETTING_KEYS.publicRegistration, false);
}

/** Décision D-12. Obligatoire par défaut. */
export function isAdminMfaRequired(): Promise<boolean> {
  return readBooleanSetting(AUTH_SETTING_KEYS.adminMfaRequired, true);
}
