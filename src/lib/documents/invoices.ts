import 'server-only';

/**
 * Factures officielles — lecture, rendu et archive.
 *
 * ## Le chemin d'une facture, de l'émission au téléchargement
 *
 *   1. `issue_order_invoice()` alloue le numéro FACL par le Moteur de
 *      Documents et fige l'instantané dans la même transaction ;
 *   2. le serveur rend le PDF **à partir de l'instantané**, le dépose dans le
 *      bucket privé `documents-officiels`, et enregistre son empreinte ;
 *   3. au téléchargement, l'archive est relue, son empreinte revérifiée, et
 *      servie telle quelle — l'octet près celle de l'émission.
 *
 * Si l'étape 2 n'a pas pu avoir lieu (stockage indisponible au moment de
 * l'émission), le premier téléchargement la rattrape : le rendu est
 * déterministe, donc le fichier archivé alors est celui qui l'aurait été.
 *
 * ## Qui peut lire
 *
 * La pièce et son instantané sont lus avec la **session** de la personne :
 * RLS décide — le destinataire, ou qui détient `orders.view`. Rien n'est lu si
 * elle refuse. La clé à privilèges n'intervient qu'ensuite, et pour une seule
 * chose : déposer dans le bucket un fichier que le serveur vient de rendre
 * lui-même. Aucune URL n'est remise au navigateur, signée ou non.
 */

import { createHash } from 'node:crypto';

import { invoiceLogo } from '@/lib/documents/logo';
import { parseReference } from '@/lib/domain/documents';
import {
  INVOICE_RENDERER_VERSION,
  invoiceFileName,
  parseInvoiceSnapshot,
  renderInvoicePdf,
  type InvoiceSnapshot,
} from '@/lib/domain/invoice-pdf';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { DocumentRow, DocumentSnapshotRow } from '@/lib/supabase/types';

export const INVOICE_BUCKET = 'documents-officiels';

export type InvoiceRecord = {
  document: DocumentRow;
  snapshotRow: DocumentSnapshotRow;
  snapshot: InvoiceSnapshot;
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Chemin d'archive : `FACL/<uuid du document>.pdf`. Ni nom, ni référence. */
export function invoiceArchivePath(documentId: string): string {
  return `FACL/${documentId}.pdf`;
}

/**
 * Facture lisible par la session courante, ou `null`.
 *
 * `null` couvre indistinctement : référence mal formée, facture inexistante,
 * facture d'un autre client, instantané illisible. Le § 102 demande de ne pas
 * dire lequel.
 */
export async function loadInvoice(reference: string): Promise<InvoiceRecord | null> {
  const normalised = reference.trim().toUpperCase();
  const parsed = parseReference(normalised);
  if (!parsed || parsed.type !== 'FACL') return null;

  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data: document } = await supabase
    .from('documents')
    .select('*')
    .eq('reference', normalised)
    .eq('doc_type', 'FACL')
    .maybeSingle();
  if (!document) return null;

  const { data: snapshotRow } = await supabase
    .from('document_snapshots')
    .select('*')
    .eq('document_id', document.id)
    .maybeSingle();
  if (!snapshotRow) return null;

  const snapshot = parseInvoiceSnapshot(snapshotRow.content);
  if (!snapshot || snapshot.reference !== document.reference) return null;

  return { document, snapshotRow, snapshot };
}

/** Rendu depuis l'instantané, et lui seul. */
export function renderInvoice(record: Pick<InvoiceRecord, 'document' | 'snapshot'>): Uint8Array {
  return renderInvoicePdf(record.snapshot, {
    logo: invoiceLogo(),
    status: record.document.status,
  });
}

/**
 * Dépose l'archive d'une facture émise et enregistre son empreinte.
 *
 * Appelée juste après l'émission, puis en rattrapage au premier
 * téléchargement. Idempotente : un dépôt déjà fait n'est pas refait, et
 * l'empreinte déjà enregistrée n'est jamais remplacée.
 */
export async function archiveInvoice(
  record: Pick<InvoiceRecord, 'document' | 'snapshot'>,
  bytes: Uint8Array = renderInvoice(record),
): Promise<boolean> {
  if (record.document.status !== 'EMIS') return false;

  const admin = getAdminSupabaseClient();
  if (!admin) return false;

  const path = invoiceArchivePath(record.document.id);

  const upload = await admin.storage.from(INVOICE_BUCKET).upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
    cacheControl: 'private, no-store',
  });

  // Un objet déjà présent n'est pas une erreur : un rattrapage concurrent l'a
  // déposé. Son empreinte est vérifiée à la lecture.
  if (upload.error && !/exist|duplicate/i.test(upload.error.message)) {
    console.error('[factures] dépôt de l’archive impossible');
    return false;
  }

  const { error } = await admin.rpc('record_document_archive', {
    p_document_id: record.document.id,
    p_path: path,
    p_sha256: sha256(bytes),
    p_size: bytes.byteLength,
    p_renderer: INVOICE_RENDERER_VERSION,
  });

  if (error) {
    console.error('[factures] enregistrement de l’archive impossible');
    return false;
  }
  return true;
}

/**
 * Archive une facture qui vient d'être émise, par sa référence.
 *
 * La facture est relue avec la session de l'émetteur : on n'archive que ce
 * que cette session a le droit de lire.
 */
export async function archiveIssuedInvoice(reference: string): Promise<boolean> {
  const record = await loadInvoice(reference);
  if (!record || record.snapshotRow.pdf_path) return Boolean(record);
  return archiveInvoice(record);
}

export type InvoicePdf = { bytes: Uint8Array; fileName: string; source: 'archive' | 'rendu' };

/**
 * Le PDF d'une facture, pour la session courante.
 *
 *   * facture émise et archivée — l'archive, après contrôle de l'empreinte ;
 *   * facture émise sans archive — rendue depuis l'instantané, puis archivée ;
 *   * facture annulée ou remplacée — rendue avec le bandeau qui le dit,
 *     jamais l'archive de l'émission, qui ne le disait pas.
 *
 * Une archive dont l'empreinte ne correspond plus n'est **jamais** servie :
 * on rend depuis l'instantané, et l'incident est signalé.
 */
export async function getInvoicePdf(reference: string): Promise<InvoicePdf | null> {
  const record = await loadInvoice(reference);
  if (!record) return null;

  const fileName = invoiceFileName(record.document.reference);
  const { snapshotRow } = record;

  if (record.document.status === 'EMIS' && snapshotRow.pdf_path && snapshotRow.pdf_sha256) {
    const supabase = await getServerSupabaseClient();
    // Lecture sous la session : la politique du bucket revérifie le droit.
    const download = supabase
      ? await supabase.storage.from(INVOICE_BUCKET).download(snapshotRow.pdf_path)
      : null;

    if (download?.data) {
      const bytes = new Uint8Array(await download.data.arrayBuffer());
      if (sha256(bytes) === snapshotRow.pdf_sha256) {
        return { bytes, fileName, source: 'archive' };
      }
      console.error('[factures] empreinte d’archive inattendue — rendu depuis l’instantané');
    }

    return { bytes: renderInvoice(record), fileName, source: 'rendu' };
  }

  const bytes = renderInvoice(record);
  if (record.document.status === 'EMIS' && !snapshotRow.pdf_path) {
    await archiveInvoice(record, bytes);
  }
  return { bytes, fileName, source: 'rendu' };
}
