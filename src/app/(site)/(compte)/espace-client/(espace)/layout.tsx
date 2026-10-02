import type { ReactNode } from 'react';
import Link from 'next/link';

import SignOutButton from '@/components/auth/SignOutButton';
import ClientSpaceNav from '@/components/client/ClientSpaceNav';
import PageHero from '@/components/sections/PageHero';
import { displayIdentity } from '@/lib/auth/identifiers';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import { getMyClientSpace } from '@/lib/client/space';

/**
 * Espace client — gabarit commun (phase 4I).
 *
 * Accès : session et compte actif exigés (`requirePrivateAccess`, dans
 * `getMyClientSpace`), puis la fiche client du compte, lue sous RLS. Chaque
 * page relit cet état (mis en cache pour la requête) : un gabarit seul ne
 * protège rien.
 *
 * Un compte **suspendu** n'atteint jamais ce gabarit, même avec une session
 * encore valide : son statut est relu à chaque requête et il repart vers la
 * connexion. La base refuse de son côté toute écriture d'un compte non actif.
 *
 * Le groupe `(espace)` n'apparaît pas dans l'adresse. Il réunit les rubriques
 * déjà construites sous ce gabarit ; la fiche commande de la phase 4G le
 * rejoindra au lot 4I-2.
 */
export default async function EspaceClientLayout({ children }: { children: ReactNode }) {
  const space = await getMyClientSpace();
  const { context } = space;
  const name = context.profile.full_name ?? displayIdentity(context.profile, context.email);

  if (space.state !== 'ready') {
    return (
      <>
        <PageHero
          breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Mon espace' }]}
          eyebrow="Votre compte"
          title={`Bonjour ${name}`}
          lead={
            space.state === 'unavailable'
              ? 'Nous n’avons pas pu charger ces informations. Veuillez réessayer.'
              : space.state === 'blocked'
                ? 'Votre espace client est suspendu.'
                : 'Votre compte ne comporte pas d’espace client.'
          }
        />
        <section className="section auth-shell auth-shell--wide">
          <div className="container">
            <div className="auth-shell__inner">
              {space.state === 'blocked' ? (
                <div className="auth-notice auth-notice--warn" role="status">
                  <p>
                    L’accès à votre espace client a été suspendu par MORA Shawiri. Vos commandes, demandes et documents
                    sont conservés. Pour en savoir plus, contactez-nous.
                  </p>
                </div>
              ) : null}
              {space.state === 'unavailable' ? (
                <div className="auth-notice auth-notice--warn" role="alert">
                  <p>
                    Votre espace n’a pas pu être chargé. Rechargez la page dans un instant ; si le problème persiste,
                    contactez MORA Shawiri.
                  </p>
                </div>
              ) : space.state === 'blocked' && !space.isAffiliate && !context.isAdmin ? null : (
                <div className="auth-card">
                  <div className="auth-card__head">
                    <h2>Vos accès</h2>
                    <p>
                      L’espace client réunit les commandes, demandes et rendez-vous d’un client. Votre compte donne accès
                      aux espaces suivants.
                    </p>
                  </div>
                  <div className="btn-row">
                    {space.isAffiliate ? (
                      <Link className="btn btn--primary" href={AUTH_ROUTES.affiliateArea}>
                        Mon espace affilié
                      </Link>
                    ) : null}
                    {context.isAdmin ? (
                      <Link className="btn btn--ghost" href={AUTH_ROUTES.adminArea}>
                        Administration
                      </Link>
                    ) : null}
                    <Link className="btn btn--ghost" href={AUTH_ROUTES.changePassword}>
                      Changer mon mot de passe
                    </Link>
                  </div>
                </div>
              )}
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

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Mon espace' }]}
        eyebrow="Votre espace client"
        title={`Bonjour ${name}`}
        lead={`Retrouvez ici vos commandes, vos demandes et vos rendez-vous. Référence client : ${space.client.reference}.`}
      />
      <section className="section aff-space-section">
        <div className="container">
          <div className="aff-space">
            <ClientSpaceNav affiliate={space.isAffiliate} />
            <div className="aff-main">{children}</div>
          </div>
        </div>
      </section>
    </>
  );
}
