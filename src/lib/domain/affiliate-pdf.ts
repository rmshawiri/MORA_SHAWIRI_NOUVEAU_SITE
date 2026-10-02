/**
 * Pièces officielles d'affiliation — fiche affilié (FIAF) et relevé de
 * versement (RVAF).
 *
 * Module **pur**, posé sur le moteur PDF partagé et la mise en page commune
 * des pièces officielles (`official-pdf.ts`) : même logo circulaire, même
 * en-tête, même pied, mêmes panneaux que la facture. Il ne lit qu'une chose :
 * l'instantané figé à l'émission (`document_snapshots.content`) — ou, pour
 * l'aperçu d'une fiche, l'état lu à l'instant, marqué comme tel sur chaque
 * page et sans numéro.
 *
 * Déterministe : rendue deux fois, une pièce est identique au bit près ; la
 * version du gabarit est enregistrée avec chaque archive.
 */

import {
  ACQUISITION_TRIGGER_LABELS,
  PAYOUT_FREQUENCY_LABELS,
  PROTECTION_MODE_LABELS,
  describeDiscount,
} from '@/lib/affiliation/affiliates';
import { ADJUSTMENT_KIND_LABELS } from '@/lib/affiliation/commissions';
import type {
  AcquisitionTrigger,
  AdjustmentKind,
  PayoutFrequency,
  ProspectProtectionMode,
} from '@/lib/supabase/types-affiliation';

import { describeRule, type Rule, type RuleKind, type Tier } from './affiliation';
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
  wrapLines,
} from './pdf-engine';

export const SHEET_RENDERER_VERSION = 'fiaf-1.0';
export const STATEMENT_RENDERER_VERSION = 'rvaf-1.0';

const { blue, gold, black, white, grey } = BRAND_COLORS;

export type DocumentStatus = 'EMIS' | 'ANNULE' | 'REMPLACE';
export type AffiliateRenderOptions = { logo?: PdfImage | null; status?: DocumentStatus };

/* -------------------------------------------------------------------------- */
/* Lecture prudente                                                            */
/* -------------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
const amount = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

function readIssuer(value: unknown): IssuerIdentity | null {
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

const TABLE_STYLE = {
  x: MARGIN,
  size: 9,
  subSize: 7.6,
  headerSize: 8.2,
  leading: 11.6,
  padding: 7,
  headerFill: blue,
  headerText: white,
  stripe: grey,
  text: black,
  subText: blue,
  rule: blue,
} as const;

/** Intitulé de section, avec la place qu'il lui faut avant le contenu. */
function sectionTitle(flow: PdfFlow, title: string, keepWith = 60): void {
  flow.ensure(22 + keepWith);
  flow.page.fill(blue).text(title, MARGIN, flow.cursor - 12, 10.5, 'bold');
  flow.page.stroke(gold).line(MARGIN, flow.cursor - 17, MARGIN + 36, flow.cursor - 17, 1.4);
  flow.cursor -= 26;
}

/** Panneau pleine largeur, déplacé sur la page suivante s'il ne tient pas. */
function fullPanel(flow: PdfFlow, title: string, rows: PanelRow[]): void {
  const height = measurePanel(CONTENT, rows);
  flow.ensure(height);
  drawPanel(flow.page, MARGIN, flow.cursor, CONTENT, title, rows);
  flow.cursor -= height + 16;
}

/** Deux panneaux côte à côte, de même hauteur. */
function twinPanels(flow: PdfFlow, left: [string, PanelRow[]], right: [string, PanelRow[]]): void {
  const half = (CONTENT - 14) / 2;
  const height = Math.max(measurePanel(half, left[1]), measurePanel(half, right[1]));
  flow.ensure(height);
  drawPanel(flow.page, MARGIN, flow.cursor, half, left[0], left[1], height);
  drawPanel(flow.page, MARGIN + half + 14, flow.cursor, half, right[0], right[1], height);
  flow.cursor -= height + 18;
}

