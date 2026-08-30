"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Marketing — codes promotionnels (CRUD). Les codes et réductions sont définis
 * par l'administrateur ; jamais inventés par le système.
 */

export interface PromoInput {
  code: string;
  discount_type: "percent" | "fixed";
  value: number;
  valid_from?: string | null;
  valid_until?: string | null;
  min_amount?: number | null;
  max_uses?: number | null;
  is_active?: boolean;
}

function validate(input: PromoInput): string | null {
  const c = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(c)) return "Code invalide (3 à 20 caractères alphanumériques).";
  if (input.discount_type === "percent" && (input.value <= 0 || input.value > 100)) return "Réduction % invalide (1–100).";
  if (input.discount_type === "fixed" && input.value <= 0) return "Montant invalide.";
  return null;
}

export async function createPromo(input: PromoInput): Promise<{ success: boolean; error?: string }> {
  const err = validate(input);
  if (err) return { success: false, error: err };
  const supabase = createAdminClient();
  const { error } = await supabase.from("promo_codes").insert({
    code: input.code.trim().toUpperCase(),
    discount_type: input.discount_type,
    value: input.value,
    valid_from: input.valid_from || null,
    valid_until: input.valid_until || null,
    min_amount: input.min_amount ?? null,
    max_uses: input.max_uses ?? null,
    is_active: input.is_active ?? true,
  });
  if (error) return { success: false, error: error.message || "Impossible d'ajouter le code." };
  revalidatePath("/admin/marketing");
  return { success: true };
}

export async function updatePromo(id: string, input: PromoInput): Promise<{ success: boolean; error?: string }> {
  const err = validate(input);
  if (err) return { success: false, error: err };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("promo_codes")
    .update({
      code: input.code.trim().toUpperCase(),
      discount_type: input.discount_type,
      value: input.value,
      valid_from: input.valid_from || null,
      valid_until: input.valid_until || null,
      min_amount: input.min_amount ?? null,
      max_uses: input.max_uses ?? null,
      is_active: input.is_active ?? true,
    })
    .eq("id", id);
  if (error) return { success: false, error: error.message || "Impossible de modifier le code." };
  revalidatePath("/admin/marketing");
  return { success: true };
}

export async function deletePromo(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("promo_codes").delete().eq("id", id);
  if (error) return { success: false, error: "Impossible de supprimer le code." };
  revalidatePath("/admin/marketing");
  return { success: true };
}
