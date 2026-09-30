import 'server-only';

/**
 * Justificatifs de paiement : validation, téléversement, relecture.
 *
 * Un fichier reçu d'un navigateur est une entrée hostile jusqu'à preuve du
 * contraire. Ce module applique, dans l'ordre, les contrôles que les § 26 à
 * § 38 du document Stockage réclament :
 *
 *   1. **la taille**, avant toute lecture du contenu ;
 *   2. **le type réel**, lu dans les premiers octets et non dans l'en-tête
 *      déclaré ni dans l'extension — § 31 : « ne jamais considérer
 *      l'extension comme seule preuve du type réel d'un fichier » ;
 *   3. **le chemin**, construit par le serveur à partir d'identifiants qu'il
 *      connaît, jamais à partir du nom envoyé — § 26 ;
 *   4. **l'empreinte**, qui rend le dépôt idempotent.
 *
 * Le bucket refuse de son côté ce qui dépasse 5 Mo ou n'est pas l'un des
 * quatre types autorisés, et la RLS refuse un dossier qui n'appartient pas à
 * l'appelant. Ces contrôles-ci ne remplacent pas les siens : ils donnent un
 * message utile avant que la base n'oppose un refus sec.
 *
 * ## Aucune URL permanente
 *
 * Le bucket est privé et le reste. La lecture passe par une URL signée,
 * produite ici après que la RLS a répondu — et valable quelques minutes. Le
 * § 23 est explicite : « connaître l'URL d'un fichier ne doit pas suffire à
 * obtenir un fichier privé ».
 */

import { getServerSupabaseClient } from '@/lib/supabase/server';

import { PROOF_MAX_BYTES } from './labels';
import { buildProofPath, checksumOf, sniffProof } from './proof-format';

export { buildProofPath, checksumOf, sniffProof } from './proof-format';
export type { SniffResult } from './proof-format';

export const PROOF_BUCKET = 'paiements-justificatifs';

/** Durée de vie d'une URL signée. § 80 : « une expiration adaptée ». */
export const PROOF_URL_TTL_SECONDS = 300;

export type ProofUploadResult =
  | { ok: true; proofId: string }
  | { ok: false; reason: 'taille' | 'type' | 'vide' | 'refus' | 'indisponible' };

/**
 * Téléverse un justificatif puis le rattache à son paiement.
 *
 * Le téléversement passe par le client de **session** : c'est la politique
 * Storage qui autorise ou refuse, en lisant l'identifiant de commande dans le
 * chemin. Un client qui tenterait de déposer dans le dossier d'un autre serait
 * refusé par la base, pas par une vérification applicative qu'un appel direct
 * contournerait.
 */
export async function uploadPaymentProof(params: {
  orderId: string;
  paymentId: string;
  file: File;
}): Promise<ProofUploadResult> {
  const { orderId, paymentId, file } = params;

  if (file.size > PROOF_MAX_BYTES) return { ok: false, reason: 'taille' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffProof(bytes, bytes.byteLength);
  if (!sniffed.ok) return { ok: false, reason: sniffed.reason };

  const supabase = await getServerSupabaseClient();
  if (!supabase) return { ok: false, reason: 'indisponible' };

  const path = buildProofPath(orderId, paymentId, sniffed.extension);

  const { error: uploadError } = await supabase.storage
    .from(PROOF_BUCKET)
    .upload(path, bytes, { contentType: sniffed.mimeType, upsert: false });

  if (uploadError) {
    console.error('[commerce] téléversement du justificatif refusé');
    return { ok: false, reason: 'refus' };
  }

  const { data, error } = await supabase.rpc('attach_payment_proof', {
    p_payment_id: paymentId,
    p_storage_path: path,
    p_mime_type: sniffed.mimeType,
    p_file_size: bytes.byteLength,
    p_checksum: checksumOf(bytes),
    p_original_name: file.name,
  });

  if (error || !data) {
    // L'objet a été déposé mais n'a pas pu être rattaché : il n'appartient à
    // aucun justificatif et n'a donc rien à faire dans le bucket.
    await supabase.storage.from(PROOF_BUCKET).remove([path]);
    console.error('[commerce] rattachement du justificatif refusé');
    return { ok: false, reason: 'refus' };
  }

  return { ok: true, proofId: data.id };
}

/**
 * URL temporaire d'un justificatif, produite après contrôle d'autorisation.
 *
 * L'autorisation n'est pas vérifiée ici : elle l'est par la politique Storage,
 * que le client de session ne peut pas contourner. Si l'appelant n'a pas le
 * droit de lire l'objet, Supabase ne signe rien et cette fonction renvoie
 * `null`.
 */
export async function signProofUrl(storagePath: string): Promise<string | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(storagePath, PROOF_URL_TTL_SECONDS);

  if (error || !data) return null;
  return data.signedUrl;
}
