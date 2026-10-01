import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import { ApplicationStatusBadge } from '@/components/admin/AffiliationBadges';
import { PROFILE_LABELS, isRequestedProfile } from '@/lib/affiliation/applications';
import { countApplicationsByStatus, formatMoment, listApplications } from '@/lib/affiliation/admin';
import { requireModule } from '@/lib/rbac/guards';
import { notFound } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Candidatures affiliés',
  robots: { index: false, follow: false },
};

/**
 * Candidatures au programme d'affiliation — phase 4H.
 *
 * La liste ne montre ni la motivation, ni le téléphone, ni le moyen de
 * versement : elle sert à trier. Le détail est sur la fiche, où l'on va le
 * chercher en le voulant (même règle qu'en 4F).
 */
export default async function CandidaturesPage() {
  const context = await requireModule('affiliation');
  if (!context.can('affiliate_applications.view')) notFound();

  const applications = await listApplications();
  const counts = countApplicationsByStatus(applications);

  return (
    <AdminPage
      eyebrow="Affiliation"
      title="Candidatures"
      lead="Les candidatures déposées depuis la page d’inscription. Une candidature n’est pas un affilié : l’acceptation crée une fiche en préparation."
      actions={
        <Link className="btn btn--ghost" href="/administration/affiliation/">
          Retour au module
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Candidatures reçues</h2>
          <p>
            {applications.length} candidature(s) : {counts.NOUVELLE} nouvelle(s), {counts.EN_ETUDE} en étude,{' '}
            {counts.INFOS_REQUISES} en attente d’informations, {counts.ACCEPTEE} acceptée(s), {counts.REFUSEE}{' '}
            refusée(s).
          </p>
        </div>

        {applications.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune candidature</p>
            <p>C’est l’état réel de la base. Les candidatures déposées sur le site apparaissent ici dès leur réception.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Candidatures, de la plus récente à la plus ancienne</caption>
              <thead>
                <tr>
                  <th scope="col">Candidat</th>
                  <th scope="col">Profil indiqué</th>
                  <th scope="col">Lieu</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Reçue le</th>
                  <th scope="col">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      {entry.first_name} {entry.last_name}
                    </th>
                    <td>{isRequestedProfile(entry.requested_profile) ? PROFILE_LABELS[entry.requested_profile] : '—'}</td>
                    <td>
                      {entry.city}, {entry.country}
                    </td>
                    <td>
                      <ApplicationStatusBadge status={entry.status} />
                    </td>
                    <td>{formatMoment(entry.created_at)}</td>
                    <td>
                      <Link className="btn btn--ghost" href={`/administration/affiliation/candidatures/${entry.id}/`}>
                        Ouvrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminPage>
  );
}
