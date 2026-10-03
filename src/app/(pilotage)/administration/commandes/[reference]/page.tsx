import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import AffiliationTrace from '@/components/admin/AffiliationTrace';
import CommerceReasonForm from '@/components/admin/CommerceReasonForm';
import ConfirmForm from '@/components/admin/ConfirmForm';
import OrderMoneyForm from '@/components/admin/OrderMoneyForm';
import RelationSelectForm from '@/components/admin/RelationSelectForm';
import OfficialDocumentActions from '@/components/documents/OfficialDocumentActions';
import { isDocumentEstablished } from '@/lib/documents/commercial-documents';
import {
  cancelOrder,
  completeRefund,
  issueInvoice,
  issueOrderDocument,
  recordOfflinePayment,
  recordRefund,
  rejectPayment,
  updateOrderStatus,
  verifyPayment,
} from '@/lib/commerce/actions';
import {
  findOrder,
  formatAmount,
  formatQuantity,
  listPaymentMethods,
  ORDER_EVENT_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  PAYMENT_PENDING_STATUSES,
  PAYMENT_STATUS_LABELS,
  REFUND_STATUS_LABELS,
  remainingDue,
  SETTLEMENT_STATUS_LABELS,
} from '@/lib/commerce/admin';
import { formatMoment } from '@/lib/relation/labels';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Commande',
  robots: { index: false, follow: false },
};

/**
 * Fiche d'une commande — phase 4G.
 *
 * Tout ce qui se décide sur une commande se décide ici : son avancement, ses
 * règlements, ses remboursements, sa facture. Chaque acte est protégé par sa
 * propre permission, et le bouton disparaît quand elle manque — sans que cette
 * disparition soit la protection. Le § 129 est formel : masquer un bouton ne
 * protège rien, et chaque action revérifie côté serveur.
 *
 * ## Les deux colonnes de statut
 *
 * Le § 59 du document commerce donne l'exemple exact de cet affichage :
 * « Commande : Confirmée / Paiement : En attente ». Les deux ne se confondent
 * pas, et la fiche ne les fusionne pas davantage que le schéma.
 *
 * ## Les justificatifs
 *
 * Ils ne sont pas affichés en ligne : le lien passe par `/api/justificatifs/`,
 * qui signe une URL temporaire après que la base a autorisé la lecture. Le
 * bucket reste privé, et aucune adresse permanente n'existe.
 */
