"use server";

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getServiceBySlug, type Service } from "@/lib/data/services";
import { getPaymentMethod, type PaymentMethodId } from "@/lib/data/payments";
import { allocateDocumentId, DOCUMENT_TYPES } from "@/lib/document-engine";
import { getAffiliateByCode, commissionAmount } from "@/lib/affiliation";

/**
 * Création de commande (V1) — modèle « déclaration de paiement ».
 * Règles serveur (source de vérité) :
 *  - le prix est calculé CÔTÉ SERVEUR (jamais celui envoyé par le client) ;
 *  - le montant sert à l'historique (snapshot) ;
 *  - une déclaration de paiement ne rend PAS la commande « Payée » :
 *    statut paiement = 'in_review' / commande = 'awaiting_payment'.
 */

export interface CreateOrderInput {
  serviceSlug: string;
  quantity: number;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  paymentMethod: PaymentMethodId;
}

export interface CreateOrderResult {
  success: boolean;
  error?: string;
  orderNumber?: string;
}

function resolvePrice(service: Service, quantity: number): number {
  // Total = prix unitaire × quantité (Offres Basique/Pro) ou prix fixe.
  return Math.round((service.price ?? 0) * quantity);
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const service = getServiceBySlug(input.serviceSlug);
  if (!service) return { success: false, error: "Service introuvable." };
  if (!service.directPurchase) {
    return { success: false, error: "Ce service nécessite une demande de devis." };
  }
  const quantity = Math.max(1, Math.min(100, Math.floor(input.quantity || 1)));
  if (!input.contactName || input.contactName.trim().length < 2) {
    return { success: false, error: "Veuillez indiquer votre nom." };
  }
  if (!input.contactPhone || input.contactPhone.trim().length < 6) {
    return { success: false, error: "Veuillez indiquer un numéro valide." };
  }
  const payment = getPaymentMethod(input.paymentMethod);
  if (!payment) return { success: false, error: "Moyen de paiement invalide." };

  const total = resolvePrice(service, quantity);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { success: false, error: "La commande n'est pas encore configurée." };
  }

  try {
    const supabase = createAdminClient();
    // Associer la commande à l'utilisateur connecté lorsqu'il y en a un.
    const user = await (async () => {
      const sc = await createClient();
      const { data } = await sc.auth.getUser();
      return data.user;
    })();

    const doc = await allocateDocumentId(DOCUMENT_TYPES.COMMANDE_CLIENT.code);
    const orderNumber = doc.id; // Utilise MORA-CMCL-... comme numéro de commande stable

    // 1) Commande (snapshot des informations commerciales)
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        customer_name: input.contactName.trim(),
        customer_email: input.contactEmail?.trim() || null,
        customer_id: user?.id ?? null,
        order_number: orderNumber,
        status: "awaiting_payment",
        payment_status: "pending",
        currency: "KMF",
        subtotal: total,
        discount: 0,
        total,
        payment_method: payment.id,
      })
      .select("id")
      .single();

    if (orderErr || !order) {
      return { success: false, error: "Impossible de créer la commande." };
    }

    // 2) Ligne de commande (snapshot du prix au moment de l'achat)
    const { error: itemErr } = await supabase.from("order_items").insert({
      order_id: order.id,
      ref_type: "service",
      ref_id: service.id,
      name: service.name,
      unit_price: service.price ?? 0,
      quantity,
      line_total: total,
    });
    if (itemErr) return { success: false, error: "Impossible d'enregistrer la commande." };

    // 3) Paiement — DÉCLARÉ (in_review), jamais « payé » sans vérification.
    const { error: payErr } = await supabase.from("payments").insert({
      order_id: order.id,
      method: payment.id,
      amount: total,
      currency: "KMF",
      status: "in_review", // déclaré → à vérifier par l'admin
    });
    if (payErr) return { success: false, error: "Impossible d'enregistrer le paiement." };

    // 4) Commande passe en attente de statut paiement "en revue"
    await supabase
      .from("orders")
      .update({ payment_status: "in_review" })
      .eq("id", order.id);

    // 5) Attribution d'affiliation + commission (si un lien affilié est présent)
    const cookieStore = await cookies();
    const ref = cookieStore.get("ms_ref")?.value;
    if (ref) {
      const affiliate = await getAffiliateByCode(ref);
      if (affiliate && affiliate.rate > 0) {
        await supabase.from("commissions").insert({
          affiliate_id: affiliate.affiliateId,
          order_id: order.id,
          rate_applied: affiliate.rate,
          base_amount: total,
          amount: commissionAmount(total, affiliate.rate),
          status: "pending",
        });
      }
    }

    return { success: true, orderNumber };
  } catch {
    return {
      success: false,
      error: "Une erreur est survenue. Merci de réessayer ou de nous contacter sur WhatsApp.",
    };
  }
}
