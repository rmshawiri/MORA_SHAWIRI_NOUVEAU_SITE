"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PopupInput {
  title: string;
  content?: string | null;
  type?: "banner" | "modal" | "announcement";
  is_active?: boolean;
  priority?: number;
  target_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  frequency?: string | null;
}

function validate(input: PopupInput): string | null {
  if (!input.title || input.title.trim().length < 2) return "Titre requis.";
  return null;
}

export async function createPopup(input: PopupInput): Promise<{ success: boolean; error?: string }> {
  const err = validate(input);
  if (err) return { success: false, error: err };
  const supabase = createAdminClient();
  const { error } = await supabase.from("popups").insert({
    title: input.title.trim(),
    content: input.content || null,
    type: input.type ?? "banner",
    is_active: input.is_active ?? false,
    priority: input.priority ?? 0,
    target_url: input.target_url || null,
    starts_at: input.starts_at || null,
    ends_at: input.ends_at || null,
    frequency: input.frequency || null,
  });
  if (error) return { success: false, error: error.message || "Impossible d'ajouter le popup." };
  revalidatePath("/admin/popups");
  return { success: true };
}

export async function updatePopup(id: string, input: PopupInput): Promise<{ success: boolean; error?: string }> {
  const err = validate(input);
  if (err) return { success: false, error: err };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("popups")
    .update({
      title: input.title.trim(),
      content: input.content || null,
      type: input.type ?? "banner",
      is_active: input.is_active ?? false,
      priority: input.priority ?? 0,
      target_url: input.target_url || null,
      starts_at: input.starts_at || null,
      ends_at: input.ends_at || null,
      frequency: input.frequency || null,
    })
    .eq("id", id);
  if (error) return { success: false, error: error.message || "Impossible de modifier le popup." };
  revalidatePath("/admin/popups");
  return { success: true };
}

export async function deletePopup(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("popups").delete().eq("id", id);
  if (error) return { success: false, error: "Impossible de supprimer le popup." };
  revalidatePath("/admin/popups");
  return { success: true };
}
