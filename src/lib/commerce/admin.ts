import 'server-only';

/**
 * Lectures des modules Commandes et Paiements — phase 4G.
 *
 * Toutes passent par le client de session, donc sous RLS : c'est le patron de
 * 4C, repris en 4E et 4F. Le client à clé secrète n'apparaît nulle part ici —
 * il contournerait la troisième barrière, et l'administration deviendrait le
 * seul endroit du système où elle ne s'applique pas.
 *
 * ## Ce que les listes ne ramènent pas
 *
 * Ni le téléphone du client, ni sa note libre, ni la référence de transaction
 * d'un paiement. Un tableau n'en a pas besoin, et le § 90 demande de ne pas
 * exposer ce qui n'est pas nécessaire — y compris à quelqu'un d'autorisé. Ces
 * valeurs arrivent sur la fiche, où on les consulte en le voulant.
 *
 * ## Aucun chiffre fabriqué
 *
 * § 115 de `06_PAIEMENTS.md` : « aucune statistique fictive ». Les nombres
 * affichés sont des `length` sur des lignes réellement lues et des sommes sur
 * des montants réellement enregistrés. Quand il n'y a rien, l'écran dit qu'il
 * n'y a rien.
 */

import { getServerSupabaseClient } from '@/lib/supabase/server';
import type {
  OrderEventRow,
  OrderItemRow,
  OrderRow,
  OrderStatus,
  OrderStatusHistoryRow,
  PaymentMethodRow,
  PaymentProofRow,
  PaymentRow,
  PaymentStatus,
  RefundRow,
} from '@/lib/supabase/types';

import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from './labels';

export * from './labels';

/* ----------------------------------------------------------------- listes --- */

export type OrderListEntry = Pick<
  OrderRow,
  | 'id'
  | 'reference'
  | 'status'
  | 'settlement_status'
  | 'customer_name'
  | 'total_amount'
  | 'paid_amount'
  | 'currency'
  | 'is_manual'
  | 'created_at'
>;

/**
 * Commandes, les plus récentes d'abord, celles qui réclament une décision en
 * tête.
 *
 * Le § 174 du tableau de bord demande de hiérarchiser par ce que l'on regarde
 * tous les jours. Une commande nouvelle passe donc avant une commande
 * terminée, et à statut égal la plus ancienne d'abord — celle qui attend
 * depuis trois jours avant celle d'hier.
 */
export async function listOrders(limit = 100): Promise<OrderListEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('orders')
    // prettier-ignore
    .select('id, reference, status, settlement_status, customer_name, total_amount, paid_amount, currency, is_manual, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[commerce] Lecture des commandes impossible : ${error.message}`);
    return [];
  }

  const rank: Record<OrderStatus, number> = {
    NOUVELLE: 0,
    EN_ATTENTE_INFO: 1,
    CONFIRMEE: 2,
    EN_TRAITEMENT: 3,
    PRETE: 4,
    TERMINEE: 5,
    ANNULEE: 6,
  };

  return (data ?? []).sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus !== 0) return byStatus;
    return a.created_at.localeCompare(b.created_at);
  });
}

export type PaymentListEntry = Pick<
  PaymentRow,
  | 'id'
  | 'order_id'
  | 'method_code'
  | 'amount'
  | 'currency'
  | 'status'
  | 'declared_at'
  | 'verified_at'
  | 'created_at'
> & {
  orders: Pick<OrderRow, 'reference' | 'customer_name' | 'total_amount'> | null;
};

/**
 * Paiements, ceux à vérifier en premier.
 *
 * C'est l'écran de travail quotidien que D-10 rend nécessaire : une
 * déclaration attend une personne. Les paiements déjà tranchés suivent.
 */
