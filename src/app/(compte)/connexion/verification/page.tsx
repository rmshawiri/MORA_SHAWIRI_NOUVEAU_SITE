import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import SignOutButton from '@/components/auth/SignOutButton';
import TotpChallengeForm from '@/components/auth/TotpChallengeForm';
import PageHero from '@/components/sections/PageHero';
import { requireSession } from '@/lib/auth/guards';
import { AUTH_ROUTES, NEXT_PARAM, safeInternalPath } from '@/lib/auth/routes';

export const metadata: Metadata = {
  title: 'Vérification en deux étapes',
  description: 'Présentez votre second facteur d’authentification.',
  robots: { index: false, follow: false },
};

/**
 * Second facteur — étape de connexion.
 *
 * La page n'est pas soumise au garde d'administration : elle est précisément
 * l'endroit où l'on lève l'obstacle « second facteur à vérifier ». L'y soumettre
 * créerait une boucle de redirection. Elle exige donc une session, et rien de
 * plus.
 *
 * Deux redirections la protègent malgré tout de l'inutile : une session déjà
 * `AAL2` n'a rien à y faire, et un compte sans facteur vérifié doit d'abord en
 * enrôler un.
 */
export default async function VerificationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireSession(AUTH_ROUTES.mfaChallenge);

  if (context.mustChangePassword) redirect(AUTH_ROUTES.changePassword);
  if (context.totpFactors.length === 0) redirect(AUTH_ROUTES.mfaSettings);

  const params = await searchParams;
  const raw = params[NEXT_PARAM];
  const next = safeInternalPath(
    Array.isArray(raw) ? raw[0] : raw,
    context.isAdmin ? AUTH_ROUTES.adminArea : AUTH_ROUTES.clientArea,
  );

  if (context.assuranceLevel === 'aal2') redirect(next);

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Vérification' }]}
        eyebrow="Sécurité"
        title="Vérification en deux étapes"
        lead="Votre mot de passe a été accepté. Il reste à confirmer que c’est bien vous."
      />

      <section className="section auth-shell">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Saisissez votre code</h2>
                <p>
                  Les comptes d’administration de MORA Shawiri sont protégés par une double
                  authentification. Elle reste exigée à chaque connexion.
                </p>
              </div>

              <TotpChallengeForm next={next} />

              <div className="auth-links">
                <span className="muted">
                  Vous n’avez plus accès à votre application&nbsp;? Contactez un autre
                  administrateur : lui seul peut rétablir votre accès.
                </span>
              </div>
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Ce n’est pas vous&nbsp;?</h2>
                <p>Fermez cette session immédiatement.</p>
              </div>
              <SignOutButton label="Fermer la session" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
