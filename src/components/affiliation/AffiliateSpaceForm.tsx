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

export function ProspectForm({
  action,
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <>
        <Notice state={state} />
        <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
          Déclarer un prospect
        </button>
      </>
    );
  }
  return (
    <form action={formAction} className="form" key={state.status === 'ok' ? state.message : 'form'}>
      <Notice state={state} />
      <div className="form__row">
        <div className="field">
          <label htmlFor="pr-name">Nom du prospect <span className="req" aria-hidden="true">*</span></label>
          <input id="pr-name" name="full_name" required maxLength={120} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="pr-company">Entreprise ou organisation</label>
          <input id="pr-company" name="company" maxLength={160} autoComplete="off" />
        </div>
      </div>
      <div className="form__row">
        <div className="field">
          <label htmlFor="pr-phone">Téléphone ou WhatsApp <span className="req" aria-hidden="true">*</span></label>
          <input id="pr-phone" name="phone" type="tel" inputMode="tel" required maxLength={40} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="pr-email">E-mail</label>
          <input id="pr-email" name="email" type="email" inputMode="email" maxLength={160} autoComplete="off" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="pr-need">Son besoin <span className="req" aria-hidden="true">*</span></label>
        <textarea id="pr-need" name="need" rows={3} required maxLength={1000} />
      </div>
      <div className="field">
        <label htmlFor="pr-comment">Commentaire</label>
        <textarea id="pr-comment" name="comment" rows={2} maxLength={1000} />
      </div>
      <label className="aff-consent-line">
        <input type="checkbox" name="consent" value="1" required />
        <span>J’ai l’accord de cette personne pour transmettre ses coordonnées et son besoin à MORA Shawiri.</span>
      </label>
      <p className="form__note">Ne transmettez que ce qui est utile. L’origine du prospect est vérifiée par MORA Shawiri.</p>
      <div className="btn-row">
        <Submit label="Déclarer" />
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
          Fermer
        </button>
      </div>
    </form>
  );
}

export function CancelProspectButton({
  action,
  prospectId,
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  prospectId: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  if (state.status === 'ok') return <Notice state={state} />;
  return (
    <form action={formAction}>
      <Notice state={state} />
      <input type="hidden" name="prospect" value={prospectId} />
      <button type="submit" className="btn btn--ghost">
        Annuler la déclaration
      </button>
    </form>
  );
}
