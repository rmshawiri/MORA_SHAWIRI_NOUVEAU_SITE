import 'server-only';

/**
 * Liste des factures — lecture administrative, sous RLS.
 *
 * Les informations affichées viennent de l'**instantané** de chaque facture :
 * le client et le montant tels qu'ils figurent sur la pièce, pas tels que la
 * commande ou le profil les décrivent aujourd'hui. Seul l'état de règlement
 * est lu sur la commande, et présenté comme ce qu'il est : l'état actuel.
 *
 * La recherche et les filtres s'appliquent après lecture, sur au plus
 * `LIMIT` factures — les plus récentes. C'est largement au-delà du volume de
 * MORA Shawiri aujourd'hui ; le jour où ce ne le sera plus, la recherche
 * passera côté base sans changer l'écran.
 */

import { parseInvoiceSnapshot, type InvoiceSnapshot } from '@/lib/domain/invoice-pdf';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { DocumentStatusValue, OrderSettlementStatus } from '@/lib/supabase/types';

export const INVOICE_LIST_LIMIT = 500;

export type InvoiceListEntry = {
  reference: string;
  status: DocumentStatusValue;
  issuedAt: string;
  customerName: string;
  customerEmail: string | null;
  orderReference: string;
  total: number;
  currency: string;
  archived: boolean;
  settlement: OrderSettlementStatus | null;
};

export type InvoiceFilters = {
  q?: string;
  statut?: string;
  reglement?: string;
};

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export async function listInvoices(filters: InvoiceFilters = {}): Promise<{
  entries: InvoiceListEntry[];
  total: number;
}> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return { entries: [], total: 0 };

  const { data: documents, error } = await supabase
    .from('documents')
    .select('id, reference, status, issued_at, entity_id')
    .eq('doc_type', 'FACL')
    .order('issued_at', { ascending: false })
    .limit(INVOICE_LIST_LIMIT);

  if (error || !documents || documents.length === 0) return { entries: [], total: 0 };

  const ids = documents.map((document) => document.id);
  const orderIds = documents.map((document) => document.entity_id).filter((id): id is string => !!id);

  const [snapshotsResult, ordersResult] = await Promise.all([
    supabase.from('document_snapshots').select('document_id, content, pdf_path').in('document_id', ids),
    orderIds.length > 0
      ? supabase.from('orders').select('id, settlement_status').in('id', orderIds)
      : Promise.resolve({ data: [] as { id: string; settlement_status: OrderSettlementStatus }[] }),
  ]);

  const snapshots = new Map(
    (snapshotsResult.data ?? []).map((row) => [row.document_id, row] as const),
  );
  const settlements = new Map((ordersResult.data ?? []).map((row) => [row.id, row.settlement_status]));

  const all: InvoiceListEntry[] = [];
  for (const document of documents) {
    const row = snapshots.get(document.id);
    const snapshot: InvoiceSnapshot | null = row ? parseInvoiceSnapshot(row.content) : null;
    if (!snapshot) continue;

    all.push({
      reference: document.reference,
      status: document.status,
      issuedAt: document.issued_at,
      customerName: snapshot.customer.name,
      customerEmail: snapshot.customer.email,
      orderReference: snapshot.references.order,
      total: snapshot.totals.total,
      currency: snapshot.currency,
      archived: Boolean(row?.pdf_path),
      settlement: document.entity_id ? (settlements.get(document.entity_id) ?? null) : null,
    });
  }

  const query = fold(filters.q?.trim() ?? '');
  const entries = all.filter((entry) => {
    if (filters.statut && entry.status !== filters.statut) return false;
    if (filters.reglement && entry.settlement !== filters.reglement) return false;
    if (!query) return true;
    return [entry.reference, entry.orderReference, entry.customerName, entry.customerEmail ?? '']
      .map(fold)
      .some((value) => value.includes(query));
  });

  return { entries, total: all.length };
}
