/**
 * Lignes d'un devis — règles pures, partagées par l'éditeur (affichage des
 * montants pendant la saisie), l'action serveur (validation avant envoi) et
 * les tests.
 *
 * Elles ne font foi nulle part : `save_quote_draft` revalide chaque ligne et
 * recalcule le total en base. Ce module sert à refuser tôt et à afficher
 * juste ; le calcul de référence reste celui de Postgres, et il est le même :
 * `round(quantité × prix, 2) − remise`, en centimes entiers ici pour ne pas
 * dépendre des flottants.
 */

export const MAX_QUOTE_LINES = 50;

export type QuoteLineDraft = {
  designation: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
};

export type QuoteLine = {
  designation: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
};

export const EMPTY_LINE: QuoteLineDraft = { designation: '', description: '', quantity: '1', unitPrice: '', discount: '' };

/** `1 500,50` → 1500.5 ; vide → null. Virgule et espaces acceptés. */
export function parseDecimal(value: string): number | null {
  const cleaned = value.replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

const cents = (value: number) => Math.round(value * 100);

/** Nombre de décimales saisies (`2,50` → 2), lu sur le texte et non sur le flottant. */
function decimalsOf(value: string): number {
  const cleaned = value.replace(/\s/g, '').replace(',', '.');
  const dot = cleaned.indexOf('.');
  return dot < 0 ? 0 : cleaned.length - dot - 1;
}

/** Montant d'une ligne en centimes : arrondi au centime, puis remise. */
export function lineTotalCents(line: Pick<QuoteLine, 'quantity' | 'unit_price' | 'discount'>): number {
  return Math.round(line.quantity * cents(line.unit_price)) - cents(line.discount);
}

export type LineCheck = { ok: true; line: QuoteLine } | { ok: false; message: string };

/** Valide une ligne saisie, avec les bornes de la base. */
export function checkLine(draft: QuoteLineDraft, index: number): LineCheck {
  const n = index + 1;
  const designation = draft.designation.trim();
  const description = draft.description.trim();
  const quantity = parseDecimal(draft.quantity);
  const unitPrice = parseDecimal(draft.unitPrice);
  const discount = parseDecimal(draft.discount) ?? 0;

  if (designation === '' || designation.length > 300) {
    return { ok: false, message: `Ligne ${n} : la désignation est obligatoire (300 caractères au plus).` };
  }
  if (description.length > 600) return { ok: false, message: `Ligne ${n} : la description ne dépasse pas 600 caractères.` };
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || decimalsOf(draft.quantity) > 3) {
    return { ok: false, message: `Ligne ${n} : indiquez une quantité supérieure à zéro (trois décimales au plus).` };
  }
  if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice > 10_000_000_000 || decimalsOf(draft.unitPrice) > 2) {
    return { ok: false, message: `Ligne ${n} : indiquez un prix unitaire (deux décimales au plus).` };
  }
  if (!Number.isFinite(discount) || discount < 0 || decimalsOf(draft.discount) > 2) {
    return { ok: false, message: `Ligne ${n} : la remise est un montant positif.` };
  }
  const line: QuoteLine = { designation, description: description || null, quantity, unit_price: unitPrice, discount };
  if (lineTotalCents(line) < 0) return { ok: false, message: `Ligne ${n} : la remise ne peut dépasser le montant de la ligne.` };
  return { ok: true, line };
}

export type LinesCheck =
  | { ok: true; lines: QuoteLine[]; subtotal: number; discount: number; total: number }
  | { ok: false; message: string };

/** Valide toutes les lignes et calcule les totaux, en unités monétaires. */
export function checkLines(drafts: readonly QuoteLineDraft[]): LinesCheck {
  if (drafts.length === 0) return { ok: false, message: 'Ajoutez au moins une ligne au devis.' };
  if (drafts.length > MAX_QUOTE_LINES) return { ok: false, message: `Un devis compte ${MAX_QUOTE_LINES} lignes au plus.` };

  const lines: QuoteLine[] = [];
  for (const [index, draft] of drafts.entries()) {
    const result = checkLine(draft, index);
    if (!result.ok) return result;
    lines.push(result.line);
  }
  const subtotal = lines.reduce((sum, line) => sum + Math.round(line.quantity * cents(line.unit_price)), 0);
  const discount = lines.reduce((sum, line) => sum + cents(line.discount), 0);
  const total = subtotal - discount;
  if (total <= 0) return { ok: false, message: 'Le total du devis doit être supérieur à zéro.' };
  return { ok: true, lines, subtotal: subtotal / 100, discount: discount / 100, total: total / 100 };
}

/** Lit la charge JSON envoyée par l'éditeur ; `null` si elle n'a pas la forme attendue. */
export function readLineDrafts(raw: string): QuoteLineDraft[] | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length > MAX_QUOTE_LINES * 2) return null;
  const drafts: QuoteLineDraft[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const str = (key: string) => (typeof record[key] === 'string' ? (record[key] as string).slice(0, 1000) : '');
    drafts.push({
      designation: str('designation'),
      description: str('description'),
      quantity: str('quantity'),
      unitPrice: str('unitPrice'),
      discount: str('discount'),
    });
  }
  return drafts;
}

/** Montant affiché pendant la saisie : `15 000 KMF`, ou `—` si illisible. */
export function previewLineTotal(draft: QuoteLineDraft): number | null {
  const quantity = parseDecimal(draft.quantity);
  const unitPrice = parseDecimal(draft.unitPrice);
  const discount = parseDecimal(draft.discount) ?? 0;
  if (quantity === null || unitPrice === null || !Number.isFinite(quantity) || !Number.isFinite(unitPrice) || !Number.isFinite(discount)) {
    return null;
  }
  return (Math.round(quantity * cents(unitPrice)) - cents(discount)) / 100;
}
