import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { formatClientDate } from '@/lib/client/labels';
import { getMyClientSpace } from '@/lib/client/space';
import { listMyOrders } from '@/lib/commerce/client';
import { formatAmount, ORDER_STATUS_LABELS, remainingDue, SETTLEMENT_STATUS_LABELS } from '@/lib/commerce/labels';

export const metadata: Metadata = {
  title: 'Mes commandes',
  robots: { index: false, follow: false },
};

/**
 * Mes commandes (phase 4I-2).
 *
 * Les commandes du compte connecté, et elles seules : `listMyOrders` filtre
 * sur le titulaire, quels que soient les droits d'administration du compte.
 */
export default async function MesCommandesPage() {
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const orders = await listMyOrders(200);

  return (
    <SpaceCard
      title="Mes commandes"
      intro={orders.length > 0 ? 'Ouvrez une commande pour en voir le détail, vos paiements et votre facture.' : undefined}
    >
      {orders.length === 0 ? (
        <SpaceEmpty title="Vous n’avez encore aucune commande.">
          Une commande est établie par MORA Shawiri après acceptation d’un devis ; vous la retrouverez ici.{' '}
          <Link href="/boutique/">Découvrir nos offres</Link>
        </SpaceEmpty>
      ) : (
        <SpaceList label="Mes commandes">
          {orders.map((order) => {
            const due = remainingDue(String(order.total_amount), String(order.paid_amount));
            return (
              <SpaceItem
                key={order.id}
                title={<Link href={`/espace-client/commandes/${order.reference}/`}>{order.reference}</Link>}
                amount={formatAmount(order.total_amount, order.currency)}
                status={ORDER_STATUS_LABELS[order.status]}
                tone={order.status === 'TERMINEE' ? 'ok' : order.status === 'ANNULEE' ? 'muted' : 'todo'}
                meta={`${SETTLEMENT_STATUS_LABELS[order.settlement_status]} · ${formatClientDate(order.created_at)}`}
              >
                {order.status !== 'ANNULEE' && due > 0 ? (
                  <p>Reste à régler : {formatAmount(due, order.currency)}</p>
                ) : null}
              </SpaceItem>
            );
          })}
        </SpaceList>
      )}
    </SpaceCard>
  );
}
