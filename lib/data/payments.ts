/**
 * MORA Shawiri — Moyens de paiement (V1)
 * --------------------------------------
 * En V1, MORA Shawiri fonctionne selon le modèle documentaire :
 *   1. le client DÉCLARE avoir payé (envoi d'une preuve) ;
 *   2. l'administrateur VÉRIFIE la preuve ;
 *   3. la commande passe au statut « Payé » uniquement après vérification.
 *
 * Une déclaration n'est JAMAIS un paiement confirmé.
 *
 * Moyens documentés : Mvola, Holo, virement, paiement en ligne.
 * Moyen ajouté sur décision du propriétaire : Wakati.
 * Les détails d'intégration (compte, fournisseur, webhook) sont à compléter
 * lors de la configuration réelle — on ne prétend pas qu'un paiement est
 * effectivement vérifié tant que l'intégration n'est pas active.
 */

export type PaymentMethodId =
  | "mvola"
  | "holo"
  | "wakati"
  | "virement"
  | "paiement-en-ligne";

export type PaymentMethodType =
  | "mobile_money" // paiement mobile (Mvola, Holo, Wakati…)
  | "bank_transfer" // virement
  | "online"; // paiement en ligne (fournisseur à configurer)

export interface PaymentMethod {
  id: PaymentMethodId;
  label: string;
  type: PaymentMethodType;
  /** En V1 le paiement est déclaré puis vérifié manuellement par l'admin. */
  verification: "manual" | "provider";
  description: string;
  /** Indique si l'intégration (fournisseur/webhook) est réellement configurée. */
  integrated: boolean;
}

/** Moyens de paiement officiellement listés pour MORA Shawiri. */
export const paymentMethods: PaymentMethod[] = [
  {
    id: "mvola",
    label: "Mvola",
    type: "mobile_money",
    verification: "manual",
    description: "Paiement mobile Mvola — déclaration puis vérification manuelle.",
    integrated: false,
  },
  {
    id: "holo",
    label: "Holo",
    type: "mobile_money",
    verification: "manual",
    description: "Paiement mobile Holo — déclaration puis vérification manuelle.",
    integrated: false,
  },
  {
    id: "wakati",
    label: "Wakati",
    type: "mobile_money",
    verification: "manual",
    description: "Paiement Wakati — déclaration puis vérification manuelle. (Ajouté sur décision MORA Shawiri.)",
    integrated: false,
  },
  {
    id: "virement",
    label: "Virement bancaire",
    type: "bank_transfer",
    verification: "manual",
    description: "Virement bancaire — déclaration puis vérification manuelle.",
    integrated: false,
  },
  {
    id: "paiement-en-ligne",
    label: "Paiement en ligne",
    type: "online",
    verification: "provider",
    description: "Paiement en ligne via un fournisseur — intégration à configurer (webhook vérifié).",
    integrated: false,
  },
];

/** Moyens réellement proposables dans l'interface de commande (V1, déclaration). */
export const activePaymentMethods = paymentMethods.map((m) => ({
  ...m,
  selectable: true,
}));

export function getPaymentMethod(id: PaymentMethodId): PaymentMethod | undefined {
  return paymentMethods.find((m) => m.id === id);
}
