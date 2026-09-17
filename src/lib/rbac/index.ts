import 'server-only';

/**
 * Lecture serveur des droits du compte connecté.
 *
 * Portée volontairement restreinte à la phase 4A : lire l'identité, les rôles
 * et les permissions effectives. Les gardes de route (`requirePermission()`,
 * vérification de propriété de ressource) relèvent de la phase 4C, en même
 * temps que la coquille d'administration qui les consommera.
 *
 * Toutes les lectures passent par le client de session, donc par RLS. La clé
 * secrète n'est jamais utilisée ici : c'est précisément la faiblesse du socle
 * précédent que le plan demande de corriger.
 */

import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { ProfileRow } from '@/lib/supabase/types';

import { FULL_ACCESS, type Permission, type RoleCode } from './catalogue';

export * from './catalogue';

/** Droits effectifs du compte connecté. */
export type CurrentAccess = {
  userId: string;
  profile: ProfileRow | null;
  roles: RoleCode[];
  permissions: string[];
};

/**
 * Charge l'identité, les rôles et les permissions du compte connecté.
 *
 * Renvoie `null` si personne n'est connecté, si Supabase n'est pas configuré,
 * ou si le profil n'est pas actif. Un compte suspendu ou désactivé est traité
 * exactement comme un visiteur anonyme (§ 33-34 de l'authentification).
 */
export async function getCurrentAccess(): Promise<CurrentAccess | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const userId = userData.user.id;

  const [profileResult, rolesResult, permissionsResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('user_roles').select('roles(code)').eq('user_id', userId),
    supabase.rpc('current_permissions'),
  ]);

  const profile = (profileResult.data as ProfileRow | null) ?? null;

  if (!profile || profile.status !== 'ACTIF' || profile.deleted_at !== null) {
    return null;
  }

  const roles = (rolesResult.data ?? [])
    .map((row) => (row as { roles: { code: string } | null }).roles?.code)
    .filter((code): code is RoleCode => typeof code === 'string');

  const permissions = Array.isArray(permissionsResult.data)
    ? (permissionsResult.data as string[])
    : [];

  return { userId, profile, roles, permissions };
}

/**
 * Vérifie une permission côté serveur.
 *
 * Deux barrières se superposent volontairement : la base tranche via
 * `public.has_permission()`, l'application relit le même résultat. Aucune
 * décision ne repose sur une information venue du navigateur.
 */
export async function hasPermission(permission: Permission): Promise<boolean> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return false;

  const { data, error } = await supabase.rpc('has_permission', { p_permission: permission });
  if (error) return false;

  return data === true;
}

/** Vrai si le compte connecté détient la permission globale (§ 45). */
export async function hasFullAccess(): Promise<boolean> {
  return hasPermission(FULL_ACCESS);
}

/**
 * Vrai si le compte connecté porte un rôle d'administration actif.
 * Ne dispense jamais d'un contrôle de permission sur l'action elle-même.
 */
export async function isAdmin(): Promise<boolean> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return false;

  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;

  return data === true;
}

/**
 * Journalise une action sensible.
 *
 * L'auteur est déterminé par la base à partir de la session : il ne peut donc
 * pas être falsifié par l'appelant. Les métadonnées ne doivent contenir aucun
 * secret — la base refuse l'enregistrement le cas échéant.
 */
export async function recordAuditEvent(input: {
  action: string;
  resourceType?: string;
  resourceId?: string;
  result?: 'SUCCES' | 'REFUS' | 'ECHEC';
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return false;

  const { error } = await supabase.rpc('record_audit_event', {
    p_action: input.action,
    p_resource_type: input.resourceType ?? null,
    p_resource_id: input.resourceId ?? null,
    p_result: input.result ?? 'SUCCES',
    p_metadata: (input.metadata ?? {}) as never,
  });

  return !error;
}
