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
 * ## Aucun filtre applicatif sur la propriété
 *
 * Les lectures ne portent pas de `where user_id = …`. C'est la RLS qui décide,
 * et elle seule : `orders_select_own` ne laisse passer que les commandes du
 * demandeur. Ajouter un filtre applicatif par-dessus donnerait l'illusion
 * d'une protection et masquerait un défaut de politique le jour où il
 * surviendrait. Le test IDOR vérifie la politique, pas le filtre.
 */

import { getServerSupabaseClient } from '@/lib/supabase/server';
import type {
  OrderEventRow,
  OrderItemRow,
  OrderRow,
  PaymentProofRow,
  PaymentRow,
} from '@/lib/supabase/types';

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

/** Commandes du client connecté. La RLS fait le tri. */
export async function listMyOrders(limit = 50): Promise<ClientOrderEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('orders')
    // prettier-ignore
    .select('id, reference, status, settlement_status, total_amount, paid_amount, currency, created_at')
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
  events: OrderEventRow[];
  methods: ActivePaymentMethod[];
};

/**
 * Fiche d'une commande, vue par son titulaire.
 *
 * Renvoie `null` aussi bien quand la référence n'existe pas que quand elle
 * appartient à quelqu'un d'autre — la RLS ne distingue pas les deux cas, et
 * c'est exactement ce qu'il faut : le § 102 demande de ne pas révéler ce qui
 * existe. Une commande d'autrui est introuvable, pas interdite.
 */
export async function findMyOrder(reference: string): Promise<ClientOrderDetail | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();

  if (error || !order) return null;

  const [itemsResult, paymentsResult, eventsResult, methods] = await Promise.all([
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
    events: eventsResult.data ?? [],
    methods,
  };
}