/** Note discrète, en italique : ce qui manque, ou ce qu'il faut savoir. */
function note(flow: PdfFlow, lines: string[], gap = 14): void {
  const laid = lines.flatMap((line) => wrapLines(line, 8.4, CONTENT, 'italic'));
  flow.ensure(laid.length * 11.5 + 4);
  flow.page.fill(black);
  for (const line of laid) {
    flow.cursor -= 11.5;
    flow.page.text(line, MARGIN, flow.cursor + 2, 8.4, 'italic');
  }
  flow.cursor -= gap;
}

function banner(page: PdfPage, top: number, message: string): number {
  page.fill(grey).rect(MARGIN, top - 24, CONTENT, 24);
  page.fill(gold).rect(MARGIN, top - 24, 3, 24);
  page.fill(blue).text(message, MARGIN + 10, top - 16, 9.6, 'bold');
  return top - 36;
}

const STATUS_NOTICE: Record<string, string> = {
  ANNULE: 'Pièce annulée — document sans valeur.',
  REMPLACE: 'Pièce remplacée par une version plus récente.',
};

/* ========================================================================== */
/* FIAF — fiche officielle de l'affilié                                        */
/* ========================================================================== */

export type SheetRule = {
  owner: 'AFFILIATE' | 'CATEGORY';
  target: string;
  kind: RuleKind;
  rate: number | null;
  fixedAmount: number | null;
  tiers: Tier[];
  minCommission: number | null;
  maxCommission: number | null;
  minBase: number | null;
  validFrom: string;
  validTo: string | null;
  label: string | null;
  version: number;
  derogation: boolean;
};

export type SheetCode = {
  code: string;
  label: string | null;
  discountKind: 'PERCENT' | 'FIXED';
  discountValue: number;
  maxDiscount: number | null;
  minOrder: number | null;
  validFrom: string | null;
  validTo: string | null;
};

export type SheetSnapshot = {
  type: 'FIAF';
  preview: boolean;
  reference: string | null;
  issuedAt: string;
  version: number | null;
  issuer: IssuerIdentity;
  affiliate: {
    reference: string | null;
    name: string;
    legalName: string | null;
    partyType: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    country: string | null;
    status: string;
    startedOn: string | null;
    endedOn: string | null;
    contract: string | null;
    contractSignedOn: string | null;
    slug: string | null;
  };
  category: { code: string | null; label: string };
  terms: {
    attributionWindowDays: number | null;
    protectionMode: ProspectProtectionMode | null;
    protectionMonths: number | null;
    survivalMonths: number | null;
    payoutFrequency: PayoutFrequency | null;
    payoutMinAmount: number | null;
    acquisitionTrigger: AcquisitionTrigger | null;
  };
  rules: SheetRule[];
  codes: SheetCode[];
  payout: { label: string; details: Record<string, string> } | null;
};

const RULE_KINDS: readonly RuleKind[] = ['PERCENT', 'FIXED', 'TIERED', 'EXCLUDED'];

