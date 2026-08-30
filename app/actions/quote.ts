"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { allocateDocumentId, DOCUMENT_TYPES } from "@/lib/document-engine";

/**
 * Règle métier : tout formulaire conversationnel de demande de devis doit
 * prévoir un champ de MESSAGE LIBRE (obligatoire) et un récapitulatif avant
 * envoi. Le message libre n'est jamais interprété (anti-XSS) : stocké tel quel.
 */

export interface QuoteRequestInput {
  serviceSlug?: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  projectInfo?: string;
  freeMessage: string;
}

export interface QuoteRequestResult {
  success: boolean;
  error?: string;
  reference?: string;
}

function validate(input: QuoteRequestInput): string | null {
  if (!input.contactName || input.contactName.trim().length < 2) {
    return "Veuillez indiquer votre nom.";
  }
  if (!input.contactPhone || input.contactPhone.trim().length < 6) {
    return "Veuillez indiquer un numéro de téléphone valide.";
  }
  if (input.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) {
    return "L'adresse email n'est pas valide.";
  }
  if (!input.freeMessage || input.freeMessage.trim().length < 5) {
    return "Veuillez décrire votre besoin (message libre obligatoire).";
  }
  if (input.freeMessage.length > 3000) {
    return "Le message est trop long (maximum 3000 caractères).";
  }
  return null;
}

export async function createQuoteRequest(
  input: QuoteRequestInput,
): Promise<QuoteRequestResult> {
  const validationError = validate(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Honnêteté : ne pas simuler un succès tant que la persistance n'est pas branchée.
    return {
      success: false,
      error:
        "La soumission automatique n'est pas encore configurée. Merci de nous contacter sur WhatsApp.",
    };
  }

  try {
    const supabase = createAdminClient();
    const reference = await allocateDocumentId(DOCUMENT_TYPES.DEVIS_CLIENT.code);

    const { error } = await supabase.from("quote_requests").insert({
      service_id: input.serviceSlug ? undefined : undefined,
      contact_name: input.contactName.trim(),
      contact_phone: input.contactPhone.trim(),
      contact_email: input.contactEmail?.trim() || null,
      free_message: input.freeMessage.trim(),
      payload: { projectInfo: input.projectInfo?.trim() ?? null, serviceSlug: input.serviceSlug ?? null },
      reference: reference.id,
      status: "new",
    });

    if (error) {
      return {
        success: false,
        error: "Votre demande n'a pas pu être enregistrée. Merci de réessayer ou de nous contacter sur WhatsApp.",
      };
    }

    return { success: true, reference: reference.id };
  } catch {
    return {
      success: false,
      error: "Une erreur est survenue. Merci de réessayer ou de nous contacter sur WhatsApp.",
    };
  }
}
