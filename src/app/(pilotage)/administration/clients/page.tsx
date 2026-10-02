import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import { CLIENT_PAGE_SIZE, CLIENT_SORTS, CLIENT_STATES, listClients, readListQuery } from '@/lib/clients/admin';
import { CONTACT_PREFERENCE_LABELS } from '@/lib/client/profile';
import { formatClientDate } from '@/lib/client/labels';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Clients',
  robots: { index: false, follow: false },
};

/**
 * Module « Clients » — phase 4I-4.
 *
 * Les comptes qui portent réellement le rôle CLIENT (une fiche `clients`,
 * donc une référence MORA-CLI). Les prospects sans compte restent dans
 * « Demandes et devis ». Recherche, filtres, tri et pagination côté serveur
 * (`admin_list_clients`, sous users.view) : la page ne charge jamais toute la
 * base.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule('clients');
  const query = readListQuery(await searchParams);
  const { rows, total, failed } = await listClients(query);
  const pages = Math.max(1, Math.ceil(total / CLIENT_PAGE_SIZE));
  const link = (page: number) => {
    const params = new URLSearchParams();
    if (query.search) params.set('q', query.search);
    if (query.state) params.set('etat', query.state);
    if (query.preference) params.set('preference', query.preference);
    if (query.sort !== 'recent') params.set('tri', query.sort);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    return `/administration/clients/${qs ? `?${qs}` : ''}`;
  };

  return (
    <AdminPage
      eyebrow="Activité"
      title="Clients"
      lead="Les comptes clients, leur référence, leurs coordonnées et leur état. Ouvrez une fiche pour l’historique complet, les notes internes et le blocage."
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>{total} client(s)</h2>
          <p>Recherche par référence MORA-CLI, nom, adresse e-mail, téléphone ou WhatsApp, ou référence de commande.</p>
        </div>

        <form className="admin-filters" method="get" role="search">
          <label className="admin-field">
            <span className="admin-field__label">Rechercher</span>
            <input className="admin-input" type="search" name="q" defaultValue={query.search} maxLength={120} placeholder="MORA-CLI-A0001, nom, e-mail…" />
          </label>
          <label className="admin-field">
            <span className="admin-field__label">État</span>
            <select className="admin-input" name="etat" defaultValue={query.state}>
              <option value="">Tous</option>
              {(Object.keys(CLIENT_STATES) as (keyof typeof CLIENT_STATES)[]).map((key) => (
                <option key={key} value={key}>
                  {CLIENT_STATES[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Préférence de contact</span>
            <select className="admin-input" name="preference" defaultValue={query.preference}>
              <option value="">Toutes</option>
              {(Object.keys(CONTACT_PREFERENCE_LABELS) as (keyof typeof CONTACT_PREFERENCE_LABELS)[]).map((key) => (
                <option key={key} value={key}>
                  {CONTACT_PREFERENCE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Tri</span>
            <select className="admin-input" name="tri" defaultValue={query.sort}>
              {(Object.keys(CLIENT_SORTS) as (keyof typeof CLIENT_SORTS)[]).map((key) => (
                <option key={key} value={key}>
                  {CLIENT_SORTS[key]}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn--ghost" type="submit">
            Filtrer
          </button>
        </form>

        {failed ? (
          <div className="admin-notice admin-notice--error" role="alert">
            <p>La liste n’a pas pu être chargée. Réessayez dans un instant.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun client</p>
            <p>{query.search || query.state || query.preference ? 'Aucun client ne correspond à ces critères.' : 'Aucun compte client n’existe encore.'}</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Clients</caption>
              <thead>
                <tr>
                  <th scope="col">Référence</th>
                  <th scope="col">Nom</th>
                  <th scope="col">E-mail</th>
                  <th scope="col">Téléphone</th>
                  <th scope="col">WhatsApp</th>
                  <th scope="col">Préférence</th>
                  <th scope="col">État</th>
                  <th scope="col">Client depuis</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.user_id}>
                    <th scope="row">
                      <Link href={`/administration/clients/${row.reference}/`}>{row.reference}</Link>
                    </th>
                    <td>{row.full_name ?? '—'}</td>
                    <td>{row.email}</td>
                    <td>{row.phone ?? '—'}</td>
                    <td>{row.whatsapp ?? '—'}</td>
                    <td>{row.contact_preference ? CONTACT_PREFERENCE_LABELS[row.contact_preference] : '—'}</td>
                    <td>
                      {row.blocked ? (
                        <span className="admin-badge admin-badge--danger">Bloqué</span>
                      ) : row.profile_status !== 'ACTIF' ? (
                        <span className="admin-badge admin-badge--muted">Compte suspendu</span>
                      ) : (
                        <span className="admin-badge admin-badge--ok">Actif</span>
                      )}
                    </td>
                    <td>{formatClientDate(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 ? (
          <nav className="admin-actions" aria-label="Pagination">
            {query.page > 1 ? (
              <Link className="btn btn--ghost" href={link(query.page - 1)}>
                Page précédente
              </Link>
            ) : null}
            <span>
              Page {Math.min(query.page, pages)} sur {pages}
            </span>
            {query.page < pages ? (
              <Link className="btn btn--ghost" href={link(query.page + 1)}>
                Page suivante
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </AdminPage>
  );
}
