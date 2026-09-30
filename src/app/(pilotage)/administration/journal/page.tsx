import type { Metadata } from 'next';

import AdminPage from '@/components/admin/AdminPage';
import { listAuditEvents } from '@/lib/admin/administrators';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Journal d’activité',
  robots: { index: false, follow: false },
};

/**
 * Journal d'activité — lecture seule, et rien d'autre.
 *
 * Le journal a été construit en phase 4A et n'est pas refait ici : le cadrage
 * de la phase 4C interdit explicitement d'en créer un second. Cette page ne
 * fait que le montrer.
 *
 * Trois propriétés méritent d'être rappelées, parce qu'elles expliquent ce que
 * cet écran ne propose pas :
 *
 *   * `audit_logs` n'a **aucune** politique d'écriture, de modification ou de
 *     suppression. Il n'y a donc ni bouton « effacer », ni bouton « corriger ».
 *     Un journal que l'on nettoie ne prouve rien ;
 *   * l'auteur de chaque ligne est attribué par la base à partir de la
 *     session : personne ne peut imputer une action à quelqu'un d'autre ;
 *   * les métadonnées ne contiennent aucun secret — un déclencheur refuse
 *     l'écriture d'une valeur qui ressemble à un mot de passe ou à un jeton.
 *
 * L'affichage est volontairement brut : une action, une ressource, un résultat,
 * un horodatage. Interpréter à l'écran risquerait de raconter autre chose que
 * ce qui a été enregistré.
 */
export default async function JournalPage() {
  await requireModule('journal');

  const events = await listAuditEvents(100);

  return (
    <AdminPage
      eyebrow="Système"
      title="Journal d’activité"
      lead="Les 100 dernières actions sensibles enregistrées. Ce journal est en ajout seul : il ne peut être ni modifié ni effacé, depuis cette page comme depuis n’importe quelle autre."
    >
      {events.length === 0 ? (
        <div className="admin-empty">
          <p className="admin-empty__title">Aucune action enregistrée pour le moment.</p>
          <p>
            Les connexions, refus, modifications de permissions et autres actions sensibles
            apparaîtront ici dès qu’elles se produiront.
          </p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Journal des actions sensibles</caption>
            <thead>
              <tr>
                <th scope="col">Horodatage</th>
                <th scope="col">Action</th>
                <th scope="col">Auteur</th>
                <th scope="col">Ressource</th>
                <th scope="col">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.created_at)}</td>
                  <th scope="row">
                    <code>{event.action}</code>
                  </th>
                  <td>{event.actor_label ?? (event.actor_id ? 'Compte supprimé' : 'Anonyme')}</td>
                  <td>
                    {event.resource_type ? (
                      <code>{event.resource_type}</code>
                    ) : (
                      <span className="admin-badge admin-badge--muted">—</span>
                    )}
                  </td>
                  <td>{resultBadge(event.result)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminPage>
  );
}

function resultBadge(result: string) {
  if (result === 'SUCCES') return <span className="admin-badge admin-badge--ok">Succès</span>;
  if (result === 'REFUS') return <span className="admin-badge admin-badge--danger">Refus</span>;
  return <span className="admin-badge admin-badge--muted">Échec</span>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Indian/Comoro',
  }).format(new Date(value));
}
