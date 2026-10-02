import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import DocumentShareButton from "@/components/documents/DocumentShareButton";
import PaymentDeclarationForm from "@/components/interactive/PaymentDeclarationForm";
import { SpaceCard } from "@/components/affiliation/SpaceUi";
import { formatClientDate } from "@/lib/client/labels";
import { getMyClientSpace } from "@/lib/client/space";
import { findMyOrder } from "@/lib/commerce/client";
import { declareMyPayment } from "@/lib/commerce/client-actions";
import {
  formatAmount,
  formatQuantity,
  ORDER_EVENT_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  REFUND_STATUS_LABELS,
  remainingDue,
  SETTLEMENT_STATUS_LABELS,
} from "@/lib/commerce/labels";
import { formatMoment } from "@/lib/relation/labels";

export const metadata: Metadata = {
  title: "Ma commande",
  robots: { index: false, follow: false },
};

/**
 * Une commande, vue par son titulaire — phase 4G, intégrée au gabarit de
 * l'espace client en 4I-2 (mêmes cartes, carte facture comprise).
 *
 * ## Pourquoi cette page existe maintenant
 *
 * L'espace client complet appartient à la phase 4I. Celle-ci ne l'anticipe
 * pas : elle livre la seule porte sans laquelle le cycle que 4G doit rendre
 * suivable n'existerait qu'à moitié —
 *
 *     COMMANDE → MONTANT → PAIEMENT DÉCLARÉ → VÉRIFICATION → STATUT
 *
 * Sans un endroit où le client déclare son règlement, il n'y aurait rien à
 * vérifier, et D-10 resterait une intention. Il y a donc le détail de la
 * commande, ses paiements, et de quoi en déclarer un. Rien d'autre : ni
 * tableau de bord, ni profil, ni documents, ni rendez-vous.
 *
 * ## Une commande d'autrui est introuvable, pas interdite
 *
 * `findMyOrder` ne lit que les commandes du compte connecté (filtre explicite
 * depuis 4I-2, en plus de la RLS) : un compte qui détient aussi des droits
 * d'administration commerce n'ouvre pas ici la commande d'un autre client. La
 * lecture revient vide pour une référence qui n'appartient pas au demandeur —
 * exactement comme pour une référence qui n'existe pas. Le § 102 demande de ne pas révéler ce
 * qui existe ; distinguer les deux cas apprendrait à un curieux qu'il a
 * deviné juste.
 */
