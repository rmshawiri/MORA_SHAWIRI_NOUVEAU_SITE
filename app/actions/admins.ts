"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Création d'un administrateur — action PRIVILÉGIÉE.
 * ⚠️ Réservée à un SUPER_ADMIN (permis critique, vérifié côté serveur).
 * Aucun admin ne peut s'attribuer lui-même des permissions supérieures.
 */

export interface CreateAdminInput {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "SUPER_ADMIN";
}

export interface CreateAdminResult {
  success: boolean;
  error?: string;
}

export async function createAdmin(input: CreateAdminInput): Promise<CreateAdminResult> {
  // Vérification serveur de l'auteur (SUPER_ADMIN).
  const caller = await (async () => {
    const sc = await createClient();
    const { data } = await sc.auth.getUser();
    return data.user;
  })();
  if (!caller) return { success: false, error: "Vous devez être connecté." };

  try {
    const supabase = createAdminClient();
    const { data: roles } = await supabase.from("roles").select("id,name");
    const roleId = (roles ?? []).find((r) => r.name === input.role)?.id;
    if (!roleId) return { success: false, error: "Rôle introuvable." };

    // L'auteur doit être SUPER_ADMIN (contrôle de permission).
    const { data: callerRoles } = await supabase
      .from("user_roles")
      .select("roles(name)")
      .eq("user_id", caller.id);
    const names = (callerRoles ?? [])
      .flatMap((r: { roles?: { name: string } | { name: string }[] | null }) => {
        const v = r.roles as { name: string } | { name: string }[] | null;
        if (!v) return [];
        return Array.isArray(v) ? v.map((x) => x.name) : [v.name];
      });
    if (!names.includes("SUPER_ADMIN")) {
      return { success: false, error: "Seul un SUPER_ADMIN peut créer un administrateur." };
    }

    const email = input.email.trim().toLowerCase();
    const password = input.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, error: "Email invalide." };
    if (password.length < 8) return { success: false, error: "Mot de passe trop court (min. 8)." };

    // Créer l'utilisateur Auth (confirmé).
    const { data: created, error: err } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: input.name.trim() },
    });
    if (err) {
      return { success: false, error: "Impossible de créer le compte (email peut-être déjà utilisé)." };
    }
    const userId = created.user.id;

    // Profil + rôle.
    await supabase.from("profiles").upsert(
      { id: userId, email, username: email.split("@")[0], status: "active" },
      { onConflict: "id" },
    );
    await supabase.from("user_roles").upsert(
      { user_id: userId, role_id: roleId },
      { onConflict: "user_id,role_id" },
    );

    return { success: true };
  } catch {
    return { success: false, error: "Une erreur est survenue." };
  }
}
