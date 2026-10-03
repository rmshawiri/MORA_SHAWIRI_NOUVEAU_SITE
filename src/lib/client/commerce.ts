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

/* ------------------------------------------------- Mes documents (remarques 01) */

export type MyDocumentKind = 'DVCL' | 'CMCL' | 'FACL';

export type MyDocument = {
  id: string;
  kind: MyDocumentKind;
  reference: string;
  /** Date de la pièce : émission (devis, facture) ou établissement (bon de commande). */
  date: string;
  /** État de la pièce elle-même : un devis remplacé reste listé, et le dit. */
  documentStatus: 'EMIS' | 'REMPLACE';
  /** État métier lu sur l'entité : statut du devis, de la commande. */
  quoteStatus: string | null;
  quoteValidUntil: string | null;
  orderReference: string | null;
  orderStatus: OrderStatus | null;
};

/**
 * Les pièces officielles dont le compte est le **titulaire** (`owner_id`) :
 * devis émis (y compris remplacés, pour l'historique), bons de commande
 * établis, factures émises. Une pièce annulée n'est pas proposée ; un bon de
 * commande dont le contenu n'est pas encore figé n'existe pas pour le client.
 *
 * Tout est lu sous la session : la RLS des pièces, des instantanés, des devis
 * et des commandes s'applique, et chaque requête filtre en plus sur le compte.
 */
export async function myOfficialDocuments(space: Ready): Promise<{ documents: MyDocument[]; failed: boolean }> {
  const [{ refs, failed }, documents] = await Promise.all([
    myOrderRefs(space),
    space.supabase
      .from('documents')
      .select('id, reference, doc_type, status, issued_at, entity_id')
      .eq('owner_id', space.context.userId)
      .in('doc_type', ['DVCL', 'CMCL', 'FACL'])
      .in('status', ['EMIS', 'REMPLACE'])
      .order('issued_at', { ascending: false })
      .limit(300),
  ]);
  const rows = (documents.data ?? []) as {
    id: string;
    reference: string;
    doc_type: MyDocumentKind;
    status: 'EMIS' | 'REMPLACE';
    issued_at: string;
    entity_id: string | null;
  }[];
  const kept = rows.filter((row) => row.doc_type === 'DVCL' || row.status === 'EMIS');
  if (kept.length === 0) return { documents: [], failed: failed || Boolean(documents.error) };

  const ids = kept.map((row) => row.id);
  const quoteIds = kept.filter((row) => row.doc_type === 'DVCL' && row.entity_id).map((row) => row.entity_id!);
  const [snapshots, quotes] = await Promise.all([
    space.supabase.from('document_snapshots').select('document_id, content').in('document_id', ids),
    quoteIds.length > 0
      ? space.supabase.from('quotes').select('id, status, valid_until').in('id', quoteIds)
      : Promise.resolve({ data: [] as { id: string; status: string; valid_until: string | null }[], error: null }),
  ]);
  const snapshotOf = new Map(
    ((snapshots.data ?? []) as { document_id: string; content: Record<string, unknown> }[]).map((row) => [row.document_id, row.content]),
  );
  const quoteOf = new Map(((quotes.data ?? []) as { id: string; status: string; valid_until: string | null }[]).map((row) => [row.id, row]));
  const orderOf = new Map(refs.map((order) => [order.id, order]));

  const list: MyDocument[] = [];
  for (const row of kept) {
    const content = snapshotOf.get(row.id);
    // Sans instantané, pas de pièce à remettre (bon de commande non établi).
    if (!content && row.doc_type !== 'FACL') continue;
    const order = row.entity_id && row.doc_type !== 'DVCL' ? (orderOf.get(row.entity_id) ?? null) : null;
    // Un bon de commande ou une facture dont la commande n'est pas au compte n'est pas listé.
    if (row.doc_type !== 'DVCL' && !order) continue;
    const quote = row.doc_type === 'DVCL' && row.entity_id ? (quoteOf.get(row.entity_id) ?? null) : null;
    const established = row.doc_type === 'CMCL' && typeof content?.issued_at === 'string' ? (content.issued_at as string) : null;
    list.push({
      id: row.id,
      kind: row.doc_type,
      reference: row.reference,
      date: established ?? row.issued_at,
      documentStatus: row.status,
      quoteStatus: quote?.status ?? null,
      quoteValidUntil: quote?.valid_until ?? null,
      orderReference: order?.reference ?? null,
      orderStatus: order?.status ?? null,
    });
  }
  return {
    documents: list,
    failed: failed || Boolean(documents.error || snapshots.error || quotes.error),
  };
}
