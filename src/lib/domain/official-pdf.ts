/**
 * Mise en page commune des pièces officielles — facture (FACL), fiche
 * affilié (FIAF), relevé de versement (RVAF).
 *
 * Module **pur**, posé sur le moteur PDF partagé (`pdf-engine.ts`) : un seul
 * moteur, une seule identité visuelle. En-tête avec le logo circulaire
 * officiel, en-tête réduit des pages suivantes, pied numéroté « page x / n »,
 * panneaux à liseré or, montants et dates mis en forme sans `Intl` — une mise
 * à jour de Node ne doit pas changer les octets d'une pièce rendue de nouveau.
 *
 * Extrait tel quel du gabarit de facture de 4G : la facture rendue avant et
 * après l'extraction est identique au bit près (contrôlé par test).
 */

import { A4, BRAND_COLORS, type PdfImage, type PdfPage, textWidth, wrapLines } from './pdf-engine';

export const MARGIN = 40;
export const CONTENT = A4.width - MARGIN * 2;
export const RIGHT = A4.width - MARGIN;
export const FOOTER_TOP = 70;
/** Hauteur du logo dans l'en-tête, en points (≈ 2,5 cm). */
export const LOGO_HEIGHT = 70;
const { blue, gold, black, grey } = BRAND_COLORS;

export type IssuerIdentity = { name: string; slogan: string; address: string; phone: string; email: string };

/* -------------------------------------------------------------------------- */
/* Mise en forme déterministe                                                  */
/* -------------------------------------------------------------------------- */

/** Espace insécable (U+00A0), écrite en échappement pour ne jamais se perdre. */
const NBSP = '\u00a0';

/** `15 000 KMF`, `1 250,50 KMF` — espaces insécables, décimales si utiles. */
export function formatOfficialAmount(value: number, currency: string): string {
  const negative = value < 0;
  const cents = Math.round(Math.abs(value) * 100);
  const units = Math.floor(cents / 100);
  const rest = cents % 100;
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const decimals = rest > 0 ? `,${String(rest).padStart(2, '0')}` : '';
  return `${negative ? '–' : ''}${grouped}${decimals}${NBSP}${currency}`;
}

/** Quantité sans zéros décoratifs : `1`, `2,5`, `0,125`. */
export function formatOfficialQuantity(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  const [whole, fraction] = String(rounded).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return fraction ? `${grouped},${fraction}` : grouped;
}

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** `1er octobre 2026`, à l'heure de Moroni (UTC+3, fixe). */
export function formatOfficialDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '—';
  const local = new Date(time + 3 * 3600 * 1000);
  const day = local.getUTCDate();
  return `${day === 1 ? '1er' : day} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}`;
}

/* -------------------------------------------------------------------------- */
/* En-têtes et pied                                                            */
/* -------------------------------------------------------------------------- */

export type HeaderInput = {
  issuer: IssuerIdentity;
  /** Titre en capitales : `FACTURE`, `FICHE AFFILIÉ`, `RELEVÉ DE VERSEMENT`. */
  title: string;
  /** Référence officielle ; absente pour un aperçu. */
  reference: string | null;
  /** Ligne de date sous la référence. */
  dateLine: string;
  /** Taille du titre : la facture garde la sienne. */
  titleSize?: number;
};

