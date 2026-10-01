'use client';

import { useActionState, useState } from 'react';

import AdminNotice from './AdminNotice';
import ConfirmDialog from './ConfirmDialog';
import type { AdminActionState } from '@/lib/admin/actions';

/**
 * Action sensible en deux temps : on la demande, puis on la confirme.
 *
 * Le § 123 impose une confirmation explicite pour toute action irréversible ou
 * lourde de conséquence, et le § 129 demande que la conséquence soit dite en
 * clair plutôt que devinée. Un simple bouton « Supprimer » n'apprend rien à
 * celui qui hésite.
 *
 * Depuis le 1er octobre 2026, la confirmation s'ouvre dans une fenêtre modale
 * (`ConfirmDialog`) plutôt que sous le bouton : titre, conséquence, Annuler,
 * Confirmer. C'est une protection contre l'erreur de manipulation, pas une
 * seconde authentification — l'action revérifie sa permission côté serveur,
 * et la base la revérifie encore.
 *
 * Le premier clic ne déclenche **aucune** requête : il ne fait qu'ouvrir la
 * fenêtre.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function ConfirmForm({
  action,
  fields,
  trigger,
  title,
  consequence,
  confirmLabel,
  variant = 'ghost',
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  fields: Record<string, string>;
  trigger: string;
  /** Question posée en titre de la fenêtre. Par défaut : le libellé du bouton. */
  title?: string;
  consequence: string;
  confirmLabel: string;
  variant?: 'ghost' | 'primary' | 'gold' | 'danger';
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [open, setOpen] = useState(false);

  if (state.status !== 'idle') {
    return <AdminNotice state={state} />;
  }

  return (
    <form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <button className={`btn btn--${variant}`} type="button" onClick={() => setOpen(true)}>
        {trigger}
      </button>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title ?? `${trigger} ?`}
        confirmLabel={confirmLabel}
        variant={variant === 'ghost' ? 'primary' : variant}
      >
        <p>{consequence}</p>
      </ConfirmDialog>
    </form>
  );
}
