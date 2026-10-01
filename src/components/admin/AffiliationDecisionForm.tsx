'use client';

import { useActionState, useRef, useState } from 'react';

import AdminNotice from './AdminNotice';
import ConfirmDialog from './ConfirmDialog';
import type { AdminActionState } from '@/lib/admin/actions';

/**
 * Décision d'affiliation en deux temps : on la prépare, puis on la confirme.
 *
 * Sert à tous les actes du module Affiliation qui portent une saisie — un
 * message au candidat, un motif interne, une catégorie, le choix de notifier.
 * Le premier clic ouvre le formulaire, sans requête ; « Continuer » vérifie
 * la saisie puis ouvre la fenêtre de confirmation (`ConfirmDialog`), dont le
 * bouton envoie le formulaire.
 *
 * Comme partout dans l'administration, la fenêtre protège de l'erreur de
 * manipulation ; elle n'est pas une seconde authentification. L'action
 * revérifie sa permission, et la base la revérifie encore.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export type DecisionInput =
  | {
      kind: 'textarea';
      name: string;
      label: string;
      hint?: string;
      required?: boolean;
      maxLength?: number;
      placeholder?: string;
      defaultValue?: string;
    }
  | {
      kind: 'select';
      name: string;
      label: string;
      hint?: string;
      options: readonly { value: string; label: string }[];
      defaultValue?: string;
    }
  | { kind: 'checkbox'; name: string; label: string; hint?: string; defaultChecked?: boolean }
  | { kind: 'datetime'; name: string; label: string; hint?: string; required?: boolean; defaultValue?: string }
  | { kind: 'date'; name: string; label: string; hint?: string; required?: boolean; defaultValue?: string }
  | {
      kind: 'text';
      name: string;
      label: string;
      hint?: string;
      required?: boolean;
      maxLength?: number;
      placeholder?: string;
      defaultValue?: string;
      inputMode?: 'decimal' | 'numeric' | 'email' | 'tel' | 'text';
      type?: 'text' | 'email' | 'tel';
    }
  | {
      kind: 'checklist';
      name: string;
      label: string;
      hint?: string;
      options: readonly { value: string; label: string }[];
      defaultValues?: readonly string[];
    }
  /** Un fichier joint : son type réel est revérifié par le serveur. */
  | { kind: 'file'; name: string; label: string; hint?: string; required?: boolean; accept: string }
  /** Regroupe des champs sur une ligne, comme partout dans l'administration. */
  | { kind: 'row'; inputs: readonly DecisionInput[] };

export default function AffiliationDecisionForm({
  action,
  fields,
  trigger,
  title,
  consequence,
  confirmLabel,
  inputs,
  variant = 'primary',
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  /** Champs cachés d'identification. Jamais un droit, jamais un montant décidé ici. */
  fields: Record<string, string>;
  trigger: string;
  title: string;
  consequence: string;
  confirmLabel: string;
  inputs: readonly DecisionInput[];
  variant?: 'ghost' | 'primary' | 'gold' | 'danger';
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [open, setOpen] = useState(false);
  // La fenêtre est ouverte pour un état donné de l'action : dès que le
  // serveur répond, l'état change et la fenêtre se referme d'elle-même — le
  // message doit pouvoir se lire.
  const [openedOn, setOpenedOn] = useState<AdminActionState | null>(null);
  const confirming = openedOn === state;
  const formRef = useRef<HTMLFormElement>(null);

  if (state.status === 'ok') return <AdminNotice state={state} />;

  if (!open) {
    return (
      <button className={`btn btn--${variant === 'primary' ? 'ghost' : variant}`} type="button" onClick={() => setOpen(true)}>
        {trigger}
      </button>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="admin-form admin-confirm">
      <AdminNotice state={state} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <p>{consequence}</p>

      {inputs.map((input, index) => (
        <DecisionField key={'name' in input ? input.name : `row-${index}`} input={input} />
      ))}

      <div className="admin-table__actions">
        <button
          className={`btn btn--${variant}`}
          type="button"
          onClick={() => {
            if (formRef.current?.reportValidity()) setOpenedOn(state);
          }}
        >
          Continuer
        </button>
        <button className="btn btn--ghost" type="button" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setOpenedOn(null)}
        title={title}
        confirmLabel={confirmLabel}
        variant={variant === 'ghost' ? 'primary' : variant}
      >
        <p>{consequence}</p>
      </ConfirmDialog>
    </form>
  );
}

function DecisionField({ input }: { input: DecisionInput }) {
  if (input.kind === 'row') {
    return (
      <div className="admin-form__grid">
        {input.inputs.map((child, index) => (
          <DecisionField key={'name' in child ? child.name : `row-${index}`} input={child} />
        ))}
      </div>
    );
  }
  if (input.kind === 'checkbox') {
    return (
      <label className="admin-check">
        <input type="checkbox" name={input.name} value="1" defaultChecked={input.defaultChecked} />
        <span>
          {input.label}
          {input.hint ? <small>{input.hint}</small> : null}
        </span>
      </label>
    );
  }
  if (input.kind === 'checklist') {
    return (
      <fieldset className="admin-field">
        <legend className="admin-field__label">{input.label}</legend>
        {input.options.map((option) => (
          <label key={option.value} className="admin-check">
            <input
              type="checkbox"
              name={input.name}
              value={option.value}
              defaultChecked={input.defaultValues?.includes(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {input.hint ? <span className="admin-field__hint">{input.hint}</span> : null}
      </fieldset>
    );
  }
  return (
    <label className="admin-field">
      <span className="admin-field__label">{input.label}</span>
      {input.kind === 'textarea' ? (
        <textarea
          className="admin-input admin-input--area"
          name={input.name}
          rows={3}
          required={input.required}
          maxLength={input.maxLength ?? 2000}
          placeholder={input.placeholder}
          defaultValue={input.defaultValue}
        />
      ) : input.kind === 'select' ? (
        <select className="admin-input" name={input.name} defaultValue={input.defaultValue ?? ''}>
          {input.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : input.kind === 'file' ? (
        <input className="admin-input" type="file" name={input.name} required={input.required} accept={input.accept} />
      ) : input.kind === 'datetime' || input.kind === 'date' ? (
        <input
          className="admin-input"
          type={input.kind === 'datetime' ? 'datetime-local' : 'date'}
          name={input.name}
          required={input.required}
          defaultValue={input.defaultValue}
        />
      ) : (
        <input
          className="admin-input"
          type={input.type ?? 'text'}
          name={input.name}
          required={input.required}
          maxLength={input.maxLength ?? 200}
          placeholder={input.placeholder}
          defaultValue={input.defaultValue}
          inputMode={input.inputMode}
        />
      )}
      {input.hint ? <span className="admin-field__hint">{input.hint}</span> : null}
    </label>
  );
}
