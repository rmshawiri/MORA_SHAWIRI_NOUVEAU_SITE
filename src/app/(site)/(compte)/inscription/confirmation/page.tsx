import type { Metadata } from 'next';
import Link from 'next/link';

import PageHero from '@/components/sections/PageHero';
import { Check } from '@/components/ui/Icon';
import { AUTH_MESSAGES } from '@/lib/auth/messages';
import { AUTH_ROUTES } from '@/lib/auth/routes';

export const metadata: Metadata = {
  title: 'Confirmez votre adresse',
  description: 'Dernière étape de la création de votre compte.',
  robots: { index: false, follow: false },
};

/**
 * Écran d'attente après inscription.
 *
 * Cette page est atteinte **quelle que soit l'issue réelle** : adresse libre,
 * adresse déjà inscrite, ou refus du service d'authentification. C'est la
 * condition pour que l'inscription ne permette pas de découvrir si une adresse
 * possède déjà un compte (§ 127, § 171).
 *
 * Elle ne lit aucune donnée et ne nomme aucune adresse : elle décrit ce qui va
 * se passer, sans rien confirmer.
 */
export default function ConfirmationPage() {
  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Confirmation' }]}
        eyebrow="Votre compte"
        title="Vérifiez votre boîte e-mail"
        lead="Une dernière étape avant d’accéder à votre espace."
      />

      <section className="section auth-shell">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              <div className="rdv-done__head">
                <span className="rdv-done__icon" aria-hidden="true">
                  <Check size={16} strokeWidth={3} />
                </span>
                <h2>Votre demande est enregistrée</h2>
              </div>

              <p className="lead" style={{ marginTop: 'var(--sp-4)' }}>
                {AUTH_MESSAGES.registrationSubmitted}
              </p>

              <div className="auth-notice" role="note">
                <strong>Ouvrez le lien depuis ce navigateur.</strong>
                <span>
                  Le lien de confirmation est rattaché au navigateur d’où votre demande est
                  partie. Ouvert ailleurs, il vous demandera de recommencer.
                </span>
              </div>

              <div className="btn-row">
                <Link className="btn btn--gold" href={AUTH_ROUTES.signIn}>
                  Aller à la connexion
                </Link>
                <Link className="btn btn--ghost" href="/contact/">
                  Je n’ai rien reçu
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
