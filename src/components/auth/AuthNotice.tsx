'use client';

import { useEffect, useRef } from 'react';

import type { AuthActionState } from '@/lib/auth/messages';

/**
 * Retour d'une action d'authentification.
 *
 * Le bloc prend le focus dès qu'il apparaît : un message d'erreur placé en
 * haut d'un formulaire long passerait inaperçu, en particulier pour une
 * personne utilisant un lecteur d'écran. `role="alert"` pour une erreur,
 * `role="status"` pour une confirmation — le premier interrompt, le second
 * attend une pause.
 *
 * Les libellés viennent tous de `src/lib/auth/messages.ts` : aucun texte
 * d'authentification n'est écrit dans un composant, faute de quoi la
 * neutralité des messages finirait par se perdre.
 */
export default function AuthNotice({ state }: { state: AuthActionState }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== 'idle') ref.current?.focus();
  }, [state]);

  if (state.status === 'idle' || !state.message) return null;

  const isError = state.status === 'error';

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={isError ? 'alert' : 'status'}
      className={isError ? 'form-alert' : 'auth-notice auth-notice--ok'}
    >
      <strong>{isError ? 'Votre demande n’a pas abouti.' : 'C’est noté.'}</strong>
      <span>{state.message}</span>

      {state.reasons && state.reasons.length > 0 && (
        <ul className="auth-reasons">
          {state.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
