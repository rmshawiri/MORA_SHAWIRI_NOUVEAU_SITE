'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';

/**
 * Un choix, et son enregistrement.
 *
 * Sert aux deux gestes qui se ramènent à « choisir une valeur dans une liste
 * fermée » : changer un statut, affecter une demande ou un rendez-vous. Les
 * écrire séparément garantirait qu'une correction n'atteigne qu'un des deux.
 *
 * ## Les options affichées ne sont pas une autorisation
 *
 * Ce composant ne montre que les transitions légales, pour éviter de proposer
 * un bouton qui échouera. Mais c'est une commodité, pas une barrière : le
 * § 129 rappelle qu'un ADMIN sans permission ne doit pas pouvoir agir en
 * appelant directement le serveur. Une valeur forgée ici se heurte au
 * déclencheur de transition, qui voit l'ancien et le nouveau statut — et à
 * RLS, qui juge la ligne. Voir `src/lib/relation/actions.ts`.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export type SelectOption = { value: string; label: string };

export default function RelationSelectForm({
  action,
  fields,
  name,
  label,
  options,
  current,
  submitLabel,
  hint,
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  /** Champs cachés d'identification : référence, identifiant. Jamais de droit. */
  fields: Record<string, string>;
  name: string;
  label: string;
  options: readonly SelectOption[];
  current?: string;
  submitLabel: string;
  hint?: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL);

  if (options.length === 0) return null;

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      {Object.entries(fields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}

      <div className="admin-form__grid">
        <label className="admin-field">
          <span className="admin-field__label">{label}</span>
          <select className="admin-input" name={name} defaultValue={current ?? ''}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {hint ? <span className="admin-field__hint">{hint}</span> : null}
        </label>
      </div>

      <Submit label={submitLabel} />
    </form>
  );
}

/** Le § 97 demande d'empêcher les doubles soumissions. */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <div className="admin-actions">
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? 'Enregistrement…' : label}
      </button>
    </div>
  );
}
