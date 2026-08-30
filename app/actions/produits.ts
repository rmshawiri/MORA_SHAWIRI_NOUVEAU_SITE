"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Gestion des produits (boutique) — CRUD serveur.
 * Types : digital / physical / service / pack. Prix en KMF (serveur).
 */

export interface ProductInput {
  name: string;
  slug?: string;
  summary?: string;
  description?: string;
  price?: number | null;
  type?: "digital" | "physical" | "service" | "pack";
  status?: "draft" | "published" | "available" | "unavailable" | "archived";
  stock_quantity?: number | null;
  image?: string | null;
  affiliate_eligible?: boolean;
  meta_title?: string;
  meta_description?: string;
}

function validateProduct(input: ProductInput): string | null {
  if (!input.name || input.name.trim().length < 2) return "Nom requis.";
  if (input.price != null && input.price < 0) return "Prix invalide.";
  return null;
}

function slugify(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " et ")
    .replace(/[^a-z0-9\s-]/gi, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    .toLowerCase();
}

export async function createProduct(input: ProductInput): Promise<{ success: boolean; error?: string }> {
  const err = validateProduct(input);
  if (err) return { success: false, error: err };
  const supabase = createAdminClient();
  const { error } = await supabase.from("products").insert({
    name: input.name.trim(),
    slug: input.slug || slugify(input.name),
    summary: input.summary?.trim() || null,
    description: input.description?.trim() || null,
    price: input.price ?? null,
    type: input.type ?? "digital",
    status: input.status ?? "draft",
    stock_quantity: input.stock_quantity ?? null,
    image_url: input.image || null,
    is_affiliate_eligible: input.affiliate_eligible ?? false,
    meta_title: input.meta_title?.trim() || null,
    meta_description: input.meta_description?.trim() || null,
  });
  if (error) return { success: false, error: error.message || "Impossible d'ajouter le produit." };
  revalidatePath("/boutique");
  revalidatePath("/admin/produits");
  return { success: true };
}

export async function updateProduct(id: string, input: ProductInput): Promise<{ success: boolean; error?: string }> {
  const err = validateProduct(input);
  if (err) return { success: false, error: err };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("products")
    .update({
      name: input.name.trim(),
      slug: input.slug || slugify(input.name),
      summary: input.summary?.trim() || null,
      description: input.description?.trim() || null,
      price: input.price ?? null,
      type: input.type ?? "digital",
      status: input.status ?? "draft",
      stock_quantity: input.stock_quantity ?? null,
      image_url: input.image || null,
      is_affiliate_eligible: input.affiliate_eligible ?? false,
      meta_title: input.meta_title?.trim() || null,
      meta_description: input.meta_description?.trim() || null,
    })
    .eq("id", id);
  if (error) return { success: false, error: error.message || "Impossible de modifier le produit." };
  revalidatePath("/boutique");
  revalidatePath("/admin/produits");
  return { success: true };
}

export async function deleteProduct(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { success: false, error: "Impossible de supprimer le produit." };
  revalidatePath("/boutique");
  revalidatePath("/admin/produits");
  return { success: true };
}
