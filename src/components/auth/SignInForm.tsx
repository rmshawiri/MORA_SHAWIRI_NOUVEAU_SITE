'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import AuthNotice from '@/components/auth/AuthNotice';
import HoneypotField from '@/components/auth/HoneypotField';
import SubmitButton from '@/components/auth/SubmitButton';
import { signInAction } from '@/lib/auth/actions';
import { AUTH_IDLE } from '@/lib/auth/messages';
import { AUTH_ROUTES, NEXT_PARAM } from '@/lib/auth/routes';

/**
 * Formulaire de connexion.
 *
 * Un seul champ d'identification, qui accepte les deux formes retenues par la
 * décision D-4 : l'identifiant métier d'un administrateur (`rachade`) ou
 * l'adresse e-mail d'un client. Le serveur tranche — voir
 * `src/lib/auth/identifiers.ts`.
 *
 * Aucune validation de format n'est faite ici, et c'est volontaire : refuser
 * « ceci n'est pas une adresse e-mail » avant l'envoi apprendrait à un
 * attaquant quelles formes le système reconnaît, et la validation côté
 * navigateur ne protège rien de toute façon (§ 3 : « aucune confiance accordée
 * au frontend »).
 *
 * `inputMode` et `autoComplete` sont renseignés pour que le clavier mobile et
 * le gestionnaire de mots de passe fassent leur travail (§ 120-121).
 */
export default function SignInForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signInAction, AUTH_IDLE);

  return (
    <form className="form" action={formAction}>
      <AuthNotice state={state} />

      <input type="hidden" name={NEXT_PARAM} value={next} />

      <div className="field">
        <label htmlFor="identifiant">
          Identifiant ou adresse e-mail{' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="identifiant"
          name="identifiant"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <p className="field__hint">
          Les administrateurs utilisent leur identifiant. Les clients utilisent l’adresse e-mail de
          leur compte.
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
          autoComplete="current-password"
          required
        />
      </div>

      <HoneypotField />

      <SubmitButton label="Se connecter" pendingLabel="Connexion en cours…" />

      <div className="auth-links">
        <Link href={AUTH_ROUTES.forgotPassword}>Mot de passe oublié&nbsp;?</Link>
        <Link href={AUTH_ROUTES.signUp}>Créer un compte client</Link>
      </div>
    </form>
  );
}
