import 'server-only';

/**
 * Devis (DVCL) et document de commande (CMCL) — lecture, rendu, archive,
 * aperçu.
 *
 * Même chemin que la facture et les pièces d'affiliation :
 *
 *   1. la base fige l'instantané (`send_quote`, `issue_order_document`) ;
 *   2. le serveur rend le PDF **depuis l'instantané**, le dépose dans le
 *      bucket privé et enregistre son empreinte ;
 *   3. au téléchargement, l'archive est relue sous la session et servie si son
 *      empreinte est intacte ; sinon la pièce est rendue de nouveau depuis son
 *      instantané — à l'identique, le rendu étant déterministe.
 *
 * Qui lit : la RLS de `documents` et `document_snapshots` — le titulaire, ou
 * la permission de lecture du type (`quotes.view` pour DVCL, `orders.view`
 * pour CMCL). Rien n'est lu si elle refuse.
 *
 * L'aperçu d'un brouillon de devis n'est pas une pièce : il se lit à
 * l'instant, sans numéro, n'est jamais archivé et le dit sur chaque page.
 */

import { archiveOfficialPdf, readVerifiedArchive } from '@/lib/documents/archive';
import { invoiceLogo } from '@/lib/documents/logo';
import {
  ORDER_RENDERER_VERSION,
  QUOTE_RENDERER_VERSION,
  orderFileName,
  parseOrderSnapshot,
  parseQuoteSnapshot,
  quoteFileName,
  renderOrderPdf,
  renderQuotePdf,
  type OrderSnapshot,
  type QuoteSnapshot,
} from '@/lib/domain/commercial-pdf';
import { parseReference } from '@/lib/domain/documents';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { DocumentRow, DocumentSnapshotRow } from '@/lib/supabase/types';

export type CommercialType = 'DVCL' | 'CMCL';

export type CommercialRecord =
  | { type: 'DVCL'; document: DocumentRow; snapshotRow: DocumentSnapshotRow; snapshot: QuoteSnapshot }
  | { type: 'CMCL'; document: DocumentRow; snapshotRow: DocumentSnapshotRow; snapshot: OrderSnapshot };

export type CommercialPdf = { bytes: Uint8Array; fileName: string; source: 'archive' | 'rendu' | 'apercu' };

export function isCommercialType(type: string): type is CommercialType {
  return type === 'DVCL' || type === 'CMCL';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Pièce lisible par la session courante, ou `null` — sans dire pourquoi. */
export async function loadCommercialDocument(reference: string): Promise<CommercialRecord | null> {
  const normalised = reference.trim().toUpperCase();
  const parsed = parseReference(normalised);
  if (!parsed || !isCommercialType(parsed.type)) return null;

  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data: document } = await supabase
    .from('documents')
    .select('*')
    .eq('reference', normalised)
    .eq('doc_type', parsed.type)
    .maybeSingle();
  if (!document) return null;
  const { data: snapshotRow } = await supabase
    .from('document_snapshots')
    .select('*')
    .eq('document_id', document.id)
    .maybeSingle();
  if (!snapshotRow) return null;

  if (parsed.type === 'DVCL') {
    const snapshot = parseQuoteSnapshot(snapshotRow.content);
    if (!snapshot || snapshot.preview || snapshot.reference !== document.reference) return null;
    return { type: 'DVCL', document, snapshotRow, snapshot };
  }
  const snapshot = parseOrderSnapshot(snapshotRow.content);
  if (!snapshot || snapshot.reference !== document.reference) return null;
  return { type: 'CMCL', document, snapshotRow, snapshot };
}

/** Rendu depuis l'instantané, et lui seul. */
export function renderCommercialDocument(record: CommercialRecord): Uint8Array {
  const options = { logo: invoiceLogo(), status: record.document.status as 'EMIS' | 'ANNULE' | 'REMPLACE' };
  return record.type === 'DVCL' ? renderQuotePdf(record.snapshot, options) : renderOrderPdf(record.snapshot, options);
}

const rendererOf = (record: CommercialRecord) =>
  record.type === 'DVCL' ? QUOTE_RENDERER_VERSION : ORDER_RENDERER_VERSION;

/** Archive une pièce qui vient d'être émise, relue sous la session de l'émetteur. */
export async function archiveIssuedCommercialDocument(reference: string): Promise<boolean> {
  const record = await loadCommercialDocument(reference);
  if (!record) return false;
  if (record.snapshotRow.pdf_path) return true;
  return archiveOfficialPdf(record.document, renderCommercialDocument(record), rendererOf(record), 'documents');
}

/**
 * Le PDF d'un devis ou d'un document de commande pour la session courante.
 *
 *   * émis et archivé — l'archive, après contrôle de l'empreinte ;
 *   * émis sans archive — rendu depuis l'instantané, puis archivé ;
 *   * remplacé ou annulé — rendu avec le bandeau qui le dit, jamais
 *     l'archive de l'émission, qui ne le disait pas.
 */
export async function getCommercialDocumentPdf(reference: string): Promise<CommercialPdf | null> {
  const record = await loadCommercialDocument(reference);
  if (!record) return null;
  const fileName =
    record.type === 'DVCL' ? quoteFileName(record.snapshot) : orderFileName(record.document.reference);

  if (record.document.status === 'EMIS' && record.snapshotRow.pdf_path) {
    const archived = await readVerifiedArchive(record.snapshotRow, 'documents');
    if (archived) return { bytes: archived, fileName, source: 'archive' };
    return { bytes: renderCommercialDocument(record), fileName, source: 'rendu' };
  }
  const bytes = renderCommercialDocument(record);
  if (record.document.status === 'EMIS') {
    await archiveOfficialPdf(record.document, bytes, rendererOf(record), 'documents');
  }
  return { bytes, fileName, source: 'rendu' };
}

/**
 * Aperçu d'un brouillon de devis : `quotes.view` (la base en décide).
 * Jamais archivé, jamais numéroté.
 */
export async function getQuotePreviewPdf(quoteId: string): Promise<CommercialPdf | null> {
  if (!UUID.test(quoteId)) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('quote_preview', { p_quote_id: quoteId });
  if (error || !data) return null;
  const snapshot = parseQuoteSnapshot(data);
  if (!snapshot || !snapshot.preview) return null;
  return { bytes: renderQuotePdf(snapshot, { logo: invoiceLogo() }), fileName: quoteFileName(snapshot), source: 'apercu' };
}

/**
 * La pièce a-t-elle son contenu figé ? Pour la commande : le document de
 * commande est-il établi ? Lu sous la session (RLS des instantanés).
 */
export async function isDocumentEstablished(documentId: string | null): Promise<boolean> {
  if (!documentId) return false;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return false;
  const { data } = await supabase.from('document_snapshots').select('document_id').eq('document_id', documentId).maybeSingle();
  return Boolean(data);
}
