import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Affiliation — attribution & calcul des commissions (côté serveur).
 * Le taux provient de `commission_rules` (10/15/20 %), jamais du client.
 * Règle : taux appliqué = min(taux de la catégorie de l'affilié, plafond du
 * service). Aucun plafond par service n'étant documenté, on utilise le taux de
 * la catégorie. La commission porte sur le montant réellement encaissé.
 */

export interface AffiliateInfo {
  affiliateId: string;
  category: "particulier" | "influenceur" | "equipe";
  rate: number;
  code: string;
}

/** Retrouve l'affilié actif par son code (via le client à privilèges). */
export async function getAffiliateByCode(code: string): Promise<AffiliateInfo | null> {
  if (!code) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("affiliates")
    .select("id, category, code")
    .eq("code", code)
    .eq("status", "active")
    .maybeSingle();

  if (!data) return null;

  const { data: rule } = await supabase
    .from("commission_rules")
    .select("rate")
    .eq("category", data.category)
    .maybeSingle();

  return {
    affiliateId: data.id,
    category: data.category,
    rate: rule ? Number(rule.rate) : 0,
    code: data.code,
  };
}

/** Taux applicable (min(taux catégorie, plafond service)). */
export function resolveRate(categoryRate: number, serviceCap: number | null): number {
  if (serviceCap != null && serviceCap > 0) return Math.min(categoryRate, serviceCap);
  return categoryRate;
}

/** Montant arrondi d'une commission (KMF, sans décimales). */
export function commissionAmount(baseAmount: number, rate: number): number {
  return Math.round(baseAmount * rate);
}

/** Formate un taux (0.15 -> "15 %"). */
export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)} %`;
}
