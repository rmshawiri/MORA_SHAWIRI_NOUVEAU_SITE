'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';

import AuthNotice from '@/components/auth/AuthNotice';
import { removeTotpFactorAction } from '@/lib/auth/actions';
import { AUTH_IDLE } from '@/lib/auth/messages';
import type { EnrolledFactor } from '@/lib/auth/session';

/**
 * Facteurs enrôlés, et retrait éventuel.
 *
 * Le bouton de retrait n'est affiché que si le serveur l'autorise
 * (`removable`) : retirer le dernier facteur d'un compte soumis à la double
 * authentification obligatoire le laisserait, un temps, protégé par un simple
 * mot de passe. Le § 9 du cadrage demande qu'un `SUPER_ADMIN` ne puisse pas se
 * mettre lui-même en difficulté par une fausse manœuvre.
 *
 * Masquer le bouton ne suffit évidemment pas : l'action serveur refuse le
 * retrait de son côté, qu'elle ait été appelée depuis ce bouton ou autrement.
 * L'interface explique, le serveur décide.
 */
export default function FactorList({
  factors,
  removable,
}: {
  factors: readonly EnrolledFactor[];
  removable: boolean;
}) {
  const [state, formAction] = useActionState(removeTotpFactorAction, AUTH_IDLE);
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'ok') router.refresh();
  }, [state.status, router]);

  if (factors.length === 0) return null;

  return (
    <div>
      <AuthNotice state={state} />

      {factors.map((factor) => (
        <div className="auth-factor" key={factor.id}>
          <div>
            <span className="auth-factor__name">
              {factor.friendlyName ?? 'Application d’authentification'}
            </span>
            {factor.createdAt && (
              <span className="auth-factor__date">
                Enrôlée le{' '}
                {new Date(factor.createdAt).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            )}
          </div>

          {removable ? (
            <form action={formAction}>
              <input type="hidden" name="facteur" value={factor.id} />
              <RemoveButton />
            </form>
          ) : (
            <span className="auth-badge auth-badge--ok">Protection active</span>
          )}
        </div>
      ))}
    </div>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();

  return (
    <button className="btn btn--ghost btn--danger" type="submit" disabled={pending}>
      {pending ? 'Retrait…' : 'Retirer ce facteur'}
    </button>
  );
}