export default async function MaCommandePage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const space = await getMyClientSpace();
  if (space.state !== "ready") return null;

  const detail = await findMyOrder(decodeURIComponent(reference));
  if (!detail) notFound();

  const { order, items, payments, refunds, events, methods, invoiceReference } =
    detail;
  const due = remainingDue(order.total_amount, order.paid_amount);

  return (
    <>
      <SpaceCard
        title={`Commande ${order.reference}`}
        intro={`Établie le ${formatClientDate(order.created_at)}.`}
      >
        <dl className="auth-meta">
          <div>
            <dt>Montant</dt>
            <dd>{formatAmount(order.total_amount, order.currency)}</dd>
          </div>
          <div>
            <dt>État de la commande</dt>
            <dd>{ORDER_STATUS_LABELS[order.status]}</dd>
          </div>
          <div>
            <dt>Règlement</dt>
            <dd>{SETTLEMENT_STATUS_LABELS[order.settlement_status]}</dd>
          </div>
        </dl>
      </SpaceCard>

      <div className="auth-card">
        <div className="auth-card__head">
          <h2>Détail</h2>
        </div>

        <div className="espace-table-wrap">
          <table className="espace-table">
            <caption className="sr-only">Lignes de votre commande</caption>
            <thead>
              <tr>
                <th scope="col">Prestation</th>
                <th scope="col">Quantité</th>
                <th scope="col">Montant</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.designation}</th>
                  <td>
                    {formatQuantity(item.quantity)}
                    {item.unit_label ? ` ${item.unit_label}` : ""}
                  </td>
                  <td>{formatAmount(item.line_total, order.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  Total
                </th>
                <td>
                  <strong>
                    {formatAmount(order.total_amount, order.currency)}
                  </strong>
                </td>
              </tr>
              <tr>
                <th scope="row" colSpan={2}>
                  Déjà réglé et vérifié
                </th>
                <td>{formatAmount(order.paid_amount, order.currency)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={2}>
                  Reste à régler
                </th>
                <td>{formatAmount(due, order.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {invoiceReference ? (
        <div className="auth-card">
          <div className="auth-card__head">
            <h2>Votre facture</h2>
            <p>
              Facture <code>{invoiceReference}</code>, au format PDF. Son
              contenu est celui du jour de son émission.
            </p>
          </div>

          <div className="btn-row">
            <a
              className="btn btn--primary"
              href={`/api/documents/${invoiceReference}/?espace=client`}
              download={`${invoiceReference}.pdf`}
            >
              Télécharger la facture
            </a>
            <DocumentShareButton
              reference={invoiceReference}
              title={`Facture ${invoiceReference}`}
              label="Partager le PDF"
              tone={{ ok: "auth-notice auth-notice--ok", error: "form-alert" }}
              ownerOnly
            />
          </div>
        </div>
      ) : null}

      {payments.length > 0 ? (
        <div className="auth-card">
          <div className="auth-card__head">
            <h2>Vos paiements</h2>
            <p>
              Un paiement déclaré est vérifié par MORA Shawiri avant d’être
              confirmé. Tant qu’il ne l’est pas, votre commande n’est pas
              considérée comme réglée.
            </p>
          </div>

          <div className="espace-table-wrap">
            <table className="espace-table">
              <caption className="sr-only">
                Paiements déclarés sur cette commande
              </caption>
              <thead>
                <tr>
                  <th scope="col">Moyen</th>
                  <th scope="col">Montant</th>
                  <th scope="col">Référence</th>
                  <th scope="col">État</th>
                  <th scope="col">Déclaré le</th>
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
                        "—"
                      )}
                    </td>
                    <td>
                      {PAYMENT_STATUS_LABELS[payment.status]}
                      {payment.rejection_reason ? (
                        <>
                          <br />
                          <small>{payment.rejection_reason}</small>
                        </>
                      ) : null}
                      {payment.proofs.map((proof) => (
                        <span key={proof.id}>
                          <br />
                          <a
                            href={`/api/justificatifs/${proof.id}/?espace=client`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Voir mon justificatif
                          </a>
                        </span>
                      ))}
                    </td>
                    <td>
                      {formatMoment(payment.declared_at ?? payment.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {refunds.length > 0 ? (
        <div className="auth-card">
          <div className="auth-card__head">
            <h2>Remboursements</h2>
            <p>
              Les remboursements enregistrés par MORA Shawiri sur cette
              commande.
            </p>
          </div>

          <div className="espace-table-wrap">
            <table className="espace-table">
              <caption className="sr-only">
                Remboursements de cette commande
              </caption>
              <thead>
                <tr>
                  <th scope="col">Montant</th>
                  <th scope="col">État</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((refund) => (
                  <tr key={refund.id}>
                    <th scope="row">
                      {formatAmount(refund.amount, refund.currency)}
                    </th>
                    <td>{REFUND_STATUS_LABELS[refund.status]}</td>
                    <td>
                      {formatMoment(refund.completed_at ?? refund.requested_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {order.status !== "ANNULEE" && due > 0 ? (
        <div className="auth-card">
          <div className="auth-card__head">
            <h2>Déclarer un paiement</h2>
            <p>
              Réglez par le moyen de votre choix, puis indiquez-le ici. MORA
              Shawiri vérifie et confirme.
            </p>
          </div>

          <PaymentDeclarationForm
            action={declareMyPayment}
            orderId={order.id}
            methods={methods}
            suggestedAmount={String(due)}
            currency={order.currency}
          />
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="auth-card">
          <div className="auth-card__head">
            <h2>Suivi</h2>
          </div>

          <ol className="espace-timeline">
            {events.map((event) => (
              <li key={event.id}>
                <p className="espace-timeline__when">
                  {formatMoment(event.occurred_at)}
                </p>
                <p className="espace-timeline__what">
                  {ORDER_EVENT_LABELS[event.event_type]}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="auth-card">
        <div className="btn-row">
          <Link className="btn btn--ghost" href="/espace-client/commandes/">
            Retour à mes commandes
          </Link>
        </div>
      </div>
    </>
  );
}
