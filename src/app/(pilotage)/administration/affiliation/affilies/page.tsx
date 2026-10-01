import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import { AffiliateStatusBadge } from '@/components/admin/AffiliationBadges';
import { formatMoment, listAffiliates } from '@/lib/affiliation/admin';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Affiliés',
  robots: { index: false, follow: false },
};

/**
 * Liste des affiliés — phase 4H-3.
 *
 * Sans coordonnées financières, sans règles : la liste sert à retrouver une
 * fiche. Tout le reste est sur la fiche, sous ses propres permissions.
 */
export default async function AffiliesPage() {
  await requireModule('affiliation');
  const affiliates = await listAffiliates();
  const counts = affiliates.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <AdminPage
      eyebrow="Affiliation"
      title="Affiliés"
      lead="Chaque affilié naît d’une candidature acceptée, en préparation. Il devient actif une fois sa configuration complète."
      actions={
        <Link className="btn btn--ghost" href="/administration/affiliation/">
          Retour au module
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Affiliés</h2>
          <p>
            {affiliates.length} fiche(s) : {counts.ACTIF ?? 0} active(s), {counts.PREPARATION ?? 0} en préparation,{' '}
            {counts.SUSPENDU ?? 0} suspendue(s), {counts.TERMINE ?? 0} terminée(s).
          </p>
        </div>
        {affiliates.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun affilié</p>
            <p>C’est l’état réel de la base. Un affilié apparaît ici dès qu’une candidature est acceptée.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Affiliés, du plus récent au plus ancien</caption>
              <thead>
                <tr>
                  <th scope="col">Affilié</th>
                  <th scope="col">Référence</th>
                  <th scope="col">Catégorie</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Créé le</th>
                  <th scope="col">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {affiliates.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.display_name}</th>
                    <td>{row.reference ? <code>{row.reference}</code> : '—'}</td>
                    <td>{row.categoryLabel}</td>
                    <td>
                      <AffiliateStatusBadge status={row.status} />
                    </td>
                    <td>{formatMoment(row.created_at)}</td>
                    <td>
                      <Link className="btn btn--ghost" href={`/administration/affiliation/affilies/${row.id}/`}>
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
