import { createClient } from "@/lib/supabase/server";

/**
 * RBAC — contrôle d'accès basé sur les rôles (table `roles` + `user_roles`).
 * Les permissions sont vérifiées CÔTÉ SERVEUR ; masquer un bouton n'est pas
 * une protection. Les rôles admin : 'ADMIN' et 'SUPER_ADMIN'.
 */

export const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

export interface UserRoleInfo {
  roles: string[];
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

/** Rôles de l'utilisateur courant (liste de rôles) — vide si non connecté. */
export async function getUserRoles(): Promise<UserRoleInfo> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { roles: [], isAdmin: false, isSuperAdmin: false };

  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.user.id);

  const roles = ((data ?? []) as Array<{ roles: { name: string } | { name: string }[] | null }>)
    .flatMap((r) => {
      const value = r.roles as { name: string } | { name: string }[] | null;
      if (!value) return [];
      return Array.isArray(value) ? value.map((x) => x.name) : [value.name];
    })
    .filter(Boolean);

  return {
    roles,
    isAdmin: roles.some((r) => ADMIN_ROLES.includes(r)),
    isSuperAdmin: roles.includes("SUPER_ADMIN"),
  };
}

/** Le rôle d'un utilisateur par son id (utilisé côté serveur pour les actions). */
export async function userHasRole(userId: string, roleName: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId)
    .limit(20);
  if (!data || data.length === 0) return false;
  const { data: roleRows } = await supabase
    .from("roles")
    .select("id")
    .eq("name", roleName);
  const roleIds = new Set((roleRows ?? []).map((r) => r.id));
  return data.some((r) => roleIds.has(r.role_id));
}
