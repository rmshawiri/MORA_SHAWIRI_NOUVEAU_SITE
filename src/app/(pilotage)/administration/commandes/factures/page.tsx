import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import DocumentShareButton from '@/components/documents/DocumentShareButton';
import { formatAmount, SETTLEMENT_STATUS_LABELS } from '@/lib/commerce/admin';
import { listInvoices } from '@/lib/documents/invoice-list';
import { formatMoment } from '@/lib/relation/labels';
import { requireModule } from '@/lib/rbac/guards';
import type { DocumentStatusValue, OrderSettlementStatus } from '@/lib/supabase/types';

export const metadata: Metadata = {
  title: 'Factures',
  robots: { index: false, follow: false },
};

/**
 * Liste des factures — finalisation 4G.
 *
 * Rattachée au module « Commandes » plutôt qu'ajoutée à la barre latérale :
 * une facture est une pièce de la commande, elle se lit avec `orders.view`,
 * et la navigation validée par le propriétaire ne gagne pas d'entrée. On y
 * arrive depuis l'en-tête du module Commandes et depuis chaque fiche.
 *
 * Ce qui s'affiche vient de l'instantané de chaque facture : le client et le
 * montant tels qu'ils figurent sur la pièce. Seul le règlement est lu sur la
 * commande, et dit « actuel » pour ne pas le confondre avec la pièce.
 *
 * Émettre une facture ne se fait pas ici : c'est un acte posé depuis la fiche
 * de la commande, sous `invoices.issue`.
 */

const STATUS_LABELS: Record<DocumentStatusValue, string> = {
  EMIS: 'Émise',
  ANNULE: 'Annulée',
  REMPLACE: 'Remplacée',
};

const NOTICE_TONE = { ok: 'admin-notice admin-notice--ok', error: 'admin-notice admin-notice--error' };

export default async function FacturesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule('commandes');

  const params = await searchParams;
  const read = (name: string) => {
    const value = params[name];
    return typeof value === 'string' ? value.slice(0, 120) : '';
  };

  const filters = { q: read('q'), statut: read('statut'), reglement: read('reglement') };
  const { entries, total } = await listInvoices(filters);
  const filtered = Boolean(filters.q || filters.statut || filters.reglement);

  return (
    <AdminPage
      eyebrow="Commandes"
      title="Factures"
      lead="Les factures officielles émises, telles qu’elles ont été figées à leur émission. Le contenu d’une facture ne change plus : ni le catalogue, ni la commande ne la réécrivent."
      actions={
        <Link className="btn btn--ghost" href="/administration/commandes/">
          Retour aux commandes
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Factures émises</h2>
          <p>
            {total} facture(s) au total
            {filtered ? `, ${entries.length} correspondant à la recherche` : ''}. Une facture
            s’émet depuis la fiche de sa commande.
          </p>
        </div>

        <form className="admin-filters" method="get" role="search">
          <label className="admin-field">
            <span className="admin-field__label">Rechercher</span>
            <input
              className="admin-input"
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="N° de facture, commande, client, e-mail"
            />
          </label>
          <label className="admin-field">
            <span className="admin-field__label">État</span>
            <select className="admin-input" name="statut" defaultValue={filters.statut}>
              <option value="">Tous</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Règlement actuel</span>
            <select className="admin-input" name="reglement" defaultValue={filters.reglement}>
              <option value="">Tous</option>
              {Object.entries(SETTLEMENT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-table__actions">
            <button className="btn btn--primary" type="submit">
              Filtrer
            </button>
            {filtered ? (
              <Link className="btn btn--ghost" href="/administration/commandes/factures/">
                Effacer
              </Link>
            ) : null}
          </div>
        </form>

        {entries.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">
              {total === 0 ? 'Aucune facture émise' : 'Aucune facture ne correspond'}
            </p>
            <p>
              {total === 0
                ? 'C’est l’état réel de la base. La première facture portera le numéro MORA-FACL-A0001.'
                : 'Modifiez la recherche ou les filtres.'}
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Factures émises, les plus récentes d’abord</caption>
              <thead>
                <tr>
                  <th scope="col">Facture</th>
                  <th scope="col">Client</th>
                  <th scope="col">Commande</th>
                  <th scope="col">Émise le</th>
                  <th scope="col">Montant</th>
                  <th scope="col">État</th>
                  <th scope="col">Règlement actuel</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.reference}>
                    <th scope="row">
                      <Link href={`/administration/commandes/factures/${entry.reference}/`}>
                        <code>{entry.reference}</code>
                      </Link>
                    </th>
                    <td>{entry.customerName}</td>
                    <td>
                      <Link href={`/administration/commandes/${entry.orderReference}/`}>
                        <code>{entry.orderReference}</code>
                      </Link>
                    </td>
                    <td>{formatMoment(entry.issuedAt)}</td>
                    <td>{formatAmount(entry.total, entry.currency)}</td>
                    <td>{statusBadge(entry.status)}</td>
                    <td>{entry.settlement ? settlementBadge(entry.settlement) : '—'}</td>
                    <td>
                      <details className="admin-menu">
                        <summary className="btn btn--ghost">Actions</summary>
                        <div className="admin-menu__panel">
                          <Link
                            className="btn btn--ghost"
                            href={`/administration/commandes/factures/${entry.reference}/`}
                          >
                            Consulter
                          </Link>
                          <a
                            className="btn btn--ghost"
                            href={`/api/documents/${entry.reference}/`}
                            download={`${entry.reference}.pdf`}
                          >
                            Télécharger le PDF
                          </a>
                          <DocumentShareButton
                            reference={entry.reference}
                            title={`Facture ${entry.reference}`}
                            label="Envoyer par WhatsApp / partager"
                            tone={NOTICE_TONE}
                          />
                        </div>
                      </details>
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

function statusBadge(status: DocumentStatusValue) {
  const className =
    status === 'EMIS' ? 'admin-badge--ok' : status === 'ANNULE' ? 'admin-badge--danger' : 'admin-badge--muted';
  return <span className={`admin-badge ${className}`}>{STATUS_LABELS[status]}</span>;
}

function settlementBadge(status: OrderSettlementStatus) {
  const className =
    status === 'SOLDEE'
      ? 'admin-badge--ok'
      : status === 'NON_PAYEE'
        ? 'admin-badge--muted'
        : status === 'REMBOURSEE'
          ? 'admin-badge--danger'
          : 'admin-badge--gold';
  return <span className={`admin-badge ${className}`}>{SETTLEMENT_STATUS_LABELS[status]}</span>;
}
