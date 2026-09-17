'use client';

import { useActionState } from 'react';

import AuthNotice from '@/components/auth/AuthNotice';
import SubmitButton from '@/components/auth/SubmitButton';
import { verifyTotpChallengeAction } from '@/lib/auth/actions';
import { AUTH_IDLE } from '@/lib/auth/messages';
import { NEXT_PARAM } from '@/lib/auth/routes';

/**
 * Présentation du second facteur.
 *
 * C'est l'étape qui fait passer la session de `AAL1` à `AAL2`. Tant qu'elle
 * n'est pas franchie, l'administration reste fermée — y compris en saisissant
 * son adresse directement, puisque le garde serveur relit le niveau
 * d'assurance à chaque requête.
 *
 * `autoComplete="one-time-code"` permet aux gestionnaires de mots de passe et
 * aux systèmes mobiles de proposer le code sans que la personne l'écrive.
 */
export default function TotpChallengeForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(verifyTotpChallengeAction, AUTH_IDLE);

  return (
    <form className="form" action={formAction}>
      <AuthNotice state={state} />

      <input type="hidden" name={NEXT_PARAM} value={next} />

      <div className="field auth-code">
        <label htmlFor="code">
          Code à six chiffres{' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          pattern="[0-9 ]*"
          autoFocus
          required
          aria-describedby="code-hint"
        />
        <p className="field__hint" id="code-hint">
          Ouvrez votre application d’authentification et recopiez le code affiché pour MORA
          Shawiri. Il change toutes les trente secondes.
        </p>
      </div>

      <SubmitButton label="Valider le code" pendingLabel="Vérification…" />
    </form>
  );
}
