/**
 * Facture client (FACL) — gabarit PDF.
 *
 * Module **pur**. Il ne lit qu'une chose : l'instantané figé à l'émission par
 * `issue_order_invoice()` (`document_snapshots.content`). Ni la commande telle
 * qu'elle est devenue, ni le catalogue, ni le profil courant du client. C'est
 * la garantie demandée : une facture émise avec une prestation à 15 000 KMF
 * affichera 15 000 KMF même si le tarif passe à 20 000 KMF le lendemain.
 *
 * ## Ce que la facture affiche, et ce qu'elle n'affiche pas
 *
 * Elle affiche ce que la base connaît réellement : émetteur (informations
 * publiques du site), client, références, lignes, sous-total, remises et frais
 * s'il y en a, total, et le règlement constaté à la date d'émission.
 *
 * Elle n'affiche aucune taxe, aucune TVA, aucune mention légale, aucune
 * condition de paiement : rien de tout cela n'est défini par le projet
 * (décision D-17 ouverte). Aucun identifiant interne, aucune adresse de
 * stockage, aucun secret.
 *
 * ## Déterminisme
 *
 * Dates et montants sont mis en forme ici, à la main, et non par `Intl` : une
 * mise à jour de Node peut changer l'espace des milliers ou l'abréviation d'un
 * mois, et donc les octets d'une facture rendue de nouveau. Rendue deux fois,
 * une facture est identique au bit près ; `INVOICE_RENDERER_VERSION` change si
 * le gabarit change.
 */

import {
  A4,
  BRAND_COLORS,
  PdfFlow,
  type PdfImage,
  type PdfPage,
  type TableCell,
  type TableColumn,
  assemblePdf,
  drawTable,
  pdfDate,
  textWidth,
  wrapLines,
} from './pdf-engine';

/** Version du gabarit, enregistrée avec chaque archive. */
export const INVOICE_RENDERER_VERSION = 'facl-1.0';

/* -------------------------------------------------------------------------- */
/* L'instantané                                                                */
/* -------------------------------------------------------------------------- */

export type InvoiceLine = {
  designation: string;
  reference: string | null;
  unit: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
};

