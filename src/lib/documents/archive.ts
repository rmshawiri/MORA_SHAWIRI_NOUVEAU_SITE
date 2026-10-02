import 'server-only';

/**
 * Archive privée des pièces officielles — commune à toutes les pièces rendues
 * depuis un instantané (FACL, FIAF, RVAF).
 *
 *   * le fichier est déposé par le serveur, avec la clé à privilèges, dans le
 *     bucket privé `documents-officiels`, sous `<TYPE>/<uuid du document>.pdf` ;
 *   * son empreinte SHA-256, sa taille et la version du gabarit sont
 *     enregistrées une seule fois (`record_document_archive`) ;
 *   * à la lecture, le fichier est relu **sous la session** (la politique du
 *     bucket revérifie le droit) et servi seulement si son empreinte est
 *     intacte — sinon on rend de nouveau depuis l'instantané, à l'identique.
 *
 * Aucune URL n'est remise au navigateur, signée ou non.
 */

import { createHash } from 'node:crypto';

import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { DocumentRow, DocumentSnapshotRow } from '@/lib/supabase/types';

export const OFFICIAL_BUCKET = 'documents-officiels';

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** `<TYPE>/<uuid du document>.pdf`. Ni nom, ni référence. */
export function archivePath(document: Pick<DocumentRow, 'doc_type' | 'id'>): string {
  return `${document.doc_type}/${document.id}.pdf`;
}

/**
 * Dépose l'archive d'une pièce émise et enregistre son empreinte.
 * Idempotente : un dépôt déjà fait n'est pas refait, une empreinte enregistrée
 * n'est jamais remplacée.
 */
export async function archiveOfficialPdf(
  document: Pick<DocumentRow, 'doc_type' | 'id' | 'status'>,
  bytes: Uint8Array,
  renderer: string,
  label = 'documents',
): Promise<boolean> {
  if (document.status !== 'EMIS') return false;
  const admin = getAdminSupabaseClient();
  if (!admin) return false;

  const path = archivePath(document);
  const upload = await admin.storage.from(OFFICIAL_BUCKET).upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
    cacheControl: 'private, no-store',
  });
  // Un objet déjà présent n'est pas une erreur : un rattrapage concurrent l'a
  // déposé. Son empreinte est vérifiée à la lecture.
  if (upload.error && !/exist|duplicate/i.test(upload.error.message)) {
    console.error(`[${label}] dépôt de l’archive impossible`);
    return false;
  }

  const { error } = await admin.rpc('record_document_archive', {
    p_document_id: document.id,
    p_path: path,
    p_sha256: sha256(bytes),
    p_size: bytes.byteLength,
    p_renderer: renderer,
  });
  if (error) {
    console.error(`[${label}] enregistrement de l’archive impossible`);
    return false;
  }
  return true;
}

/**
 * Relit l'archive sous la session et la rend si son empreinte est intacte ;
 * `null` sinon (absente, illisible, ou altérée — l'incident est signalé).
 */
export async function readVerifiedArchive(snapshotRow: DocumentSnapshotRow, label = 'documents'): Promise<Uint8Array | null> {
  if (!snapshotRow.pdf_path || !snapshotRow.pdf_sha256) return null;
  const supabase = await getServerSupabaseClient();
  const download = supabase ? await supabase.storage.from(OFFICIAL_BUCKET).download(snapshotRow.pdf_path) : null;
  if (!download?.data) return null;
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  if (sha256(bytes) === snapshotRow.pdf_sha256) return bytes;
  console.error(`[${label}] empreinte d’archive inattendue — rendu depuis l’instantané`);
  return null;
}
