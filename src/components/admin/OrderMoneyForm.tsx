'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';

/**
 * Un mouvement d'argent enregistré depuis l'administration.
 *
 * Deux usages, une seule forme : le règlement reçu hors ligne (§ 104-105 —
 * espèces remises au bureau, chèque encaissé) et le remboursement décidé
 * (§ 89-91). Les deux demandent un moyen, un montant, une référence
 * facultative et un texte.
 *
 * ## Le montant proposé n'est pas le montant imposé
 *
 * Le champ est pré-rempli avec ce qui reste dû, parce que c'est le cas le plus
 * fréquent. Mais c'est une commodité : la base borne le montant réel — la
 * somme confirmée ne peut pas dépasser le total, et un remboursement ne peut
 * pas dépasser l'encaissé. Modifier la valeur ici ne contourne rien.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export type MethodOption = { value: string; label: string };

export default function OrderMoneyForm({
  action,
  fields,
  trigger,
  heading,
  intro,
  methods,
  suggestedAmount,
  currency,
  reasonLabel,
  reasonPlaceholder,
  reasonRequired,
  submitLabel,
  variant = 'primary',
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  fields: Record<string, string>;
  trigger: string;
  heading: string;
  intro: string;
  methods: readonly MethodOption[];
  suggestedAmount: string;
  currency: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  reasonRequired: boolean;
  submitLabel: string;
  variant?: 'primary' | 'ghost';
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [open, setOpen] = useState(false);

  if (state.status === 'ok') {
    return <AdminNotice state={state} />;
  }

  if (!open) {
    return (
      <button className={`btn btn--${variant}`} type="button" onClick={() => setOpen(true)}>
        {trigger}
      </button>
    );
  }

  return (
    <form action={formAction} className="admin-form admin-confirm">
      <AdminNotice state={state} />

      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="admin-card__head">
        <h3>{heading}</h3>
        <p>{intro}</p>
      </div>

      <div className="admin-form__grid">
        <label className="admin-field">
          <span className="admin-field__label">Moyen</span>
          <select className="admin-input" name="moyen" required={reasonRequired === false}>
            <option value="">—</option>
            {methods.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          <span className="admin-field__label">Montant ({currency})</span>
          <input
            className="admin-input"
            type="text"
            inputMode="decimal"
            name="montant"
            required
            defaultValue={suggestedAmount}
          />
        </label>

        <label className="admin-field">
          <span className="admin-field__label">Référence (facultatif)</span>
          <input className="admin-input" type="text" name="reference" maxLength={120} />
        </label>
      </div>

      <label className="admin-field">
        <span className="admin-field__label">{reasonLabel}</span>
        <textarea
          className="admin-input"
          name={reasonRequired ? 'motif' : 'note'}
          rows={3}
          maxLength={400}
          required={reasonRequired}
          minLength={reasonRequired ? 3 : undefined}
          placeholder={reasonPlaceholder}
        />
      </label>

      <div className="admin-table__actions">
        <Submit label={submitLabel} />
        <button className="btn btn--ghost" type="button" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button className="btn btn--primary" type="submit" disabled={pending}>
      {pending ? 'Enregistrement…' : label}
    </button>
  );
}