export type InvoiceSnapshot = {
  schema: 1;
  type: 'FACL';
  reference: string;
  issued_at: string;
  issuer: { name: string; slogan: string; address: string; phone: string; email: string };
  customer: { name: string; email: string | null; phone: string | null };
  references: { order: string; quote: string | null; request: string | null };
  currency: string;
  lines: InvoiceLine[];
  totals: { subtotal: number; discount: number; fees: number; total: number; paid: number; due: number };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** PostgREST sérialise `numeric` en nombre ; on accepte aussi la chaîne. */
const amount = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

/**
 * Lit et valide un instantané de facture.
 *
 * Refuse plutôt que de compléter : une facture rendue avec un champ deviné
 * serait pire qu'une facture absente. `null` signale un instantané illisible.
 */
export function parseInvoiceSnapshot(value: unknown): InvoiceSnapshot | null {
  if (!isRecord(value) || value.schema !== 1 || value.type !== 'FACL') return null;

  const reference = text(value.reference);
  const issuedAt = text(value.issued_at);
  const currency = text(value.currency);
  if (!reference || !/^MORA-FACL-[A-Z]+\d{4}$/.test(reference) || !issuedAt || !currency) return null;

  const { issuer, customer, references, totals, lines } = value;
  if (!isRecord(issuer) || !isRecord(customer) || !isRecord(references) || !isRecord(totals)) return null;
  if (!Array.isArray(lines) || lines.length === 0) return null;

  const parsedLines: InvoiceLine[] = [];
  for (const line of lines) {
    if (!isRecord(line)) return null;
    const designation = text(line.designation);
    const quantity = amount(line.quantity);
    const unitPrice = amount(line.unit_price);
    const discount = amount(line.discount) ?? 0;
    const total = amount(line.total);
    if (!designation || quantity === null || unitPrice === null || total === null) return null;
    parsedLines.push({
      designation,
      reference: text(line.reference),
      unit: text(line.unit),
      quantity,
      unit_price: unitPrice,
      discount,
      total,
    });
  }

  const order = text(references.order);
  const customerName = text(customer.name);
  const issuerName = text(issuer.name);
  const t = {
    subtotal: amount(totals.subtotal),
    discount: amount(totals.discount) ?? 0,
    fees: amount(totals.fees) ?? 0,
    total: amount(totals.total),
    paid: amount(totals.paid) ?? 0,
    due: amount(totals.due),
  };
  if (!order || !customerName || !issuerName || t.subtotal === null || t.total === null || t.due === null) {
    return null;
  }

  return {
    schema: 1,
    type: 'FACL',
    reference,
    issued_at: issuedAt,
    issuer: {
      name: issuerName,
      slogan: text(issuer.slogan) ?? '',
      address: text(issuer.address) ?? '',
      phone: text(issuer.phone) ?? '',
      email: text(issuer.email) ?? '',
    },
    customer: { name: customerName, email: text(customer.email), phone: text(customer.phone) },
    references: { order, quote: text(references.quote), request: text(references.request) },
    currency,
    lines: parsedLines,
    totals: { ...t, subtotal: t.subtotal, total: t.total, due: t.due },
  };
}

/* -------------------------------------------------------------------------- */
/* Mise en forme déterministe                                                  */
/* -------------------------------------------------------------------------- */

const NBSP = ' ';

/** `15 000 KMF`, `1 250,50 KMF` — espaces insécables, décimales si utiles. */
export function formatInvoiceAmount(value: number, currency: string): string {
  const negative = value < 0;
  const cents = Math.round(Math.abs(value) * 100);
  const units = Math.floor(cents / 100);
  const rest = cents % 100;
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const decimals = rest > 0 ? `,${String(rest).padStart(2, '0')}` : '';
  return `${negative ? '–' : ''}${grouped}${decimals}${NBSP}${currency}`;
}

/** Quantité sans zéros décoratifs : `1`, `2,5`, `0,125`. */
export function formatInvoiceQuantity(value: number): string {
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
export function formatInvoiceDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '—';
  const local = new Date(time + 3 * 3600 * 1000);
  const day = local.getUTCDate();
  return `${day === 1 ? '1er' : day} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}`;
}

/** Nom du fichier : la référence officielle, et elle seule. */
export function invoiceFileName(reference: string): string {
  return `${reference}.pdf`;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                 */
/* -------------------------------------------------------------------------- */

const MARGIN = 40;
const CONTENT = A4.width - MARGIN * 2;
const RIGHT = A4.width - MARGIN;
const FOOTER_TOP = 70;
const { blue, gold, black, white, grey } = BRAND_COLORS;

export type InvoiceRenderOptions = {
  /** Logo officiel, déjà préparé (`logo-asset.ts`). Absent : nom en toutes lettres. */
  logo?: PdfImage | null;
  /** État de la pièce. Autre que EMIS : un bandeau le dit sur chaque page. */
  status?: 'EMIS' | 'ANNULE' | 'REMPLACE';
};

const STATUS_NOTICE: Record<string, string> = {
  ANNULE: 'Facture annulée — document sans valeur.',
  REMPLACE: 'Facture remplacée par une version ultérieure.',
};

function drawFirstHeader(page: PdfPage, snapshot: InvoiceSnapshot, logo: PdfImage | null): number {
  const top = A4.height - MARGIN;

  // Logo, ou à défaut le nom — l'identité reste lisible dans les deux cas.
  if (logo) {
    const width = 128;
    const height = (width * logo.height) / logo.width;
    page.image(logo.name, MARGIN, top - height, width, height);
  } else {
    page.fill(blue).text(snapshot.issuer.name, MARGIN, top - 22, 20, 'bold');
  }

  // Titre, numéro et date, à droite.
  page.fill(blue).textRight('FACTURE', RIGHT, top - 22, 26, 'bold');
  page.fill(black).textRight(`N° ${snapshot.reference}`, RIGHT, top - 42, 11.5, 'bold');
  page.textRight(`Date d’émission : ${formatInvoiceDate(snapshot.issued_at)}`, RIGHT, top - 57, 9.5);

  // Émetteur, sous le logo.
  let y = top - 84;
  page.fill(blue).text(snapshot.issuer.name, MARGIN, y, 10.5, 'bold');
  page.fill(black);
  for (const line of [
    snapshot.issuer.slogan,
    snapshot.issuer.address,
    [snapshot.issuer.phone && `Tél. ${snapshot.issuer.phone}`, snapshot.issuer.email]
      .filter(Boolean)
      .join(' · '),
  ]) {
    if (!line) continue;
    y -= 12;
    page.text(line, MARGIN, y, 8.8, line === snapshot.issuer.slogan ? 'italic' : 'regular');
  }

  y -= 14;
  page.stroke(gold).line(MARGIN, y, RIGHT, y, 1.6);
  return y - 16;
}

function drawContinuationHeader(page: PdfPage, snapshot: InvoiceSnapshot): number {
  const top = A4.height - MARGIN;
  page.fill(blue).text(`FACTURE ${snapshot.reference}`, MARGIN, top - 12, 12, 'bold');
  page.fill(black).text('(suite)', MARGIN + textWidth(`FACTURE ${snapshot.reference} `, 12, 'bold'), top - 12, 10, 'italic');
  page.textRight(`Date d’émission : ${formatInvoiceDate(snapshot.issued_at)}`, RIGHT, top - 12, 9);
  page.stroke(gold).line(MARGIN, top - 22, RIGHT, top - 22, 1.2);
  return top - 40;
}

function drawFooter(page: PdfPage, snapshot: InvoiceSnapshot, index: number, count: number): void {
  page.stroke(gold).line(MARGIN, FOOTER_TOP - 8, RIGHT, FOOTER_TOP - 8, 1);

  const identity = [snapshot.issuer.name, snapshot.issuer.slogan].filter(Boolean).join(' — ');
  const contact = [snapshot.issuer.address, snapshot.issuer.phone, snapshot.issuer.email]
    .filter(Boolean)
    .join(' · ');

  page.fill(blue).text(identity, MARGIN, FOOTER_TOP - 22, 7.8, 'bold');
  page.fill(black).text(contact, MARGIN, FOOTER_TOP - 33, 7.8);
  page.fill(blue).textRight(`${snapshot.reference} — page ${index + 1} / ${count}`, RIGHT, FOOTER_TOP - 22, 7.8, 'bold');
}

/** Bloc à fond gris : un intitulé, puis des lignes. Rend sa hauteur. */
function drawPanel(
  page: PdfPage,
  x: number,
  top: number,
  width: number,
  title: string,
  rows: { value: string; style?: 'regular' | 'bold'; size?: number }[],
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

function measurePanel(width: number, rows: { value: string; style?: 'regular' | 'bold'; size?: number }[]): number {
  const padding = 10;
  const count = rows.flatMap((row) =>
    wrapLines(row.value, row.size ?? 9.2, width - padding * 2, row.style ?? 'regular').map(() => row.size ?? 9.2),
  );
  return padding * 2 + 12 + count.reduce((total, size) => total + size + 3.5, 0);
}

/**
 * Rend la facture.
 *
 * Page 1 : en-tête complet, émetteur, client, références, puis le tableau.
 * Pages suivantes : un en-tête réduit, l'en-tête du tableau répété. Chaque
 * page porte le pied officiel et sa numérotation « page x / n ».
 */
export function renderInvoicePdf(snapshot: InvoiceSnapshot, options: InvoiceRenderOptions = {}): Uint8Array {
  const logo = options.logo ?? null;
  const notice = options.status ? STATUS_NOTICE[options.status] : undefined;
  const currency = snapshot.currency;
  const money = (value: number) => formatInvoiceAmount(value, currency);

  const flow = new PdfFlow(FOOTER_TOP + 12, (page, index) => {
    const start = index === 0 ? drawFirstHeader(page, snapshot, logo) : drawContinuationHeader(page, snapshot);
    if (!notice) return start;
    page.fill(grey).rect(MARGIN, start - 24, CONTENT, 24);
    page.fill(blue).text(notice, MARGIN + 10, start - 16, 10, 'bold');
    return start - 36;
  });

  /* --- Client et références --------------------------------------------- */

  const half = (CONTENT - 14) / 2;
  const customerRows = [
    { value: snapshot.customer.name, style: 'bold' as const, size: 11 },
    ...(snapshot.customer.email ? [{ value: snapshot.customer.email }] : []),
    ...(snapshot.customer.phone ? [{ value: `Tél. ${snapshot.customer.phone}` }] : []),
  ];
  const referenceRows = [
    { value: `Commande : ${snapshot.references.order}`, style: 'bold' as const },
    ...(snapshot.references.quote ? [{ value: `Devis : ${snapshot.references.quote}` }] : []),
    ...(snapshot.references.request ? [{ value: `Demande : ${snapshot.references.request}` }] : []),
    { value: `Devise : ${currency === 'KMF' ? 'franc comorien (KMF)' : currency}` },
  ];
  const panelHeight = Math.max(measurePanel(half, customerRows), measurePanel(half, referenceRows));

  drawPanel(flow.page, MARGIN, flow.cursor, half, 'FACTURÉ À', customerRows, panelHeight);
  drawPanel(flow.page, MARGIN + half + 14, flow.cursor, half, 'RÉFÉRENCES', referenceRows, panelHeight);
  flow.cursor -= panelHeight + 20;

  /* --- Lignes ------------------------------------------------------------- */

  const hasDiscount = snapshot.lines.some((line) => line.discount > 0);
  const numeric = hasDiscount ? [44, 88, 74, 92] : [48, 96, 0, 100];
  const columns: TableColumn[] = [
    { label: 'Désignation', width: CONTENT - numeric.reduce((a, b) => a + b, 0), align: 'left' },
    { label: 'Qté', width: numeric[0]!, align: 'right' },
    { label: 'Prix unitaire', width: numeric[1]!, align: 'right' },
    ...(hasDiscount ? [{ label: 'Remise', width: numeric[2]!, align: 'right' as const }] : []),
    { label: 'Montant', width: numeric[3]!, align: 'right' },
  ];

  const rows: TableCell[][] = snapshot.lines.map((line) => [
    { main: line.designation, sub: line.reference ? `Réf. ${line.reference}` : null },
    { main: formatInvoiceQuantity(line.quantity), sub: line.unit },
    { main: money(line.unit_price) },
    ...(hasDiscount ? [{ main: line.discount > 0 ? `– ${money(line.discount)}` : '—' }] : []),
    { main: money(line.total) },
  ]);

  drawTable(flow, columns, rows, {
    x: MARGIN,
    size: 9.2,
    subSize: 7.6,
    headerSize: 8.4,
    leading: 12,
    padding: 7,
    headerFill: blue,
    headerText: white,
    stripe: grey,
    text: black,
    subText: blue,
    rule: blue,
  });

  /* --- Totaux ------------------------------------------------------------- */

  const totals: { label: string; value: string; strong?: boolean }[] = [
    { label: 'Sous-total', value: money(snapshot.totals.subtotal) },
  ];
  if (snapshot.totals.discount > 0) totals.push({ label: 'Remises', value: `– ${money(snapshot.totals.discount)}` });
  if (snapshot.totals.fees > 0) totals.push({ label: 'Frais', value: money(snapshot.totals.fees) });

  const settled: { label: string; value: string; strong?: boolean }[] =
    snapshot.totals.paid > 0
      ? [
          { label: 'Réglé à la date d’émission', value: money(snapshot.totals.paid) },
          { label: 'Reste à payer', value: money(snapshot.totals.due), strong: true },
        ]
      : [];

  const boxWidth = 250;
  const boxX = RIGHT - boxWidth;
  const totalsHeight = 14 + totals.length * 16 + 28 + settled.length * 16 + 6;

  flow.cursor -= 14;
  flow.ensure(totalsHeight);

  let y = flow.cursor;
  for (const row of totals) {
    y -= 16;
    flow.page.fill(black).text(row.label, boxX + 8, y + 4, 9.4);
    flow.page.textRight(row.value, RIGHT - 8, y + 4, 9.4);
  }

  y -= 28;
  flow.page.fill(blue).rect(boxX, y, boxWidth, 24);
  flow.page.fill(gold).rect(boxX, y, 3, 24);
  flow.page.fill(white).text('TOTAL', boxX + 12, y + 8, 11, 'bold');
  flow.page.textRight(money(snapshot.totals.total), RIGHT - 8, y + 8, 11.5, 'bold');

  for (const row of settled) {
    y -= 16;
    flow.page.fill(black).text(row.label, boxX + 8, y + 1, 9.2, row.strong ? 'bold' : 'regular');
    flow.page.textRight(row.value, RIGHT - 8, y + 1, 9.2, row.strong ? 'bold' : 'regular');
  }

  flow.cursor = y - 22;

  /* --- Règlement ---------------------------------------------------------- */

  const paidInFull = snapshot.totals.paid > 0 && snapshot.totals.due <= 0;
  const settlement = [
    paidInFull
      ? 'Facture intégralement réglée à la date d’émission.'
      : `Montant restant à régler à la date d’émission : ${money(snapshot.totals.due)}.`,
    ...(paidInFull ? [] : [`Merci de rappeler la référence ${snapshot.reference} lors de votre règlement.`]),
    `Montants exprimés en ${currency === 'KMF' ? 'francs comoriens (KMF)' : currency}.`,
  ].map((value) => ({ value }));

  // Une facture annulée ou remplacée n'invite à aucun règlement.
  if (!notice) {
    const settlementHeight = measurePanel(CONTENT, settlement);
    flow.ensure(settlementHeight);
    drawPanel(flow.page, MARGIN, flow.cursor, CONTENT, 'RÈGLEMENT', settlement);
    flow.cursor -= settlementHeight;
  }

  /* --- Pied de page, maintenant que le nombre de pages est connu ---------- */

  flow.pages.forEach((page, index) => drawFooter(page, snapshot, index, flow.pages.length));

  return assemblePdf(flow.pages, logo ? [logo] : [], {
    title: `Facture ${snapshot.reference}`,
    subject: snapshot.reference,
    author: snapshot.issuer.name,
    creator: `MORA Shawiri — Moteur de Documents (${INVOICE_RENDERER_VERSION})`,
    creationDate: pdfDate(snapshot.issued_at),
  });
}
