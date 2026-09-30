import type { Metadata } from 'next';
import Link from 'next/link';

import PasswordForm from '@/components/auth/PasswordForm';
import PageHero from '@/components/sections/PageHero';
import { AUTH_MESSAGES } from '@/lib/auth/messages';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import { getAuthContext } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Nouveau mot de passe',
  description: 'Définissez un nouveau mot de passe pour votre compte.',
  robots: { index: false, follow: false },
};

/**
 * Fin du parcours de réinitialisation.
 *
 * On y arrive par le lien reçu par e-mail, après que `/auth/callback/` l'a
 * échangé contre une session. Cette page ne demande donc pas le mot de passe
 * actuel : c'est précisément ce que la personne a oublié, et la possession du
 * lien fait office de preuve (§ 15 de l'authentification).
 *
 * **Le lien n'ouvre pas l'administration.** La session obtenue est `AAL1`. Un
 * administrateur qui réinitialise son mot de passe devra présenter son second
 * facteur pour aller plus loin : la réinitialisation ne contourne pas la double
 * authentification.
 *
 * Sans session valide — lien expiré, déjà servi, ou ouvert dans un autre
 * navigateur —, la page l'explique au lieu d'afficher un formulaire qui ne
 * pourrait pas aboutir.
 */
export default async function ReinitialiserPage() {
  const context = await getAuthContext();

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Nouveau mot de passe' }]}
        eyebrow="Votre compte"
        title="Définir un nouveau mot de passe"
        lead={
          context
            ? 'Choisissez un mot de passe que vous n’utilisez nulle part ailleurs.'
            : 'Ce lien ne peut plus servir.'
        }
      />

      <section className="section auth-shell">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              {context ? (
                <>
                  <div className="auth-card__head">
                    <h2>Votre nouveau mot de passe</h2>
                    <p>
                      Une fois enregistré, il remplace immédiatement l’ancien. Vos autres sessions
                      restent ouvertes : déconnectez-vous depuis votre espace si vous souhaitez
                      toutes les fermer.
                    </p>
                  </div>

                  <PasswordForm askCurrentPassword={false} submitLabel="Enregistrer" />

                  <div className="auth-links">
                    <Link href={AUTH_ROUTES.clientArea}>Aller à mon espace</Link>
                  </div>
                </>
              ) : (
                <>
                  <div className="auth-card__head">
                    <h2>Lien inutilisable</h2>
                  </div>

                  <div className="auth-notice auth-notice--warn" role="status">
                    <span>{AUTH_MESSAGES.linkUnusable}</span>
                  </div>

                  <div className="btn-row">
                    <Link className="btn btn--gold" href={AUTH_ROUTES.forgotPassword}>
                      Demander un nouveau lien
                    </Link>
                    <Link className="btn btn--ghost" href={AUTH_ROUTES.signIn}>
                      Retour à la connexion
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
