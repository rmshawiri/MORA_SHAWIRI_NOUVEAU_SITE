'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AdminActionState } from '@/lib/admin/actions';
import { PAYOUT_FIELDS, isPayoutKind } from '@/lib/affiliation/applications';

/**
 * Formulaires de l'espace affilié : demande de coordonnées de versement et
 * création d'une campagne. Styles de l'espace privé (`.espace`), jamais ceux
 * de l'administration.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

function Notice({ state }: { state: AdminActionState }) {
  if (state.status === 'idle' || !state.message) return null;
  return (
    <div className={`auth-notice ${state.status === 'error' ? 'auth-notice--warn' : 'auth-notice--ok'}`} role={state.status === 'error' ? 'alert' : 'status'}>
      <p>{state.message}</p>
    </div>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn--primary" type="submit" disabled={pending}>
      {pending ? 'Envoi…' : label}
    </button>
  );
}

export function PayoutRequestForm({
  action,
  methods,
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  methods: readonly { code: string; label: string; kind: string }[];
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState(methods[0]?.code ?? '');
  const kind = methods.find((entry) => entry.code === method)?.kind;
  const fields = kind && isPayoutKind(kind) ? PAYOUT_FIELDS[kind] : [];

  if (state.status === 'ok') return <Notice state={state} />;
  if (!open) {
    return (
      <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
        Demander à modifier mes coordonnées
      </button>
    );
  }
  return (
    <form action={formAction} className="form">
      <Notice state={state} />
      <div className="field">
        <label htmlFor="aff-method">Moyen de versement</label>
        <select id="aff-method" name="method" value={method} onChange={(event) => setMethod(event.target.value)}>
          {methods.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
      {fields.map((fieldDef) => (
        <div className="field" key={fieldDef.key}>
          <label htmlFor={`aff-${fieldDef.key}`}>{fieldDef.label}</label>
          <input id={`aff-${fieldDef.key}`} name={fieldDef.key} type={fieldDef.type} required autoComplete={fieldDef.autoComplete ?? 'off'} maxLength={120} />
        </div>
      ))}
      {fields.length === 0 ? <p className="form__note">Aucune coordonnée n’est nécessaire pour ce moyen.</p> : null}
      <p className="form__note">Vos coordonnées actuelles restent valables jusqu’à la validation par MORA Shawiri.</p>
      <div className="btn-row">
        <Submit label="Envoyer la demande" />
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

export function CampaignForm({
  action,
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [label, setLabel] = useState('');
  const code = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  return (
    <form action={formAction} className="form">
      <Notice state={state} />
      <div className="field">
        <label htmlFor="aff-campaign">Nouvelle campagne</label>
        <input id="aff-campaign" name="label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80}
          placeholder="Par exemple : WhatsApp, Facebook, salon" required />
        <input type="hidden" name="code" value={code} />
        <p className="form__note">Le lien se terminera par « &amp;c={code || '…'} ». Il mesure un canal ; il ne change pas votre rémunération.</p>
      </div>
      <div className="btn-row">
        <Submit label="Créer le lien" />
      </div>
    </form>
  );
}
