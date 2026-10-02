import 'server-only';

/**
 * Ce qu'un client voit et fait sur ses propres commandes — phase 4G.
 *
 * ## Le périmètre, et pourquoi il est si étroit
 *
 * L'espace client complet appartient à la phase 4I. Ce module ne construit pas
 * cet espace : il livre le strict nécessaire au cycle que 4G doit rendre
 * réellement suivable —
 *
 *     COMMANDE → MONTANT → PAIEMENT DÉCLARÉ → VÉRIFICATION → STATUT
 *
 * Sans une porte par laquelle le client déclare son paiement, la moitié de ce
 * cycle n'existerait que dans l'administration, et D-10 n'aurait rien à
 * vérifier. Il y a donc une liste de ses commandes, une fiche par commande, et
 * de quoi déclarer un règlement. Rien de plus : ni tableau de bord, ni profil,
 * ni documents, ni rendez-vous.
 *
 * ## La propriété est filtrée explicitement (phase 4I-2)
 *
 * En 4G, ces lectures s'en remettaient à la seule RLS. C'était insuffisant :
 * la RLS laisse aussi passer `orders_select_admin` (`can_view_commandes`) et
 * `payments_select_admin`. Un compte à la fois CLIENT et détenteur d'un droit
 * de consultation commerce aurait vu, dans « Mes commandes », les commandes de
 * tous les clients.
 *
 * Règle désormais : **l'espace client lit les données du compte connecté, et
 * elles seules, quels que soient ses rôles et permissions.** Chaque lecture
 * porte `user_id = <compte de la session>` (ou passe par une commande ainsi
 * filtrée), en plus de la RLS — qui reste la protection de fond contre un
 * appel direct à l'API. Les permissions d'administration n'élargissent jamais
 * cet espace ; l'administration garde ses propres lectures.
 */

import { getServerSupabaseClient } from '@/lib/supabase/server';
import type {
  OrderEventRow,
  OrderItemRow,
  OrderRow,
  PaymentProofRow,
  PaymentRow,
  RefundRow,
} from '@/lib/supabase/types';

type Session = NonNullable<Awaited<ReturnType<typeof getServerSupabaseClient>>>;

/** Identifiant du compte de la session, lu au serveur d'authentification. */
async function sessionUserId(supabase: Session): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export type ClientOrderEntry = Pick<
  OrderRow,
  | 'id'
  | 'reference'
  | 'status'
  | 'settlement_status'
  | 'total_amount'
  | 'paid_amount'
  | 'currency'
  | 'created_at'
>;

/** Commandes du client connecté — les siennes seulement, quels que soient ses droits. */
export async function listMyOrders(limit = 50): Promise<ClientOrderEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  const uid = await sessionUserId(supabase);
  if (!uid) return [];

  const { data, error } = await supabase
    .from('orders')
    // prettier-ignore
    .select('id, reference, status, settlement_status, total_amount, paid_amount, currency, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[commerce] Lecture des commandes du client impossible : ${error.message}`);
    return [];
  }

  return data ?? [];
}

export type ActivePaymentMethod = {
  code: string;
  label: string;
  kind: string;
  instructions: string;
  account_number: string | null;
  account_holder: string | null;
  requires_proof: boolean;
  sort_order: number;
};

/**
 * Moyens que le client peut réellement utiliser.
 *
 * Passe par `active_payment_methods()` plutôt que par une lecture de table :
 * la règle du § 11 — « n'afficher que les moyens effectivement activés » — est
 * ainsi dite une seule fois, en base. Wakati et le virement, inactifs, n'en
 * sortent jamais, quelle que soit la page qui interroge.
 */
export async function listActivePaymentMethods(): Promise<ActivePaymentMethod[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc('active_payment_methods');

  if (error) {
    console.error(`[commerce] Lecture des moyens actifs impossible : ${error.message}`);
    return [];
  }

  return (data ?? []) as ActivePaymentMethod[];
}

export type ClientOrderDetail = {
  order: OrderRow;
  items: OrderItemRow[];
  payments: (PaymentRow & { proofs: PaymentProofRow[] })[];
  refunds: RefundRow[];
  events: OrderEventRow[];
  methods: ActivePaymentMethod[];
  /** Facture émise pour cette commande, lue sous RLS (le titulaire lit les siennes). */
  invoiceReference: string | null;
};

/**
 * Fiche d'une commande, vue par son titulaire.
 *
 * Renvoie `null` aussi bien quand la référence n'existe pas que quand elle
 * appartient à quelqu'un d'autre — y compris pour un compte qui détient des
 * droits d'administration commerce : le § 102 demande de ne pas révéler ce
 * qui existe. Une commande d'autrui est introuvable, pas interdite.
 */
export async function findMyOrder(reference: string): Promise<ClientOrderDetail | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const uid = await sessionUserId(supabase);
  if (!uid) return null;

  // Toutes les lectures suivantes partent de cette commande, dont la
  // propriété vient d'être établie : paiements, justificatifs, remboursements,
  // journal et facture ne peuvent appartenir qu'au même titulaire.
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('reference', reference)
    .eq('user_id', uid)
    .maybeSingle();

  if (error || !order) return null;

  const [itemsResult, paymentsResult, eventsResult, methods, invoiceResult, refundsResult] = await Promise.all([
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
      .from('order_events')
      .select('*')
      .eq('order_id', order.id)
      .order('occurred_at', { ascending: true }),
    listActivePaymentMethods(),
    supabase
      .from('documents')
      .select('reference')
      .eq('doc_type', 'FACL')
      .eq('entity_type', 'order')
      .eq('entity_id', order.id)
      .eq('owner_id', uid)
      .eq('status', 'EMIS')
      .maybeSingle(),
    supabase
      .from('refunds')
      .select('*')
      .eq('order_id', order.id)
      .order('requested_at', { ascending: false }),
  ]);

  const payments = paymentsResult.data ?? [];

  let proofs: PaymentProofRow[] = [];
  if (payments.length > 0) {
    const { data } = await supabase
      .from('payment_proofs')
      .select('*')
      .in(
        'payment_id',
        payments.map((payment) => payment.id),
      );
    proofs = data ?? [];
  }

  return {
    order,
    items: itemsResult.data ?? [],
    payments: payments.map((payment) => ({
      ...payment,
      proofs: proofs.filter((proof) => proof.payment_id === payment.id),
    })),
    refunds: (refundsResult.data ?? []) as RefundRow[],
    events: eventsResult.data ?? [],
    methods,
    invoiceReference: invoiceResult.data?.reference ?? null,
  };
}
