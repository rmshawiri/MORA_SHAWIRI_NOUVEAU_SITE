"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Affiliation — espace affilié.
 * Le taux est fixé côté serveur par `commission_rules` (10/15/20 %) ; le client
 * ne peut jamais imposer son taux. Un affilié ne voit que ses propres données.
 */

export interface BecomeAffiliateInput {
  category: "particulier" | "influenceur" | "equipe";
  /** Informations nécessaires au paiement des commissions (facultatif V1). */
  phone?: string;
}

export interface BecomeAffiliateResult {
  success: boolean;
  error?: string;
  code?: string;
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `MRA-${out}`;
}

export async function becomeAffiliate(
  input: BecomeAffiliateInput,
): Promise<BecomeAffiliateResult> {
  if (!["particulier", "influenceur", "equipe"].includes(input.category)) {
    return { success: false, error: "Catégorie d'affilié invalide." };
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { success: false, error: "L'affiliation n'est pas encore configurée." };
  }

  try {
    const supabase = createAdminClient();
    const user = await (async () => {
      const sc = await createClient();
      const { data } = await sc.auth.getUser();
      return data.user;
    })();
    if (!user) return { success: false, error: "Vous devez être connecté." };

    // Déjà affilié ? Retourner le code existant.
    const { data: existing } = await supabase
      .from("affiliates")
      .select("code")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing?.code) return { success: true, code: existing.code };

    // Générer un code unique.
    let code = generateCode();
    for (let i = 0; i < 5; i++) {
      const { data } = await supabase.from("affiliates").select("code").eq("code", code).maybeSingle();
      if (!data) break;
      code = generateCode();
    }

    const { error } = await supabase.from("affiliates").insert({
      user_id: user.id,
      category: input.category,
      code,
      status: "pending",
    });
    if (error) return { success: false, error: "Impossible de créer votre compte affilié." };

    return { success: true, code };
  } catch {
    return { success: false, error: "Une erreur est survenue." };
  }
}
