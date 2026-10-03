/**
 * Devis (DVCL) et document de commande (CMCL) — gabarits PDF.
 *
 * Module **pur**, posé sur la mise en page commune des pièces officielles
 * (`official-pdf.ts`) : même en-tête au logo, même pied numéroté, mêmes
 * panneaux, même tableau que la facture. La facture garde son propre gabarit
 * (`invoice-pdf.ts`), inchangé.
 *
 * Chaque gabarit ne lit qu'une chose : l'instantané figé à l'émission
 * (`document_snapshots.content`, composé par `quote_document_content` ou
 * `order_document_content`). Un aperçu de devis suit exactement le même
 * chemin, avec `preview: true` et sans référence : il le dit sur chaque page.
 *
 * Ce que ces pièces n'affichent pas : aucun identifiant interne, aucune note
 * d'administration, aucune taxe ni mention légale (D-17 ouverte), aucune
 * condition de paiement qui n'existe pas en base.
 */

import {
  CONTENT,
  FOOTER_TOP,
  MARGIN,
  RIGHT,
  drawContinuationHeader,
  drawOfficialFooter,
  drawOfficialHeader,
  drawPanel,
  formatOfficialAmount,
  formatOfficialDate,
  formatOfficialQuantity,
  measurePanel,
  type IssuerIdentity,
  type PanelRow,
} from './official-pdf';
import {
  BRAND_COLORS,
  PdfFlow,
  type PdfImage,
  type PdfPage,
  type TableCell,
  type TableColumn,
  assemblePdf,
  drawTable,
  pdfDate,
} from './pdf-engine';

/** Versions des gabarits, enregistrées avec chaque archive. */
export const QUOTE_RENDERER_VERSION = 'dvcl-1.0';
export const ORDER_RENDERER_VERSION = 'cmcl-1.0';

/* -------------------------------------------------------------------------- */
/* Lecture des instantanés                                                     */
/* -------------------------------------------------------------------------- */

export type CommercialLine = {
  designation: string;
  /** Devis : description courte. Commande : référence de la ligne. */
  detail: string | null;
  unit: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
};

export type QuoteSnapshot = {
  type: 'DVCL';
  preview: boolean;
  reference: string | null;
  issued_at: string;
  issuer: IssuerIdentity;
  customer: { name: string; organisation: string | null; email: string | null; phone: string | null };
  references: { request: string | null; replaces: string | null };
  subject: string;
  service: string | null;
  currency: string;
  lines: CommercialLine[];
  totals: { subtotal: number; discount: number; total: number };
  valid_until: string | null;
  notes: string | null;
};

