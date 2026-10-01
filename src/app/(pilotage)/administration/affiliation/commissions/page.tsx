import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import CommissionsTable from '@/components/admin/CommissionsTable';
import { listCommissions } from '@/lib/affiliation/admin';
import { COMMISSION_STATUS_LABELS, isCommissionStatus, kmf } from '@/lib/affiliation/commissions';
import { requireModule } from '@/lib/rbac/guards';
import type { CommissionStatus } from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Commissions',
  robots: { index: false, follow: false },
};

/**
 * Commissions — phase 4H-5.
 *
 * Elles naissent de la base, jamais d'une saisie : une affaire attribuée
 * produit sa commission, calculée sur les règles en vigueur à sa date et
 * figée à l'acquisition. Cette page les lit sous `commissions.view` ; les
 * actes (validation, annulation, ajustement) se font sur la fiche.
 */
export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule('affiliation');
  const query = await searchParams;
  const status = isCommissionStatus(query.statut) ? query.statut : undefined;
  const allowed = context.can('commissions.view');
  const rows = allowed ? await listCommissions({ status }) : [];
  const sum = (s: CommissionStatus) => rows.filter((row) => row.status === s).reduce((total, row) => total + row.net, 0);

  return (
    <AdminPage
      eyebrow="Affiliation"
      title="Commissions"
      lead="Chaque commission est calculée par la base à partir de l’affaire attribuée et des règles en vigueur à sa date. Une commission acquise ne se réécrit pas : elle se corrige par un ajustement motivé."
      actions={
        <Link className="btn btn--ghost" href="/administration/affiliation/">
          Retour au module
        </Link>
      }
    >
      {!allowed ? (
        <div className="admin-notice admin-notice--error" role="note">
          <p>La permission commissions.view est nécessaire pour consulter les commissions.</p>
        </div>
      ) : (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>{status ? COMMISSION_STATUS_LABELS[status] : 'Toutes les commissions'}</h2>
            <p>
              {rows.length} commission(s)
              {status
                ? ` — ${kmf(sum(status))} net.`
                : ` — prévisionnelles ${kmf(sum('PREVISIONNELLE'))}, acquises ${kmf(sum('ACQUISE'))}, à verser ${kmf(sum('A_VERSER'))}, versées ${kmf(sum('VERSEE'))}.`}
            </p>
          </div>
          <form className="admin-filters" method="get" role="search">
            <label className="admin-field">
              <span className="admin-field__label">Statut</span>
              <select className="admin-input" name="statut" defaultValue={status ?? ''}>
                <option value="">Tous</option>
                {(Object.keys(COMMISSION_STATUS_LABELS) as CommissionStatus[]).map((key) => (
                  <option key={key} value={key}>
                    {COMMISSION_STATUS_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn--ghost" type="submit">
              Filtrer
            </button>
          </form>
          <CommissionsTable rows={rows} caption="Commissions, de la plus récente à la plus ancienne" />
        </section>
      )}
    </AdminPage>
  );
}
