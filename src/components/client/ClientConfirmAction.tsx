'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AdminActionState } from '@/lib/admin/actions';

/**
 * Action confirmée de l'espace client (phase 4I-3) — styles de l'espace privé,
 * jamais ceux de l'administration.
 *
 * Deux temps : le bouton ouvre la confirmation, qui dit la conséquence et,
 * s'il le faut, demande un motif (obligatoire ou facultatif). La base refait
 * tous les contrôles : cette confirmation n'en est pas un.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

function Confirm({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn--primary" type="submit" disabled={pending}>
      {pending ? 'Envoi…' : label}
    </button>
  );
}

export default function ClientConfirmAction({
  action,
  fields,
  trigger,
  consequence,
  confirmLabel,
  reason,
  variant = 'primary',
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  fields: Record<string, string>;
  trigger: string;
  consequence: string;
  confirmLabel: string;
  reason?: { label: string; required: boolean; maxLength: number; hint?: string };
  variant?: 'primary' | 'ghost';
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [open, setOpen] = useState(false);

  if (state.status === 'ok') {
    return (
      <div className="auth-notice auth-notice--ok" role="status">
        <p>{state.message}</p>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className={`btn btn--${variant}`} onClick={() => setOpen(true)}>
        {trigger}
      </button>
    );
  }

  const reasonId = `motif-${Object.values(fields).join('-')}`;
  return (
    <form action={formAction} className="form">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="auth-notice auth-notice--warn" role="status">
        <p>{consequence}</p>
      </div>
      {state.status === 'error' && state.message ? (
        <div className="form-alert" role="alert">
          <span>{state.message}</span>
        </div>
      ) : null}
      {reason ? (
        <div className="field">
          <label htmlFor={reasonId}>
            {reason.label}
            {reason.required ? '' : ' (facultatif)'}
          </label>
          <textarea
            id={reasonId}
            name="motif"
            rows={3}
            maxLength={reason.maxLength}
            required={reason.required}
            minLength={reason.required ? 3 : undefined}
          />
          {reason.hint ? <p className="form__note">{reason.hint}</p> : null}
        </div>
      ) : null}
      <div className="btn-row">
        <Confirm label={confirmLabel} />
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
          Ne rien faire
        </button>
      </div>
    </form>
  );
}
