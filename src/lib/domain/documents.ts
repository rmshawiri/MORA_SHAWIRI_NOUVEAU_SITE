/**
 * Nomenclature officielle des documents — module pur.
 *
 * Aucune dépendance serveur, aucun accès réseau : tout ce qui est ici se
 * calcule, donc se teste sans base de données. C'est volontaire. La règle du
 * § 38 du prompt maître — « Deux documents du même type ne doivent jamais
 * recevoir le même identifiant » — est garantie par la base, pas par ce
 * fichier ; mais le *format*, la progression des séries et la normalisation
 * des noms de fichiers sont des règles d'écriture, et elles se vérifient mieux
 * à froid, sur les 10 000 cas d'une série entière.
 *
 * ## Décision D-2
 *
 * Tranchée par le propriétaire le 30 septembre 2026, avant la première ligne
 * de code de la phase 4D. Trois conventions coexistaient dans les documents de
 * référence ; une seule est normative. Le format officiel
 * `MORA-[TYPE]-[SÉRIE][NUMÉRO]` s'applique désormais à **tout**, y compris à
 * la référence visible d'une commande et d'une commission. Les formats
 * `MS-2026-000001` et `CMD-2026-0001` sont écartés : leurs propres sources les
 * qualifient d'exemples.
 *
 * Conséquence directe : **la référence ne porte pas l'année**. Le millésime vit
 * dans `issued_at`, qui est indexé. Une série ne se réinitialise jamais au
 * 1er janvier — c'est la progression alphabétique du § 38 qui absorbe le
 * débordement, et elle seule.
 *
 * ## Ce que ce fichier n'est pas
 *
 * Ce n'est pas un allocateur. Rien ici ne décide du prochain numéro : cette
 * décision appartient à `public.allocate_document_number()`, sous verrou de
 * ligne. Un calcul applicatif du prochain numéro serait exactement le défaut
 * que le plan § 8 demande d'éviter.
 *
 * Références : prompt maître § 36-43, § 74-77 ; plan § 4.8 et phase 4D.
 */

/** Codes documentaires officiels, nommés par le prompt maître § 75. */
export const DOCUMENT_TYPES = [
  { code: 'DVCL', label: 'Devis client', entityType: 'quote' },
  { code: 'CMCL', label: 'Commande client', entityType: 'order' },
  { code: 'ACCL', label: 'Acompte client', entityType: 'payment' },
  { code: 'BLCL', label: 'Bon de livraison client', entityType: 'order' },
  { code: 'FACL', label: 'Facture client', entityType: 'order' },
  { code: 'AVCL', label: 'Avoir client', entityType: 'order' },
  { code: 'COMAF', label: 'Relevé de commission affilié', entityType: 'commission' },
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number]['code'];

export type DocumentStatus = 'EMIS' | 'ANNULE' | 'REMPLACE';

/** Préfixe institutionnel. Invariable (§ 37). */
export const REFERENCE_PREFIX = 'MORA';

/** Dernier numéro d'une série avant passage à la suivante (§ 38). */
export const SERIES_CAPACITY = 9999;

/** Largeur du numéro, zéros compris : `A0001`, jamais `A1`. */
export const NUMBER_WIDTH = 4;

/**
 * Forme exacte d'une référence officielle.
 *
 * La série est `[A-Z]+` et non `[A-Z]` : le § 38 prévoit explicitement le
 * passage à `AA0001` lorsque `Z9999` est atteint.
 */
export const REFERENCE_PATTERN = /^MORA-([A-Z]{4,6})-([A-Z]+)(\d{4})$/;

export type DocumentReference = {
  type: string;
  series: string;
  number: number;
};

export function isDocumentType(value: string): value is DocumentType {
  return DOCUMENT_TYPES.some((entry) => entry.code === value);
}

export function documentTypeLabel(code: string): string | null {
  return DOCUMENT_TYPES.find((entry) => entry.code === code)?.label ?? null;
}

/**
 * Compose une référence officielle.
 *
 * Refuse plutôt que de corriger : une série hors forme ou un numéro hors
 * bornes signale un état de la base que rien ne devrait pouvoir produire, et
 * le masquer par un `padStart` complaisant reviendrait à fabriquer une
 * référence plausible pour un compteur cassé.
 */
export function formatReference(input: DocumentReference): string {
  if (!/^[A-Z]{4,6}$/.test(input.type)) {
    throw new RangeError(`Type documentaire invalide : ${input.type}`);
  }
  if (!/^[A-Z]+$/.test(input.series)) {
    throw new RangeError(`Série invalide : ${input.series}`);
  }
  if (!Number.isInteger(input.number) || input.number < 1 || input.number > SERIES_CAPACITY) {
    throw new RangeError(`Numéro hors série : ${input.number}`);
  }

  const number = String(input.number).padStart(NUMBER_WIDTH, '0');
  return `${REFERENCE_PREFIX}-${input.type}-${input.series}${number}`;
}

/** Décompose une référence, ou `null` si elle n'en est pas une. */
export function parseReference(value: string): DocumentReference | null {
  const match = REFERENCE_PATTERN.exec(value.trim().toUpperCase());
  if (!match) return null;

  const number = Number.parseInt(match[3]!, 10);
  if (number < 1 || number > SERIES_CAPACITY) return null;

  return { type: match[1]!, series: match[2]!, number };
}

/**
 * Série suivante : `A` → `B` → … → `Z` → `AA` → `AB` → … → `ZZ` → `AAA`.
 *
 * C'est l'incrément d'une colonne de tableur, et c'est exactement la
 * progression que les exemples du § 38 décrivent. Miroir fidèle de
 * `public.document_next_series()` : les deux sont comparés par test.
 */