export function drawOfficialHeader(page: PdfPage, input: HeaderInput, logo: PdfImage | null): number {
  const top = A4.height - MARGIN;

  // Logo, ou à défaut le nom — l'identité reste lisible dans les deux cas.
  // Le logo est calé sur une hauteur : un logo circulaire (1:1) comme un logo
  // en bandeau garde ses proportions d'origine, sans étirement.
  if (logo) {
    const height = LOGO_HEIGHT;
    const width = (height * logo.width) / logo.height;
    page.image(logo.name, MARGIN, top - height, width, height);
  } else {
    page.fill(blue).text(input.issuer.name, MARGIN, top - 22, 20, 'bold');
  }

  // Titre, numéro et date, à droite.
  page.fill(blue).textRight(input.title, RIGHT, top - 22, input.titleSize ?? 26, 'bold');
  page.fill(black).textRight(input.reference ? `N° ${input.reference}` : 'Sans numéro', RIGHT, top - 42, 11.5, 'bold');
  page.textRight(input.dateLine, RIGHT, top - 57, 9.5);

  // Émetteur, sous le logo.
  let y = top - LOGO_HEIGHT - 16;
  page.fill(blue).text(input.issuer.name, MARGIN, y, 10.5, 'bold');
  page.fill(black);
  for (const line of [
    input.issuer.slogan,
    input.issuer.address,
    [input.issuer.phone && `Tél. ${input.issuer.phone}`, input.issuer.email].filter(Boolean).join(' · '),
  ]) {
    if (!line) continue;
    y -= 12;
    page.text(line, MARGIN, y, 8.8, line === input.issuer.slogan ? 'italic' : 'regular');
  }

  y -= 14;
  page.stroke(gold).line(MARGIN, y, RIGHT, y, 1.6);
  return y - 16;
}

export function drawContinuationHeader(page: PdfPage, input: Pick<HeaderInput, 'title' | 'reference' | 'dateLine'>): number {
  const top = A4.height - MARGIN;
  const label = input.reference ? `${input.title} ${input.reference}` : input.title;
  page.fill(blue).text(label, MARGIN, top - 12, 12, 'bold');
  page.fill(black).text('(suite)', MARGIN + textWidth(`${label} `, 12, 'bold'), top - 12, 10, 'italic');
  page.textRight(input.dateLine, RIGHT, top - 12, 9);
  page.stroke(gold).line(MARGIN, top - 22, RIGHT, top - 22, 1.2);
  return top - 40;
}

export function drawOfficialFooter(page: PdfPage, issuer: IssuerIdentity, mark: string, index: number, count: number): void {
  page.stroke(gold).line(MARGIN, FOOTER_TOP - 8, RIGHT, FOOTER_TOP - 8, 1);

  const identity = [issuer.name, issuer.slogan].filter(Boolean).join(' — ');
  const contact = [issuer.address, issuer.phone, issuer.email].filter(Boolean).join(' · ');

  page.fill(blue).text(identity, MARGIN, FOOTER_TOP - 22, 7.8, 'bold');
  page.fill(black).text(contact, MARGIN, FOOTER_TOP - 33, 7.8);
  page.fill(blue).textRight(`${mark} — page ${index + 1} / ${count}`, RIGHT, FOOTER_TOP - 22, 7.8, 'bold');
}

/* -------------------------------------------------------------------------- */
/* Panneaux                                                                    */
/* -------------------------------------------------------------------------- */

export type PanelRow = { value: string; style?: 'regular' | 'bold'; size?: number };

/** Bloc à fond gris : un intitulé, puis des lignes. Rend sa hauteur. */
export function drawPanel(
  page: PdfPage,
  x: number,
  top: number,
  width: number,
  title: string,
  rows: PanelRow[],
  minHeight = 0,
): number {
  const padding = 10;
  const laid = rows.flatMap((row) =>
    wrapLines(row.value, row.size ?? 9.2, width - padding * 2, row.style ?? 'regular').map((line) => ({
      line,
      style: row.style ?? 'regular',
      size: row.size ?? 9.2,
    })),
  );
  const height = Math.max(minHeight, padding * 2 + 12 + laid.reduce((total, row) => total + row.size + 3.5, 0));

  page.fill(grey).rect(x, top - height, width, height);
  page.fill(gold).rect(x, top - height, 2.5, height);

  let y = top - padding - 7;
  page.fill(blue).text(title, x + padding + 2, y, 7.8, 'bold');
  y -= 6;
  page.fill(black);
  for (const row of laid) {
    y -= row.size + 3.5;
    page.text(row.line, x + padding + 2, y + 3, row.size, row.style);
  }
  return height;
}

export function measurePanel(width: number, rows: PanelRow[]): number {
  const padding = 10;
  const count = rows.flatMap((row) =>
    wrapLines(row.value, row.size ?? 9.2, width - padding * 2, row.style ?? 'regular').map(() => row.size ?? 9.2),
  );
  return padding * 2 + 12 + count.reduce((total, size) => total + size + 3.5, 0);
}
