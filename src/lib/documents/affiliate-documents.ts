import 'server-only';

/**
 * Pièces officielles d'affiliation — FIAF et RVAF : lecture, rendu, archive,
 * aperçu.
 *
 * Même chemin que la facture (4G) :
 *
 *   1. la base alloue le numéro par le moteur de documents de 4D et fige
 *      l'instantané dans la même transaction (`issue_affiliate_sheet`,
 *      `confirm_affiliate_payout`) ;
 *   2. le serveur rend le PDF **depuis l'instantané**, le dépose dans le bucket
 *      privé et enregistre son empreinte ;
 *   3. au téléchargement, l'archive est relue sous la session et servie si son
 *      empreinte est intacte ; sinon la pièce est rendue de nouveau depuis son
 *      instantané — identique, le rendu étant déterministe.
 *
 * Qui lit : la RLS de `documents` et `document_snapshots` — le titulaire
 * (l'affilié, `owner_id`), ou la permission de lecture du type
 * (`affiliates.view` pour FIAF, `payouts.view` pour RVAF). Rien n'est lu si
 * elle refuse.
 *
 * L'aperçu d'une fiche n'est pas une pièce : il se lit à l'instant, sans
 * numéro, n'est jamais archivé et le dit sur chaque page.
 */

import { archiveOfficialPdf, readVerifiedArchive } from '@/lib/documents/archive';
import { invoiceLogo } from '@/lib/documents/logo';
import {
  SHEET_RENDERER_VERSION,
  STATEMENT_RENDERER_VERSION,
  parseSheetSnapshot,
  parseStatementSnapshot,
  renderSheetPdf,
  renderStatementPdf,
  sheetFileName,
  statementFileName,
  type SheetSnapshot,
  type StatementSnapshot,
} from '@/lib/domain/affiliate-pdf';
import { parseReference } from '@/lib/domain/documents';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { DocumentRow, DocumentSnapshotRow } from '@/lib/supabase/types';

export type AffiliateDocumentRecord =
  | { type: 'FIAF'; document: DocumentRow; snapshotRow: DocumentSnapshotRow; snapshot: SheetSnapshot }
  | { type: 'RVAF'; document: DocumentRow; snapshotRow: DocumentSnapshotRow; snapshot: StatementSnapshot };

export type AffiliatePdf = { bytes: Uint8Array; fileName: string; source: 'archive' | 'rendu' | 'apercu' };

export function isAffiliateDocumentType(type: string): type is 'FIAF' | 'RVAF' {
  return type === 'FIAF' || type === 'RVAF';
}

/** Pièce lisible par la session courante, ou `null` — sans dire pourquoi. */
export async function loadAffiliateDocument(reference: string): Promise<AffiliateDocumentRecord | null> {
  const normalised = reference.trim().toUpperCase();
  const parsed = parseReference(normalised);
  if (!parsed || !isAffiliateDocumentType(parsed.type)) return null;

  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data: document } = await supabase
    .from('documents')
    .select('*')
    .eq('reference', normalised)
    .eq('doc_type', parsed.type)
    .maybeSingle();
  if (!document) return null;
  const { data: snapshotRow } = await supabase.from('document_snapshots').select('*').eq('document_id', document.id).maybeSingle();
  if (!snapshotRow) return null;

  if (parsed.type === 'FIAF') {
    const snapshot = parseSheetSnapshot(snapshotRow.content);
    if (!snapshot || snapshot.preview || snapshot.reference !== document.reference) return null;
    return { type: 'FIAF', document, snapshotRow, snapshot };
  }
  const snapshot = parseStatementSnapshot(snapshotRow.content);
  if (!snapshot || snapshot.reference !== document.reference) return null;
  return { type: 'RVAF', document, snapshotRow, snapshot };
}

/** Rendu depuis l'instantané, et lui seul. */
export function renderAffiliateDocument(record: AffiliateDocumentRecord): Uint8Array {
  const options = { logo: invoiceLogo(), status: record.document.status as 'EMIS' | 'ANNULE' | 'REMPLACE' };
  return record.type === 'FIAF' ? renderSheetPdf(record.snapshot, options) : renderStatementPdf(record.snapshot, options);
}

const rendererOf = (record: AffiliateDocumentRecord) =>
  record.type === 'FIAF' ? SHEET_RENDERER_VERSION : STATEMENT_RENDERER_VERSION;

/** Archive une pièce qui vient d'être émise, relue sous la session de l'émetteur. */
export async function archiveIssuedAffiliateDocument(reference: string): Promise<boolean> {
  const record = await loadAffiliateDocument(reference);
  if (!record) return false;
  if (record.snapshotRow.pdf_path) return true;
  return archiveOfficialPdf(record.document, renderAffiliateDocument(record), rendererOf(record), 'affiliation');
}

/**
 * Le PDF d'une pièce d'affiliation pour la session courante.
 *
 *   * émise et archivée — l'archive, après contrôle de l'empreinte ;
 *   * émise sans archive — rendue depuis l'instantané, puis archivée ;
 *   * remplacée ou annulée — rendue avec le bandeau qui le dit, jamais
 *     l'archive de l'émission, qui ne le disait pas.
 */
export async function getAffiliateDocumentPdf(reference: string): Promise<AffiliatePdf | null> {
  const record = await loadAffiliateDocument(reference);
  if (!record) return null;
  const fileName = record.type === 'FIAF' ? sheetFileName(record.snapshot) : statementFileName(record.document.reference);

  if (record.document.status === 'EMIS' && record.snapshotRow.pdf_path) {
    const archived = await readVerifiedArchive(record.snapshotRow, 'affiliation');
    if (archived) return { bytes: archived, fileName, source: 'archive' };
    return { bytes: renderAffiliateDocument(record), fileName, source: 'rendu' };
  }
  const bytes = renderAffiliateDocument(record);
  if (record.document.status === 'EMIS') {
    await archiveOfficialPdf(record.document, bytes, rendererOf(record), 'affiliation');
  }
  return { bytes, fileName, source: 'rendu' };
}

/**
 * Aperçu actuel d'une fiche : l'affilié lui-même ou `affiliates.view` (la
 * base en décide). Jamais archivé, jamais numéroté.
 */
export async function getSheetPreviewPdf(affiliateId: string): Promise<AffiliatePdf | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(affiliateId)) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('affiliate_sheet_preview', { p_affiliate_id: affiliateId });
  if (error || !data) return null;
  const snapshot = parseSheetSnapshot(data);
  if (!snapshot || !snapshot.preview) return null;
  return { bytes: renderSheetPdf(snapshot, { logo: invoiceLogo() }), fileName: sheetFileName(snapshot), source: 'apercu' };
}
