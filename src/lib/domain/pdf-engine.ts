/**
 * Moteur PDF documentaire — socle commun à toutes les pièces officielles.
 *
 * Module **pur** : aucune dépendance serveur, aucun accès réseau, aucune
 * horloge. Les mêmes données produisent les mêmes octets, aujourd'hui comme
 * dans cinq ans — c'est ce qui permet de reproduire une facture à partir de son
 * instantané et de vérifier qu'elle n'a pas bougé.
 *
 * Il reprend les choix de la phase 4D (`pdf.ts`) et les prolonge :
 *
 *   * PDF 1.4 et polices de base (Helvetica et ses variantes), présentes dans
 *     tout lecteur — aucune police embarquée, aucune bibliothèque ;
 *   * encodage WinAnsi, partagé avec `pdf.ts` : accents, guillemets français,
 *     tirets et apostrophes typographiques passent ;
 *   * palette officielle du système de design, et elle seule.
 *
 * Ce qu'il ajoute : plusieurs pages, une image (le logo) avec sa
 * transparence, un flux de mise en page qui ouvre une page quand la place
 * manque, et un tableau dont l'en-tête se répète sur chaque page sans jamais
 * couper une ligne en deux.
 *
 * Les gabarits métier (facture aujourd'hui ; devis, bon de livraison, avoir,
 * relevé de commission demain) composent avec ces briques. Aucun d'eux n'écrit
 * d'octet PDF lui-même.
 */

import { BRAND_COLORS, toWinAnsi } from './pdf';

export { BRAND_COLORS };

export type Colour = readonly [number, number, number];
export type FontStyle = 'regular' | 'bold' | 'italic';

/** A4 en points typographiques. */
export const A4 = { width: 595.28, height: 841.89 } as const;

const FONT_RESOURCE: Record<FontStyle, string> = { regular: 'FR', bold: 'FB', italic: 'FI' };

/* -------------------------------------------------------------------------- */
/* Métrique                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Largeurs Helvetica et Helvetica-Bold, en millièmes de cadratin (AFM Adobe).
 *
 * Contrairement à la phase 4D, où la mesure ne servait qu'à couper des lignes,
 * elle sert ici à **aligner à droite** des montants : une approximation se
 * verrait. La graisse a donc sa propre table.
 */
const ASCII = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

// prettier-ignore
const REGULAR_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// prettier-ignore
const BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Caractères hors ASCII, mêmes largeurs dans les deux graisses sauf mention. */
const EXTRA_WIDTHS: Record<string, [number, number]> = {
  ' ': [278, 278],
  '«': [556, 556],
  '»': [556, 556],
  '—': [1000, 1000],
  '–': [556, 556],
  '’': [222, 278],
  '‘': [222, 278],
  '“': [333, 500],
  '”': [333, 500],
  '…': [1000, 1000],
  '€': [556, 556],
  'œ': [944, 944],
  'Œ': [1000, 1000],
  '°': [400, 400],
  '·': [278, 278],
  '•': [350, 350],
  'ß': [611, 611],
  'æ': [889, 889],
  'Æ': [1000, 1000],
};

function charWidth(character: string, bold: boolean): number {
  const index = ASCII.indexOf(character);
  if (index !== -1) return (bold ? BOLD_WIDTHS : REGULAR_WIDTHS)[index]!;

  const extra = EXTRA_WIDTHS[character];
  if (extra) return extra[bold ? 1 : 0];

  // Une lettre accentuée a la chasse de sa lettre de base.
  const base = character.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (base.length === 1 && base !== character) return charWidth(base, bold);

  return 556;
}

/** Largeur d'un texte, en points, pour une taille et une graisse données. */
export function textWidth(value: string, size: number, style: FontStyle = 'regular'): number {
  let thousandths = 0;
  for (const character of value.normalize('NFC')) {
    thousandths += charWidth(character, style === 'bold');
  }
  return (thousandths / 1000) * size;
}

/**
 * Découpe un texte en lignes tenant dans la largeur donnée.
 *
 * Seule l'espace ordinaire sépare deux mots : l'espace insécable, qui relie un
 * montant à sa devise ou les milliers d'un nombre, n'est jamais une coupure.
 * Un mot plus large que la colonne — une référence, une adresse — est coupé
 * au caractère plutôt que de déborder : un texte qui sort de sa case est
 * précisément ce qu'un document officiel ne doit pas montrer.
 */
