import 'server-only';

/**
 * Espace client — paiements, remboursements, factures (phase 4I-2).
 *
 * Mêmes données que la phase 4G, mêmes tables, aucune règle nouvelle : ces
 * lectures ne font que rassembler, pour le titulaire, ce que la fiche d'une
 * commande montrait déjà commande par commande.
 *
 * Règle de l'espace client : **tout part des commandes du compte connecté**
 * (`orders.user_id = session`). Les droits d'administration éventuels du
 * compte n'élargissent jamais ce périmètre ; la RLS reste la protection de
 * fond. Les colonnes sont nommées une à une : aucune note interne
 * (`admin_note`) ni motif saisi par l'administration n'en sort.
 */

import type { OrderStatus, PaymentStatus, RefundStatus } from '@/lib/supabase/types';

import type { Ready } from './space';

export type MyOrderRef = { id: string; reference: string; currency: string; status: OrderStatus };

export type MyPayment = {
  id: string;
  order_id: string;
  method_code: string;
  amount: number | string;
  currency: string;
  status: PaymentStatus;
  transaction_reference: string | null;
  rejection_reason: string | null;
  declared_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  proofs: { id: string }[];
};

export type MyRefund = {
  id: string;
  order_id: string;
  amount: number | string;
  currency: string;
  status: RefundStatus;
  requested_at: string;
  completed_at: string | null;
};

export type MyInvoice = { id: string; reference: string; issued_at: string; orderId: string | null };

/** Les commandes du compte connecté (identifiant, référence) — le point de départ de tout le reste. */
async function myOrderRefs(space: Ready): Promise<{ refs: MyOrderRef[]; failed: boolean }> {
  const { data, error } = await space.supabase
    .from('orders')
    .select('id, reference, currency, status')
    .eq('user_id', space.context.userId)
    .order('created_at', { ascending: false })
    .limit(500);
  return { refs: (data ?? []) as MyOrderRef[], failed: Boolean(error) };
}

export async function myPaymentsAndRefunds(space: Ready) {
  const { refs, failed } = await myOrderRefs(space);
  if (refs.length === 0) return { orders: refs, payments: [] as MyPayment[], refunds: [] as MyRefund[], failed };

  const ids = refs.map((order) => order.id);
  const [payments, refunds] = await Promise.all([
    space.supabase
      .from('payments')
      .select('id, order_id, method_code, amount, currency, status, transaction_reference, rejection_reason, declared_at, confirmed_at, created_at')
      .in('order_id', ids)
      .order('created_at', { ascending: false })
      .limit(500),
    space.supabase
      .from('refunds')
      .select('id, order_id, amount, currency, status, requested_at, completed_at')
      .in('order_id', ids)
      .order('requested_at', { ascending: false })
      .limit(500),
  ]);

  const paymentRows = (payments.data ?? []) as Omit<MyPayment, 'proofs'>[];
  const { data: proofs } =
    paymentRows.length > 0
      ? await space.supabase.from('payment_proofs').select('id, payment_id').in('payment_id', paymentRows.map((row) => row.id))
      : { data: [] as { id: string; payment_id: string }[] };

  return {
    orders: refs,
    payments: paymentRows.map((row) => ({
      ...row,
      proofs: (proofs ?? []).filter((proof) => proof.payment_id === row.id).map((proof) => ({ id: proof.id })),
    })),
    refunds: (refunds.data ?? []) as MyRefund[],
    failed: failed || Boolean(payments.error || refunds.error),
  };
}

/**
 * Factures émises dont le compte est le titulaire (`owner_id`), reliées à
 * leur commande. Une facture annulée ou remplacée n'est pas proposée.
 */
export async function myInvoices(space: Ready): Promise<{ invoices: MyInvoice[]; orders: MyOrderRef[]; failed: boolean }> {
  const [{ refs, failed }, documents] = await Promise.all([
    myOrderRefs(space),
    space.supabase
      .from('documents')
      .select('id, reference, issued_at, entity_id')
      .eq('owner_id', space.context.userId)
      .eq('doc_type', 'FACL')
      .eq('status', 'EMIS')
      .order('issued_at', { ascending: false })
      .limit(200),
  ]);
  return {
    invoices: ((documents.data ?? []) as { id: string; reference: string; issued_at: string; entity_id: string | null }[]).map((row) => ({
      id: row.id,
      reference: row.reference,
      issued_at: row.issued_at,
      orderId: row.entity_id,
    })),
    orders: refs,
    failed: failed || Boolean(documents.error),
  };
}

/** Libellés des moyens de paiement (ceux encore actifs) ; le code sinon. */
export async function paymentMethodLabels(space: Ready): Promise<Record<string, string>> {
  const { data } = await space.supabase.rpc('active_payment_methods');
  return Object.fromEntries(((data ?? []) as { code: string; label: string }[]).map((row) => [row.code, row.label]));
}