export function parseSheetSnapshot(value: unknown): SheetSnapshot | null {
  if (!isRecord(value) || value.schema !== 1 || value.type !== 'FIAF') return null;
  const preview = value.preview === true;
  const reference = text(value.reference);
  if (!preview && (!reference || !/^MORA-FIAF-[A-Z]+\d{4}$/.test(reference))) return null;
  const issuedAt = text(value.issued_at);
  const issuer = readIssuer(value.issuer);
  const a = value.affiliate;
  const c = value.category;
  const t = value.terms;
  if (!issuedAt || !issuer || !isRecord(a) || !isRecord(c) || !isRecord(t)) return null;
  const name = text(a.name);
  if (!name) return null;

  const rules: SheetRule[] = [];
  for (const raw of Array.isArray(value.rules) ? value.rules : []) {
    if (!isRecord(raw) || !RULE_KINDS.includes(raw.kind as RuleKind)) return null;
    rules.push({
      owner: raw.owner === 'AFFILIATE' ? 'AFFILIATE' : 'CATEGORY',
      target: text(raw.target) ?? 'Offre',
      kind: raw.kind as RuleKind,
      rate: amount(raw.rate),
      fixedAmount: amount(raw.fixedAmount),
      tiers: Array.isArray(raw.tiers) ? (raw.tiers as Tier[]) : [],
      minCommission: amount(raw.minCommission),
      maxCommission: amount(raw.maxCommission),
      minBase: amount(raw.minBase),
      validFrom: text(raw.validFrom) ?? issuedAt,
      validTo: text(raw.validTo),
      label: text(raw.label),
      version: amount(raw.version) ?? 1,
      derogation: raw.derogation === true,
    });
  }
  const codes: SheetCode[] = [];
  for (const raw of Array.isArray(value.codes) ? value.codes : []) {
    if (!isRecord(raw) || !text(raw.code)) return null;
    codes.push({
      code: text(raw.code)!,
      label: text(raw.label),
      discountKind: raw.discountKind === 'FIXED' ? 'FIXED' : 'PERCENT',
      discountValue: amount(raw.discountValue) ?? 0,
      maxDiscount: amount(raw.maxDiscount),
      minOrder: amount(raw.minOrder),
      validFrom: text(raw.validFrom),
      validTo: text(raw.validTo),
    });
  }
  let payout: SheetSnapshot['payout'] = null;
  if (isRecord(value.payout)) {
    const details: Record<string, string> = {};
    if (isRecord(value.payout.details)) {
      for (const [key, v] of Object.entries(value.payout.details)) if (typeof v === 'string') details[key] = v;
    }
    payout = { label: text(value.payout.label) ?? text(value.payout.code) ?? '—', details };
  }

  return {
    type: 'FIAF',
    preview,
    reference,
    issuedAt,
    version: amount(value.version),
    issuer,
    affiliate: {
      reference: text(a.reference),
      name,
      legalName: text(a.legalName),
      partyType: text(a.partyType),
      email: text(a.email),
      phone: text(a.phone),
      city: text(a.city),
      country: text(a.country),
      status: text(a.status) ?? '—',
      startedOn: text(a.startedOn),
      endedOn: text(a.endedOn),
      contract: text(a.contract),
      contractSignedOn: text(a.contractSignedOn),
      slug: text(a.slug),
    },
    category: { code: text(c.code), label: text(c.label) ?? '—' },
    terms: {
      attributionWindowDays: amount(t.attributionWindowDays),
      protectionMode: (text(t.protectionMode) as ProspectProtectionMode | null) ?? null,
      protectionMonths: amount(t.protectionMonths),
      survivalMonths: amount(t.survivalMonths),
      payoutFrequency: (text(t.payoutFrequency) as PayoutFrequency | null) ?? null,
      payoutMinAmount: amount(t.payoutMinAmount),
      acquisitionTrigger: (text(t.acquisitionTrigger) as AcquisitionTrigger | null) ?? null,
    },
    rules,
    codes,
    payout,
  };
}

const STATUS_LABELS: Record<string, string> = {
  PREPARATION: 'En préparation',
  ACTIF: 'Actif',
  SUSPENDU: 'Suspendu',
  TERMINE: 'Terminé',
};
const DETAIL_LABELS: Record<string, string> = {
  numero: 'Numéro',
  titulaire: 'Titulaire',
  banque: 'Banque',
  compte: 'Compte',
  email: 'E-mail',
  ordre: 'À l’ordre de',
};

const day = (iso: string | null) => (iso ? formatOfficialDate(iso.length === 10 ? `${iso}T09:00:00Z` : iso) : '—');

/** La règle d'une fiche, dite comme partout ailleurs (`describeRule`). */
export function describeSheetRule(rule: SheetRule): string {
  const asRule: Rule = {
    id: 'fiche',
    version: rule.version,
    owner: { type: rule.owner, id: 'fiche' },
    target: { type: 'ALL' },
    kind: rule.kind,
    rate: rule.rate,
    fixedAmount: rule.fixedAmount,
    tiers: rule.tiers,
    minCommission: rule.minCommission,
    maxCommission: rule.maxCommission,
    minBase: rule.minBase,
    validFrom: rule.validFrom,
    validTo: rule.validTo,
    label: rule.label,
  };
  return describeRule(asRule);
}

