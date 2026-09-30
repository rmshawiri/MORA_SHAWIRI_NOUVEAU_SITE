/**
 * Forme d'un justificatif : type réel, chemin, empreinte.
 *
 * Séparé de `proofs.ts`, qui porte `server-only` parce qu'il ouvre le client
 * Supabase. Ces trois fonctions-ci ne touchent ni la base ni le réseau : ce
 * sont des fonctions pures, et les isoler permet de les éprouver directement
 * dans la suite unitaire — un contrôle de type de fichier qu'on ne peut pas
 * tester ne vaut pas grand-chose.
 *
 * Les règles qu'elles appliquent viennent des § 26 à § 38 du document
 * Stockage :
 *
 *   * **le type réel**, lu dans les premiers octets et non dans l'en-tête
 *     déclaré ni dans l'extension — § 31 : « ne jamais considérer l'extension
 *     comme seule preuve du type réel d'un fichier » ;
 *   * **le chemin**, construit par le serveur à partir d'identifiants qu'il
 *     connaît, jamais à partir du nom envoyé — § 26 ;
 *   * **l'empreinte**, qui rend le dépôt idempotent.
 */

import { createHash, randomUUID } from 'node:crypto';

import { PROOF_EXTENSIONS, PROOF_MAX_BYTES, type PROOF_MIME_TYPES } from './labels';

type ProofMimeType = (typeof PROOF_MIME_TYPES)[number];

export type SniffResult =
  | { ok: true; mimeType: ProofMimeType; extension: string }
  | { ok: false; reason: 'taille' | 'type' | 'vide' };

/**
 * Détermine le type d'un fichier d'après son contenu.
 *
 * Les quatre signatures sont celles des formats acceptés. Un exécutable
 * renommé `recu.pdf`, une archive déguisée en image, un SVG portant du script :
 * aucun ne franchit cette fonction, parce qu'aucun ne commence par les octets
 * attendus.
 */
export function sniffProof(bytes: Uint8Array, size: number): SniffResult {
  if (size <= 0) return { ok: false, reason: 'vide' };
  if (size > PROOF_MAX_BYTES) return { ok: false, reason: 'taille' };
  if (bytes.length < 12) return { ok: false, reason: 'type' };

  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  // JPEG : FF D8 FF
  if (starts(0xff, 0xd8, 0xff)) {
    return { ok: true, mimeType: 'image/jpeg', extension: PROOF_EXTENSIONS['image/jpeg'] };
  }

  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { ok: true, mimeType: 'image/png', extension: PROOF_EXTENSIONS['image/png'] };
  }

  // WebP : « RIFF » …quatre octets de taille… « WEBP »
  const ascii = (offset: number, text: string) =>
    [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    return { ok: true, mimeType: 'image/webp', extension: PROOF_EXTENSIONS['image/webp'] };
  }

  // PDF : « %PDF- »
  if (ascii(0, '%PDF-')) {
    return { ok: true, mimeType: 'application/pdf', extension: PROOF_EXTENSIONS['application/pdf'] };
  }

  return { ok: false, reason: 'type' };
}

/**
 * Chemin de stockage d'un justificatif.
 *
 * `<commande>/<paiement>/<uuid>.<ext>`, et rien d'autre. Les deux premiers
 * segments sont des identifiants que le serveur a lus en base ; le troisième
 * est tiré au sort. Le nom d'origine n'entre pas dans le chemin : il est
 * conservé à part, pour l'affichage.
 *
 * Une contrainte de la table impose cette forme, et la politique Storage lit
 * le premier segment pour décider de l'accès. Un `../` n'a donc aucune prise :
 * il ne passerait ni la contrainte, ni la politique.
 */
export function buildProofPath(orderId: string, paymentId: string, extension: string): string {
  return `${orderId}/${paymentId}/${randomUUID()}.${extension}`;
}

export function checksumOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
