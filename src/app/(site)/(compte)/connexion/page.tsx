import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import SignInForm from '@/components/auth/SignInForm';
import PageHero from '@/components/sections/PageHero';
import { AUTH_MESSAGES } from '@/lib/auth/messages';
import { AUTH_ROUTES, NEXT_PARAM, safeInternalPath } from '@/lib/auth/routes';
import { adminAccessObstacle, getAuthContext, privateAccessObstacle } from '@/lib/auth/session';

/**
 * Page de connexion.
 *
 * `06_SEO/05_ANALYTICS_ET_INDEXATION.md` § 67 : « La page de connexion n'a
 * généralement pas de valeur SEO. » Elle est donc explicitement retirée de
 * l'indexation, et absente du plan de site.
 */
export const metadata: Metadata = {
  title: 'Connexion',
  description: 'Accédez à votre espace MORA Shawiri.',
  robots: { index: false, follow: false },
};

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params[NEXT_PARAM];
  const next = safeInternalPath(Array.isArray(raw) ? raw[0] : raw, '');

  // Une personne déjà connectée n'a rien à faire ici : elle est conduite là où
  // elle en est réellement de son parcours — changement de mot de passe
  // obligatoire, second facteur, ou son espace.
  const context = await getAuthContext();

  if (context) {
    const obstacle = context.isAdmin
      ? adminAccessObstacle(context)
      : privateAccessObstacle(context);

    if (obstacle === 'mot-de-passe-a-changer') redirect(AUTH_ROUTES.changePassword);
    if (obstacle === 'second-facteur-a-enroler') redirect(AUTH_ROUTES.mfaSettings);
    if (obstacle === 'second-facteur-a-verifier') redirect(AUTH_ROUTES.mfaChallenge);

    redirect(
      safeInternalPath(next, context.isAdmin ? AUTH_ROUTES.adminArea : AUTH_ROUTES.clientArea),
    );
  }

  const linkFailed = params.lien === 'invalide';

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Connexion' }]}
        eyebrow="Votre compte"
        title="Connexion"
        lead="Retrouvez vos demandes, vos commandes et vos échanges avec MORA Shawiri."
      />

      <section className="section auth-shell">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              {linkFailed && (
                <div className="auth-notice auth-notice--warn" role="status">
                  <strong>Ce lien n’a pas pu être utilisé.</strong>
                  <span>{AUTH_MESSAGES.linkUnusable}</span>
                </div>
              )}

              <div className="auth-card__head">
                <h2>Accéder à mon espace</h2>
                <p>Saisissez vos identifiants pour continuer.</p>
              </div>

              <SignInForm next={next} />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