export function sheetFileName(snapshot: Pick<SheetSnapshot, 'reference' | 'affiliate' | 'preview'>): string {
  if (!snapshot.preview && snapshot.reference) return `${snapshot.reference}.pdf`;
  const slug = (snapshot.affiliate.slug ?? 'affilie').replace(/[^a-z0-9-]/g, '');
  return `Apercu-fiche-affilie-${slug}.pdf`;
}

export function renderSheetPdf(snapshot: SheetSnapshot, options: AffiliateRenderOptions = {}): Uint8Array {
  const logo = options.logo ?? null;
  const notice = snapshot.preview
    ? 'APERÇU — état actuel, sans numéro ni valeur officielle.'
    : options.status
      ? STATUS_NOTICE[options.status]
      : undefined;
  const dateLine = snapshot.preview
    ? `Aperçu du ${formatOfficialDate(snapshot.issuedAt)}`
    : `Émise le ${formatOfficialDate(snapshot.issuedAt)}${snapshot.version && snapshot.version > 1 ? ` — version ${snapshot.version}` : ''}`;
  const header = { issuer: snapshot.issuer, title: 'FICHE AFFILIÉ', reference: snapshot.reference, dateLine };

  const flow = new PdfFlow(FOOTER_TOP + 12, (page, index) => {
    const start = index === 0 ? drawOfficialHeader(page, header, logo) : drawContinuationHeader(page, header);
    return notice ? banner(page, start, notice) : start;
  });

  const a = snapshot.affiliate;
  const identity: PanelRow[] = [
    { value: a.name, style: 'bold', size: 11 },
    ...(a.legalName ? [{ value: a.legalName }] : []),
    { value: a.partyType === 'ORGANISATION' ? 'Organisation' : 'Personne' },
    ...(a.email ? [{ value: a.email }] : []),
    ...(a.phone ? [{ value: `Tél. ${a.phone}` }] : []),
    ...(a.city || a.country ? [{ value: [a.city, a.country].filter(Boolean).join(', ') }] : []),
  ];
  const partnership: PanelRow[] = [
    { value: `Référence affilié : ${a.reference ?? '—'}`, style: 'bold' },
    { value: `Catégorie : ${snapshot.category.label}` },
    { value: `Statut : ${STATUS_LABELS[a.status] ?? a.status}` },
    { value: `Début : ${day(a.startedOn)}${a.endedOn ? ` — fin : ${day(a.endedOn)}` : ''}` },
    ...(a.contract ? [{ value: `Contrat : ${a.contract}${a.contractSignedOn ? ` (signé le ${day(a.contractSignedOn)})` : ''}` }] : []),
    ...(a.slug ? [{ value: `Identifiant de lien : ${a.slug}` }] : []),
  ];
  twinPanels(flow, ['AFFILIÉ', identity], ['PARTENARIAT', partnership]);

  const t = snapshot.terms;
  const protection =
    t.protectionMode === 'PARTENARIAT'
      ? `${PROTECTION_MODE_LABELS.PARTENARIAT}${t.survivalMonths ? `, puis ${t.survivalMonths} mois après sa fin` : ''}`
      : `${t.protectionMonths ?? '—'} mois après reconnaissance`;
  fullPanel(flow, 'CONDITIONS', [
    { value: `Fenêtre d’attribution : ${t.attributionWindowDays ?? '—'} jours après le dernier clic.` },
    { value: `Protection d’un prospect reconnu : ${protection}.` },
    { value: `Acquisition d’une commission : ${t.acquisitionTrigger ? ACQUISITION_TRIGGER_LABELS[t.acquisitionTrigger].toLowerCase() : '—'}.` },
    { value: `Versements : ${t.payoutFrequency ? PAYOUT_FREQUENCY_LABELS[t.payoutFrequency].toLowerCase() : '—'}${t.payoutMinAmount ? `, à partir de ${formatOfficialAmount(t.payoutMinAmount, 'KMF')}` : ', sans seuil minimum'}.` },
    { value: 'Une commission acquise n’expire pas.' },
  ]);

  sectionTitle(flow, 'RÈGLES DE COMMISSION EN VIGUEUR');
  if (snapshot.rules.length === 0) {
    note(flow, ['Aucune règle de commission n’est en vigueur à cette date.']);
  } else {
    const columns: TableColumn[] = [
      { label: 'Offre', width: 150, align: 'left' },
      { label: 'Commission', width: CONTENT - 150 - 80 - 100, align: 'left' },
      { label: 'Origine', width: 80, align: 'left' },
      { label: 'Depuis le', width: 100, align: 'right' },
    ];
    const rows: TableCell[][] = snapshot.rules.map((rule) => [
      { main: rule.target },
      {
        main: describeSheetRule(rule),
        sub: [rule.label, rule.derogation ? 'Dérogation contractuelle' : null].filter(Boolean).join(' — ') || null,
      },
      { main: rule.owner === 'AFFILIATE' ? 'Individuelle' : 'Catégorie', sub: `v${rule.version}` },
      { main: day(rule.validFrom), sub: rule.validTo ? `jusqu’au ${day(rule.validTo)}` : null },
    ]);
    drawTable(flow, columns, rows, TABLE_STYLE);
    flow.cursor -= 18;
  }

  sectionTitle(flow, 'CODES DE RÉDUCTION ACTIFS');
  if (snapshot.codes.length === 0) {
    note(flow, ['Aucun code de réduction actif à cette date.']);
  } else {
    const columns: TableColumn[] = [
      { label: 'Code', width: 130, align: 'left' },
      { label: 'Réduction', width: CONTENT - 130 - 150, align: 'left' },
      { label: 'Validité', width: 150, align: 'right' },
    ];
    const rows: TableCell[][] = snapshot.codes.map((code) => [
      { main: code.code, sub: code.label },
      {
        main: describeDiscount(code.discountKind, code.discountValue),
        sub: [
          code.maxDiscount ? `plafond ${formatOfficialAmount(code.maxDiscount, 'KMF')}` : null,
          code.minOrder ? `dès ${formatOfficialAmount(code.minOrder, 'KMF')} de commande` : null,
        ].filter(Boolean).join(' · ') || null,
      },
      { main: code.validTo ? `jusqu’au ${day(code.validTo)}` : 'Sans échéance', sub: code.validFrom ? `depuis le ${day(code.validFrom)}` : null },
    ]);
    drawTable(flow, columns, rows, TABLE_STYLE);
    flow.cursor -= 18;
  }

  fullPanel(flow, 'VERSEMENTS', [
    snapshot.payout
      ? { value: `Moyen validé : ${snapshot.payout.label}`, style: 'bold' }
      : { value: 'Aucune coordonnée de versement validée à cette date.' },
    ...(snapshot.payout
      ? Object.entries(snapshot.payout.details).map(([key, value]) => ({ value: `${DETAIL_LABELS[key] ?? key} : ${value}` }))
      : []),
  ]);

  note(flow, [
    'Cette fiche reflète les conditions à sa date. Une commission déjà enregistrée garde la règle en vigueur à la date de son affaire.',
    'Les coordonnées de versement sont masquées ; elles ne figurent en entier dans aucun document.',
  ], 0);

  const mark = snapshot.reference ?? 'Aperçu';
  flow.pages.forEach((page, index) => drawOfficialFooter(page, snapshot.issuer, mark, index, flow.pages.length));
  return assemblePdf(flow.pages, logo ? [logo] : [], {
    title: snapshot.reference ? `Fiche affilié ${snapshot.reference}` : `Aperçu de fiche affilié — ${a.name}`,
    subject: snapshot.reference ?? 'Aperçu',
    author: snapshot.issuer.name,
    creator: `MORA Shawiri — Moteur de Documents (${SHEET_RENDERER_VERSION})`,
    creationDate: pdfDate(snapshot.issuedAt),
  });
}

