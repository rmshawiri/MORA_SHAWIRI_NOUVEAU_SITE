'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { saveQuoteDraft } from '@/lib/relation/actions';
import {
  EMPTY_LINE,
  MAX_QUOTE_LINES,
  checkLines,
  previewLineTotal,
  type QuoteLineDraft,
} from '@/lib/relation/quote-lines';

/**
 * Préparer un devis — remarques 01 (A7).
 *
 * Un devis commercial se prépare en lignes : désignation, description courte,
 * quantité, prix unitaire, remise, montant. Les montants s'affichent pendant
 * la saisie pour aider, mais ne font pas foi : l'action serveur relit chaque
 * ligne et la base recalcule le total (`save_quote_draft`).
 *
 * ## Toujours un brouillon
 *
 * Aucun champ de statut : l'éditeur enregistre un brouillon, qui ne consomme
 * aucun numéro et que le client ne voit pas. L'émission reste un second
 * geste, sous `quotes.manage`, après aperçu.
 *
 * ## La validité reste facultative
 *
 * Le § 134 interdit d'inventer une durée de validité : aucune n'est proposée
 * par défaut, la date se choisit au cas par cas.
 *
 * ## Sur téléphone
 *
 * Chaque ligne devient une petite fiche (désignation, puis quantité, prix et
 * remise côte à côte, puis le montant) au lieu d'un tableau à faire défiler.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export type QuoteEditorInitial = {
  quoteId: string | null;
  summary: string;
  notes: string;
  validUntil: string;
  replaces: string;
  lines: QuoteLineDraft[];
};

const NBSP = String.fromCharCode(0xa0);

function money(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const [units, decimals] = Math.abs(value).toFixed(2).split('.');
  const grouped = units!.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${value < 0 ? '–' : ''}${grouped}${decimals === '00' ? '' : `,${decimals}`}${NBSP}${currency}`;
}

export default function QuoteEditor({
  reference,
  currency,
  initial,
  replaceable,
  today,
  onCancelHref,
}: {
  /** Référence de la demande d'origine. */
  reference: string;
  currency: string;
  initial: QuoteEditorInitial;
  /** Devis émis de la même demande qu'une nouvelle version peut remplacer. */
  replaceable: readonly { id: string; reference: string; label: string }[];
  /** Date du jour à Moroni (AAAA-MM-JJ) : plancher de la validité. */
  today: string;
  /** Lien « Annuler » quand l'éditeur corrige un brouillon existant. */
  onCancelHref?: string;
}) {
  const [state, formAction] = useActionState(saveQuoteDraft, INITIAL);
  const [lines, setLines] = useState<QuoteLineDraft[]>(initial.lines.length > 0 ? initial.lines : [{ ...EMPTY_LINE }]);
  // Champs contrôlés : React réinitialise un formulaire après son action, et
  // une erreur ne doit pas effacer ce qui a été saisi.
  const [summary, setSummary] = useState(initial.summary);
  const [notes, setNotes] = useState(initial.notes);
  const [validUntil, setValidUntil] = useState(initial.validUntil);
  const [replaces, setReplaces] = useState(initial.replaces);

  const update = (index: number, key: keyof QuoteLineDraft, value: string) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  const add = () => setLines((current) => (current.length >= MAX_QUOTE_LINES ? current : [...current, { ...EMPTY_LINE }]));
  const remove = (index: number) => setLines((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
  const move = (index: number, delta: number) =>
    setLines((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const checked = checkLines(lines);
  const subtotal = lines.reduce((sum, line) => {
    const value = previewLineTotal({ ...line, discount: '' });
    return value === null ? sum : sum + value;
  }, 0);
  const total = lines.reduce((sum, line) => {
    const value = previewLineTotal(line);
    return value === null ? sum : sum + value;
  }, 0);

  return (
    <form action={formAction} className="admin-form quote-editor">
      <AdminNotice state={state} />

      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="quoteId" value={initial.quoteId ?? ''} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <label className="admin-field">
        <span className="admin-field__label">
          Objet du devis<abbr title="obligatoire"> *</abbr>
        </span>
        <textarea
          className="admin-input admin-input--area quote-editor__subject"
          name="summary"
          rows={2}
          minLength={3}
          maxLength={2000}
          required
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Ce que couvre le devis, en une ou deux phrases. Exemple : Création d’un site vitrine de cinq pages."
        />
        <span className="admin-field__hint">Imprimé en tête du devis, sous « Objet du devis ».</span>
      </label>

      <fieldset className="quote-lines" aria-describedby="quote-lines-hint">
        <legend className="admin-field__label">Lignes du devis</legend>
        <p className="admin-field__hint" id="quote-lines-hint">
          Montants en {currency}, virgule acceptée. Le montant de chaque ligne et le total sont recalculés par le
          serveur à l’enregistrement.
        </p>

        <div className="quote-lines__head" aria-hidden="true">
          <span>Désignation</span>
          <span>Qté</span>
          <span>Prix unitaire</span>
          <span>Remise</span>
          <span>Montant</span>
          <span />
        </div>

        <ol className="quote-lines__list">
          {lines.map((line, index) => {
            const n = index + 1;
            const lineTotal = previewLineTotal(line);
            return (
              <li className="quote-line" key={index}>
                <div className="quote-line__main">
                  <label className="quote-line__field">
                    <span className="quote-line__label">Désignation (ligne {n})</span>
                    <input
                      className="admin-input"
                      value={line.designation}
                      maxLength={300}
                      onChange={(event) => update(index, 'designation', event.target.value)}
                      placeholder="Prestation"
                    />
                  </label>
                  <label className="quote-line__field">
                    <span className="quote-line__label">Description courte (facultative)</span>
                    <input
                      className="admin-input quote-line__desc"
                      value={line.description}
                      maxLength={600}
                      onChange={(event) => update(index, 'description', event.target.value)}
                      placeholder="Précision imprimée sous la désignation"
                    />
                  </label>
                </div>
                <label className="quote-line__field quote-line__num">
                  <span className="quote-line__label">Quantité</span>
                  <input
                    className="admin-input"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) => update(index, 'quantity', event.target.value)}
                  />
                </label>
                <label className="quote-line__field quote-line__num">
                  <span className="quote-line__label">Prix unitaire</span>
                  <input
                    className="admin-input"
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(event) => update(index, 'unitPrice', event.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="quote-line__field quote-line__num">
                  <span className="quote-line__label">Remise</span>
                  <input
                    className="admin-input"
                    inputMode="decimal"
                    value={line.discount}
                    onChange={(event) => update(index, 'discount', event.target.value)}
                    placeholder="0"
                  />
                </label>
                <p className="quote-line__total" aria-live="polite">
                  <span className="quote-line__label">Montant</span>
                  <strong>{money(lineTotal, currency)}</strong>
                </p>
                <div className="quote-line__tools">
                  <button
                    type="button"
                    className="btn btn--ghost quote-line__tool"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Monter la ligne ${n}`}
                    title="Monter"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost quote-line__tool"
                    onClick={() => move(index, 1)}
                    disabled={index === lines.length - 1}
                    aria-label={`Descendre la ligne ${n}`}
                    title="Descendre"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost quote-line__tool"
                    onClick={() => remove(index)}
                    disabled={lines.length <= 1}
                    aria-label={`Supprimer la ligne ${n}`}
                  >
                    Supprimer
                  </button>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="quote-lines__foot">
          <button type="button" className="btn btn--ghost" onClick={add} disabled={lines.length >= MAX_QUOTE_LINES}>
            Ajouter une ligne
          </button>
          <dl className="quote-lines__totals">
            <div>
              <dt>Sous-total</dt>
              <dd>{money(subtotal, currency)}</dd>
            </div>
            {subtotal !== total ? (
              <div>
                <dt>Remises</dt>
                <dd>{money(total - subtotal, currency)}</dd>
              </div>
            ) : null}
            <div className="quote-lines__grand">
              <dt>Total</dt>
              <dd>{money(total, currency)}</dd>
            </div>
          </dl>
        </div>
        {!checked.ok && lines.some((line) => line.designation.trim() !== '' || line.unitPrice.trim() !== '') ? (
          <p className="admin-field__hint quote-lines__check" role="status">
            {checked.message}
          </p>
        ) : null}
      </fieldset>

      <div className="admin-form__grid">
        <label className="admin-field">
          <span className="admin-field__label">Observations</span>
          <textarea
            className="admin-input admin-input--area"
            name="notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Conditions particulières, éléments à fournir par le client, modalités convenues…"
          />
          <span className="admin-field__hint">Facultatif. Imprimé sur le devis, sous les totaux.</span>
        </label>

        <div>
          <label className="admin-field">
            <span className="admin-field__label">Valable jusqu’au</span>
            <input className="admin-input" type="date" name="validUntil" min={today} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
            <span className="admin-field__hint">
              Facultatif. Laissé vide, le devis n’expire pas : aucune durée de validité n’est officiellement définie.
            </span>
          </label>

          {replaceable.length > 0 ? (
            <label className="admin-field">
              <span className="admin-field__label">Nouvelle version de</span>
              <select className="admin-input" name="replaces" value={replaces} onChange={(event) => setReplaces(event.target.value)}>
                <option value="">Aucun devis (devis distinct)</option>
                {replaceable.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.reference} — {entry.label}
                  </option>
                ))}
              </select>
              <span className="admin-field__hint">
                À l’émission, la pièce remplacée passe à « Remplacé » et un devis encore en attente est annulé. Rien
                n’est réécrit : l’ancien devis reste consultable.
              </span>
            </label>
          ) : null}
        </div>
      </div>

      <Submit editing={Boolean(initial.quoteId)} onCancelHref={onCancelHref} />
    </form>
  );
}

/** Le § 97 demande d'empêcher les doubles soumissions. */
function Submit({ editing, onCancelHref }: { editing: boolean; onCancelHref?: string }) {
  const { pending } = useFormStatus();

  return (
    <div className="admin-actions">
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? 'Enregistrement…' : editing ? 'Enregistrer le brouillon' : 'Créer le devis en brouillon'}
      </button>
      {onCancelHref ? (
        <a className="btn btn--ghost" href={onCancelHref}>
          Annuler
        </a>
      ) : null}
    </div>
  );
}
