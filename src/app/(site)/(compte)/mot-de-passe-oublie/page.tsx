import type { Metadata } from 'next';

import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm';
import PageHero from '@/components/sections/PageHero';

export const metadata: Metadata = {
  title: 'Mot de passe oublié',
  description: 'Recevez un lien pour définir un nouveau mot de passe.',
  robots: { index: false, follow: false },
};

export default function MotDePasseOubliePage() {
  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Mot de passe oublié' }]}
        eyebrow="Votre compte"
        title="Mot de passe oublié"
        lead="Indiquez votre identifiant ou votre adresse e-mail : nous vous envoyons un lien pour en définir un nouveau."
      />

      <section className="section auth-shell">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Recevoir un lien</h2>
                <p>
                  Le lien est valable un temps limité et ne sert qu’une fois. Ouvrez-le depuis ce
                  navigateur.
                </p>
              </div>

              <ForgotPasswordForm />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
