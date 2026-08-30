"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Gestion des contenus — FAQ (CRUD serveur).
 * Toutes les opérations passent par le client à privilèges (serveur) et sont
 * protégées par la garde de rôle admin (layout /admin). Le contenu utilisateur
 * n'est jamais interprété (anti-XSS).
 */

export interface FaqInput {
  question: string;
  answer: string;
  category?: string;
  sort_order?: number;
  is_active?: boolean;
}

function validateFaq(input: FaqInput): string | null {
  if (!input.question || input.question.trim().length < 3) return "Question requise.";
  if (!input.answer || input.answer.trim().length < 5) return "Réponse requise.";
  if (input.question.length > 300) return "Question trop longue.";
  if (input.answer.length > 4000) return "Réponse trop longue.";
  return null;
}

export async function createFaq(input: FaqInput): Promise<{ success: boolean; error?: string }> {
  const err = validateFaq(input);
  if (err) return { success: false, error: err };
  const supabase = createAdminClient();
  const { error } = await supabase.from("faqs").insert({
    question: input.question.trim(),
    answer: input.answer.trim(),
    category: input.category?.trim() || null,
    sort_order: input.sort_order ?? 0,
    is_active: input.is_active ?? true,
  });
  if (error) return { success: false, error: "Impossible d'ajouter la question." };
  revalidatePath("/faq");
  revalidatePath("/admin/contenus");
  return { success: true };
}

export async function updateFaq(id: string, input: FaqInput): Promise<{ success: boolean; error?: string }> {
  const err = validateFaq(input);
  if (err) return { success: false, error: err };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("faqs")
    .update({
      question: input.question.trim(),
      answer: input.answer.trim(),
      category: input.category?.trim() || null,
      sort_order: input.sort_order ?? 0,
      is_active: input.is_active ?? true,
    })
    .eq("id", id);
  if (error) return { success: false, error: "Impossible de modifier la question." };
  revalidatePath("/faq");
  revalidatePath("/admin/contenus");
  return { success: true };
}

export async function deleteFaq(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("faqs").delete().eq("id", id);
  if (error) return { success: false, error: "Impossible de supprimer la question." };
  revalidatePath("/faq");
  revalidatePath("/admin/contenus");
  return { success: true };
}
