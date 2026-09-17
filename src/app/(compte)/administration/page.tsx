import type { Metadata } from 'next';
import Link from 'next/link';

import SignOutButton from '@/components/auth/SignOutButton';
import PageHero from '@/components/sections/PageHero';
import { requireAdminAccess } from '@/lib/auth/guards';
import { displayIdentity } from '@/lib/auth/identifiers';
import { AUTH_ROUTES } from '@/lib/auth/routes';

export const metadata: Metadata = {
  title: 'Administration',
  description: 'Espace d’administration MORA Shawiri.',
  robots: { index: false, follow: false },
};

/**
 * Espace d'administration — porte d'entrée.
 *
 * L'interface d'administration elle-même relève de la phase 4C. Cette page est
 * ce que la phase 4B doit livrer : **la porte**, et la preuve qu'elle ne
 * s'ouvre qu'au bon moment.
 *
 * Quatre conditions sont réunies avant qu'elle ne s'affiche, toutes vérifiées
 * côté serveur par `requireAdminAccess` :
 *
 *   * une session valide ;
 *   * un rôle d'administration — sinon la page n'existe pas, au sens propre :
 *     `notFound()` est renvoyé, car rediriger apprendrait à un client qu'une
 *     administration se trouve à cette adresse (§ 102-103) ;
 *   * le mot de passe d'amorçage remplacé ;
 *   * un second facteur enrôlé **et présenté pour cette session**.
 *
 * Saisir l'adresse directement ne change rien à ces conditions : le garde est
 * relu à chaque requête, et le niveau d'assurance est lu dans les claims
 * vérifiés du jeton.
 */
export default async function AdministrationPage() {
  const context = await requireAdminAccess(AUTH_ROUTES.adminArea);

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Administration' }]}
        eyebrow="Administration"
        title="Tableau de bord"
        lead={`Session vérifiée. Bienvenue, ${displayIdentity(context.profile, context.email)}.`}
      />

      <section className="section auth-shell auth-shell--wide">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              <div className="auth-card__head">
                <h2>État de la session</h2>
              </div>

              <dl className="auth-meta">
                <div>
                  <dt>Identifiant</dt>
                  <dd>{displayIdentity(context.profile, context.email)}</dd>
                </div>
                <div>
                  <dt>Rôles</dt>
                  <dd>{context.roles.join(', ') || '—'}</dd>
                </div>
                <div>
                  <dt>Niveau d’assurance</dt>
                  <dd>
                    <span className="auth-badge auth-badge--ok">
                      {context.assuranceLevel.toUpperCase()}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Double authentification</dt>
                  <dd>
                    {context.totpFactors.length} facteur
                    {context.totpFactors.length > 1 ? 's' : ''} vérifié
                    {context.totpFactors.length > 1 ? 's' : ''}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Ce qui arrive ensuite</h2>
                <p>
                  Les fonctions d’administration — catalogue, commandes, clients, affiliation,
                  paramètres — sont construites lors des étapes suivantes. Cette phase a livré
                  l’accès et sa protection.
                </p>
              </div>

              <div className="btn-row">
                <Link className="btn btn--ghost" href={AUTH_ROUTES.mfaSettings}>
                  Gérer la double authentification
                </Link>
                <Link className="btn btn--ghost" href={AUTH_ROUTES.changePassword}>
                  Changer mon mot de passe
                </Link>
                <Link className="btn btn--ghost" href={AUTH_ROUTES.clientArea}>
                  Mon espace
                </Link>
              </div>
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Quitter</h2>
                <p>
                  Fermez toujours votre session sur un poste partagé. Toutes vos sessions seront
                  révoquées.
                </p>
              </div>

              <SignOutButton label="Me déconnecter" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
