import 'server-only';

/**
 * Lecture des comptes administratifs, de leurs droits et des invitations.
 *
 * Tout passe par le client de session, donc par RLS. Aucune lecture n'emprunte
 * la clé à privilèges : c'est la faiblesse précise du socle abandonné, et le
 * plan § 7.3 demande qu'elle ne se reproduise pas. Si une requête ne rend rien,
 * c'est que la politique a refusé — et c'est le comportement attendu, pas un
 * incident à contourner.
 *
 * Les lectures s'appuient sur les politiques élargies par la migration 0004
 * § 10 : `admins.view` ouvre les comptes administratifs, et eux seuls. Un
 * administrateur chargé des comptes internes ne reçoit donc pas au passage
 * l'accès au fichier client.
 */

import { getServerSupabaseClient } from '@/lib/supabase/server';
import type {
  AdminInvitationRow,
  PermissionRow,
  ProfileRow,
  AuditLogRow,
} from '@/lib/supabase/types';

import type { AccountPermissionRow } from '@/lib/rbac';

/** Un compte administratif, tel que la liste l'affiche. */
export type AdministratorSummary = {
  userId: string;
  profile: ProfileRow;
  roles: string[];
  isSuperAdmin: boolean;
};

type UserRoleJoin = {
  user_id: string;
  roles: { code: string; is_admin_role: boolean } | null;
};

/**
 * Les comptes portant un rôle d'administration.
 *
 * Deux requêtes plutôt qu'une jointure imbriquée : la première établit qui est
 * administrateur, la seconde lit les profils correspondants. C'est un
 * aller-retour de plus, mais une forme de requête que PostgREST type sans
 * ambiguïté — et une liste d'administrateurs se compte en unités, pas en
 * milliers.
 */
export async function listAdministrators(): Promise<AdministratorSummary[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('user_id, roles(code, is_admin_role)');

  const rows = (roleRows ?? []) as unknown as UserRoleJoin[];

  const byUser = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.roles?.is_admin_role) continue;
    const existing = byUser.get(row.user_id) ?? [];
    existing.push(row.roles.code);
    byUser.set(row.user_id, existing);
  }

  if (byUser.size === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', [...byUser.keys()]);

  return ((profiles ?? []) as ProfileRow[])
    .map((profile) => {
      const roles = (byUser.get(profile.id) ?? []).sort();
      return {
        userId: profile.id,
        profile,
        roles,
        isSuperAdmin: roles.includes('SUPER_ADMIN'),
      };
    })
    .sort((a, b) => {
      // Les super-administrateurs d'abord : c'est la lecture qu'on cherche.
      if (a.isSuperAdmin !== b.isSuperAdmin) return a.isSuperAdmin ? -1 : 1;
      return (a.profile.username ?? '').localeCompare(b.profile.username ?? '');
    });
}

/** Un compte administratif précis, ou `null` si la politique le refuse. */
export async function getAdministrator(userId: string): Promise<AdministratorSummary | null> {
  const administrators = await listAdministrators();
  return administrators.find((entry) => entry.userId === userId) ?? null;
}

/**
 * Le catalogue complet vu depuis un compte : origine et détention de chaque
 * permission. C'est ce que la grille affiche, et ce que le formulaire renvoie.
 */
export async function getAccountPermissions(userId: string): Promise<AccountPermissionRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data } = await supabase.rpc('account_permissions', { p_user_id: userId });

  return (data ?? []) as AccountPermissionRow[];
}

/** Catalogue des permissions, pour leurs libellés et leur regroupement. */
export async function listPermissionCatalogue(): Promise<PermissionRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from('permissions')
    .select('*')
    .order('domain')
    .order('action');

  return (data ?? []) as PermissionRow[];
}

/**
 * Invitations encore ouvertes.
 *
 * Une invitation expirée n'est ni supprimée ni masquée : elle est affichée
 * comme expirée. Le § 127 demande la traçabilité, et une invitation qui
 * disparaît d'elle-même ne dit pas si elle a été acceptée ou oubliée.
 */
export async function listInvitations(): Promise<AdminInvitationRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from('admin_invitations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  return (data ?? []) as AdminInvitationRow[];
}

export type InvitationState = 'EN_ATTENTE' | 'ACCEPTEE' | 'REVOQUEE' | 'EXPIREE';

export function invitationState(row: AdminInvitationRow, now: Date = new Date()): InvitationState {
  if (row.accepted_at) return 'ACCEPTEE';
  if (row.revoked_at) return 'REVOQUEE';
  if (new Date(row.expires_at).getTime() <= now.getTime()) return 'EXPIREE';
  return 'EN_ATTENTE';
}

/**
 * Dernières actions sensibles enregistrées.
 *
 * Lecture seule, et réservée par RLS aux détenteurs de `audit.view`. La table
 * n'a aucune politique d'écriture, de modification ou de suppression : un
 * journal modifiable ne prouve rien (phase 4A § 5.4).
 */
export async function listAuditEvents(limit = 100): Promise<AuditLogRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from('audit_logs')
    .select('*')
    .order('id', { ascending: false })
    .limit(limit);

  return (data ?? []) as AuditLogRow[];
}
