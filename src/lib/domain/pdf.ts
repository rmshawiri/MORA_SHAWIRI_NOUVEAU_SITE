/**
 * Génération PDF aux couleurs de la marque — écrivain minimal, sans dépendance.
 *
 * ## Pourquoi pas une bibliothèque
 *
 * Un document officiel est une pièce comptable : il doit pouvoir être régénéré
 * à l'identique dans cinq ans. Les trois bibliothèques PDF courantes pèsent
 * chacune plusieurs mégaoctets, embarquent leurs propres polices, et
 * changeraient le rendu au fil de leurs versions majeures. Le format PDF 1.4,
 * lui, ne bouge plus depuis 2001, et les quatorze polices de base sont
 * garanties présentes dans tout lecteur.
 *
 * Ce que produit ce fichier tient en quelques kilo-octets, ne dépend de rien,
 * et se relit. C'est un choix de durabilité, pas d'économie.
 *
 * ## Ce qu'il fait, et ce qu'il ne fait pas
 *
 * Il compose une page A4 aux couleurs officielles, avec un en-tête, un tableau
 * d'informations et un pied de page. Il ne fait ni image, ni police
 * personnalisée, ni pagination automatique au-delà d'une seconde page : le
 * Moteur de Documents de la phase 4D produit des pièces d'identification, pas
 * des mises en page libres. Les documents commerciaux détaillés viendront avec
 * leurs lignes en phases 4F à 4H, et ce socle les portera.
 *
 * Référence : `01_IDENTITE_MARQUE/SYSTEME_DESIGN_MORA_SHAWIRI.md` § 5-7
 * (palette officielle) ; `07_ARCHITECTURE_TECHNIQUE/05_STOCKAGE.md` § 128.
 */

/* -------------------------------------------------------------------------- */
/* Palette officielle (§ 5 du système de design)                               */
/* -------------------------------------------------------------------------- */

/** Chaque couleur en composantes PDF (0 → 1), dans l'ordre rouge, vert, bleu. */
export const BRAND_COLORS = {
  /** Bleu MORA `#003366` — couleur institutionnelle principale. */
  blue: [0x00 / 255, 0x33 / 255, 0x66 / 255],
  /** Or Shawiri `#FFD700` — accent, jamais dominant. */
  gold: [0xff / 255, 0xd7 / 255, 0x00 / 255],
  /** Vert `#00A859` — validation. Le § 5 interdit d'en faire la dominante. */
  green: [0x00 / 255, 0xa8 / 255, 0x59 / 255],
  white: [1, 1, 1],
  black: [0, 0, 0],
  /** Gris structure `#F2F2F2` — sépare sans ajouter de couleur. */
  grey: [0xf2 / 255, 0xf2 / 255, 0xf2 / 255],
} as const;

type Colour = readonly [number, number, number];

/* -------------------------------------------------------------------------- */
/* Encodage du texte                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Caractères hors Latin-1 que WinAnsiEncoding place à un emplacement précis.
 * Sans cette table, « MORA Shawiri — agence » perdrait son tiret cadratin et
 * les guillemets français, qui sont partout dans les contenus du site.
 */
const WIN_ANSI_EXTRAS = new Map<string, number>([
  ['€', 0x80], // €
  ['‚', 0x82],
  ['ƒ', 0x83],
  ['„', 0x84],
  ['…', 0x85], // …
  ['†', 0x86],
  ['‡', 0x87],
  ['ˆ', 0x88],
  ['‰', 0x89],
  ['Š', 0x8a],
  ['‹', 0x8b],
  ['Œ', 0x8c], // Œ
  ['Ž', 0x8e],
  ['‘', 0x91],
  ['’', 0x92], // ’
  ['“', 0x93],
  ['”', 0x94],
  ['•', 0x95],
  ['–', 0x96], // –
  ['—', 0x97], // —
  ['˜', 0x98],
  ['™', 0x99],
  ['š', 0x9a],
  ['›', 0x9b],
  ['œ', 0x9c], // œ
  ['ž', 0x9e],
  ['Ÿ', 0x9f],
]);

/**
 * Traduit une chaîne JavaScript en octets WinAnsi.
 *
 * Un caractère sans équivalent est remplacé par une espace plutôt que par un
 * point d'interrogation : sur une facture, un `?` ressemble à une donnée
 * douteuse, une espace ressemble à ce qu'elle est.
 */
export function toWinAnsi(value: string): string {
  let out = '';

  for (const character of value.normalize('NFC')) {
    const code = character.codePointAt(0)!;

    if (code === 0x0a || code === 0x0d || code === 0x09) {
      out += ' ';
      continue;
    }
    if (code >= 0x20 && code <= 0x7e) {
      out += character;
      continue;
    }
    if (code >= 0xa0 && code <= 0xff) {
      out += character;
      continue;
    }

    const mapped = WIN_ANSI_EXTRAS.get(character);
    if (mapped !== undefined) {
      out += String.fromCharCode(mapped);
      continue;
    }

    // Dernière tentative : réduire l'accent plutôt que perdre la lettre.
    const stripped = character.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    out += /^[ -~]+$/.test(stripped) ? stripped : ' ';
  }

  return out;
}

