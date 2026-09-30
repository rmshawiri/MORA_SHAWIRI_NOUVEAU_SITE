/**
 * Libellés, transitions et mises en forme du commerce — phase 4G.
 *
 * Même raison d'être que `relation/labels.ts` : `admin.ts` porte
 * `server-only`, et les mêmes libellés servent aux formulaires, qui sont des
 * composants client. Ce module ne contient que des valeurs et des fonctions
 * pures.
 *
 * ## Le graphe est ici parce qu'il est déjà ailleurs
 *
 * `ORDER_TRANSITIONS` et `PAYMENT_TRANSITIONS` recopient ce que les
 * déclencheurs de la migration 0009 appliquent. Cette duplication est
 * assumée, et elle est **surveillée** : un test unitaire relit le fichier SQL
 * et compare les deux graphes. L'interface a besoin de savoir quoi proposer ;
 * la base, elle, décide. Si les deux divergent, le test le dit avant que
 * l'écran ne propose un bouton qui échouerait.
 */

import type {
  OrderEventType,
  OrderSettlementStatus,
  OrderStatus,
  PaymentMethodKind,
  PaymentStatus,
  RefundStatus,
} from '@/lib/supabase/types';

/* --------------------------------------------------------------- libellés --- */

/** `09_ADMINISTRATION/02` § 22 — l'échelle retenue par le propriétaire. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NOUVELLE: 'Nouvelle',
  CONFIRMEE: 'Confirmée',
  EN_TRAITEMENT: 'En traitement',
  EN_ATTENTE_INFO: 'En attente d’information',
  PRETE: 'Prête',
  TERMINEE: 'Terminée',
  ANNULEE: 'Annulée',
};

/**
 * État du règlement, dérivé des paiements confirmés.
 *
 * Il se lit à côté du statut de commande, jamais à sa place — le § 59 du
 * document commerce donne l'exemple exact de cet affichage à deux lignes.
 */
export const SETTLEMENT_STATUS_LABELS: Record<OrderSettlementStatus, string> = {
  NON_PAYEE: 'Non payée',
  PARTIELLE: 'Partiellement réglée',
  SOLDEE: 'Soldée',
  PARTIELLEMENT_REMBOURSEE: 'Partiellement remboursée',
  REMBOURSEE: 'Remboursée',
};

/** `06_PAIEMENTS.md` § 22. */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  EN_ATTENTE: 'En attente',
  INITIE: 'Initié',
  EN_VERIFICATION: 'En vérification',
  PAYE: 'Payé',
  ECHEC: 'Échec',
  ANNULE: 'Annulé',
  REMBOURSE: 'Remboursé',
  PARTIELLEMENT_REMBOURSE: 'Partiellement remboursé',
};

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  EN_COURS: 'En cours',
  EFFECTUE: 'Effectué',
  ECHEC: 'Échec',
  ANNULE: 'Annulé',
};

export const PAYMENT_METHOD_KIND_LABELS: Record<PaymentMethodKind, string> = {
  MOBILE_MONEY: 'Mobile money',
  BANK_TRANSFER: 'Virement bancaire',
  CHEQUE: 'Chèque',
  CASH: 'Espèces',
  ONLINE: 'Paiement en ligne',
};

export const ORDER_EVENT_LABELS: Record<OrderEventType, string> = {
  COMMANDE_CREEE: 'Commande créée',
  STATUT_CHANGE: 'Statut modifié',
  MONTANTS_RECALCULES: 'Montants recalculés',
  PAIEMENT_DECLARE: 'Paiement déclaré',
  PAIEMENT_CONFIRME: 'Paiement confirmé',
  PAIEMENT_REJETE: 'Déclaration rejetée',
  PAIEMENT_ANNULE: 'Déclaration annulée',
  JUSTIFICATIF_AJOUTE: 'Justificatif joint',
  REMBOURSEMENT_ENREGISTRE: 'Remboursement enregistré',
  REMBOURSEMENT_EFFECTUE: 'Remboursement effectué',
  DOCUMENT_EMIS: 'Document émis',
};