export function nextSeries(series: string): string {
  const current = series.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(current)) {
    throw new RangeError(`Série invalide : ${series}`);
  }

  const chars = [...current];
  let index = chars.length - 1;

  while (index >= 0) {
    if (chars[index] !== 'Z') {
      chars[index] = String.fromCharCode(chars[index]!.charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[index] = 'A';
    index -= 1;
  }

  // Retenue sortie par la gauche : la série gagne un caractère.
  return `A${chars.join('')}`;
}

/**
 * Identifiant qui suivrait celui-ci dans la même suite.
 *
 * Sert uniquement à **vérifier** une suite déjà écrite — un contrôle de
 * continuité, un test de bascule `A9999` → `B0001`. Ne l'utilisez jamais pour
 * décider d'un numéro à attribuer : c'est le travail exclusif de la base.
 */
export function nextReference(reference: DocumentReference): DocumentReference {
  if (reference.number >= SERIES_CAPACITY) {
    return { type: reference.type, series: nextSeries(reference.series), number: 1 };
  }
  return { ...reference, number: reference.number + 1 };
}

/* -------------------------------------------------------------------------- */
/* Noms de fichiers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Caractères que le § 42 nomme explicitement comme incompatibles :
 * `/ \ : * ? " < > |`.
 */
export const FORBIDDEN_FILENAME_CHARACTERS = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'] as const;

/**
 * Noms réservés par Windows. Un fichier nommé `NUL.pdf` n'est pas seulement
 * gênant : sur un poste Windows, il est inouvrable. Le § 42 demande d'éviter
 * les noms « problématiques » ; ceux-ci le sont sans contenir le moindre
 * caractère interdit.
 */
const RESERVED_FILENAME_STEMS = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** Longueur retenue pour la partie « nom du sujet » du fichier. */
export const SUBJECT_NAME_MAX_LENGTH = 60;

/**
 * Normalise un nom de client ou d'affilié pour un nom de fichier (§ 42).
 *
 * « Mohamed Ali » devient « Mohamed-Ali ». Trois traitements se superposent, et
 * chacun répond à un problème distinct :
 *
 * 1. **Les accents sont réduits à leur lettre de base.** Le § 42 demande un nom
 *    « normalisé » sans en fixer le jeu de caractères. Un `é` traverse mal les
 *    en-têtes HTTP, les systèmes de fichiers hérités et les clients de
 *    messagerie ; il est décomposé puis dépouillé de son accent. Le nom
 *    complet, lui, reste intact en base et dans le PDF — c'est le *fichier*
 *    qu'on normalise, pas la personne.
 * 2. **Les caractères interdits et de contrôle disparaissent.** Les neuf du
 *    § 42, plus ceux que le texte ne nomme pas mais qui cassent tout autant :
 *    caractères de contrôle, et le point en tête ou en fin.
 * 3. **Les espaces et séparateurs deviennent un tiret unique**, sans tiret en
 *    tête ni en fin, sans doublon.
 *
 * Renvoie une chaîne vide si rien d'exploitable ne subsiste — l'appelant
 * décide alors de s'en passer, car le § 77 rappelle que ce nom n'est jamais
 * une clé.
 */
export function normalizeSubjectName(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';

  const withoutDiacritics = value.normalize('NFD').replace(/\p{Diacritic}/gu, '');

  const cleaned = withoutDiacritics
    // L'apostrophe disparaît sans laisser de séparateur : « O'Brien » doit
    // donner « OBrien », pas « O-Brien » — un tiret y ressemblerait à un nom
    // composé, ce qu'il n'est pas.
    .replace(/['’ʼ`]/g, '')
    // Caractères interdits par le § 42, caractères de contrôle, et tout ce qui
    // n'est ni lettre latine, ni chiffre, ni séparateur usuel.
    .replace(/[^\p{Letter}\p{Number}\s._-]/gu, ' ')
    // `_` et `.` sont tolérés dans un nom de fichier mais n'ont rien à faire
    // dans un nom de personne : ils rejoignent les séparateurs.
    .replace(/[\s._]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  const truncated = cleaned.slice(0, SUBJECT_NAME_MAX_LENGTH).replace(/-+$/, '');

  if (truncated.length === 0) return '';
  if (RESERVED_FILENAME_STEMS.has(truncated.toUpperCase())) return `${truncated}-doc`;

  return truncated;
}

/**
 * Nom de fichier d'un document (§ 39-41).
 *
 *   `MORA-FACL-A0001_Mohamed-Ali.pdf`
 *
 * L'identifiant officiel vient en premier et ne bouge jamais ; le nom du sujet
 * n'est là que pour la lisibilité humaine. Si le client change de nom, le
 * fichier téléchargé demain portera le nouveau nom — et la même référence. Le
 * § 40 ne demande rien d'autre, et le § 77 interdit de faire du nom une clé.
 */
export function documentFileName(
  reference: string,
  subjectName?: string | null,
  extension = 'pdf',
): string {
  const subject = normalizeSubjectName(subjectName);
  const base = subject.length > 0 ? `${reference}_${subject}` : reference;
  return `${base}.${extension}`;
}

/** Vrai si aucun caractère nommé par le § 42 ne subsiste. */
export function isSafeFileName(value: string): boolean {
  if (value.length === 0) return false;
  if (FORBIDDEN_FILENAME_CHARACTERS.some((character) => value.includes(character))) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('.') || value.startsWith('-')) return false;
  if (/[ .]$/.test(value)) return false;

  return true;
}
