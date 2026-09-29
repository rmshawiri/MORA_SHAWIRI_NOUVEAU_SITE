'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';

/**
 * Action sensible en deux temps : on la demande, puis on la confirme.
 *
 * Le § 123 impose une confirmation explicite pour toute action irréversible ou
 * lourde de conséquence, et le § 129 demande que la conséquence soit dite en
 * clair plutôt que devinée. Un simple bouton « Supprimer » n'apprend rien à
 * celui qui hésite.
 *
 * La confirmation est volontairement locale et sans fenêtre modale : un
 * `confirm()` de navigateur est ignoré par certains lecteurs d'écran, et une
 * modale maison imposerait une gestion du focus pour un gain nul ici.
 *
 * Le premier clic ne déclenche **aucune** requête : il ne fait qu'afficher la
 * phrase de conséquence et le bouton de validation.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function ConfirmForm({
  action,
  fields,
  trigger,
  consequence,
  confirmLabel,
  variant = 'ghost',
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  fields: Record<string, string>;
  trigger: string;
  consequence: string;
  confirmLabel: string;
  variant?: 'ghost' | 'primary' | 'gold';
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [asked, setAsked] = useState(false);

  if (state.status !== 'idle') {
    return <AdminNotice state={state} />;
  }

  if (!asked) {
    return (
      <button className={`btn btn--${variant}`} type="button" onClick={() => setAsked(true)}>
        {trigger}
      </button>
    );
  }

  return (
    <form action={formAction} className="admin-confirm">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <p>{consequence}</p>

      <div className="admin-table__actions">
        <ConfirmButton label={confirmLabel} variant={variant} />
        <button className="btn btn--ghost" type="button" onClick={() => setAsked(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function ConfirmButton({ label, variant }: { label: string; variant: string }) {
  const { pending } = useFormStatus();

  return (
    <button className={`btn btn--${variant}`} type="submit" disabled={pending}>
      {pending ? 'En cours…' : label}
    </button>
  );
}
