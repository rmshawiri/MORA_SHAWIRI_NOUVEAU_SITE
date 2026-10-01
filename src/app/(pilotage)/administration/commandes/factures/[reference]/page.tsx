import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import DocumentShareButton from '@/components/documents/DocumentShareButton';
import { formatAmount, formatQuantity } from '@/lib/commerce/admin';
import { loadInvoice } from '@/lib/documents/invoices';
import { formatMoment } from '@/lib/relation/labels';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Facture',
  robots: { index: false, follow: false },
};

const NOTICE_TONE = { ok: 'admin-notice admin-notice--ok', error: 'admin-notice admin-notice--error' };

const STATUS_LABELS = { EMIS: 'Émise', ANNULE: 'Annulée', REMPLACE: 'Remplacée' } as const;

/**
 * Fiche d'une facture — finalisation 4G.
 *
 * Tout ce qui s'y lit vient de l'instantané figé à l'émission : c'est
 * exactement ce que porte le PDF. La fiche ne recalcule rien.
 *
 * Trois gestes : ouvrir le PDF dans le navigateur, le télécharger, et
 * l'envoyer — le vrai fichier — par la feuille de partage de l'appareil.
 */
export default async function FactureFichePage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  await requireModule('commandes');

  const record = await loadInvoice(decodeURIComponent(reference));
  if (!record) notFound();

  const { document, snapshot, snapshotRow } = record;
  const money = (value: number) => formatAmount(value, snapshot.currency);
  const hasDiscount = snapshot.lines.some((line) => line.discount > 0);
  const pdf = `/api/documents/${document.reference}/`;

  return (
    <AdminPage
      eyebrow="Factures"
      title={document.reference}
      lead={`${snapshot.customer.name} · ${money(snapshot.totals.total)} · émise le ${formatMoment(document.issued_at)}.`}
      actions={
        <>
          <a className="btn btn--primary" href={`${pdf}?affichage=1`} target="_blank" rel="noreferrer">
            Ouvrir le PDF
          </a>
          <a className="btn btn--ghost" href={pdf} download={`${document.reference}.pdf`}>
            Télécharger le PDF
          </a>
          <DocumentShareButton
            reference={document.reference}
            title={`Facture ${document.reference}`}
            label="Envoyer par WhatsApp / partager"
            tone={NOTICE_TONE}
          />
          <Link className="btn btn--ghost" href="/administration/commandes/factures/">
            Retour aux factures
          </Link>
        </>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Synthèse</h2>
          <p>
            Contenu figé à l’émission. Une modification ultérieure de la commande, du catalogue ou
            du profil du client ne change pas cette facture.
          </p>
        </div>

        <dl className="admin-meta">
          <div>
            <dt>État</dt>
            <dd>{STATUS_LABELS[document.status]}</dd>
          </div>
          <div>
            <dt>Émise le</dt>
            <dd>{formatMoment(document.issued_at)}</dd>
          </div>
          <div>
            <dt>Client</dt>
            <dd>
              {snapshot.customer.name}
              {snapshot.customer.email ? (
                <>
                  <br />
                  {snapshot.customer.email}
                </>
              ) : null}
              {snapshot.customer.phone ? (
                <>
                  <br />
                  {snapshot.customer.phone}
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Commande</dt>
            <dd>
              <Link href={`/administration/commandes/${snapshot.references.order}/`}>
                <code>{snapshot.references.order}</code>
              </Link>
              {snapshot.references.quote ? (
                <>
                  <br />
                  Devis <code>{snapshot.references.quote}</code>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{money(snapshot.totals.total)}</dd>
          </div>
          <div>
            <dt>Réglé à l’émission</dt>
            <dd>{money(snapshot.totals.paid)}</dd>
          </div>
          <div>
            <dt>Archive PDF</dt>
            <dd>
              {snapshotRow.pdf_path
                ? `Archivée le ${formatMoment(snapshotRow.archived_at)}`
                : 'Pas encore archivée — elle le sera au premier téléchargement'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Lignes facturées</h2>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Lignes de la facture {document.reference}</caption>
            <thead>
              <tr>
                <th scope="col">Désignation</th>
                <th scope="col">Quantité</th>
                <th scope="col">Prix unitaire</th>
                {hasDiscount ? <th scope="col">Remise</th> : null}
                <th scope="col">Montant</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.lines.map((line, index) => (
                <tr key={index}>
                  <th scope="row">
                    {line.designation}
                    {line.reference ? (
                      <>
                        <br />
                        <small>
                          Réf. <code>{line.reference}</code>
                        </small>
                      </>
                    ) : null}
                  </th>
                  <td>
                    {formatQuantity(line.quantity)}
                    {line.unit ? ` ${line.unit}` : ''}
                  </td>
                  <td>{money(line.unit_price)}</td>
                  {hasDiscount ? <td>{line.discount > 0 ? `– ${money(line.discount)}` : '—'}</td> : null}
                  <td>{money(line.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={hasDiscount ? 4 : 3}>
                  Sous-total
                </th>
                <td>{money(snapshot.totals.subtotal)}</td>
              </tr>
              {snapshot.totals.discount > 0 ? (
                <tr>
                  <th scope="row" colSpan={hasDiscount ? 4 : 3}>
                    Remises
                  </th>
                  <td>– {money(snapshot.totals.discount)}</td>
                </tr>
              ) : null}
              {snapshot.totals.fees > 0 ? (
                <tr>
                  <th scope="row" colSpan={hasDiscount ? 4 : 3}>
                    Frais
                  </th>
                  <td>{money(snapshot.totals.fees)}</td>
                </tr>
              ) : null}
              <tr>
                <th scope="row" colSpan={hasDiscount ? 4 : 3}>
                  Total
                </th>
                <td>
                  <strong>{money(snapshot.totals.total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="admin-notice">
        <p>
          « Envoyer » ouvre la feuille de partage de votre appareil avec le fichier PDF joint :
          choisissez-y WhatsApp. Sur un ordinateur qui ne sait pas partager de fichier, le PDF est
          téléchargé, à joindre ensuite dans WhatsApp.
        </p>
      </div>
    </AdminPage>
  );
}
