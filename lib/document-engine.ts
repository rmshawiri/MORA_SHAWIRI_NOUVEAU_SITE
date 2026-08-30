/**
 * MORA Shawiri — Moteur de Documents (centralisé)
 * ------------------------------------------------
 * Source unique de génération des identifiants officiels. Aucun module ne doit
 * inventer sa propre numérotation.
 *
 * Format officiel :  MORA-[TYPE]-[SÉRIE][NUMÉRO]   (ex: MORA-FACL-A0001)
 * Série : A0001..A9999 -> B0001..B9999 -> C0001.. -> AA0001..AB0001...
 * L'identifiant est STABLE ; le nom du client/affilié ne sert qu'au nom de
 * fichier et n'est jamais la clé d'identification.
 */

/** Types de documents officiels (nomenclature MORA Shawiri). */
export const DOCUMENT_TYPES = {
  DEVIS_CLIENT: { code: "DVCL", label: "Devis Client" },
  COMMANDE_CLIENT: { code: "CMCL", label: "Commande Client" },
  BON_LIVRAISON_CLIENT: { code: "BLCL", label: "Bon de livraison Client" },
  FACTURE_CLIENT: { code: "FACL", label: "Facture Client" },
  AVOIR_CLIENT: { code: "AVCL", label: "Avoir Client" },
  ACCUSE_CLIENT: { code: "ACCL", label: "Accusé de réception Client" },
  COMMISSION_AFFILIE: { code: "COMAF", label: "Commission Affilié" },
} as const;

export type DocumentTypeCode = (typeof DOCUMENT_TYPES)[keyof typeof DOCUMENT_TYPES]["code"];

/** Séries alphabétiques (A, B, ..., Z, AA, AB, ..., ZZ). */
function seriesSuffix(series: number): string {
  if (series <= 0) return "A";
  if (series <= 26) return String.fromCharCode(64 + series); // A..Z
  // AA, AB, ...
  const letters = [];
  let n = series - 26;
  while (n > 0) {
    letters.unshift(String.fromCharCode(64 + ((n - 1) % 26) + 1));
    n = Math.floor((n - 1) / 26);
  }
  return letters.join("").padStart(2, "A").replace(/^/, ""); // begins at AA
}

/**
 * Construit un identifiant officiel à partir d'un type, d'une série et d'un numéro.
 * Exemple : buildDocumentId("FACL", 1, 1) -> "MORA-FACL-A0001"
 */
export function buildDocumentId(
  typeCode: DocumentTypeCode,
  series: number,
  number: number,
): string {
  const [M, S, N] = [
    "MORA",
    typeCode,
    `${seriesSuffix(series)}${String(number).padStart(4, "0")}`,
  ];
  return `${M}-${S}-${N}`;
}

/** Nom de fichier sécurisé (identifiant + nom client/affilié normalisé). */
export function buildDocumentFileName(
  documentId: string,
  entityName: string,
  extension = "pdf",
): string {
  const safeName = entityName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${documentId}_${safeName}.${extension}`;
}

/** Normalisation d'un nom (ex: "Mohamed Ali" -> "Mohamed-Ali"). */
export function normalizeEntityName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * ALLOCATION du prochain identifiant.
 * ⚠️ L'allocation transactionnelle (anti-collision) DOIT être faite côté serveur
 * sur une table de séquences. Cette fonction retourne un identifiant à titre
 * d'illustration et doit être remplacée par l'appel à l'allocateur en base
 * (voir `document_sequences` / migration dédiée) avant utilisation réelle.
 */
export async function allocateDocumentId(
  typeCode: DocumentTypeCode,
): Promise<{ id: string; name: string }> {
  // V1 : placeholder déterministe. En production, remplacer par un allocateur
  // transactionnel en base (série + compteur, contrainte d'unicité).
  const series = 1;
  const number = Math.floor((Date.now() % 9000) + 1);
  return {
    id: buildDocumentId(typeCode, series, number),
    name: DOCUMENT_TYPES[typeKey(typeCode)].label,
  };
}

function typeKey(code: DocumentTypeCode) {
  const found = (Object.keys(DOCUMENT_TYPES) as Array<keyof typeof DOCUMENT_TYPES>).find(
    (k) => DOCUMENT_TYPES[k].code === code,
  );
  return found ?? "DEVIS_CLIENT";
}