/** Échappe les trois caractères qu'une chaîne littérale PDF ne supporte pas. */
function pdfString(value: string): string {
  return `(${toWinAnsi(value).replace(/([\\()])/g, '\\$1')})`;
}

/* -------------------------------------------------------------------------- */
/* Mesure et découpe                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Largeurs Helvetica, en millièmes de cadratin.
 *
 * Seules les valeurs des caractères réellement rencontrés sont tabulées ; les
 * autres retombent sur 556, la largeur moyenne de la fonte. Une approximation
 * suffit : elle ne sert qu'à décider où couper une ligne, jamais à positionner
 * un caractère — c'est le lecteur PDF qui compose.
 */
const HELVETICA_WIDTHS: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, 'A': 667, 'B': 667, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778,
  'H': 722, 'I': 278, 'J': 500, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778,
  'P': 667, 'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944,
  'X': 667, 'Y': 667, 'Z': 611, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556,
  '`': 333, 'a': 556, 'b': 556, 'c': 500, 'd': 556, 'e': 556, 'f': 278, 'g': 556,
  'h': 556, 'i': 222, 'j': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556,
  'p': 556, 'q': 556, 'r': 333, 's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722,
  'x': 500, 'y': 500, 'z': 500, '{': 334, '|': 260, '}': 334, '~': 584,
};

/** Largeur approchée d'un texte, en points, pour une taille donnée. */
export function measureText(value: string, size: number, bold = false): number {
  let thousandths = 0;

  for (const character of toWinAnsi(value)) {
    thousandths += HELVETICA_WIDTHS[character] ?? 556;
  }

  // Helvetica-Bold est sensiblement plus large ; 6 % suffisent à éviter les
  // débordements sans faire de ce module un moteur typographique.
  return (thousandths / 1000) * size * (bold ? 1.06 : 1);
}

/** Découpe un texte en lignes tenant dans la largeur donnée. */
export function wrapText(value: string, size: number, maxWidth: number, bold = false): string[] {
  const words = value.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;

    if (measureText(candidate, size, bold) <= maxWidth || current.length === 0) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                 */
/* -------------------------------------------------------------------------- */

/** A4 en points typographiques. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export type DocumentField = {
  label: string;
  value: string;
};

export type DocumentPdfSpec = {
  /** Intitulé du type — « Facture client », « Devis client »… */
  title: string;
  /** Identifiant officiel. Affiché tel quel, jamais recomposé. */
  reference: string;
  /** Date d'émission, déjà formatée par l'appelant. */
  issuedAt: string;
  /** Nom du client ou de l'affilié, tel qu'enregistré. */
  subjectName?: string | null;
  /** Statut affiché lorsqu'il n'est pas « émis ». */
  statusNotice?: string | null;
  fields: readonly DocumentField[];
  /** Mention de pied de page. */
  footer?: string | null;
};

class ContentStream {
  private parts: string[] = [];

  fill(colour: Colour): this {
    this.parts.push(`${colour[0].toFixed(4)} ${colour[1].toFixed(4)} ${colour[2].toFixed(4)} rg`);
    return this;
  }

  stroke(colour: Colour): this {
    this.parts.push(`${colour[0].toFixed(4)} ${colour[1].toFixed(4)} ${colour[2].toFixed(4)} RG`);
    return this;
  }

  rect(x: number, y: number, width: number, height: number): this {
    this.parts.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.75): this {
    this.parts.push(
      `${width.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`,
    );
    return this;
  }

  text(value: string, x: number, y: number, size: number, bold = false): this {
    this.parts.push(
      `BT /${bold ? 'FB' : 'FR'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(value)} Tj ET`,
    );
    return this;
  }

  toString(): string {
    return this.parts.join('\n');
  }
}

/**
 * Compose le contenu d'une pièce officielle.
 *
 * Le bandeau supérieur porte le Bleu MORA, l'Or Shawiri n'apparaît qu'en
 * filet : le § 5 du système de design est explicite, l'or est un accent et ne
 * doit jamais devenir dominant. Le gris structure sépare les lignes du tableau
 * sans introduire de couleur supplémentaire (§ 6).
 */