/* ------------------------------------------------------------ transitions --- */

/**
 * Transitions légales d'une commande — miroir de
 * `tg_orders_transition_guard()`.
 *
 * TERMINEE et ANNULEE sont finales : le § 63 veut qu'une commande annulée
 * « reste accessible dans l'historique », pas qu'elle reparte.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  NOUVELLE: ['CONFIRMEE', 'ANNULEE'],
  CONFIRMEE: ['EN_TRAITEMENT', 'EN_ATTENTE_INFO', 'PRETE', 'ANNULEE'],
  EN_TRAITEMENT: ['EN_ATTENTE_INFO', 'PRETE', 'TERMINEE', 'ANNULEE'],
  EN_ATTENTE_INFO: ['EN_TRAITEMENT', 'PRETE', 'ANNULEE'],
  PRETE: ['TERMINEE', 'ANNULEE'],
  TERMINEE: [],
  ANNULEE: [],
};

/** Miroir de `tg_payments_transition_guard()`. */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  EN_ATTENTE: ['INITIE', 'EN_VERIFICATION', 'ECHEC', 'ANNULE'],
  INITIE: ['EN_VERIFICATION', 'PAYE', 'ECHEC', 'ANNULE'],
  EN_VERIFICATION: ['PAYE', 'ECHEC', 'ANNULE'],
  PAYE: ['REMBOURSE', 'PARTIELLEMENT_REMBOURSE'],
  PARTIELLEMENT_REMBOURSE: ['REMBOURSE'],
  ECHEC: [],
  ANNULE: [],
  REMBOURSE: [],
};

/** Un paiement que l'administration peut encore vérifier ou rejeter. */
export const PAYMENT_PENDING_STATUSES: readonly PaymentStatus[] = [
  'EN_ATTENTE',
  'INITIE',
  'EN_VERIFICATION',
];

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/* ---------------------------------------------------------- mise en forme --- */

/**
 * Montant affiché.
 *
 * Les montants arrivent de PostgREST en **chaîne** : `numeric` n'a pas
 * d'équivalent exact en JavaScript, et le convertir en `number` dès la lecture
 * reviendrait à faire passer par un flottant ce que le § 10 interdit
 * précisément d'y faire passer. La conversion n'a lieu qu'ici, pour
 * l'affichage, et jamais avant un calcul — les calculs sont faits par la base.
 */
export function formatAmount(value: string | number | null | undefined, currency = 'KMF'): string {
  if (value === null || value === undefined) return '—';

  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return '—';

  // Le franc comorien n'a pas de subdivision en usage courant. Les décimales
  // ne s'affichent donc que lorsqu'elles portent une information.
  const hasCents = Math.abs(amount % 1) > 0;

  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount)} ${currency}`;
}

/** Quantité affichée, sans zéros décoratifs. */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const quantity = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(quantity)) return '—';

  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(quantity);
}

/** Reste dû, calculé pour l'affichage seulement. */
export function remainingDue(total: string, paid: string): number {
  const rest = Number(total) - Number(paid);
  return Number.isFinite(rest) ? Math.max(rest, 0) : 0;
}

/**
 * Formats acceptés pour un justificatif, dits une seule fois.
 *
 * Ces valeurs doivent rester alignées sur celles du bucket
 * `paiements-justificatifs` et sur la contrainte `payment_proofs_mime_allowed`.
 * Un test le vérifie contre la migration plutôt que de le supposer.
 */
export const PROOF_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const PROOF_EXTENSIONS: Record<(typeof PROOF_MIME_TYPES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** 5 Mo, comme le bucket et la contrainte de taille. */
export const PROOF_MAX_BYTES = 5_242_880;

export function isProofMimeType(value: string): value is (typeof PROOF_MIME_TYPES)[number] {
  return (PROOF_MIME_TYPES as readonly string[]).includes(value);
}
