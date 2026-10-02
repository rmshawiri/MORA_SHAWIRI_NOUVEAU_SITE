import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { myPaymentsAndRefunds, paymentMethodLabels } from '@/lib/client/commerce';
import { getMyClientSpace } from '@/lib/client/space';
import { formatAmount, PAYMENT_STATUS_LABELS, REFUND_STATUS_LABELS } from '@/lib/commerce/labels';
import { formatMoment } from '@/lib/relation/labels';

export const metadata: Metadata = {
  title: 'Mes paiements',
  robots: { index: false, follow: false },
};

/**
 * Mes paiements (phase 4I-2).
 *
 * L'historique réel des paiements du client, toutes commandes confondues, tel
 * que la phase 4G l'enregistre. Un paiement déclaré reste « en vérification »
 * tant que MORA Shawiri ne l'a pas confirmé : l'écran le dit, rien n'est
 * présenté comme réglé avant. On déclare un paiement depuis la fiche de la
 * commande — le formulaire et ses règles sont ceux de 4G.
 */
export default async function MesPaiementsPage() {
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const [{ orders, payments, refunds, failed }, labels] = await Promise.all([
    myPaymentsAndRefunds(space),
    paymentMethodLabels(space),
  ]);
  const orderRef = (id: string) => orders.find((order) => order.id === id)?.reference ?? '—';

  return (
    <>
      {failed ? (
        <div className="auth-notice auth-notice--warn" role="alert">
          <p>Une partie de vos paiements n’a pas pu être chargée. Veuillez réessayer dans un instant.</p>
        </div>
      ) : null}

      <SpaceCard
        title="Mes paiements"
        intro="Un paiement déclaré est vérifié par MORA Shawiri avant d’être confirmé. Pour déclarer un paiement, ouvrez la commande concernée."
      >
        {payments.length === 0 ? (
          <SpaceEmpty title="Aucun paiement enregistré.">
            Vos paiements apparaîtront ici dès que vous en aurez déclaré un sur une commande.{' '}
            <Link href="/espace-client/commandes/">Voir mes commandes</Link>
          </SpaceEmpty>
        ) : (
          <SpaceList label="Mes paiements">
            {payments.map((payment) => (
              <SpaceItem
                key={payment.id}
                title={
                  <Link href={`/espace-client/commandes/${orderRef(payment.order_id)}/`}>{orderRef(payment.order_id)}</Link>
                }
                amount={formatAmount(payment.amount, payment.currency)}
                status={PAYMENT_STATUS_LABELS[payment.status]}
                tone={payment.status === 'PAYE' ? 'ok' : payment.status === 'ECHEC' ? 'warn' : 'todo'}
                meta={`${labels[payment.method_code] ?? payment.method_code} · ${formatMoment(payment.confirmed_at ?? payment.declared_at ?? payment.created_at)}`}
              >
                {payment.transaction_reference ? (
                  <p>
                    Référence de transaction : <code>{payment.transaction_reference}</code>
                  </p>
                ) : null}
                {payment.rejection_reason ? <p>Motif : {payment.rejection_reason}</p> : null}
                {payment.proofs.map((proof) => (
                  <p key={proof.id}>
                    <a href={`/api/justificatifs/${proof.id}/?espace=client`} target="_blank" rel="noreferrer">
                      Voir mon justificatif
                    </a>
                  </p>
                ))}
              </SpaceItem>
            ))}
          </SpaceList>
        )}
      </SpaceCard>

      {refunds.length > 0 ? (
        <SpaceCard title="Mes remboursements" intro="Les remboursements enregistrés par MORA Shawiri sur vos commandes.">
          <SpaceList label="Mes remboursements">
            {refunds.map((refund) => (
              <SpaceItem
                key={refund.id}
                title={<Link href={`/espace-client/commandes/${orderRef(refund.order_id)}/`}>{orderRef(refund.order_id)}</Link>}
                amount={formatAmount(refund.amount, refund.currency)}
                status={REFUND_STATUS_LABELS[refund.status]}
                tone={refund.status === 'EFFECTUE' ? 'ok' : 'todo'}
                meta={formatMoment(refund.completed_at ?? refund.requested_at)}
              />
            ))}
          </SpaceList>
        </SpaceCard>
      ) : null}
    </>
  );
}