export function wrapLines(
  value: string,
  size: number,
  maxWidth: number,
  style: FontStyle = 'regular',
): string[] {
  const lines: string[] = [];

  // Typographie française : un guillemet ou un signe double ne commence ni ne
  // termine jamais une ligne seul. L'espace qui les sépare devient insécable.
  const french = value
    .replace(/« /g, '« ')
    .replace(/ (»|:|;|!|\?)/g, ' $1');

  for (const paragraph of french.split(/\r?\n/)) {
    const words = paragraph.split(/[ \t]+/).filter((word) => word.length > 0);
    let current = '';

    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (textWidth(candidate, size, style) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current !== '') lines.push(current);
      current = '';

      if (textWidth(word, size, style) <= maxWidth) {
        current = word;
        continue;
      }

      // Mot trop long : coupe au caractère.
      let piece = '';
      for (const character of word) {
        if (textWidth(piece + character, size, style) > maxWidth && piece !== '') {
          lines.push(piece);
          piece = character;
        } else {
          piece += character;
        }
      }
      current = piece;
    }

    if (current !== '') lines.push(current);
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

function pdfString(value: string): string {
  return `(${toWinAnsi(value).replace(/([\\()])/g, '\\$1')})`;
}

/**
 * Chaîne de **métadonnées** (titre, auteur, créateur…). Le dictionnaire Info
 * n'est pas lu en WinAnsi mais en PDFDocEncoding, où un tiret cadratin
 * devient « Š » : tout texte non ASCII y est donc écrit en UTF-16BE, comme la
 * norme le prévoit. Le texte des pages, lui, reste en WinAnsi pour les
 * polices standard.
 */
export function pdfInfoString(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return `(${value.replace(/([\\()])/g, '\\$1')})`;
  let hex = 'FEFF';
  for (let i = 0; i < value.length; i += 1) hex += value.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

const n = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const colour = (c: Colour) => `${c[0].toFixed(4)} ${c[1].toFixed(4)} ${c[2].toFixed(4)}`;

/** Une page : une suite d'opérateurs de dessin. */
export class PdfPage {
  private readonly ops: string[] = [];

  fill(c: Colour): this {
    this.ops.push(`${colour(c)} rg`);
    return this;
  }

  stroke(c: Colour): this {
    this.ops.push(`${colour(c)} RG`);
    return this;
  }

  rect(x: number, y: number, width: number, height: number): this {
    this.ops.push(`${n(x)} ${n(y)} ${n(width)} ${n(height)} re f`);
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.75): this {
    this.ops.push(`${n(width)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`);
    return this;
  }

  text(value: string, x: number, y: number, size: number, style: FontStyle = 'regular'): this {
    if (value === '') return this;
    this.ops.push(`BT /${FONT_RESOURCE[style]} ${n(size)} Tf ${n(x)} ${n(y)} Td ${pdfString(value)} Tj ET`);
    return this;
  }

  /** Texte aligné à droite sur `right`. */
  textRight(value: string, right: number, y: number, size: number, style: FontStyle = 'regular'): this {
    return this.text(value, right - textWidth(value, size, style), y, size, style);
  }

  image(name: string, x: number, y: number, width: number, height: number): this {
    this.ops.push(`q ${n(width)} 0 0 ${n(height)} ${n(x)} ${n(y)} cm /${name} Do Q`);
    return this;
  }

  toString(): string {
    return this.ops.join('\n');
  }
}

/* -------------------------------------------------------------------------- */
/* Flux de mise en page                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Curseur vertical qui ouvre une page quand la place manque.
 *
 * `startPage` dessine l'en-tête d'une page de suite et rend la hauteur à
 * laquelle le contenu reprend ; le pied de page, qui doit connaître le nombre
 * total de pages, est dessiné après coup par l'appelant.
 */
export class PdfFlow {
  readonly pages: PdfPage[] = [];
  cursor: number;

  constructor(
    private readonly bottom: number,
    private readonly startPage: (page: PdfPage, index: number) => number,
  ) {
    const first = new PdfPage();
    this.pages.push(first);
    this.cursor = startPage(first, 0);
  }

  get page(): PdfPage {
    return this.pages[this.pages.length - 1]!;
  }

  /** Place restante sur la page courante. */
  get room(): number {
    return this.cursor - this.bottom;
  }

  newPage(): void {
    const page = new PdfPage();
    this.pages.push(page);
    this.cursor = this.startPage(page, this.pages.length - 1);
  }

  /** Garantit `height` points de place ; ouvre une page sinon. Vrai si ouverte. */
  ensure(height: number): boolean {
    if (this.room >= height) return false;
    this.newPage();
    return true;
  }
}

/* -------------------------------------------------------------------------- */
/* Tableau                                                                     */
/* -------------------------------------------------------------------------- */

export type TableColumn = {
  label: string;
  width: number;
  align: 'left' | 'right';
};

/** Une cellule : un texte principal, et une mention secondaire facultative. */
export type TableCell = { main: string; sub?: string | null };

export type TableStyle = {
  x: number;
  size: number;
  subSize: number;
  headerSize: number;
  leading: number;
  padding: number;
  headerFill: Colour;
  headerText: Colour;
  stripe: Colour;
  text: Colour;
  subText: Colour;
  rule: Colour;
};

/**
 * Dessine un tableau dans le flux.
 *
 * L'en-tête est dessiné au départ, puis **répété** en tête de chaque page
 * ouverte par une ligne qui ne tenait plus. Une ligne n'est jamais coupée :
 * elle passe entière sur la page suivante. Les textes sont découpés à la
 * largeur de leur colonne, donc ne débordent ni ne se superposent.
 */
export function drawTable(
  flow: PdfFlow,
  columns: readonly TableColumn[],
  rows: readonly (readonly TableCell[])[],
  style: TableStyle,
): void {
  const width = columns.reduce((total, column) => total + column.width, 0);
  const headerHeight = style.headerSize + style.padding * 2 + 2;

  const drawHeader = () => {
    const top = flow.cursor;
    flow.page.fill(style.headerFill).rect(style.x, top - headerHeight, width, headerHeight);
    flow.page.fill(style.headerText);

    let x = style.x;
    for (const column of columns) {
      const baseline = top - style.padding - style.headerSize + 1;
      if (column.align === 'right') {
        flow.page.textRight(column.label, x + column.width - style.padding, baseline, style.headerSize, 'bold');
      } else {
        flow.page.text(column.label, x + style.padding, baseline, style.headerSize, 'bold');
      }
      x += column.width;
    }
    flow.cursor = top - headerHeight;
  };

  // Un en-tête seul en bas de page serait orphelin : il part avec sa première ligne.
  const layouts = rows.map((row) =>
    row.map((cell, index) => {
      const inner = columns[index]!.width - style.padding * 2;
      return {
        main: wrapLines(cell.main, style.size, inner),
        sub: cell.sub ? wrapLines(cell.sub, style.subSize, inner, 'italic') : [],
      };
    }),
  );

  const heightOf = (layout: (typeof layouts)[number]) =>
    Math.max(
      ...layout.map(
        (cell) =>
          cell.main.length * style.leading +
          cell.sub.length * (style.subSize + 3) +
          style.padding * 2,
      ),
    );

  flow.ensure(headerHeight + (layouts[0] ? heightOf(layouts[0]) : 0));
  drawHeader();

  layouts.forEach((layout, rowIndex) => {
    const height = heightOf(layout);

    if (flow.ensure(height)) drawHeader();

    const top = flow.cursor;
    if (rowIndex % 2 === 1) {
      flow.page.fill(style.stripe).rect(style.x, top - height, width, height);
    }

    let x = style.x;
    layout.forEach((cell, index) => {
      const column = columns[index]!;
      let baseline = top - style.padding - style.size + 1.5;

      flow.page.fill(style.text);
      for (const line of cell.main) {
        if (column.align === 'right') {
          flow.page.textRight(line, x + column.width - style.padding, baseline, style.size);
        } else {
          flow.page.text(line, x + style.padding, baseline, style.size);
        }
        baseline -= style.leading;
      }

      // La mention secondaire suit la dernière ligne principale, à son propre
      // interligne — le même que celui compté par `heightOf`.
      flow.page.fill(style.subText);
      let subBaseline = baseline + style.leading - (style.subSize + 3);
      for (const line of cell.sub) {
        if (column.align === 'right') {
          flow.page.textRight(line, x + column.width - style.padding, subBaseline, style.subSize, 'italic');
        } else {
          flow.page.text(line, x + style.padding, subBaseline, style.subSize, 'italic');
        }
        subBaseline -= style.subSize + 3;
      }

      x += column.width;
    });

    flow.cursor = top - height;
  });

  flow.page.stroke(style.rule).line(style.x, flow.cursor, style.x + width, flow.cursor, 1);
}

/* -------------------------------------------------------------------------- */
/* Assemblage du fichier                                                       */
/* -------------------------------------------------------------------------- */

/** Image matricielle déjà comprimée en zlib : couleurs RVB et transparence. */
export type PdfImage = {
  name: string;
  width: number;
  height: number;
  rgb: Uint8Array;
  alpha?: Uint8Array | null;
};

export type PdfMetadata = {
  title: string;
  subject: string;
  author: string;
  creator: string;
  /** Date de la pièce, jamais celle du rendu : deux rendus restent identiques. */
  creationDate: string;
};

function latin1(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return bytes;
}

/** Décode du base64 sans dépendre de `Buffer` : le module reste pur. */
export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Date PDF (`D:AAAAMMJJHHmmSS+03'00'`) à l'heure de Moroni, à partir d'un
 * horodatage ISO. Le fuseau des Comores est fixe (UTC+3, sans heure d'été).
 */
export function pdfDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "D:19700101000000+00'00'";
  const local = new Date(time + 3 * 3600 * 1000);
  const p = (value: number) => String(value).padStart(2, '0');
  return (
    `D:${local.getUTCFullYear()}${p(local.getUTCMonth() + 1)}${p(local.getUTCDate())}` +
    `${p(local.getUTCHours())}${p(local.getUTCMinutes())}${p(local.getUTCSeconds())}+03'00'`
  );
}

/**
 * Produit le fichier : catalogue, arbre des pages, trois polices, images,
 * pages et contenus, informations. Les décalages de la table `xref` sont
 * relevés au fil de l'écriture, en octets.
 */
export function assemblePdf(
  pages: readonly PdfPage[],
  images: readonly PdfImage[],
  meta: PdfMetadata,
): Uint8Array {
  type Obj = string | { dict: string; stream: Uint8Array };
  const objects: Obj[] = [];
  const add = (object: Obj) => {
    objects.push(object);
    return objects.length;
  };

  const catalogId = add('');
  const pagesId = add('');
  const fonts = {
    FR: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    FB: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    FI: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'),
  };

  const imageIds: Record<string, number> = {};
  for (const image of images) {
    let smask = '';
    if (image.alpha) {
      const maskId = add({
        dict:
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
          `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.alpha.length} >>`,
        stream: image.alpha,
      });
      smask = ` /SMask ${maskId} 0 R`;
    }
    imageIds[image.name] = add({
      dict:
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask} /Length ${image.rgb.length} >>`,
      stream: image.rgb,
    });
  }

  const fontDict = `/Font << /FR ${fonts.FR} 0 R /FB ${fonts.FB} 0 R /FI ${fonts.FI} 0 R >>`;
  const xobjects = Object.entries(imageIds)
    .map(([name, id]) => `/${name} ${id} 0 R`)
    .join(' ');
  const resources = `<< ${fontDict}${xobjects ? ` /XObject << ${xobjects} >>` : ''} >>`;

  const pageIds: number[] = [];
  for (const page of pages) {
    const content = latin1(page.toString());
    const contentId = add({ dict: `<< /Length ${content.length} >>`, stream: content });
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.width.toFixed(2)} ${A4.height.toFixed(2)}] ` +
          `/Resources ${resources} /Contents ${contentId} 0 R >>`,
      ),
    );
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const infoId = add(
    `<< /Title ${pdfInfoString(meta.title)} /Author ${pdfInfoString(meta.author)} ` +
      `/Subject ${pdfInfoString(meta.subject)} /Creator ${pdfInfoString(meta.creator)} ` +
      `/Producer ${pdfInfoString('MORA Shawiri — Moteur de Documents')} ` +
      `/CreationDate (${meta.creationDate}) >>`,
  );

  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    length += bytes.length;
  };

  // En-tête, suivi d'un commentaire binaire : signale aux outils de transfert
  // que le fichier n'est pas du texte (§ 7.5.2 de la norme).
  push(latin1('%PDF-1.4\n%âãÏÓ\n'));

  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(length);
    if (typeof object === 'string') {
      push(latin1(`${index + 1} 0 obj\n${object}\nendobj\n`));
    } else {
      push(latin1(`${index + 1} 0 obj\n${object.dict}\nstream\n`));
      push(object.stream);
      push(latin1('\nendstream\nendobj\n'));
    }
  });

  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  push(latin1(xref));
  push(
    latin1(
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`,
    ),
  );

  const file = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    file.set(chunk, position);
    position += chunk.length;
  }
  return file;
}
