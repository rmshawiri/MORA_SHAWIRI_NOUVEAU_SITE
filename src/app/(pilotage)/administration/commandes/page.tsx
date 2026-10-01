import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import ConfirmForm from '@/components/admin/ConfirmForm';
import { convertQuoteToOrder } from '@/lib/commerce/actions';
import {
  countOrdersByStatus,
  formatAmount,
  listConvertibleQuotes,
  listOrders,
  ORDER_STATUS_LABELS,
  SETTLEMENT_STATUS_LABELS,
  sumAmounts,
} from '@/lib/commerce/admin';
import { formatMoment } from '@/lib/relation/labels';
import { requireModule } from '@/lib/rbac/guards';
import type { OrderSettlementStatus, OrderStatus } from '@/lib/supabase/types';

export const metadata: Metadata = {
  title: 'Commandes',
  robots: { index: false, follow: false },
};

/**
 * Module « Commandes » — phase 4G.
 *
 * Le module ouvre sous `orders.view` ; les autres droits gouvernent ce qu'on
 * peut y faire :
 *
 *   * `orders.view`   ouvre le module et la liste ;
 *   * `orders.update` autorise le changement de statut, la note interne et la
 *     transformation d'un devis en commande ;
 *   * `invoices.issue` — permission critique distincte depuis la finalisation
 *     4G — autorise l'émission d'une facture ;
 *   * `orders.cancel` autorise l'annulation ;
 *   * `orders.refund` et `payments.refund` autorisent les remboursements.
 *
 * Consulter sans pouvoir décider est un état normal — c'est celui que le
 * moindre privilège rend possible, et celui qu'un compte de saisie devrait
 * avoir.
 *
 * ## Les devis à transformer
 *
 * Les quatorze prestations du catalogue sont toutes « sur devis » : c'est donc
 * par là que passe chaque commande. La liste des devis acceptés non encore
 * transformés est la vraie file de travail du module, et elle est placée en
 * tête pour cette raison.
 *
 * ## Aucun chiffre fabriqué
 *
 * § 115 de `06_PAIEMENTS.md` : « aucune statistique fictive ». Les totaux sont
 * des sommes sur les lignes réellement lues, et « encaissé » ne compte que ce
 * que `paid_amount` porte — c'est-à-dire des paiements vérifiés.
 */
