import type { ReactNode } from 'react';
import Link from 'next/link';

import AffiliateSpaceNav from '@/components/affiliation/AffiliateSpaceNav';
import PageHero from '@/components/sections/PageHero';
import { AFFILIATE_STATUS_LABELS } from '@/lib/affiliation/affiliates';
import { getMySpace } from '@/lib/affiliation/space';

/**
 * Espace affilié — gabarit commun (phase 4H-8).
 *
 * Accès : session et accès privé exigés (`requirePrivateAccess`), puis la
 * ligne d'affiliation du compte, lue sous RLS. Chaque page relit cet état
 * (mis en cache pour la requête) : un gabarit seul ne protège rien.
 *
 * Statuts : une affiliation suspendue ou terminée garde tout son historique
 * — commissions, versements, pièces ; seules les actions nouvelles suivent le
 * statut, et la base les refuse de toute façon.
 */
export default async function EspaceAffilieLayout({ children }: { children: ReactNode }) {
  const space = await getMySpace();

  if (space.state === 'none') {
    return (
      <>
        <PageHero
          breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Espace affilié' }]}
          eyebrow="Programme d’affiliation"
          title="Espace affilié"
          lead="Aucune affiliation active n’est rattachée à ce compte."
        />
        <section className="section auth-shell auth-shell--wide">
          <div className="container">
            <div className="auth-shell__inner">
              <div className="auth-card">
                <p>
                  Si vous avez candidaté, votre espace s’ouvrira à l’activation de votre affiliation : vous recevrez un
                  e-mail. Vous pouvez aussi <Link href="/affiliation/inscription/">déposer une candidature</Link>.
                </p>
              </div>
            </div>
          </div>
        </section>
      </>
    );
  }

  const { affiliate } = space;
  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Espace affilié' }]}
        eyebrow="Programme d’affiliation"
        title={`Bonjour ${affiliate.display_name}`}
        lead={`Affiliation ${affiliate.reference} — ${AFFILIATE_STATUS_LABELS[affiliate.status].toLowerCase()}.`}
      />
      <section className="section aff-space-section">
        <div className="container">
          <div className="aff-space">
            <AffiliateSpaceNav />
            <div className="aff-main">
              {affiliate.status !== 'ACTIF' ? (
                <div className="auth-notice auth-notice--warn" role="status">
                  <p>
                    {affiliate.status === 'SUSPENDU'
                      ? 'Votre affiliation est suspendue : vos liens et vos codes n’attribuent pas de nouvelles affaires, et vous ne pouvez pas déclarer de prospect. Votre historique reste consultable.'
                      : 'Votre affiliation a pris fin : vos liens et vos codes n’attribuent plus de nouvelles affaires. Vos commissions, vos versements et vos documents restent consultables.'}
                  </p>
                </div>
              ) : null}
              {children}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
