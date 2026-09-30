import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import SignUpForm from '@/components/auth/SignUpForm';
import PageHero from '@/components/sections/PageHero';
import { AUTH_MESSAGES } from '@/lib/auth/messages';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import { getAuthContext } from '@/lib/auth/session';
import { isPublicRegistrationEnabled } from '@/lib/auth/settings';

export const metadata: Metadata = {
  title: 'Créer un compte',
  description: 'Créez votre compte client MORA Shawiri.',
  robots: { index: false, follow: false },
};

/**
 * Inscription publique des clients (décision D-9).
 *
 * L'ouverture de l'inscription n'est pas écrite dans le code : elle est lue
 * dans le paramètre `auth.public_registration_enabled`, que l'administration
 * pourra basculer sans déploiement. Lorsque l'inscription est fermée, la page
 * reste atteignable et l'explique, plutôt que de renvoyer une erreur.
 */
export default async function InscriptionPage() {
  const context = await getAuthContext();
  if (context) redirect(context.isAdmin ? AUTH_ROUTES.adminArea : AUTH_ROUTES.clientArea);

  const open = await isPublicRegistrationEnabled();

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Créer un compte' }]}
        eyebrow="Votre compte"
        title="Créer un compte client"
        lead="Suivez vos demandes, retrouvez vos échanges et gardez l’historique de vos projets en un seul endroit."
      />

      <section className="section auth-shell">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              {open ? (
                <>
                  <div className="auth-card__head">
                    <h2>Vos informations</h2>
                    <p>
                      Nous ne demandons que le strict nécessaire. Le reste de votre profil se
                      complète plus tard, si vous le souhaitez.
                    </p>
                  </div>

                  <SignUpForm />
                </>
              ) : (
                <>
                  <div className="auth-card__head">
                    <h2>Création de compte momentanément fermée</h2>
                  </div>

                  <div className="auth-notice auth-notice--warn" role="status">
                    <span>{AUTH_MESSAGES.registrationClosed}</span>
                  </div>

                  <div className="btn-row">
                    <Link className="btn btn--gold" href="/contact/">
                      Nous écrire
                    </Link>
                    <Link className="btn btn--ghost" href={AUTH_ROUTES.signIn}>
                      J’ai déjà un compte
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