export default async function CommandeFichePage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const { affiliation: affiliationNotice, resultat } = await searchParams;
  const context = await requireModule('commandes');

  const detail = await findOrder(decodeURIComponent(reference));
  if (!detail) notFound();

  const { order, items, payments, refunds, history, events, documents } = detail;

  const methods = context.can('payments.verify') ? await listPaymentMethods() : [];
  const activeMethods = methods
    .filter((method) => method.is_active)
    .map((method) => ({ value: method.code, label: method.label }));
  const allMethods = methods.map((method) => ({ value: method.code, label: method.label }));

  const due = remainingDue(order.total_amount, order.paid_amount);
  const invoice = documents.find((document) => document.doc_type === 'FACL' && document.status === 'EMIS');
  const orderDocumentReady = await isDocumentEstablished(order.document_id);
  const canEstablishOrderDocument =
    !orderDocumentReady && context.can('orders.update') && order.status !== 'NOUVELLE' && order.status !== 'ANNULEE';

  const transitions = ORDER_TRANSITIONS[order.status]
    .filter((status) => status !== 'ANNULEE')
    .map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] }));

  return (
    <AdminPage
      eyebrow="Commandes"
      title={order.reference}
      lead={`${order.customer_name} · ${formatAmount(order.total_amount, order.currency)} · établie le ${formatMoment(order.created_at)}.`}
      actions={
        <Link className="btn btn--ghost" href="/administration/commandes/">
          Retour à la liste
        </Link>
      }
    >
      {/* ------------------------------------------------------ synthèse --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Synthèse</h2>
        </div>

        <dl className="admin-meta">
          <div>
            <dt>Statut de la commande</dt>
            <dd>{ORDER_STATUS_LABELS[order.status]}</dd>
          </div>
          <div>
            <dt>Règlement</dt>
            <dd>{SETTLEMENT_STATUS_LABELS[order.settlement_status]}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatAmount(order.total_amount, order.currency)}</dd>
          </div>
          <div>
            <dt>Encaissé et vérifié</dt>
            <dd>{formatAmount(order.paid_amount, order.currency)}</dd>
          </div>
          <div>
            <dt>Reste dû</dt>
            <dd>{formatAmount(due, order.currency)}</dd>
          </div>
          {Number(order.refunded_amount) > 0 ? (
            <div>
              <dt>Remboursé</dt>
              <dd>{formatAmount(order.refunded_amount, order.currency)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Client</dt>
            <dd>
              {order.customer_name}
              <br />
              {order.customer_email}
              {order.customer_phone ? (
                <>
                  <br />
                  {order.customer_phone}
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Origine</dt>
            <dd>
              {order.is_manual ? 'Saisie en administration' : 'Devis accepté'}
              {detail.quoteReference ? (
                <>
                  <br />
                  <code>{detail.quoteReference}</code>
                </>
              ) : null}
              {detail.requestReference ? (
                <>
                  {' · '}
                  <Link href={`/administration/demandes/${detail.requestReference}/`}>
                    <code>{detail.requestReference}</code>
                  </Link>
                </>
              ) : null}
            </dd>
          </div>
          {order.cancel_reason ? (
            <div>
              <dt>Motif d’annulation</dt>
              <dd>{order.cancel_reason}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* --------------------------------------------------------- lignes --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Lignes de commande</h2>
          <p>
            Les désignations et les prix sont ceux qui s’appliquaient au moment de la commande. Une
            modification ultérieure du catalogue ne les change pas.
          </p>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Lignes de la commande {order.reference}</caption>
            <thead>
              <tr>
                <th scope="col">Désignation</th>
                <th scope="col">Référence</th>
                <th scope="col">Quantité</th>
                <th scope="col">Prix unitaire</th>
                <th scope="col">Remise</th>
                <th scope="col">Montant</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.designation}</th>
                  <td>{item.item_reference ? <code>{item.item_reference}</code> : '—'}</td>
                  <td>
                    {formatQuantity(item.quantity)}
                    {item.unit_label ? ` ${item.unit_label}` : ''}
                  </td>
                  <td>{formatAmount(item.unit_price, order.currency)}</td>
                  <td>
                    {Number(item.discount_amount) > 0
                      ? formatAmount(item.discount_amount, order.currency)
                      : '—'}
                  </td>
                  <td>{formatAmount(item.line_total, order.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={5}>
                  Sous-total
                </th>
                <td>{formatAmount(order.subtotal_amount, order.currency)}</td>
              </tr>
              {Number(order.discount_amount) > 0 ? (
                <tr>
                  <th scope="row" colSpan={5}>
                    Remises
                  </th>
                  <td>− {formatAmount(order.discount_amount, order.currency)}</td>
                </tr>
              ) : null}
              {Number(order.fees_amount) > 0 ? (
                <tr>
                  <th scope="row" colSpan={5}>
                    Frais
                  </th>
                  <td>{formatAmount(order.fees_amount, order.currency)}</td>
                </tr>
              ) : null}
              <tr>
                <th scope="row" colSpan={5}>
                  Total
                </th>
                <td>
                  <strong>{formatAmount(order.total_amount, order.currency)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ------------------------------------------------------ pilotage --- */}

      {context.can('orders.update') || context.can('orders.cancel') ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Faire avancer la commande</h2>
            <p>
              Les transitions proposées sont celles que la base accepte depuis l’état actuel. Une
              commande terminée ou annulée n’évolue plus.
            </p>
          </div>

          {context.can('orders.update') && transitions.length > 0 ? (
            <RelationSelectForm
              action={updateOrderStatus}
              fields={{ reference: order.reference }}
              name="status"
              label="Nouveau statut"
              options={transitions}
              submitLabel="Enregistrer le statut"
              hint="Le changement est consigné dans l’historique de la commande."
            />
          ) : null}

          <div className="admin-table__actions">
            {context.can('orders.cancel') && order.status !== 'ANNULEE' ? (
              <CommerceReasonForm
                action={cancelOrder}
                fields={{ commande: order.id }}
                trigger="Annuler la commande"
                consequence="La commande restera consultable dans l’historique et ne pourra plus évoluer. Les déclarations de paiement encore en attente seront annulées."
                label="Motif de l’annulation"
                placeholder="Demande du client, paiement non effectué, indisponibilité…"
                confirmLabel="Annuler la commande"
                variant="danger"
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* --------------------------------------- document de commande --- */}

      {resultat === 'bon-de-commande' ? (
        <div className="admin-notice admin-notice--ok" role="status">
          <p>Le document de commande est établi. Le client le retrouve dans Mes documents.</p>
        </div>
      ) : null}

      {orderDocumentReady || canEstablishOrderDocument ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Document de commande</h2>
            <p>
              {orderDocumentReady
                ? `Le bon de commande ${order.reference} : son contenu est figé depuis son établissement, et le client le retrouve dans Mes documents.`
                : 'Établir le bon de commande fige son contenu — lignes, totaux, règlement constaté — sous la référence de la commande. Aucun numéro supplémentaire n’est consommé.'}
            </p>
          </div>
          {orderDocumentReady ? (
            <OfficialDocumentActions reference={order.reference} title={`Bon de commande ${order.reference}`} />
          ) : (
            <ConfirmForm
              action={issueOrderDocument}
              fields={{ commande: order.id }}
              trigger="Établir le document de commande"
              title="Établir le document de commande ?"
              consequence="Le contenu du bon de commande sera figé tel qu’il est maintenant, et le document apparaîtra dans l’espace du client. Une modification ultérieure des lignes ne le réécrira pas."
              confirmLabel="Établir le document"
              variant="gold"
            />
          )}
        </section>
      ) : order.status === 'NOUVELLE' && context.can('orders.update') ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Document de commande</h2>
            <p>Le bon de commande s’établit une fois la commande confirmée.</p>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------ facture --- */}

      {invoice || (context.can('invoices.issue') && order.status !== 'ANNULEE') ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Facture</h2>
            <p>
              {invoice
                ? 'La facture officielle de cette commande. Son contenu est figé depuis son émission.'
                : 'L’émission attribue un numéro de facture officiel et fige le contenu de la facture : lignes, prix et totaux tels qu’ils sont à cet instant.'}
            </p>
          </div>

          <div className="admin-table__actions">
            {invoice ? (
              <>
                <span className="admin-badge admin-badge--ok">Facture émise : {invoice.reference}</span>
                <Link
                  className="btn btn--ghost"
                  href={`/administration/commandes/factures/${invoice.reference}/`}
                >
                  Consulter la facture
                </Link>
                <a
                  className="btn btn--ghost"
                  href={`/api/documents/${invoice.reference}/`}
                  download={`${invoice.reference}.pdf`}
                >
                  Télécharger le PDF
                </a>
              </>
            ) : (
              <ConfirmForm
                action={issueInvoice}
                fields={{ commande: order.id }}
                trigger="Émettre la facture"
                title="Confirmer l’émission de cette facture ?"
                consequence="Un numéro de facture officiel sera consommé, définitivement, et le contenu de la facture sera figé. Émettre la facture ne la marque pas comme payée : le règlement se lit dans les paiements vérifiés."
                confirmLabel="Émettre la facture"
                variant="gold"
              />
            )}
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------ paiements --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Paiements</h2>
          <p>
            Une déclaration n’est jamais une confirmation. Un paiement ne compte dans le règlement
            de la commande qu’après vérification par une personne autorisée.
          </p>
        </div>

        {payments.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun paiement déclaré</p>
            <p>
              Le client peut déclarer son règlement depuis son espace. Un paiement reçu hors ligne
              s’enregistre ici.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Paiements de la commande {order.reference}</caption>
              <thead>
                <tr>
                  <th scope="col">Moyen</th>
                  <th scope="col">Montant</th>
                  <th scope="col">Référence</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Déclaré le</th>
                  <th scope="col">Justificatif</th>
                  <th scope="col">Vérification</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <th scope="row">{payment.method_code}</th>
                    <td>{formatAmount(payment.amount, payment.currency)}</td>
                    <td>
                      {payment.transaction_reference ? (
                        <code>{payment.transaction_reference}</code>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span className="admin-badge">{PAYMENT_STATUS_LABELS[payment.status]}</span>
                      {payment.rejection_reason ? (
                        <>
                          <br />
                          <small>{payment.rejection_reason}</small>
                        </>
                      ) : null}
                    </td>
                    <td>{formatMoment(payment.declared_at)}</td>
                    <td>
                      {payment.proofs.length === 0
                        ? '—'
                        : payment.proofs.map((proof, index) => (
                            <span key={proof.id}>
                              {index > 0 ? ' · ' : null}
                              <a
                                href={`/api/justificatifs/${proof.id}/`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Ouvrir
                              </a>
                            </span>
                          ))}
                    </td>
                    <td>
                      {context.can('payments.verify') &&
                      PAYMENT_PENDING_STATUSES.includes(payment.status) ? (
                        <div className="admin-table__actions">
                          <ConfirmForm
                            action={verifyPayment}
                            fields={{ paiement: payment.id }}
                            trigger="Confirmer"
                            consequence="Confirmez seulement après avoir constaté le règlement — reçu, référence vérifiée auprès de l’opérateur, ou message reçu sur la ligne. La commande sera créditée de ce montant."
                            confirmLabel="J’ai vérifié, confirmer"
                            variant="primary"
                          />
                          <CommerceReasonForm
                            action={rejectPayment}
                            fields={{ paiement: payment.id }}
                            trigger="Rejeter"
                            consequence="Le client verra le motif et pourra faire une nouvelle déclaration."
                            label="Motif du rejet"
                            placeholder="Référence introuvable chez l’opérateur, montant différent…"
                            confirmLabel="Rejeter la déclaration"
                            variant="danger"
                          />
                        </div>
                      ) : payment.verified_at ? (
                        formatMoment(payment.verified_at)
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {context.can('payments.verify') && order.status !== 'ANNULEE' && due > 0 ? (
          <OrderMoneyForm
            action={recordOfflinePayment}
            fields={{ commande: order.id }}
            trigger="Enregistrer un règlement reçu"
            heading="Règlement reçu hors ligne"
            intro="Espèces remises au bureau, chèque encaissé, virement constaté sur le compte. Le paiement est enregistré puis confirmé dans la foulée, puisque vous le constatez vous-même."
            methods={activeMethods}
            suggestedAmount={String(due)}
            currency={order.currency}
            reasonLabel="Précision (facultatif)"
            reasonPlaceholder="Chèque n° … encaissé le …"
            reasonRequired={false}
            submitLabel="Enregistrer et confirmer"
          />
        ) : null}
      </section>

      {/* -------------------------------------------------- remboursements --- */}

      {refunds.length > 0 ||
      (context.can('payments.refund') && Number(order.paid_amount) > 0) ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Remboursements</h2>
            <p>
              Enregistrer un remboursement consigne une décision ; le constater indique que l’argent
              est réellement reparti. Seul le second réduit le montant encaissé.
            </p>
          </div>

          {refunds.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Remboursements</caption>
                <thead>
                  <tr>
                    <th scope="col">Montant</th>
                    <th scope="col">Motif</th>
                    <th scope="col">Statut</th>
                    <th scope="col">Enregistré le</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((refund) => (
                    <tr key={refund.id}>
                      <th scope="row">{formatAmount(refund.amount, refund.currency)}</th>
                      <td>{refund.reason}</td>
                      <td>
                        <span className="admin-badge">{REFUND_STATUS_LABELS[refund.status]}</span>
                      </td>
                      <td>{formatMoment(refund.requested_at)}</td>
                      <td>
                        {context.can('payments.refund') && refund.status === 'EN_COURS' ? (
                          <ConfirmForm
                            action={completeRefund}
                            fields={{ remboursement: refund.id }}
                            trigger="Constater"
                            consequence="Confirmez seulement si l’argent a réellement été envoyé au client. Le montant encaissé de la commande sera réduit d’autant."
                            confirmLabel="L’argent est parti"
                            variant="primary"
                          />
                        ) : (
                          formatMoment(refund.completed_at)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {context.can('payments.refund') &&
          Number(order.paid_amount) > Number(order.refunded_amount) ? (
            <OrderMoneyForm
              action={recordRefund}
              fields={{ commande: order.id }}
              trigger="Enregistrer un remboursement"
              heading="Remboursement"
              intro="Cette opération n’envoie aucun argent : elle consigne une décision. Vous la constaterez une fois le virement ou la remise effectué."
              methods={allMethods}
              suggestedAmount={String(
                Number(order.paid_amount) - Number(order.refunded_amount),
              )}
              currency={order.currency}
              reasonLabel="Motif du remboursement"
              reasonPlaceholder="Prestation annulée, trop-perçu, geste commercial…"
              reasonRequired
              submitLabel="Enregistrer le remboursement"
            />
          ) : null}
        </section>
      ) : null}

      {/* -------------------------------------------------------- documents --- */}

      {documents.length > 0 ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Pièces émises</h2>
          </div>

          <ul className="admin-notes">
            {documents.map((document) => (
              <li key={document.id}>
                {document.doc_type === 'FACL' ? (
                  <Link href={`/administration/commandes/factures/${document.reference}/`}>
                    <code>{document.reference}</code>
                  </Link>
                ) : (
                  <code>{document.reference}</code>
                )}{' '}
                — {document.doc_type}, émise le {formatMoment(document.issued_at)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* -------------------------------------------------------- historique --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Historique</h2>
          <p>
            Le journal métier de la commande. Il ne contient ni reçu, ni coordonnée bancaire, ni
            message personnel — ces éléments se consultent là où ils sont attachés.
          </p>
        </div>

        <ol className="admin-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <p className="admin-timeline__when">{formatMoment(event.occurred_at)}</p>
              <p className="admin-timeline__what">
                <strong>{ORDER_EVENT_LABELS[event.event_type]}</strong> — {event.summary}
                {event.amount ? ` · ${formatAmount(event.amount, order.currency)}` : ''}
              </p>
              {event.actor_label ? (
                <p className="admin-timeline__who">{event.actor_label}</p>
              ) : null}
            </li>
          ))}
        </ol>

        {history.length > 1 ? (
          <p>
            Statuts traversés :{' '}
            {history.map((entry) => ORDER_STATUS_LABELS[entry.to_status]).join(' → ')}.
          </p>
        ) : null}
      </section>

      {/* Phase 4H — l'attribution affiliée de la commande (traçabilité § 36). */}
      <AffiliationTrace
        context={context}
        target="ORDER"
        id={order.id}
        path={`/administration/commandes/${order.reference}/`}
        notice={affiliationNotice}
        orderOpen={order.status !== 'TERMINEE' && order.status !== 'ANNULEE' && Number(order.paid_amount) === 0}
      />
    </AdminPage>
  );
}
