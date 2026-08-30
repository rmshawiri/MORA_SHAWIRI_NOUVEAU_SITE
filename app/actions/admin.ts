"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles } from "@/lib/rbac";

/**
 * Actions administratives sensibles — protégées par la garde de rôle admin.
 * Le client à privilèges (service role) sert aux mutations ; le contrôle de
 * permission est vérifié côté serveur.
 */

const COMMISSION_FLOW = ["pending", "validated", "payable", "paid"] as const;

export async function updateCommissionStatus(
  commissionId: string,
  status: string,
): Promise<{ success: boolean; error?: string }> {
  const { isAdmin } = await getUserRoles();
  if (!isAdmin) return { success: false, error: "Accès réservé aux administrateurs." };

  if (!COMMISSION_FLOW.includes(status as (typeof COMMISSION_FLOW)[number]) && status !== "cancelled") {
    return { success: false, error: "Statut de commission invalide." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("commissions").update({ status }).eq("id", commissionId);
  if (error) return { success: false, error: "Impossible de mettre à jour la commission." };
  revalidatePath("/admin/commissions");
  revalidatePath("/admin/statistiques");
  return { success: true };
}

/**
 * Mise à jour du statut d'une commande.
 * Si annulée ou remboursée, les commissions liées sont annulées (règle métier).
 */
export async function updateOrderStatus(
  orderId: string,
  changes: { status?: string; payment_status?: string },
): Promise<{ success: boolean; error?: string }> {
  const { isAdmin } = await getUserRoles();
  if (!isAdmin) return { success: false, error: "Accès réservé aux administrateurs." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("orders")
    .update({ ...(changes.status ? { status: changes.status } : {}), ...(changes.payment_status ? { payment_status: changes.payment_status } : {}) })
    .eq("id", orderId);
  if (error) return { success: false, error: "Impossible de mettre à jour la commande." };

  // Annulation / remboursement → annuler les commissions liées.
  if (changes.status === "cancelled" || changes.status === "refunded" || changes.payment_status === "refunded") {
    await supabase.from("commissions").update({ status: "cancelled" }).eq("order_id", orderId);
  }

  revalidatePath("/admin/commandes");
  revalidatePath("/admin/commissions");
  revalidatePath("/admin/statistiques");
  return { success: true };
}