export type OrderSnapshot = {
  type: 'CMCL';
  reference: string;
  issued_at: string;
  ordered_at: string;
  issuer: IssuerIdentity;
  customer: { name: string; email: string | null; phone: string | null };
  references: { quote: string | null; request: string | null };
  status: string;
  currency: string;
  lines: CommercialLine[];
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

function parseIssuer(value: unknown): IssuerIdentity | null {
  if (!isRecord(value)) return null;
  const name = text(value.name);
  if (!name) return null;
  return {
    name,
    slogan: text(value.slogan) ?? '',
    address: text(value.address) ?? '',
    phone: text(value.phone) ?? '',
    email: text(value.email) ?? '',
  };
}

function parseLines(value: unknown, detailKey: 'description' | 'reference'): CommercialLine[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const lines: CommercialLine[] = [];
  for (const line of value) {
    if (!isRecord(line)) return null;
    const designation = text(line.designation);
    const quantity = amount(line.quantity);
    const unitPrice = amount(line.unit_price);
    const total = amount(line.total);
    if (!designation || quantity === null || unitPrice === null || total === null) return null;
    lines.push({
      designation,
      detail: text(line[detailKey]),
      unit: text(line.unit),
      quantity,
      unit_price: unitPrice,
      discount: amount(line.discount) ?? 0,
      total,
    });
  }
  return lines;
}

/**
 * Lit et valide un instantané de devis. Refuse plutôt que de compléter :
 * une pièce rendue avec un champ deviné serait pire qu'une pièce absente.
 */
export function parseQuoteSnapshot(value: unknown): QuoteSnapshot | null {
  if (!isRecord(value) || value.schema !== 1 || value.type !== 'DVCL') return null;
  const preview = value.preview === true;
  const reference = text(value.reference);
  if (!preview && (!reference || !/^MORA-DVCL-[A-Z]+\d{4}$/.test(reference))) return null;

  const issuedAt = text(value.issued_at);
  const currency = text(value.currency);
  const subject = text(value.subject);
  const issuer = parseIssuer(value.issuer);
  const lines = parseLines(value.lines, 'description');
  const { customer, references, totals } = value;
  if (!issuedAt || !currency || !subject || !issuer || !lines) return null;
  if (!isRecord(customer) || !isRecord(references) || !isRecord(totals)) return null;

  const name = text(customer.name);
  const subtotal = amount(totals.subtotal);
  const total = amount(totals.total);
  if (!name || subtotal === null || total === null) return null;

  return {
    type: 'DVCL',
    preview,
    reference: preview ? null : reference,
    issued_at: issuedAt,
    issuer,
    customer: {
      name,
      organisation: text(customer.organisation),
      email: text(customer.email),
      phone: text(customer.phone),
    },
    references: { request: text(references.request), replaces: text(references.replaces) },
    subject,
    service: text(value.service),
    currency,
    lines,
    totals: { subtotal, discount: amount(totals.discount) ?? 0, total },
    valid_until: text(value.valid_until),
    notes: text(value.notes),
  };
}

export function parseOrderSnapshot(value: unknown): OrderSnapshot | null {
  if (!isRecord(value) || value.schema !== 1 || value.type !== 'CMCL') return null;
  const reference = text(value.reference);
  if (!reference || !/^MORA-CMCL-[A-Z]+\d{4}$/.test(reference)) return null;

  const issuedAt = text(value.issued_at);
  const orderedAt = text(value.ordered_at);
  const currency = text(value.currency);
  const status = text(value.status);
  const issuer = parseIssuer(value.issuer);
  const lines = parseLines(value.lines, 'reference');
  const { customer, references, totals } = value;
  if (!issuedAt || !orderedAt || !currency || !status || !issuer || !lines) return null;
  if (!isRecord(customer) || !isRecord(references) || !isRecord(totals)) return null;

  const name = text(customer.name);
  const t = {
    subtotal: amount(totals.subtotal),
    discount: amount(totals.discount) ?? 0,
    fees: amount(totals.fees) ?? 0,
    total: amount(totals.total),
    paid: amount(totals.paid) ?? 0,
    due: amount(totals.due),
  };
  if (!name || t.subtotal === null || t.total === null || t.due === null) return null;

  return {
    type: 'CMCL',
    reference,
    issued_at: issuedAt,
    ordered_at: orderedAt,
    issuer,
    customer: { name, email: text(customer.email), phone: text(customer.phone) },
    references: { quote: text(references.quote), request: text(references.request) },
    status,
    currency,
    lines,
    totals: { ...t, subtotal: t.subtotal, total: t.total, due: t.due },
  };
}

/* -------------------------------------------------------------------------- */
/* Libellés                                                                    */
/* -------------------------------------------------------------------------- */

/** Nom du fichier : la référence officielle ; un aperçu le dit. */
export function quoteFileName(snapshot: Pick<QuoteSnapshot, 'reference' | 'preview'>): string {
  return snapshot.preview || !snapshot.reference ? 'Apercu-devis-MORA-Shawiri.pdf' : `${snapshot.reference}.pdf`;
}

export function orderFileName(reference: string): string {
  return `${reference}.pdf`;
}

const ORDER_STATUS: Record<string, string> = {
  CONFIRMEE: 'Confirmée',
  EN_TRAITEMENT: 'En traitement',
  EN_ATTENTE_INFO: 'En attente d’informations',
  PRETE: 'Prête',
  TERMINEE: 'Terminée',
};

const currencyLabel = (currency: string) => (currency === 'KMF' ? 'franc comorien (KMF)' : currency);
const currencyPlural = (currency: string) => (currency === 'KMF' ? 'francs comoriens (KMF)' : currency);

/** `2026-10-31` → `31 octobre 2026`. Une date seule, sans fuseau. */
function formatValidity(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatOfficialDate(`${day}T00:00:00Z`) : day;
}

/* -------------------------------------------------------------------------- */
/* Briques communes                                                            */
/* -------------------------------------------------------------------------- */

const { blue, gold, black, white, grey } = BRAND_COLORS;

export type CommercialRenderOptions = {
  logo?: PdfImage | null;
  /** État de la pièce. Autre que EMIS : un bandeau le dit sur chaque page. */
  status?: 'EMIS' | 'ANNULE' | 'REMPLACE';
};

type Frame = {
  issuer: IssuerIdentity;
  title: string;
  titleSize?: number;
  reference: string | null;
  dateLine: string;
  notice: string | null;
  mark: string;
};

function openFlow(frame: Frame, logo: PdfImage | null): PdfFlow {
  return new PdfFlow(FOOTER_TOP + 12, (page: PdfPage, index: number) => {
    const start =
      index === 0
        ? drawOfficialHeader(
            page,
            { issuer: frame.issuer, title: frame.title, reference: frame.reference, dateLine: frame.dateLine, titleSize: frame.titleSize },
            logo,
          )
        : drawContinuationHeader(page, { title: frame.title, reference: frame.reference, dateLine: frame.dateLine });
    if (!frame.notice) return start;
    page.fill(grey).rect(MARGIN, start - 24, CONTENT, 24);
    page.fill(blue).text(frame.notice, MARGIN + 10, start - 16, 10, 'bold');
    return start - 36;
  });
}

function drawTwoPanels(flow: PdfFlow, left: [string, PanelRow[]], right: [string, PanelRow[]]): void {
  const half = (CONTENT - 14) / 2;
  const height = Math.max(measurePanel(half, left[1]), measurePanel(half, right[1]));
  flow.ensure(height);
  drawPanel(flow.page, MARGIN, flow.cursor, half, left[0], left[1], height);
  drawPanel(flow.page, MARGIN + half + 14, flow.cursor, half, right[0], right[1], height);
  flow.cursor -= height + 16;
}

function drawWidePanel(flow: PdfFlow, title: string, rows: PanelRow[], gap = 16): void {
  const height = measurePanel(CONTENT, rows);
  flow.ensure(height);
  drawPanel(flow.page, MARGIN, flow.cursor, CONTENT, title, rows);
  flow.cursor -= height + gap;
}

function drawLines(flow: PdfFlow, lines: readonly CommercialLine[], currency: string, detailPrefix: string): void {
  const money = (value: number) => formatOfficialAmount(value, currency);
  const hasDiscount = lines.some((line) => line.discount > 0);
  const numeric = hasDiscount ? [44, 88, 74, 92] : [48, 96, 0, 100];
  const columns: TableColumn[] = [
    { label: 'Désignation', width: CONTENT - numeric.reduce((a, b) => a + b, 0), align: 'left' },
    { label: 'Qté', width: numeric[0]!, align: 'right' },
    { label: 'Prix unitaire', width: numeric[1]!, align: 'right' },
    ...(hasDiscount ? [{ label: 'Remise', width: numeric[2]!, align: 'right' as const }] : []),
    { label: 'Montant', width: numeric[3]!, align: 'right' },
  ];
  const rows: TableCell[][] = lines.map((line) => [
    { main: line.designation, sub: line.detail ? `${detailPrefix}${line.detail}` : null },
    { main: formatOfficialQuantity(line.quantity), sub: line.unit },
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
}

type TotalRow = { label: string; value: string; strong?: boolean };

function drawTotals(flow: PdfFlow, rows: TotalRow[], total: string, after: TotalRow[] = []): void {
  const boxWidth = 250;
  const boxX = RIGHT - boxWidth;
  const height = 14 + rows.length * 16 + 28 + after.length * 16 + 6;

  flow.cursor -= 14;
  flow.ensure(height);

  let y = flow.cursor;
  for (const row of rows) {
    y -= 16;
    flow.page.fill(black).text(row.label, boxX + 8, y + 4, 9.4);
    flow.page.textRight(row.value, RIGHT - 8, y + 4, 9.4);
  }

  y -= 28;
  flow.page.fill(blue).rect(boxX, y, boxWidth, 24);
  flow.page.fill(gold).rect(boxX, y, 3, 24);
  flow.page.fill(white).text('TOTAL', boxX + 12, y + 8, 11, 'bold');
  flow.page.textRight(total, RIGHT - 8, y + 8, 11.5, 'bold');

  for (const row of after) {
    y -= 16;
    flow.page.fill(black).text(row.label, boxX + 8, y + 1, 9.2, row.strong ? 'bold' : 'regular');
    flow.page.textRight(row.value, RIGHT - 8, y + 1, 9.2, row.strong ? 'bold' : 'regular');
  }

  flow.cursor = y - 22;
}

function finish(flow: PdfFlow, frame: Frame, logo: PdfImage | null, title: string, creator: string, issuedAt: string): Uint8Array {
  flow.pages.forEach((page, index) => drawOfficialFooter(page, frame.issuer, frame.mark, index, flow.pages.length));
  return assemblePdf(flow.pages, logo ? [logo] : [], {
    title,
    subject: frame.reference ?? 'Aperçu',
    author: frame.issuer.name,
    creator: `MORA Shawiri — Moteur de Documents (${creator})`,
    creationDate: pdfDate(issuedAt),
  });
}

/* -------------------------------------------------------------------------- */
/* Devis                                                                       */
/* -------------------------------------------------------------------------- */

const QUOTE_NOTICE: Record<string, string> = {
  ANNULE: 'Devis annulé — document sans valeur.',
  REMPLACE: 'Devis remplacé par une version ultérieure.',
};

/**
 * Rend le devis : destinataire et références, objet, lignes, totaux,
 * observations, puis les conditions qui découlent réellement du devis
 * (validité, manière d'y répondre).
 */
export function renderQuotePdf(snapshot: QuoteSnapshot, options: CommercialRenderOptions = {}): Uint8Array {
  const logo = options.logo ?? null;
  const currency = snapshot.currency;
  const money = (value: number) => formatOfficialAmount(value, currency);
  const frame: Frame = {
    issuer: snapshot.issuer,
    title: 'DEVIS',
    reference: snapshot.reference,
    dateLine: snapshot.preview
      ? `Aperçu du ${formatOfficialDate(snapshot.issued_at)}`
      : `Date d’émission : ${formatOfficialDate(snapshot.issued_at)}`,
    notice: snapshot.preview
      ? 'APERÇU — devis non émis, sans numéro ni valeur contractuelle.'
      : options.status
        ? (QUOTE_NOTICE[options.status] ?? null)
        : null,
    mark: snapshot.reference ?? 'Aperçu',
  };
  const flow = openFlow(frame, logo);

  const customer: PanelRow[] = [
    { value: snapshot.customer.name, style: 'bold', size: 11 },
    ...(snapshot.customer.organisation ? [{ value: snapshot.customer.organisation }] : []),
    ...(snapshot.customer.email ? [{ value: snapshot.customer.email }] : []),
    ...(snapshot.customer.phone ? [{ value: `Tél. ${snapshot.customer.phone}` }] : []),
  ];
  const references: PanelRow[] = [
    ...(snapshot.references.request ? [{ value: `Demande : ${snapshot.references.request}`, style: 'bold' as const }] : []),
    ...(snapshot.references.replaces ? [{ value: `Remplace le devis ${snapshot.references.replaces}` }] : []),
    {
      value: snapshot.valid_until
        ? `Valable jusqu’au ${formatValidity(snapshot.valid_until)}`
        : 'Sans date d’expiration',
    },
    { value: `Devise : ${currencyLabel(currency)}` },
  ];
  drawTwoPanels(flow, ['DESTINATAIRE', customer], ['RÉFÉRENCES', references]);

  drawWidePanel(flow, 'OBJET DU DEVIS', [
    ...(snapshot.service ? [{ value: snapshot.service, style: 'bold' as const }] : []),
    { value: snapshot.subject },
  ]);

  drawLines(flow, snapshot.lines, currency, '');

  const rows: TotalRow[] = [{ label: 'Sous-total', value: money(snapshot.totals.subtotal) }];
  if (snapshot.totals.discount > 0) rows.push({ label: 'Remises', value: `– ${money(snapshot.totals.discount)}` });
  drawTotals(flow, rows, money(snapshot.totals.total));

  if (snapshot.notes) drawWidePanel(flow, 'OBSERVATIONS', [{ value: snapshot.notes }]);

  if (!frame.notice || snapshot.preview) {
    const reference = snapshot.reference ?? 'du devis';
    drawWidePanel(
      flow,
      'CONDITIONS',
      [
        snapshot.valid_until
          ? `Ce devis est valable jusqu’au ${formatValidity(snapshot.valid_until)}.`
          : 'Ce devis ne porte pas de date d’expiration.',
        `Pour l’accepter ou le refuser, répondez depuis votre espace client MORA Shawiri, ou contactez-nous en rappelant la référence ${reference}.`,
        'L’acceptation du devis précède la commande, établie ensuite par MORA Shawiri.',
        `Montants exprimés en ${currencyPlural(currency)}.`,
      ].map((value) => ({ value })),
      0,
    );
  }

  return finish(
    flow,
    frame,
    logo,
    snapshot.reference ? `Devis ${snapshot.reference}` : 'Aperçu de devis',
    QUOTE_RENDERER_VERSION,
    snapshot.issued_at,
  );
}

/* -------------------------------------------------------------------------- */
/* Commande                                                                    */
/* -------------------------------------------------------------------------- */

const ORDER_NOTICE: Record<string, string> = {
  ANNULE: 'Commande annulée — document sans valeur.',
  REMPLACE: 'Document de commande remplacé.',
};

export function renderOrderPdf(snapshot: OrderSnapshot, options: CommercialRenderOptions = {}): Uint8Array {
  const logo = options.logo ?? null;
  const currency = snapshot.currency;
  const money = (value: number) => formatOfficialAmount(value, currency);
  const frame: Frame = {
    issuer: snapshot.issuer,
    title: 'BON DE COMMANDE',
    titleSize: 22,
    reference: snapshot.reference,
    dateLine: `Établi le ${formatOfficialDate(snapshot.issued_at)}`,
    notice: options.status ? (ORDER_NOTICE[options.status] ?? null) : null,
    mark: snapshot.reference,
  };
  const flow = openFlow(frame, logo);

  const customer: PanelRow[] = [
    { value: snapshot.customer.name, style: 'bold', size: 11 },
    ...(snapshot.customer.email ? [{ value: snapshot.customer.email }] : []),
    ...(snapshot.customer.phone ? [{ value: `Tél. ${snapshot.customer.phone}` }] : []),
  ];
  const references: PanelRow[] = [
    { value: `Commande du ${formatOfficialDate(snapshot.ordered_at)}`, style: 'bold' },
    ...(snapshot.references.quote ? [{ value: `Devis : ${snapshot.references.quote}` }] : []),
    ...(snapshot.references.request ? [{ value: `Demande : ${snapshot.references.request}` }] : []),
    { value: `État au ${formatOfficialDate(snapshot.issued_at)} : ${ORDER_STATUS[snapshot.status] ?? snapshot.status}` },
    { value: `Devise : ${currencyLabel(currency)}` },
  ];
  drawTwoPanels(flow, ['CLIENT', customer], ['RÉFÉRENCES', references]);

  drawLines(flow, snapshot.lines, currency, 'Réf. ');

  const rows: TotalRow[] = [{ label: 'Sous-total', value: money(snapshot.totals.subtotal) }];
  if (snapshot.totals.discount > 0) rows.push({ label: 'Remises', value: `– ${money(snapshot.totals.discount)}` });
  if (snapshot.totals.fees > 0) rows.push({ label: 'Frais', value: money(snapshot.totals.fees) });
  const settled: TotalRow[] =
    snapshot.totals.paid > 0
      ? [
          { label: 'Réglé à cette date', value: money(snapshot.totals.paid) },
          { label: 'Reste à payer', value: money(snapshot.totals.due), strong: true },
        ]
      : [];
  drawTotals(flow, rows, money(snapshot.totals.total), settled);

  if (!frame.notice) {
    const paidInFull = snapshot.totals.paid > 0 && snapshot.totals.due <= 0;
    drawWidePanel(
      flow,
      'RÈGLEMENT',
      [
        paidInFull
          ? 'Commande intégralement réglée à la date de ce document.'
          : `Montant restant à régler à la date de ce document : ${money(snapshot.totals.due)}.`,
        ...(paidInFull ? [] : [`Merci de rappeler la référence ${snapshot.reference} lors de votre règlement.`]),
        'La facture de cette commande est un document distinct.',
        `Montants exprimés en ${currencyPlural(currency)}.`,
      ].map((value) => ({ value })),
      0,
    );
  }

  return finish(flow, frame, logo, `Bon de commande ${snapshot.reference}`, ORDER_RENDERER_VERSION, snapshot.issued_at);
}
