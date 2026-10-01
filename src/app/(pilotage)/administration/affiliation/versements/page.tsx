import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import AffiliationDecisionForm from '@/components/admin/AffiliationDecisionForm';
import { PayoutStatusBadge } from '@/components/admin/AffiliationBadges';
import { PAYOUT_FREQUENCY_LABELS } from '@/lib/affiliation/affiliates';
import { listPayable, listPayouts } from '@/lib/affiliation/admin';
import { kmf } from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';
import { preparePayout } from '@/lib/affiliation/payout-actions';
import { formatPayoutDay } from '@/lib/affiliation/payouts';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Versements',
  robots: { index: false, follow: false },
};

const formatDay = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Indian/Comoro' }).format(new Date(`${iso}T12:00:00+03:00`))
    : 'À la demande';

/**
 * Versements — phase 4H-6.
 *
 * Ce qui est dû, affilié par affilié, et l'historique de ce qui a été versé.
 * MORA Shawiri paie hors du site, puis le constate ici : la base regroupe les
 * commissions acquises et les ajustements, empêche tout double paiement et
 * émet le relevé RVAF à la confirmation. La fréquence de chaque affilié donne
 * son échéance ; elle n'empêche pas un versement anticipé.
 */
export default async function VersementsPage() {
  const context = await requireModule('affiliation');
  const allowed = context.can('payouts.view');
  const canManage = context.can('payouts.manage');
  const [payable, payouts] = allowed ? await Promise.all([listPayable(), listPayouts()]) : [[], []];
  const month = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Indian/Comoro' }).format(new Date());
  const period = month.charAt(0).toUpperCase() + month.slice(1);

  return (
    <AdminPage
      eyebrow="Affiliation"
      title="Versements"
      lead="Un versement regroupe les commissions acquises d’un affilié et ses ajustements. Il se prépare, se contrôle, puis se confirme une fois l’argent parti : il devient alors définitif, avec son relevé RVAF."
      actions={
        <Link className="btn btn--ghost" href="/administration/affiliation/">
          Retour au module
        </Link>
      }
    >
      {!allowed ? (
        <div className="admin-notice admin-notice--error" role="note">
          <p>La permission payouts.view est nécessaire pour consulter les versements.</p>
        </div>
      ) : (
        <>
          <section className="admin-card">
            <div className="admin-card__head">
              <h2>À verser</h2>
              <p>Commissions acquises nettes de leurs ajustements, et ajustements restant à imputer. Aucun seuil global : seul le seuil propre à un affilié ou à sa catégorie s’applique.</p>
            </div>
            {payable.length === 0 ? (
              <div className="admin-empty">
                <p className="admin-empty__title">Rien à verser</p>
                <p>Aucune commission acquise n’attend de versement.</p>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <caption className="sr-only">Montants à verser par affilié</caption>
                  <thead>
                    <tr>
                      <th scope="col">Affilié</th>
                      <th scope="col">Commissions</th>
                      <th scope="col">À verser</th>
                      <th scope="col">Échéance</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payable.map((row) => {
                      const below = row.min_amount !== null && Number(row.payable) < Number(row.min_amount);
                      return (
                        <tr key={row.affiliate_id}>
                          <th scope="row">
                            <Link href={`/administration/affiliation/affilies/${row.affiliate_id}/`}>{row.display_name}</Link>
                            {row.reference ? <span className="admin-field__hint"> — {row.reference}</span> : null}
                          </th>
                          <td>
                            {row.commissions}
                            {Number(row.adjustments) !== 0 ? (
                              <span className="admin-field__hint"> · ajustements {kmf(row.adjustments)}</span>
                            ) : null}
                          </td>
                          <td>
                            {kmf(row.payable)}
                            {below ? <span className="admin-field__hint"> · seuil {kmf(row.min_amount)} non atteint</span> : null}
                          </td>
                          <td>
                            {formatDay(row.next_date)}
                            <span className="admin-field__hint"> · {PAYOUT_FREQUENCY_LABELS[row.frequency]}</span>
                          </td>
                          <td>
                            {row.draft_id ? (
                              <Link className="btn btn--ghost" href={`/administration/affiliation/versements/${row.draft_id}/`}>
                                Brouillon en cours
                              </Link>
                            ) : canManage && Number(row.payable) > 0 && !below ? (
                              <AffiliationDecisionForm
                                action={preparePayout}
                                fields={{ affiliate: row.affiliate_id }}
                                trigger="Préparer le versement"
                                title="Préparer ce versement ?"
                                consequence={`Les commissions acquises de ${row.display_name} et ses ajustements sont regroupés dans un brouillon (${kmf(row.payable)}). Rien n’est payé tant que le versement n’est pas confirmé.`}
                                confirmLabel="Préparer"
                                inputs={[{ kind: 'text', name: 'period', label: 'Période', maxLength: 80, defaultValue: period }]}
                              />
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admin-card">
            <div className="admin-card__head">
              <h2>Historique</h2>
              <p>Un versement confirmé ne se supprime ni ne se modifie. Une erreur se corrige par un ajustement sur le versement suivant.</p>
            </div>
            <PayoutsTable rows={payouts} />
          </section>
        </>
      )}
    </AdminPage>
  );
}

function PayoutsTable({ rows }: { rows: Awaited<ReturnType<typeof listPayouts>> }) {
  if (rows.length === 0) {
    return (
      <div className="admin-empty">
        <p className="admin-empty__title">Aucun versement</p>
        <p>C’est l’état réel de la base.</p>
      </div>
    );
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <caption className="sr-only">Versements, du plus récent au plus ancien</caption>
        <thead>
          <tr>
            <th scope="col">Versement</th>
            <th scope="col">Affilié</th>
            <th scope="col">Montant</th>
            <th scope="col">État</th>
            <th scope="col">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                <Link href={`/administration/affiliation/versements/${row.id}/`}>{row.reference ?? row.period_label ?? 'Brouillon'}</Link>
              </th>
              <td>{row.affiliate_name}</td>
              <td>{kmf(row.total_amount)}</td>
              <td>
                <PayoutStatusBadge status={row.status} />
              </td>
              <td>{row.confirmed_at ? formatPayoutDay(row.confirmed_at) : formatMoment(row.cancelled_at ?? row.prepared_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
