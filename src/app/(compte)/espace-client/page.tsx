import type { Metadata } from 'next';
import Link from 'next/link';

import SignOutButton from '@/components/auth/SignOutButton';
import PageHero from '@/components/sections/PageHero';
import { requirePrivateAccess } from '@/lib/auth/guards';
import { displayIdentity } from '@/lib/auth/identifiers';
import { AUTH_ROUTES } from '@/lib/auth/routes';

export const metadata: Metadata = {
  title: 'Mon espace',
  description: 'Votre espace client MORA Shawiri.',
  robots: { index: false, follow: false },
};

/**
 * Espace client.
 *
 * Volontairement sobre : la phase 4B livre l'authentification et les sessions,
 * pas l'espace client lui-même — qui suppose des commandes, des devis et des
 * rendez-vous, c'est-à-dire des phases qui n'ont pas encore eu lieu.
 *
 * Cette page a néanmoins une fonction précise : elle prouve que la session
 * fonctionne de bout en bout, qu'elle survit à une navigation, et qu'un
 * visiteur non connecté n'y accède pas. C'est la destination des parcours de
 * connexion et de confirmation d'adresse ; elle ne peut pas rester absente.
 */
export default async function EspaceClientPage() {
  const context = await requirePrivateAccess(AUTH_ROUTES.clientArea);

  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: 'Super-administrateur',
    ADMIN: 'Administrateur',
    CLIENT: 'Client',
    AFFILIE: 'Affilié',
  };

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Mon espace' }]}
        eyebrow="Votre compte"
        title={`Bonjour ${context.profile.full_name ?? displayIdentity(context.profile, context.email)}`}
        lead="Votre compte est actif. Les fonctionnalités de votre espace arriveront au fil des prochaines étapes du site."
      />

      <section className="section auth-shell auth-shell--wide">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Votre compte</h2>
              </div>

              <dl className="auth-meta">
                <div>
                  <dt>Identifiant</dt>
                  <dd>{displayIdentity(context.profile, context.email)}</dd>
                </div>
                <div>
                  <dt>Statut</dt>
                  <dd>
                    <span className="auth-badge auth-badge--ok">Actif</span>
                  </dd>
                </div>
                <div>
                  <dt>Rôle</dt>
                  <dd>
                    {context.roles.length > 0
                      ? context.roles.map((role) => roleLabels[role] ?? role).join(', ')
                      : 'Aucun rôle attribué'}
                  </dd>
                </div>
                {context.profile.last_login_at && (
                  <div>
                    <dt>Dernière connexion</dt>
                    <dd>
                      {new Date(context.profile.last_login_at).toLocaleString('fr-FR', {
                        dateStyle: 'long',
                        timeStyle: 'short',
                      })}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Sécurité</h2>
                <p>
                  Votre mot de passe est le seul élément qui protège votre compte. Choisissez-en un
                  que vous n’utilisez nulle part ailleurs.
                </p>
              </div>

              <div className="btn-row">
                <Link className="btn btn--ghost" href={AUTH_ROUTES.changePassword}>
                  Changer mon mot de passe
                </Link>
                {context.isAdmin && (
                  <Link className="btn btn--ghost" href={AUTH_ROUTES.adminArea}>
                    Administration
                  </Link>
                )}
              </div>
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Quitter</h2>
                <p>La déconnexion ferme toutes vos sessions, sur tous vos appareils.</p>
              </div>

              <SignOutButton />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
