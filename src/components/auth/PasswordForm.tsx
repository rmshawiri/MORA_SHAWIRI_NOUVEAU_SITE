'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';

import AuthNotice from '@/components/auth/AuthNotice';
import SubmitButton from '@/components/auth/SubmitButton';
import { updatePasswordAction } from '@/lib/auth/actions';
import { AUTH_IDLE } from '@/lib/auth/messages';
import { PASSWORD_POLICY_HINT } from '@/lib/auth/passwords';

/**
 * Définition d'un nouveau mot de passe.
 *
 * Un seul composant sert les trois parcours — changement obligatoire à la
 * première connexion, changement volontaire, fin de réinitialisation —, parce
 * que la règle est la même dans les trois cas. Seule varie la demande du mot de
 * passe actuel : elle a du sens quand la personne le connaît (§ 24), pas après
 * un lien de réinitialisation, où c'est précisément ce qu'elle a oublié.
 *
 * Après succès, deux comportements, décidés par le serveur qui rend la page :
 * poursuivre vers l'étape suivante lorsqu'elle est connue — c'est le cas du
 * changement obligatoire, qui enchaîne sur l'enrôlement du second facteur —, ou
 * simplement rafraîchir, pour que le serveur relise l'état du compte. Le
 * composant ne choisit rien de lui-même.
 */
export default function PasswordForm({
  askCurrentPassword,
  submitLabel = 'Enregistrer le nouveau mot de passe',
  successHref,
}: {
  askCurrentPassword: boolean;
  submitLabel?: string;
  /** Étape suivante, lorsque le serveur la connaît d'avance. */
  successHref?: string;
}) {
  const [state, formAction] = useActionState(updatePasswordAction, AUTH_IDLE);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== 'ok') return;

    if (successHref) router.replace(successHref);
    else router.refresh();
  }, [state.status, successHref, router]);

  return (
    <form className="form" action={formAction}>
      <AuthNotice state={state} />

      {askCurrentPassword && (
        <div className="field">
          <label htmlFor="mot_de_passe_actuel">
            Mot de passe actuel{' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="mot_de_passe_actuel"
            name="mot_de_passe_actuel"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      )}

      <div className="field">
        <label htmlFor="nouveau_mot_de_passe">
          Nouveau mot de passe{' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="nouveau_mot_de_passe"
          name="nouveau_mot_de_passe"
          type="password"
          autoComplete="new-password"
          aria-describedby="nouveau_mot_de_passe-hint"
          required
        />
        <p className="field__hint" id="nouveau_mot_de_passe-hint">
          {PASSWORD_POLICY_HINT}
        </p>
      </div>

      <div className="field">
        <label htmlFor="confirmation">
          Confirmez le nouveau mot de passe{' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>

      <SubmitButton label={submitLabel} pendingLabel="Enregistrement…" />
    </form>
  );
}