export async function listPayments(limit = 100): Promise<PaymentListEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('payments')
    // prettier-ignore
    .select('id, order_id, method_code, amount, currency, status, declared_at, verified_at, created_at, orders ( reference, customer_name, total_amount )')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[commerce] Lecture des paiements impossible : ${error.message}`);
    return [];
  }

  const rank: Record<PaymentStatus, number> = {
    EN_VERIFICATION: 0,
    EN_ATTENTE: 1,
    INITIE: 2,
    PAYE: 3,
    PARTIELLEMENT_REMBOURSE: 4,
    REMBOURSE: 5,
    ECHEC: 6,
    ANNULE: 7,
  };

  return ((data ?? []) as unknown as PaymentListEntry[]).sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus !== 0) return byStatus;
    return a.created_at.localeCompare(b.created_at);
  });
}

/* ------------------------------------------------------------------ fiche --- */

export type OrderDetail = {
  order: OrderRow;
  items: OrderItemRow[];
  payments: (PaymentRow & { proofs: PaymentProofRow[] })[];
  refunds: RefundRow[];
  history: OrderStatusHistoryRow[];
  events: OrderEventRow[];
  /** Pièces officielles émises pour cette commande (CMCL, FACL, AVCL…). */
  documents: { id: string; reference: string; doc_type: string; status: string; issued_at: string }[];
  quoteReference: string | null;
  requestReference: string | null;
};

/**
 * Fiche d'une commande, par sa référence.
 *
 * La référence est la clé d'entrée plutôt que l'identifiant interne : c'est
 * elle que MORA Shawiri lit sur une facture et cite au téléphone. L'UUID reste
 * l'identifiant technique, comme le § 6 le demande.
 */
export async function findOrder(reference: string): Promise<OrderDetail | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();

  if (error) {
    console.error(`[commerce] Lecture de la commande impossible : ${error.message}`);
    return null;
  }
  if (!order) return null;

  const [itemsResult, paymentsResult, refundsResult, historyResult, eventsResult, documentsResult] =
    await Promise.all([
      supabase
        .from('order_items')
        .select('*')
        .eq('order_id', order.id)
        .order('position', { ascending: true }),
      supabase
        .from('payments')
        .select('*')
        .eq('order_id', order.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('refunds')
        .select('*')
        .eq('order_id', order.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('order_status_history')
        .select('*')
        .eq('order_id', order.id)
        .order('changed_at', { ascending: true }),
      supabase
        .from('order_events')
        .select('*')
        .eq('order_id', order.id)
        .order('occurred_at', { ascending: true }),
      supabase
        .from('documents')
        .select('id, reference, doc_type, status, issued_at')
        .eq('entity_type', 'order')
        .eq('entity_id', order.id)
        .order('issued_at', { ascending: true }),
    ]);

  const payments = paymentsResult.data ?? [];

  // Les justificatifs sont chargés en une requête plutôt qu'une par paiement :
  // une fiche portant cinq déclarations ne doit pas coûter six allers-retours.
  let proofs: PaymentProofRow[] = [];
  if (payments.length > 0) {
    const { data } = await supabase
      .from('payment_proofs')
      .select('*')
      .in(
        'payment_id',
        payments.map((payment) => payment.id),
      )
      .order('uploaded_at', { ascending: true });
    proofs = data ?? [];
  }

  const [quoteResult, requestResult] = await Promise.all([
    order.quote_id
      ? supabase.from('quotes').select('reference').eq('id', order.quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    order.quote_request_id
      ? supabase
          .from('quote_requests')
          .select('reference')
          .eq('id', order.quote_request_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    order,
    items: itemsResult.data ?? [],
    payments: payments.map((payment) => ({
      ...payment,
      proofs: proofs.filter((proof) => proof.payment_id === payment.id),
    })),
    refunds: refundsResult.data ?? [],
    history: historyResult.data ?? [],
    events: eventsResult.data ?? [],
    documents: documentsResult.data ?? [],
    quoteReference: quoteResult.data?.reference ?? null,
    requestReference: requestResult.data?.reference ?? null,
  };
}

/* ----------------------------------------------------- moyens de paiement --- */

/**
 * Tous les moyens, actifs ou non.
 *
 * L'administration a besoin de voir ce qui est éteint pour pouvoir l'allumer ;
 * c'est la seule lecture qui présente les moyens inactifs. Le client, lui,
 * passe par `active_payment_methods()`, qui ne les montre jamais.
 */
export async function listPaymentMethods(): Promise<PaymentMethodRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error(`[commerce] Lecture des moyens de paiement impossible : ${error.message}`);
    return [];
  }

  return data ?? [];
}

/* -------------------------------------------------------- devis à traiter --- */

export type ConvertibleQuote = {
  id: string;
  reference: string | null;
  amount: string;
  currency: string;
  summary: string;
  responded_at: string | null;
  quote_requests: { reference: string; user_id: string | null } | null;
};

/**
 * Devis acceptés qui n'ont pas encore donné de commande.
 *
 * C'est la file de travail réelle de MORA Shawiri : les quatorze prestations
 * du catalogue étant toutes « sur devis », c'est par là que passe chaque
 * commande. Un devis déjà transformé n'y figure plus — l'unicité de
 * `orders.quote_id` le garantit côté base, et cette lecture le reflète.
 */
export async function listConvertibleQuotes(limit = 50): Promise<ConvertibleQuote[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data: placed } = await supabase.from('orders').select('quote_id').not('quote_id', 'is', null);
  const taken = new Set((placed ?? []).map((row) => row.quote_id));

  const { data, error } = await supabase
    .from('quotes')
    // prettier-ignore
    .select('id, reference, amount, currency, summary, responded_at, quote_requests ( reference, user_id )')
    .eq('status', 'ACCEPTE')
    .order('responded_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error(`[commerce] Lecture des devis acceptés impossible : ${error.message}`);
    return [];
  }

  return ((data ?? []) as unknown as ConvertibleQuote[]).filter((quote) => !taken.has(quote.id));
}

/* -------------------------------------------------------------- comptages --- */

/** Compte par statut, sur les lignes réellement lues. Aucun chiffre fabriqué. */
export function countOrdersByStatus(entries: readonly { status: OrderStatus }[]) {
  const counts = Object.fromEntries(
    (Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((key) => [key, 0]),
  ) as Record<OrderStatus, number>;

  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

export function countPaymentsByStatus(entries: readonly { status: PaymentStatus }[]) {
  const counts = Object.fromEntries(
    (Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map((key) => [key, 0]),
  ) as Record<PaymentStatus, number>;

  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

/**
 * Somme d'une colonne de montants.
 *
 * Les montants arrivent en chaîne ; la somme est faite ici pour l'affichage et
 * n'est jamais réécrite en base. § 116-117 : ce que MORA Shawiri appelle
 * « encaissé » ne compte que les paiements confirmés, et `paid_amount` ne
 * contient déjà rien d'autre.
 */
export function sumAmounts(values: readonly string[]): number {
  return values.reduce((total, value) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? total + amount : total;
  }, 0);
}
