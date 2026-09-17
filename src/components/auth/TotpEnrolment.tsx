'use client';

import { useActionState } from 'react';

import AuthNotice from '@/components/auth/AuthNotice';
import SubmitButton from '@/components/auth/SubmitButton';
import { confirmTotpEnrolmentAction, startTotpEnrolmentAction } from '@/lib/auth/actions';
import { MFA_ENROLMENT_IDLE } from '@/lib/auth/messages';

/**
 * Enrôlement d'un facteur TOTP.
 *
 * Le parcours se joue en deux temps, portés par deux actions serveur
 * distinctes :
 *
 *   1. **démarrer** — Supabase produit un secret, un code QR et une URI ;
 *   2. **confirmer** — la personne saisit un code réellement produit par son
 *      application. Sans cette étape, le facteur reste « non vérifié » et ne
 *      protège rien : c'est précisément pourquoi le serveur ne compte que les
 *      facteurs vérifiés.
 *
 * Le secret est affiché en clair sous le code QR. Ce n'est pas une négligence
 * mais une nécessité d'accessibilité : sans appareil photo, sans caméra
 * fonctionnelle, ou avec un lecteur d'écran, la saisie manuelle est le seul
 * chemin. Le secret ne quitte jamais cet écran — il n'est ni journalisé, ni
 * enregistré en base, ni renvoyé une seconde fois.
 */
export default function TotpEnrolment() {
  const [start, startAction] = useActionState(startTotpEnrolmentAction, MFA_ENROLMENT_IDLE);
  // État propre au second temps. Le code QR et le secret restent lus dans
  // `start` : ils ne sont produits qu'une fois, et une saisie erronée ne doit
  // pas les faire disparaître de l'écran.
  const [confirm, confirmAction] = useActionState(confirmTotpEnrolmentAction, MFA_ENROLMENT_IDLE);

  // Tant que le premier temps n'a pas produit de facteur, seul le bouton de
  // démarrage est présenté.
  if (!start.factorId) {
    return (
      <form action={startAction}>
        <AuthNotice state={start} />

        <ol className="auth-steps">
          <li>
            <strong>Installez une application d’authentification</strong>
            Google Authenticator, Microsoft Authenticator, Authy ou toute autre application
            compatible TOTP, sur votre téléphone.
          </li>
          <li>
            <strong>Scannez le code affiché à l’étape suivante</strong>
            Votre application produira alors un code à six chiffres, renouvelé toutes les trente
            secondes.
          </li>
          <li>
            <strong>Saisissez ce code pour confirmer</strong>
            La protection ne devient active qu’une fois le premier code vérifié.
          </li>
        </ol>

        <SubmitButton
          label="Commencer la configuration"
          pendingLabel="Préparation…"
          variant="primary"
        />
      </form>
    );
  }

  return (
    <form className="form" action={confirmAction}>
      <AuthNotice state={confirm.status === 'idle' ? start : confirm} />

      <input type="hidden" name="facteur" value={start.factorId} />

      {start.qrCode && (
        <div className="auth-qr">
          {/*
            Le code QR arrive de Supabase sous forme d'URI de données SVG.
            `next/image` n'apporterait rien ici — pas de fichier à optimiser, pas
            de mise en cache possible — et l'attribut `alt` porte déjà
            l'alternative utile : le secret est lisible juste en dessous.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={start.qrCode}
            alt="Code QR à scanner avec votre application d’authentification"
            width={220}
            height={220}
          />
        </div>
      )}

      {start.secret && (
        <div className="auth-secret">
          <span className="auth-secret__label">
            Vous ne pouvez pas scanner&nbsp;? Saisissez cette clé manuellement dans votre
            application&nbsp;:
          </span>
          <code>{start.secret}</code>
        </div>
      )}

      <div className="field auth-code">
        <label htmlFor="code">
          Code affiché par votre application{' '}
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
          required
        />
      </div>

      <SubmitButton label="Activer la double authentification" pendingLabel="Vérification…" />
    </form>
  );
}
