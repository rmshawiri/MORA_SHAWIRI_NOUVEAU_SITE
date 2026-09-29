'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import AuthNotice from '@/components/auth/AuthNotice';
import SubmitButton from '@/components/auth/SubmitButton';
import { acceptInvitationAction, type AcceptState } from '@/lib/admin/accept';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import { PASSWORD_POLICY_HINT } from '@/lib/auth/passwords';

/**
 * Choix du mot de passe par la personne invitée.
 *
 * Le jeton est transporté par un champ caché plutôt que relu de l'URL au
 * moment de la soumission : le formulaire est ainsi indépendant de la barre
 * d'adresse, et le jeton n'a pas à survivre à une navigation.
 *
 * Aucun identifiant n'est saisi ici. Il a été fixé à l'invitation et il est
 * seulement rappelé : laisser la personne le choisir permettrait de revendiquer
 * un identifiant réservé, ce que la migration 0004 § 8 sert précisément à
 * empêcher.
 *
 * Les composants d'affichage et de soumission sont ceux des parcours
 * d'authentification, sans duplication : même comportement au clavier, mêmes
 * annonces aux lecteurs d'écran, même protection contre la double soumission.
 */

const INITIAL: AcceptState = { status: 'idle', message: '' };

export default function AcceptInvitationForm({
  token,
  username,
}: {
  token: string;
  username: string;
}) {
  const [state, formAction] = useActionState(acceptInvitationAction, INITIAL);

  if (state.status === 'ok') {
    return (
      <>
        <AuthNotice state={state} />

        <div className="btn-row">
          <Link className="btn btn--gold" href={AUTH_ROUTES.signIn}>
            Me connecter
          </Link>
        </div>
      </>
    );
  }

  return (
    <form className="form" action={formAction}>
      <input type="hidden" name="jeton" value={token} />

      <AuthNotice state={state} />

      <p>
        Votre identifiant de connexion est <strong>{username}</strong>. Conservez-le : c’est avec
        lui, et non avec votre adresse e-mail, que vous vous connecterez.
      </p>

      <div className="field">
        <label htmlFor="mot_de_passe">
          Choisissez votre mot de passe{' '}
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
          Confirmez votre mot de passe{' '}
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

      <SubmitButton label="Activer mon compte" pendingLabel="Activation…" />
    </form>
  );
}