/* ========================================================================== */
/* RVAF — relevé officiel de versement                                         */
/* ========================================================================== */

export type StatementLine =
  | { type: 'COMMISSION'; reference: string; order: string | null; orderDate: string | null; base: number | null; amount: number }
  | { type: 'AJUSTEMENT'; kind: AdjustmentKind | null; reason: string | null; commission: string | null; date: string | null; amount: number };

export type StatementSnapshot = {
  type: 'RVAF';
  reference: string;
  issuedAt: string;
  issuer: IssuerIdentity;
  affiliate: { reference: string | null; name: string; legalName: string | null; partyType: string | null };
  payout: {
    period: string | null;
    paidOn: string | null;
    method: { code: string; label: string; details: Record<string, string> } | null;
    transaction: string | null;
  };
  currency: string;
  lines: StatementLine[];
  total: number;
};

export function parseStatementSnapshot(value: unknown): StatementSnapshot | null {
  if (!isRecord(value) || value.schema !== 1 || value.type !== 'RVAF') return null;
  const reference = text(value.reference);
  const issuedAt = text(value.issued_at);
  const issuer = readIssuer(value.issuer);
  const currency = text(value.currency) ?? 'KMF';
  const total = amount(value.total);
  const a = value.affiliate;
  const p = value.payout;
  if (!reference || !/^MORA-RVAF-[A-Z]+\d{4}$/.test(reference) || !issuedAt || !issuer || total === null) return null;
  if (!isRecord(a) || !isRecord(p) || !text(a.name)) return null;

  const lines: StatementLine[] = [];
  for (const raw of Array.isArray(value.lines) ? value.lines : []) {
    if (!isRecord(raw)) return null;
    const lineAmount = amount(raw.amount);
    if (lineAmount === null) return null;
    if (raw.type === 'COMMISSION') {
      lines.push({
        type: 'COMMISSION',
        reference: text(raw.reference) ?? 'Commission',
        order: text(raw.order),
        orderDate: text(raw.orderDate),
        base: amount(raw.base),
        amount: lineAmount,
      });
    } else if (raw.type === 'AJUSTEMENT') {
      lines.push({
        type: 'AJUSTEMENT',
        kind: Object.hasOwn(ADJUSTMENT_KIND_LABELS, String(raw.kind)) ? (raw.kind as AdjustmentKind) : null,
        reason: text(raw.reason),
        commission: text(raw.commission),
        date: text(raw.date),
        amount: lineAmount,
      });
    } else {
      return null;
    }
  }
  if (lines.length === 0) return null;

  let method: StatementSnapshot['payout']['method'] = null;
  if (isRecord(p.method) && text(p.method.code)) {
    const details: Record<string, string> = {};
    if (isRecord(p.method.details)) {
      for (const [key, v] of Object.entries(p.method.details)) if (typeof v === 'string') details[key] = v;
    }
    method = { code: text(p.method.code)!, label: text(p.method.label) ?? text(p.method.code)!, details };
  }

  return {
    type: 'RVAF',
    reference,
    issuedAt,
    issuer,
    affiliate: { reference: text(a.reference), name: text(a.name)!, legalName: text(a.legalName), partyType: text(a.partyType) },
    payout: { period: text(p.period), paidOn: text(p.paidOn), method, transaction: text(p.transaction) },
    currency,
    lines,
    total,
  };
}

