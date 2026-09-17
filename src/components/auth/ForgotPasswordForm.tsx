'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import AuthNotice from '@/components/auth/AuthNotice';
import HoneypotField from '@/components/auth/HoneypotField';
import SubmitButton from '@/components/auth/SubmitButton';
import { requestPasswordResetAction } from '@/lib/auth/actions';
import { AUTH_IDLE } from '@/lib/auth/messages';
import { AUTH_ROUTES } from '@/lib/auth/routes';

/**
 * Demande de réinitialisation.
 *
 * Le formulaire reste affiché après l'envoi, et le message de confirmation est
 * exactement le même que l'adresse existe ou non (§ 21-22). Le masquer
 * derrière un écran de succès distinct reviendrait à confirmer que quelque
 * chose a effectivement été envoyé.
 */
export default function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, AUTH_IDLE);

  return (
    <form className="form" action={formAction}>
      <AuthNotice state={state} />

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
      </div>

      <HoneypotField />

      <SubmitButton label="Envoyer le lien" pendingLabel="Envoi en cours…" />

      <div className="auth-links">
        <Link href={AUTH_ROUTES.signIn}>Retour à la connexion</Link>
      </div>
    </form>
  );
}
