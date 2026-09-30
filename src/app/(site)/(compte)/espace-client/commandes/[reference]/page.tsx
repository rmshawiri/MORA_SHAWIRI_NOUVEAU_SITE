import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import PaymentDeclarationForm from '@/components/interactive/PaymentDeclarationForm';
import PageHero from '@/components/sections/PageHero';
import { requirePrivateAccess } from '@/lib/auth/guards';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import { findMyOrder } from '@/lib/commerce/client';
import { declareMyPayment } from '@/lib/commerce/client-actions';
import {
  formatAmount,
  formatQuantity,
  ORDER_EVENT_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  remainingDue,
  SETTLEMENT_STATUS_LABELS,
} from '@/lib/commerce/labels';
import { formatMoment } from '@/lib/relation/labels';

export const metadata: Metadata = {
  title: 'Ma commande',
  robots: { index: false, follow: false },
};

/**
 * Une commande, vue par son titulaire — phase 4G.
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
 * Aucun filtre applicatif ne compare l'identifiant du visiteur à celui du
 * titulaire. C'est `orders_select_own` qui décide, et la lecture revient vide
 * pour une référence qui n'appartient pas au demandeur — exactement comme
 * pour une référence qui n'existe pas. Le § 102 demande de ne pas révéler ce
 * qui existe ; distinguer les deux cas apprendrait à un curieux qu'il a
 * deviné juste.
 */
export default async function MaCommandePage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  await requirePrivateAccess(AUTH_ROUTES.clientArea);

  const detail = await findMyOrder(decodeURIComponent(reference));
  if (!detail) notFound();

  const { order, items, payments, events, methods } = detail;
  const due = remainingDue(order.total_amount, order.paid_amount);

  return (
    <>
      <PageHero
        breadcrumb={[
          { label: 'Accueil', href: '/' },
          { label: 'Mon espace', href: '/espace-client/' },
          { label: order.reference },
        ]}
        eyebrow="Votre commande"
        title={order.reference}
        lead={`${formatAmount(order.total_amount, order.currency)} · ${ORDER_STATUS_LABELS[order.status]} · ${SETTLEMENT_STATUS_LABELS[order.settlement_status]}`}
      />

      <section className="section auth-shell auth-shell--wide">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Détail</h2>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
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
                          {item.unit_label ? ` ${item.unit_label}` : ''}
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
                        <strong>{formatAmount(order.total_amount, order.currency)}</strong>
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

            {payments.length > 0 ? (
              <div className="auth-card">
                <div className="auth-card__head">
                  <h2>Vos paiements</h2>
                  <p>
                    Un paiement déclaré est vérifié par MORA Shawiri avant d’être confirmé. Tant
                    qu’il ne l’est pas, votre commande n’est pas considérée comme réglée.
                  </p>
                </div>

                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <caption className="sr-only">Paiements déclarés sur cette commande</caption>
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
                              '—'
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
                                  href={`/api/justificatifs/${proof.id}/`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Voir mon justificatif
                                </a>
                              </span>
                            ))}
                          </td>
                          <td>{formatMoment(payment.declared_at ?? payment.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {order.status !== 'ANNULEE' && due > 0 ? (
              <div className="auth-card">
                <div className="auth-card__head">
                  <h2>Déclarer un paiement</h2>
                  <p>
                    Réglez par le moyen de votre choix, puis indiquez-le ici. MORA Shawiri vérifie
                    et confirme.
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

                <ol className="admin-timeline">
                  {events.map((event) => (
                    <li key={event.id}>
                      <p className="admin-timeline__when">{formatMoment(event.occurred_at)}</p>
                      <p className="admin-timeline__what">
                        {ORDER_EVENT_LABELS[event.event_type]}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <div className="auth-card">
              <div className="btn-row">
                <Link className="btn btn--ghost" href="/espace-client/">
                  Retour à mon espace
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
