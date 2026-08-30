"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Paramètres globaux du site (table `settings`).
 * Les secrets ne sont jamais stockés ici. Les valeurs sont jsonb.
 */

const PUBLIC_KEYS = [
  "site_name",
  "site_slogan",
  "site_url",
  "site_email",
  "site_phone",
  "site_whatsapp",
  "site_address",
] as const;

export interface SettingsInput {
  site_name?: string;
  site_slogan?: string;
  site_url?: string;
  site_email?: string;
  site_phone?: string;
  site_whatsapp?: string;
  site_address?: string;
}

export async function updateSettings(input: SettingsInput): Promise<{ success: boolean; error?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { success: false, error: "La configuration n'est pas disponible." };
  }
  const supabase = createAdminClient();
  const rows = Object.entries(input)
    .filter(([k]) => (PUBLIC_KEYS as readonly string[]).includes(k))
    .filter(([, v]) => v != null)
    .map(([key, value]) => ({
      id: key,
      // Le client envoie des chaînes ; on les stocke comme valeur JSON (chaîne).
      value: JSON.stringify(String(value).trim()),
      is_public: key !== "site_url" ? true : true,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return { success: false, error: "Aucun paramètre à enregistrer." };

  const { error } = await supabase.from("settings").upsert(rows, { onConflict: "id" });
  if (error) return { success: false, error: error.message || "Impossible d'enregistrer." };

  revalidatePath("/");
  revalidatePath("/admin/parametres");
  return { success: true };
}