function composeDocument(spec: DocumentPdfSpec): string {
  const content = new ContentStream();

  // Bandeau institutionnel.
  const bandHeight = 96;
  content.fill(BRAND_COLORS.blue).rect(0, PAGE_HEIGHT - bandHeight, PAGE_WIDTH, bandHeight);
  content.fill(BRAND_COLORS.gold).rect(0, PAGE_HEIGHT - bandHeight - 3, PAGE_WIDTH, 3);

  content
    .fill(BRAND_COLORS.white)
    .text('MORA SHAWIRI', MARGIN, PAGE_HEIGHT - 46, 20, true)
    .text('Agence digitale — Moroni, Union des Comores', MARGIN, PAGE_HEIGHT - 66, 9);

  // L'identifiant officiel, aligné à droite du bandeau : c'est la donnée la
  // plus importante de la page, et la seule qui ne changera jamais.
  const referenceWidth = measureText(spec.reference, 13, true);
  content.text(spec.reference, PAGE_WIDTH - MARGIN - referenceWidth, PAGE_HEIGHT - 46, 13, true);

  const titleWidth = measureText(spec.title, 10);
  content.text(spec.title, PAGE_WIDTH - MARGIN - titleWidth, PAGE_HEIGHT - 66, 10);

  let cursor = PAGE_HEIGHT - bandHeight - 48;

  content.fill(BRAND_COLORS.blue).text(spec.title, MARGIN, cursor, 17, true);
  cursor -= 20;

  content.fill(BRAND_COLORS.black).text(`Émis le ${spec.issuedAt}`, MARGIN, cursor, 10);
  cursor -= 28;

  if (spec.statusNotice) {
    content.fill(BRAND_COLORS.grey).rect(MARGIN, cursor - 6, CONTENT_WIDTH, 24);
    content.fill(BRAND_COLORS.blue).text(spec.statusNotice, MARGIN + 10, cursor + 2, 10, true);
    cursor -= 40;
  }

  if (spec.subjectName && spec.subjectName.trim().length > 0) {
    content.fill(BRAND_COLORS.black).text('Destinataire', MARGIN, cursor, 9);
    cursor -= 16;
    content.fill(BRAND_COLORS.blue).text(spec.subjectName.trim(), MARGIN, cursor, 13, true);
    cursor -= 30;
  }

  // Tableau d'informations. Une ligne grise une sur deux, pas de bordure :
  // le § 6 demande de structurer sans multiplier les couleurs.
  const labelWidth = 170;
  const rowHeight = 22;

  spec.fields.forEach((field, index) => {
    if (index % 2 === 0) {
      content.fill(BRAND_COLORS.grey).rect(MARGIN, cursor - 6, CONTENT_WIDTH, rowHeight);
    }

    content.fill(BRAND_COLORS.black).text(field.label, MARGIN + 8, cursor, 9.5, true);

    const lines = wrapText(field.value, 10, CONTENT_WIDTH - labelWidth - 16);
    const first = lines[0] ?? '—';
    content.text(first, MARGIN + labelWidth, cursor, 10);

    cursor -= rowHeight;

    for (const line of lines.slice(1)) {
      content.text(line, MARGIN + labelWidth, cursor, 10);
      cursor -= 14;
    }
  });

  // Pied de page : filet or, puis la mention légale et la référence répétée.
  const footerY = MARGIN + 34;
  content.stroke(BRAND_COLORS.gold).line(MARGIN, footerY + 16, PAGE_WIDTH - MARGIN, footerY + 16, 1);

  if (spec.footer) {
    for (const [index, line] of wrapText(spec.footer, 8.5, CONTENT_WIDTH).entries()) {
      content.fill(BRAND_COLORS.black).text(line, MARGIN, footerY - index * 11, 8.5);
    }
  }

  const stamp = `${spec.reference} · page 1 / 1`;
  const stampWidth = measureText(stamp, 8.5);
  content.fill(BRAND_COLORS.blue).text(stamp, PAGE_WIDTH - MARGIN - stampWidth, footerY + 24, 8.5);

  return content.toString();
}

/* -------------------------------------------------------------------------- */
/* Assemblage du fichier                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Produit le fichier PDF complet.
 *
 * Les objets sont écrits à la suite, leurs décalages relevés au fil de
 * l'écriture, puis la table de références croisées les reprend. Tout est en
 * Latin-1 : un octet par caractère, donc une longueur de chaîne égale à un
 * décalage d'octet. C'est ce qui rend la table `xref` exacte sans arithmétique
 * séparée.
 */
export function renderDocumentPdf(spec: DocumentPdfSpec): Uint8Array {
  const content = composeDocument(spec);

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] ` +
      '/Resources << /Font << /FR 5 0 R /FB 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    // Métadonnées documentaires du § 43 : le lecteur doit pouvoir dire de quoi
    // il s'agit sans ouvrir le fichier.
    `<< /Title ${pdfString(`${spec.title} ${spec.reference}`)} ` +
      `/Author ${pdfString('MORA Shawiri')} ` +
      `/Subject ${pdfString(spec.reference)} ` +
      `/Creator ${pdfString('MORA Shawiri — Moteur de Documents')} >>`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = body.length;
  const count = objects.length + 1;

  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${count} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  const file = body + xref + trailer;

  const bytes = new Uint8Array(file.length);
  for (let index = 0; index < file.length; index += 1) {
    bytes[index] = file.charCodeAt(index) & 0xff;
  }

  return bytes;
}
