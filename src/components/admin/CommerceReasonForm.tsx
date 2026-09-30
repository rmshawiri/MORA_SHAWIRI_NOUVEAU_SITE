'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';

/**
 * Un acte sensible qui exige un motif écrit.
 *
 * Rejeter une déclaration de paiement, annuler une commande : deux gestes que
 * le § 62 et le § 16 du cadrage rangent parmi les actes sensibles, et que le
 * système refuse d'enregistrer sans explication. Le motif n'est pas décoratif
 * — il part dans l'historique métier, et le client le lira.
 *
 * Comme `ConfirmForm`, le premier clic ne déclenche aucune requête : il ouvre
 * le champ. La conséquence est dite en clair avant que la personne n'écrive,
 * pas après.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function CommerceReasonForm({
  action,
  fields,
  trigger,
  consequence,
  label,
  placeholder,
  confirmLabel,
  variant = 'ghost',
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  /** Champs cachés d'identification. Jamais de montant, jamais de droit. */
  fields: Record<string, string>;
  trigger: string;
  consequence: string;
  label: string;
  placeholder: string;
  confirmLabel: string;
  variant?: 'ghost' | 'primary' | 'danger';
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

      <p>{consequence}</p>

      <label className="admin-field">
        <span className="admin-field__label">{label}</span>
        <textarea
          className="admin-input"
          name="motif"
          rows={3}
          required
          minLength={3}
          maxLength={400}
          placeholder={placeholder}
        />
      </label>

      <div className="admin-table__actions">
        <Submit label={confirmLabel} variant={variant} />
        <button className="btn btn--ghost" type="button" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function Submit({ label, variant }: { label: string; variant: string }) {
  const { pending } = useFormStatus();

  return (
    <button className={`btn btn--${variant}`} type="submit" disabled={pending}>
      {pending ? 'En cours…' : label}
    </button>
  );
}