export function statementFileName(reference: string): string {
  return `${reference}.pdf`;
}

export function renderStatementPdf(snapshot: StatementSnapshot, options: AffiliateRenderOptions = {}): Uint8Array {
  const logo = options.logo ?? null;
  const notice = options.status ? STATUS_NOTICE[options.status] : undefined;
  const money = (value: number) => formatOfficialAmount(value, snapshot.currency);
  const paidOn = snapshot.payout.paidOn ? day(snapshot.payout.paidOn) : formatOfficialDate(snapshot.issuedAt);
  const header = {
    issuer: snapshot.issuer,
    title: 'RELEVÉ DE VERSEMENT',
    titleSize: 21,
    reference: snapshot.reference,
    dateLine: `Versement du ${paidOn}`,
  };

  const flow = new PdfFlow(FOOTER_TOP + 12, (page, index) => {
    const start = index === 0 ? drawOfficialHeader(page, header, logo) : drawContinuationHeader(page, header);
    return notice ? banner(page, start, notice) : start;
  });

  const a = snapshot.affiliate;
  const method = snapshot.payout.method;
  twinPanels(
    flow,
    [
      'BÉNÉFICIAIRE',
      [
        { value: a.name, style: 'bold', size: 11 },
        ...(a.legalName ? [{ value: a.legalName }] : []),
        { value: `Référence affilié : ${a.reference ?? '—'}` },
      ],
    ],
    [
      'VERSEMENT',
      [
        { value: `Date : ${paidOn}`, style: 'bold' },
        ...(snapshot.payout.period ? [{ value: `Période : ${snapshot.payout.period}` }] : []),
        { value: `Moyen : ${method?.label ?? '—'}` },
        ...(method
          ? Object.entries(method.details).map(([key, value]) => ({ value: `${DETAIL_LABELS[key] ?? key} : ${value}` }))
          : []),
        { value: `Transaction : ${snapshot.payout.transaction ?? (method?.code === 'ESPECES' ? 'remise en espèces' : '—')}` },
      ],
    ],
  );

  const columns: TableColumn[] = [
    { label: 'Élément', width: 150, align: 'left' },
    { label: 'Détail', width: CONTENT - 150 - 110, align: 'left' },
    { label: 'Montant', width: 110, align: 'right' },
  ];
  const rows: TableCell[][] = snapshot.lines.map((line) =>
    line.type === 'COMMISSION'
      ? [
          { main: line.reference, sub: 'Commission' },
          {
            main: line.order ? `Commande ${line.order}` : 'Commande',
            sub: [line.orderDate ? `du ${formatOfficialDate(line.orderDate)}` : null, line.base !== null ? `assiette ${money(line.base)}` : null]
              .filter(Boolean)
              .join(' · ') || null,
          },
          { main: money(line.amount) },
        ]
      : [
          { main: line.kind ? ADJUSTMENT_KIND_LABELS[line.kind] : 'Ajustement', sub: line.commission ?? 'Ajustement' },
          { main: line.reason ?? '—', sub: line.date ? `du ${formatOfficialDate(line.date)}` : null },
          { main: money(line.amount) },
        ],
  );
  drawTable(flow, columns, rows, TABLE_STYLE);

  const commissions = snapshot.lines.filter((l) => l.type === 'COMMISSION').reduce((s, l) => s + l.amount, 0);
  const adjustments = snapshot.lines.filter((l) => l.type === 'AJUSTEMENT').reduce((s, l) => s + l.amount, 0);
  const count = snapshot.lines.filter((l) => l.type === 'COMMISSION').length;
  const summary = [
    { label: `Commissions (${count})`, value: money(commissions) },
    ...(adjustments !== 0 ? [{ label: 'Ajustements', value: money(adjustments) }] : []),
  ];

  const boxWidth = 260;
  const boxX = RIGHT - boxWidth;
  flow.cursor -= 14;
  flow.ensure(14 + summary.length * 16 + 30);
  let y = flow.cursor;
  for (const row of summary) {
    y -= 16;
    flow.page.fill(black).text(row.label, boxX + 8, y + 4, 9.4);
    flow.page.textRight(row.value, RIGHT - 8, y + 4, 9.4);
  }
  y -= 28;
  flow.page.fill(blue).rect(boxX, y, boxWidth, 24);
  flow.page.fill(gold).rect(boxX, y, 3, 24);
  flow.page.fill(white).text('TOTAL VERSÉ', boxX + 12, y + 8, 11, 'bold');
  flow.page.textRight(money(snapshot.total), RIGHT - 8, y + 8, 11.5, 'bold');
  flow.cursor = y - 22;

  note(flow, [
    'Relevé établi à la confirmation du versement. Il ne se modifie plus : une correction ultérieure apparaîtra comme un ajustement sur un versement suivant.',
    `Montants exprimés en ${snapshot.currency === 'KMF' ? 'francs comoriens (KMF)' : snapshot.currency}. Coordonnées de versement masquées.`,
  ], 0);

  flow.pages.forEach((page, index) => drawOfficialFooter(page, snapshot.issuer, snapshot.reference, index, flow.pages.length));
  return assemblePdf(flow.pages, logo ? [logo] : [], {
    title: `Relevé de versement ${snapshot.reference}`,
    subject: snapshot.reference,
    author: snapshot.issuer.name,
    creator: `MORA Shawiri — Moteur de Documents (${STATEMENT_RENDERER_VERSION})`,
    creationDate: pdfDate(snapshot.issuedAt),
  });
}