export default async function CommandesPage() {
  const context = await requireModule('commandes');
  const [orders, convertible] = await Promise.all([listOrders(), listConvertibleQuotes()]);
  const counts = countOrdersByStatus(orders);

  const enCours =
    counts.NOUVELLE + counts.CONFIRMEE + counts.EN_TRAITEMENT + counts.EN_ATTENTE_INFO + counts.PRETE;
  const facture = sumAmounts(orders.filter((o) => o.status !== 'ANNULEE').map((o) => o.total_amount));
  const encaisse = sumAmounts(orders.map((order) => order.paid_amount));

  return (
    <AdminPage
      eyebrow="Activité"
      title="Commandes"
      lead="Les commandes établies, leur avancement et leur règlement. Le statut d’une commande et celui de son paiement sont deux informations distinctes : une commande confirmée peut rester à régler."
      actions={
        <Link className="btn btn--ghost" href="/administration/commandes/factures/">
          Factures émises
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Devis acceptés à transformer</h2>
          <p>
            Un devis accepté ne devient pas une commande tout seul. C’est un acte explicite, qui
            attribue la référence officielle de la commande et ne peut avoir lieu qu’une fois.
          </p>
        </div>

        {convertible.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun devis en attente de transformation</p>
            <p>
              Les devis acceptés apparaissent ici tant qu’ils n’ont pas donné de commande. Un devis
              déjà transformé n’y figure plus.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Devis acceptés sans commande</caption>
              <thead>
                <tr>
                  <th scope="col">Devis</th>
                  <th scope="col">Demande</th>
                  <th scope="col">Objet</th>
                  <th scope="col">Montant</th>
                  <th scope="col">Accepté le</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {convertible.map((quote) => (
                  <tr key={quote.id}>
                    <th scope="row">
                      <code>{quote.reference ?? '—'}</code>
                    </th>
                    <td>
                      <code>{quote.quote_requests?.reference ?? '—'}</code>
                    </td>
                    <td>{quote.summary}</td>
                    <td>{formatAmount(quote.amount, quote.currency)}</td>
                    <td>{formatMoment(quote.responded_at)}</td>
                    <td>
                      {context.can('orders.update') ? (
                        quote.quote_requests?.user_id ? (
                          <ConfirmForm
                            action={convertQuoteToOrder}
                            fields={{ devis: quote.id }}
                            trigger="Établir la commande"
                            consequence="Une référence de commande officielle sera attribuée. Cette opération n’a lieu qu’une fois : relancée, elle rouvrira la commande déjà créée."
                            confirmLabel="Établir la commande"
                            variant="primary"
                          />
                        ) : (
                          <span className="admin-badge admin-badge--muted">
                            Compte client requis
                          </span>
                        )
                      ) : (
                        <span className="admin-badge admin-badge--muted">Droit manquant</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Commandes</h2>
          <p>
            {orders.length} commande(s) enregistrée(s), dont {enCours} en cours :{' '}
            {counts.NOUVELLE} nouvelle(s), {counts.CONFIRMEE} confirmée(s), {counts.EN_TRAITEMENT}{' '}
            en traitement, {counts.EN_ATTENTE_INFO} en attente d’information, {counts.PRETE}{' '}
            prête(s). {counts.TERMINEE} terminée(s), {counts.ANNULEE} annulée(s). Total commandé
            hors annulations : {formatAmount(facture)} · encaissé et vérifié :{' '}
            {formatAmount(encaisse)}.
          </p>
        </div>

        {orders.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune commande enregistrée</p>
            <p>
              C’est l’état réel de la base. Une commande naît d’un devis accepté, ou d’une saisie
              administrative lorsque la vente s’est conclue autrement.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">
                Commandes, celles qui réclament une décision en tête
              </caption>
              <thead>
                <tr>
                  <th scope="col">Référence</th>
                  <th scope="col">Client</th>
                  <th scope="col">Total</th>
                  <th scope="col">Réglé</th>
                  <th scope="col">Commande</th>
                  <th scope="col">Règlement</th>
                  <th scope="col">Établie le</th>
                  <th scope="col">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <th scope="row">
                      <code>{order.reference}</code>
                      {order.is_manual ? (
                        <>
                          {' '}
                          <span className="admin-badge admin-badge--muted">Saisie</span>
                        </>
                      ) : null}
                    </th>
                    <td>{order.customer_name}</td>
                    <td>{formatAmount(order.total_amount, order.currency)}</td>
                    <td>{formatAmount(order.paid_amount, order.currency)}</td>
                    <td>{orderBadge(order.status)}</td>
                    <td>{settlementBadge(order.settlement_status)}</td>
                    <td>{formatMoment(order.created_at)}</td>
                    <td>
                      <Link
                        className="btn btn--ghost"
                        href={`/administration/commandes/${order.reference}/`}
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

      {context.can('orders.update') ? null : (
        <div className="admin-notice">
          <p>
            Vous consultez les commandes sans pouvoir les faire évoluer. La permission{' '}
            <code>orders.update</code> est nécessaire pour changer un statut ou établir une
            commande. L’émission d’une facture exige en outre la permission{' '}
            <code>invoices.issue</code>.
          </p>
        </div>
      )}
    </AdminPage>
  );
}

function orderBadge(status: OrderStatus) {
  const className =
    status === 'TERMINEE'
      ? 'admin-badge--ok'
      : status === 'NOUVELLE'
        ? 'admin-badge--gold'
        : status === 'ANNULEE'
          ? 'admin-badge--danger'
          : 'admin-badge--muted';

  return <span className={`admin-badge ${className}`}>{ORDER_STATUS_LABELS[status]}</span>;
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
