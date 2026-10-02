'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AdminActionState } from '@/lib/admin/actions';
import { CONTACT_PREFERENCE_LABELS, CONTACT_PREFERENCES } from '@/lib/client/profile';
import type { ContactPreference } from '@/lib/supabase/types-client';

/**
 * Formulaire du profil client (phase 4I-1) — styles de l'espace privé
 * (`.espace`), jamais ceux de l'administration.
 *
 * Le WhatsApp peut être le numéro de téléphone : la case le recopie, et c'est
 * ce numéro qui est enregistré, explicitement. Les règles sont vérifiées ici
 * pour répondre vite, puis par la base, pour de bon.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn--primary" type="submit" disabled={pending}>
      {pending ? 'Enregistrement…' : 'Enregistrer mon profil'}
    </button>
  );
}

export default function ClientProfileForm({
  action,
  initial,
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  initial: { nom: string; telephone: string; whatsapp: string; preference: ContactPreference | '' };
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [sameAsPhone, setSameAsPhone] = useState(initial.whatsapp !== '' && initial.whatsapp === initial.telephone);

  return (
    <form action={formAction} className="form">
      {state.status !== 'idle' && state.message ? (
        <div
          className={`auth-notice ${state.status === 'error' ? 'auth-notice--warn' : 'auth-notice--ok'}`}
          role={state.status === 'error' ? 'alert' : 'status'}
        >
          <p>{state.message}</p>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="cli-nom">Nom complet</label>
        <input id="cli-nom" name="nom" required minLength={2} maxLength={120} autoComplete="name" defaultValue={initial.nom} />
      </div>

      <div className="field">
        <label htmlFor="cli-tel">Téléphone</label>
        <input id="cli-tel" name="telephone" type="tel" inputMode="tel" maxLength={40} autoComplete="tel" defaultValue={initial.telephone} />
      </div>

      <div className="field">
        <label>
          <input
            type="checkbox"
            name="meme_numero"
            checked={sameAsPhone}
            onChange={(event) => setSameAsPhone(event.target.checked)}
          />
          Mon numéro WhatsApp est mon numéro de téléphone
        </label>
      </div>

      {sameAsPhone ? null : (
        <div className="field">
          <label htmlFor="cli-wa">WhatsApp</label>
          <input id="cli-wa" name="whatsapp" type="tel" inputMode="tel" maxLength={40} defaultValue={initial.whatsapp} />
        </div>
      )}

      <div className="field">
        <label htmlFor="cli-pref">Comment préférez-vous être contacté ?</label>
        <select id="cli-pref" name="preference" defaultValue={initial.preference}>
          <option value="">Pas de préférence</option>
          {CONTACT_PREFERENCES.map((code) => (
            <option key={code} value={code}>
              {CONTACT_PREFERENCE_LABELS[code]}
            </option>
          ))}
        </select>
      </div>

      <p className="form__note">
        Votre adresse e-mail est celle de votre connexion : elle ne se modifie pas ici. Pour la changer, contactez
        MORA Shawiri.
      </p>

      <div className="btn-row">
        <Submit />
      </div>
    </form>
  );
}
