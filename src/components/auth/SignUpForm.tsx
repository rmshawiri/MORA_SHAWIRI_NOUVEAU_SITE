'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import AuthNotice from '@/components/auth/AuthNotice';
import HoneypotField from '@/components/auth/HoneypotField';
import SubmitButton from '@/components/auth/SubmitButton';
import { signUpAction } from '@/lib/auth/actions';
import { AUTH_IDLE } from '@/lib/auth/messages';
import { PASSWORD_POLICY_HINT } from '@/lib/auth/passwords';
import { AUTH_ROUTES } from '@/lib/auth/routes';

/**
 * Formulaire d'inscription client.
 *
 * Trois champs seulement — nom, adresse, mot de passe —, conformément au § 125
 * de l'authentification : « elle doit demander uniquement les informations
 * nécessaires ». Le téléphone, l'organisation et l'adresse postale relèvent du
 * profil, qu'on complète plus tard sans bloquer la création du compte.
 *
 * **Aucun champ de rôle n'existe, et il ne s'agit pas d'un oubli.** Le rôle
 * `CLIENT` est attribué par le serveur après création du compte. Ajouter ici
 * un champ, même caché, même en lecture seule, créerait une valeur que le
 * serveur pourrait être tenté de lire un jour.
 */
export default function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, AUTH_IDLE);

  return (
    <form className="form" action={formAction}>
      <AuthNotice state={state} />

      <div className="field">
        <label htmlFor="nom">
          Nom et prénom{' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <input id="nom" name="nom" type="text" autoComplete="name" required />
      </div>

      <div className="field">
        <label htmlFor="email">
          Adresse e-mail{' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <p className="field__hint">
          C’est avec cette adresse que vous vous connecterez. Un message de confirmation y sera
          envoyé.
        </p>
      </div>

      <div className="field">
        <label htmlFor="mot_de_passe">
          Mot de passe{' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="mot_de_passe"
          name="mot_de_passe"
          type="password"
          autoComplete="new-password"
          aria-describedby="mot_de_passe-hint"
          required
        />
        <p className="field__hint" id="mot_de_passe-hint">
          {PASSWORD_POLICY_HINT}
        </p>
      </div>

      <div className="field">
        <label htmlFor="confirmation">
          Confirmez le mot de passe{' '}
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

      <div className="field">
        <label htmlFor="conditions" style={{ display: 'flex', gap: 'var(--sp-3)' }}>
          <input id="conditions" name="conditions" type="checkbox" value="oui" required />
          <span>
            J’accepte les{' '}
            <Link href="/conditions-generales/">conditions générales d’utilisation</Link> et la{' '}
            <Link href="/politique-de-confidentialite/">politique de confidentialité</Link>.
          </span>
        </label>
      </div>

      <HoneypotField />

      <SubmitButton label="Créer mon compte" pendingLabel="Création en cours…" />

      <div className="auth-links">
        <Link href={AUTH_ROUTES.signIn}>J’ai déjà un compte</Link>
      </div>
    </form>
  );
}
