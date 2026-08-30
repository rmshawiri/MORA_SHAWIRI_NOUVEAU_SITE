"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Inscription par email + mot de passe (Supabase Auth). */
export async function signUp(
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Veuillez indiquer une adresse email valide." };
  }
  if (password.length < 8) {
    return { error: "Le mot de passe doit contenir au moins 8 caractères." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name || undefined },
    },
  });

  if (error) {
    return { error: "Impossible de créer le compte. Vérifiez vos informations." };
  }

  // Session présente = compte confirmé (auto) → connexion.
  if (data.session) {
    redirect("/");
  }

  // Sinon : un email de confirmation a été envoyé par Supabase.
  return { success: true };
}

/** Connexion par email + mot de passe. */
export async function signIn(formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Identifiants incorrects." };
  }

  // Rediriger les administrateurs vers l'administration, sinon l'espace client.
  const { getUserRoles } = await import("@/lib/rbac");
  const { isAdmin } = await getUserRoles();
  redirect(isAdmin ? "/admin" : "/");
}

/** Déconnexion. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

/** Demande de réinitialisation de mot de passe. */
export async function resetPassword(formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Veuillez indiquer une adresse email valide." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/mot-de-passe-reinitialise`,
  });
  if (error) {
    return { error: "La demande n'a pas pu être traitée." };
  }
  return {};
}

/** Définition d'un nouveau mot de passe après récupération de compte. */
export async function updatePassword(formData: FormData): Promise<{ error?: string }> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return { error: "Le mot de passe doit contenir au moins 8 caractères." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "Impossible de mettre à jour le mot de passe." };
  }
  return {};
}
