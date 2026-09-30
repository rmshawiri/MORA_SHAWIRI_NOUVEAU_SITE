import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import { requireModule } from '@/lib/rbac/guards';
import {
  countQuoteRequestsByStatus,
  formatMoment,
  listQuoteRequests,
  QUOTE_REQUEST_STATUS_LABELS,
} from '@/lib/relation/admin';
import type { QuoteRequestStatus } from '@/lib/supabase/types';

export const metadata: Metadata = {
  title: 'Demandes et devis',
  robots: { index: false, follow: false },
};

/**
 * Module « Demandes et devis » — phase 4F.
 *
 * Le module ouvre sous `quotes.view` ; les autres droits gouvernent ce qu'on
 * peut y faire, depuis la fiche :
 *
 *   * `quotes.view`   ouvre le module et la liste ;
 *   * `quotes.update` autorise l'affectation et les notes internes ;
 *   * `quotes.create` autorise la création d'un devis en brouillon ;
 *   * `quotes.manage` autorise les changements de statut et l'émission.
 *
 * Consulter sans pouvoir décider est donc un état normal — c'est même celui
 * que le § 10 des rôles (moindre privilège) demande de rendre possible.
 *
 * ## Ce que la liste ne montre pas
 *
 * Ni le message libre, ni le téléphone. Un tableau n'en a pas besoin, et le
 * point 17 du cadrage demande de ne pas étaler des données personnelles qu'on
 * ne consulte pas — y compris devant quelqu'un d'autorisé. Elles sont sur la
 * fiche, où l'on va les chercher en le voulant.
 *
 * ## Aucun chiffre fabriqué
 *
 * Les totaux sont des comptages sur les lignes réellement lues. Le § 171 du
 * tableau de bord interdit de simuler une fonctionnalité absente ; il
 * n'interdit pas de compter ce qui est là.
 */
export default async function DemandesPage() {
  const context = await requireModule('demandes');
  const requests = await listQuoteRequests();
  const counts = countQuoteRequestsByStatus(requests);

  const ouvertes = counts.NOUVELLE + counts.EN_ETUDE + counts.DEVIS_ENVOYE;

  return (
    <AdminPage
      eyebrow="Activité"
      title="Demandes et devis"
      lead="Les demandes reçues depuis le site, les devis émis et leur suivi. Chaque demande porte une référence stable, citée dans le journal d’activité."
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Demandes reçues</h2>
          <p>
            {requests.length} demande(s) enregistrée(s), dont {ouvertes} en cours :{' '}
            {counts.NOUVELLE} nouvelle(s), {counts.EN_ETUDE} à l’étude, {counts.DEVIS_ENVOYE} avec
            devis envoyé. {counts.ACCEPTEE} acceptée(s), {counts.REFUSEE} refusée(s),{' '}
            {counts.TERMINEE} terminée(s), {counts.ANNULEE} annulée(s).
          </p>
        </div>

        {requests.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune demande enregistrée</p>
            <p>
              C’est l’état réel de la base. Les demandes envoyées depuis le formulaire de contact
              apparaissent ici dès leur réception — celles reçues par courriel avant la mise en
              place de cet enregistrement n’y figurent pas, elles n’ont jamais été stockées.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">
                Demandes reçues, de la plus récente à la plus ancienne
              </caption>
              <thead>
                <tr>
                  <th scope="col">Référence</th>
                  <th scope="col">Demandeur</th>
                  <th scope="col">Besoin</th>
                  <th scope="col">Prestation</th>
                  <th scope="col">Budget</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Reçue le</th>
                  <th scope="col">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      <code>{entry.reference}</code>
                    </th>
                    <td>{entry.leads?.full_name ?? '—'}</td>
                    <td>{entry.subject}</td>
                    <td>{entry.services?.title ?? entry.offer_title ?? '—'}</td>
                    <td>{entry.budget_label ?? '—'}</td>
                    <td>{statusBadge(entry.status)}</td>
                    <td>{formatMoment(entry.created_at)}</td>
                    <td>
                      <Link
                        className="btn btn--ghost"
                        href={`/administration/demandes/${entry.reference}/`}
                      >
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

      {context.can('quotes.manage') ? null : (
        <div className="admin-notice">
          <p>
            Vous consultez les demandes sans pouvoir en changer le statut ni émettre de devis. La
            permission <code>quotes.manage</code> est nécessaire pour décider du sort d’une
            demande.
          </p>
        </div>
      )}
    </AdminPage>
  );
}

function statusBadge(status: QuoteRequestStatus) {
  const className =
    status === 'ACCEPTEE' || status === 'TERMINEE'
      ? 'admin-badge--ok'
      : status === 'NOUVELLE'
        ? 'admin-badge--gold'
        : status === 'REFUSEE' || status === 'ANNULEE'
          ? 'admin-badge--danger'
          : 'admin-badge--muted';

  return <span className={`admin-badge ${className}`}>{QUOTE_REQUEST_STATUS_LABELS[status]}</span>;
}
