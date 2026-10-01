import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import { countApplicationsByStatus, listApplications } from '@/lib/affiliation/admin';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Affiliation',
  robots: { index: false, follow: false },
};

/**
 * Module « Affiliation » — phase 4H.
 *
 * Le garde est celui de 4C : `requireModule` exige la session, le rôle et
 * `affiliates.view`. Chaque sous-partie exige en plus sa propre permission,
 * vérifiée par sa page et par la base.
 *
 * L'accueil ne fabrique aucun chiffre : il compte ce qui est en base.
 */
export default async function AffiliationPage() {
  const context = await requireModule('affiliation');
  const canApplications = context.can('affiliate_applications.view');
  const applications = canApplications ? await listApplications() : [];
  const counts = countApplicationsByStatus(applications);
  const open = counts.NOUVELLE + counts.EN_ETUDE + counts.INFOS_REQUISES;

  return (
    <AdminPage
      eyebrow="Partenaires"
      title="Affiliation"
      lead="Candidatures, affiliés, règles de commission, commissions et versements. Chaque acte financier exige sa permission et laisse une trace."
      actions={
        <>
          {canApplications ? (
            <Link className="btn btn--primary" href="/administration/affiliation/candidatures/">
              Candidatures{open > 0 ? ` (${open} à traiter)` : ''}
            </Link>
          ) : null}
          <Link className="btn btn--ghost" href="/administration/affiliation/affilies/">
            Affiliés
          </Link>
          <Link className="btn btn--ghost" href="/administration/affiliation/prospects/">
            Prospects déclarés
          </Link>
          <Link className="btn btn--ghost" href="/administration/affiliation/categories/">
            Catégories et règles
          </Link>
        </>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Candidatures</h2>
          <p>
            {canApplications
              ? `${applications.length} candidature(s) reçue(s) : ${counts.NOUVELLE} nouvelle(s), ${counts.EN_ETUDE} en étude, ${counts.INFOS_REQUISES} en attente d’informations, ${counts.ACCEPTEE} acceptée(s), ${counts.REFUSEE} refusée(s).`
              : 'La permission affiliate_applications.view est nécessaire pour consulter les candidatures.'}
          </p>
        </div>
      </section>
    </AdminPage>
  );
}
