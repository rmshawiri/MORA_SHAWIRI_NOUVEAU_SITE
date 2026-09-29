import 'server-only';

/**
 * Lecture serveur des droits effectifs du compte connecté.
 *
 * La phase 4A avait posé la lecture ; la phase 4C y ajoute ce qui manquait :
 * les **ajustements individuels** (décision D-18), et des gardes réutilisables
 * par toutes les pages d'administration à venir (`./guards`).
 *
 * Toutes les lectures passent par le client de session, donc par RLS. La clé
 * secrète n'est jamais utilisée ici : c'est précisément la faiblesse du socle
 * précédent que le plan demande de corriger.
 *
 * ## Deux calculs, volontairement
 *
 * Les permissions effectives sont calculées **en base** par
 * `public.current_permissions()`, et **en TypeScript** par
 * `effectivePermissions()`. Ce n'est pas une duplication accidentelle : la base
 * est la source de vérité que lisent les politiques RLS, et l'application doit
 * pouvoir expliquer à l'écran d'où vient chaque droit — ce qu'une liste plate
 * ne permet pas.
 *
 * Les deux doivent rendre le même résultat, et c'est vérifié plutôt
 * qu'espéré : `getCurrentAccess()` compare les deux et signale l'écart, et
 * `scripts/verify-permissions.mjs` rejoue la comparaison contre la vraie base.
 */

import { cache } from 'react';

import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { ProfileRow } from '@/lib/supabase/types';

import { FULL_ACCESS, isPermission, type Permission, type RoleCode } from './catalogue';
import {
  allows,
  allowsAll,
  allowsAny,
  effectivePermissions,
  permissionOrigin,
  type PermissionAdjustment,
  type PermissionInputs,
} from './effective';

export * from './catalogue';
export * from './effective';
export * from './modules';

/** Une ligne de `public.account_permissions()` : une permission, son origine. */
export type AccountPermissionRow = {
  code: string;
  from_role: boolean;
  effect: 'OCTROI' | 'RETRAIT' | null;
  effective: boolean;
};

/** Droits effectifs du compte connecté, et ce qui explique chacun d'eux. */
export type CurrentAccess = {
  userId: string;
  profile: ProfileRow | null;
  roles: RoleCode[];
  /** Permissions réellement détenues, après octrois et retraits. */
  permissions: string[];
  /** Ce que les rôles accordent, avant ajustement. */
  fromRoles: string[];
  /** Octrois et retraits posés nominativement sur ce compte. */
  adjustments: PermissionAdjustment[];
  /**
   * Vrai si le calcul applicatif et celui de la base ont divergé. Ne devrait
   * jamais arriver ; si cela arrive, c'est la base qui fait foi et l'écart est
   * journalisé plutôt que masqué.
   */
  divergence: boolean;
};

/**
 * Charge l'identité, les rôles, les ajustements et les permissions effectives.
 *
 * Renvoie `null` si personne n'est connecté, si Supabase n'est pas configuré,
 * ou si le profil n'est pas actif. Un compte suspendu ou désactivé est traité
 * exactement comme un visiteur anonyme (§ 33-34 de l'authentification).
 *
 * Mémoïsé pour la durée de la requête : la barre latérale, la page et souvent
 * une action consultent le même état.
 */
export const getCurrentAccess = cache(async (): Promise<CurrentAccess | null> => {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const userId = userData.user.id;

  const [profileResult, rolesResult, catalogueResult, permissionsResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('user_roles').select('roles(code)').eq('user_id', userId),
    supabase.rpc('account_permissions', { p_user_id: userId }),
    supabase.rpc('current_permissions'),
  ]);

  const profile = (profileResult.data as ProfileRow | null) ?? null;

  if (!profile || profile.status !== 'ACTIF' || profile.deleted_at !== null) {
    return null;
  }

  const roles = (rolesResult.data ?? [])
    .map((row) => (row as { roles: { code: string } | null }).roles?.code)
    .filter((code): code is RoleCode => typeof code === 'string');

  const catalogue = (catalogueResult.data ?? []) as AccountPermissionRow[];

  const fromRoles = catalogue
    .filter((row) => row.from_role && isPermission(row.code))
    .map((row) => row.code)
    .sort();

  const adjustments = catalogue.flatMap((row): PermissionAdjustment[] => {
    if (!row.effect || !isPermission(row.code)) return [];
    return [{ permission: row.code, effect: row.effect === 'RETRAIT' ? 'RETRAIT' : 'OCTROI' }];
  });

  const computed = effectivePermissions({ fromRoles, adjustments });

  // La base fait foi. Le calcul applicatif sert à expliquer, pas à décider.
  const fromDatabase = Array.isArray(permissionsResult.data)
    ? [...(permissionsResult.data as string[])].sort()
    : null;

  const divergence = fromDatabase !== null && fromDatabase.join('|') !== computed.join('|');

  return {
    userId,
    profile,
    roles,
    permissions: fromDatabase ?? computed,
    fromRoles,
    adjustments,
    divergence,
  };
});

/** Les trois faits dont dépend le calcul, extraits d'un accès chargé. */
export function inputsOf(access: CurrentAccess): PermissionInputs {
  return { fromRoles: access.fromRoles, adjustments: access.adjustments };
}

/** D'où vient ce droit, pour ce compte : rôle, octroi, retrait, ou rien. */
export function originOf(access: CurrentAccess, permission: Permission) {
  return permissionOrigin(inputsOf(access), permission);
}

/**
 * Vérifie une permission côté serveur, contre la base.
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

/** Tranche sans nouvel aller-retour, à partir d'un accès déjà chargé. */
export function accessAllows(access: CurrentAccess, permission: Permission): boolean {
  return allows(access.permissions, permission);
}

export function accessAllowsAll(
  access: CurrentAccess,
  permissions: readonly Permission[],
): boolean {
  return allowsAll(access.permissions, permissions);
}

export function accessAllowsAny(
  access: CurrentAccess,
  permissions: readonly Permission[],
): boolean {
  return allowsAny(access.permissions, permissions);
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
