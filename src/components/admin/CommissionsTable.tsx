import Link from 'next/link';

import { CommissionStatusBadge } from '@/components/admin/AffiliationBadges';
import type { CommissionListEntry } from '@/lib/affiliation/admin';
import { kmf } from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';

/**
 * Tableau des commissions — liste générale et fiche affilié. Le net affiché
 * est le montant figé plus ses ajustements ; le montant figé, lui, ne bouge
 * jamais.
 */
export default function CommissionsTable({
  rows,
  showAffiliate = true,
  caption,
}: {
  rows: readonly CommissionListEntry[];
  showAffiliate?: boolean;
  caption: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="admin-empty">
        <p className="admin-empty__title">Aucune commission</p>
        <p>C’est l’état réel de la base.</p>
      </div>
    );
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Référence</th>
            {showAffiliate ? <th scope="col">Affilié</th> : null}
            <th scope="col">Commande</th>
            <th scope="col">Statut</th>
            <th scope="col">Montant</th>
            <th scope="col">Net</th>
            <th scope="col">Créée le</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                <Link href={`/administration/affiliation/commissions/${row.id}/`}>{row.reference}</Link>
              </th>
              {showAffiliate ? (
                <td>
                  <Link href={`/administration/affiliation/affilies/${row.affiliate_id}/`}>{row.affiliate_name}</Link>
                </td>
              ) : null}
              <td>
                <Link href={`/administration/commandes/${row.order_reference}/`}>{row.order_reference}</Link>
              </td>
              <td>
                <CommissionStatusBadge status={row.status} />
              </td>
              <td>{kmf(row.amount)}</td>
              <td>{row.net === Number(row.amount) ? '—' : kmf(row.net)}</td>
              <td>{formatMoment(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
