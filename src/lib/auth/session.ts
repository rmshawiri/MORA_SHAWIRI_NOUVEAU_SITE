import 'server-only';

/**
 * État d'authentification du compte connecté, établi côté serveur.
 *
 * C'est le **niveau 2** de l'architecture de sécurité posée en phase 4A :
 *
 *   1. session / middleware — confort de navigation, jamais une protection ;
 *   2. serveur — la barrière réelle : identité, rôle, permission, propriété ;
 *   3. PostgreSQL / RLS — le dernier filet.
 *
 * Rien n'est déduit d'un cookie lu tel quel. L'identité est vérifiée auprès du
 * serveur d'authentification, le profil et les rôles sont lus **sous RLS** par
 * le client de session — jamais par la clé à privilèges, qui contournerait la
 * troisième barrière et reproduirait la faiblesse du socle abandonné.
 *
 * ## Le niveau d'assurance
 *
 * Supabase Auth inscrit dans le jeton un niveau d'assurance : `aal1` après un
 * mot de passe, `aal2` après un second facteur. C'est cette valeur qui décide
 * de l'accès à l'administration. Elle est lue dans les **claims vérifiés**
 * (`getClaims()`), non dans une charge utile décodée localement : un cookie
 * forgé ne franchit pas cette étape.
 *
 * Exigence : § 2 du cadrage — « Le contrôle doit être appliqué côté serveur et
 * pas uniquement dans l'interface. »
 */

import { cache } from 'react';
import type { Factor, User } from '@supabase/supabase-js';

import { ADMIN_ROLES, type RoleCode } from '@/lib/rbac/catalogue';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { ProfileRow } from '@/lib/supabase/types';

import type { AccessSnapshot, AssuranceLevel } from './access';
import { isAdminMfaRequired } from './settings';

export type { AccessObstacle, AccessSnapshot, AssuranceLevel } from './access';
export {
  adminAccessObstacle,
  canRemoveFactor,
  factorManagementObstacle,
  mfaIsRequiredFor,
  privateAccessObstacle,
} from './access';

export type EnrolledFactor = {
  id: string;
  friendlyName: string | null;
  createdAt: string | null;
};

/**
 * Tout ce que le serveur sait du compte connecté.
 *
 * Satisfait `AccessSnapshot` : les règles pures d'`access.ts` s'appliquent donc
 * directement, sans conversion.
 */
export type AuthContext = AccessSnapshot & {
  userId: string;
  email: string | null;
  profile: ProfileRow;
  roles: RoleCode[];
  /** Facteurs TOTP vérifiés. Un facteur enrôlé mais non confirmé n'y figure pas. */
  totpFactors: EnrolledFactor[];
};

/**
 * Charge l'état complet du compte connecté, ou `null`.
 *
 * Renvoie `null` — donc « visiteur anonyme » — dans cinq cas : aucune session,
 * jeton invalide, profil absent, compte non actif, compte supprimé
 * logiquement. Les § 33 à 35 de l'authentification demandent exactement cela :
 * un compte désactivé, suspendu ou supprimé ne doit plus rien pouvoir.
 *
 * Mémoïsé pour la durée de la requête : le garde, le rendu et parfois une
 * action consultent le même contexte.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  // `getUser()` interroge le serveur d'authentification ; `getSession()` se
  // contenterait de relire le cookie, ce que le § 3 interdit.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const user = userData.user;

  const [profileResult, rolesResult, assuranceLevel, adminMfaRequired] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('user_roles').select('roles(code)').eq('user_id', user.id),
    readAssuranceLevel(supabase),
    isAdminMfaRequired(),
  ]);

  const profile = (profileResult.data as ProfileRow | null) ?? null;

  if (!profile || profile.status !== 'ACTIF' || profile.deleted_at !== null) {
    return null;
  }

  const roles = (rolesResult.data ?? [])
    .map((row) => (row as { roles: { code: string } | null }).roles?.code)
    .filter((code): code is RoleCode => typeof code === 'string');

  const totpFactors = verifiedTotpFactors(user);

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    roles,
    isAdmin: roles.some((role) => (ADMIN_ROLES as readonly string[]).includes(role)),
    mustChangePassword: profile.must_change_password,
    adminMfaRequired,
    assuranceLevel,
    totpFactorCount: totpFactors.length,
    totpFactors,
  };
});

/**
 * Facteurs TOTP **vérifiés** portés par le compte.
 *
 * Le filtre sur `status === 'verified'` est le point important : un facteur
 * enrôlé mais jamais confirmé ne protège rien. Le compter reviendrait à croire
 * un administrateur protégé alors qu'il a abandonné l'enrôlement à mi-chemin.
 */
function verifiedTotpFactors(user: User): EnrolledFactor[] {
  const factors: Factor[] = user.factors ?? [];

  return factors
    .filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified')
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name ?? null,
      createdAt: factor.created_at ?? null,
    }));
}

/**
 * Niveau d'assurance porté par le jeton, lu dans les claims vérifiés.
 *
 * Toute valeur inattendue est ramenée à `aal1` : en matière d'autorisation,
 * l'inconnu vaut le moins-disant.
 */
async function readAssuranceLevel(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerSupabaseClient>>>,
): Promise<AssuranceLevel> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return 'aal1';

    return data.claims?.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return 'aal1';
  }
}

/**
 * Destination naturelle après une authentification complète.
 * Relève du confort ; ne remplace aucun contrôle.
 */
export function landingFor(context: AuthContext): 'admin' | 'client' {
  return context.isAdmin ? 'admin' : 'client';
}
