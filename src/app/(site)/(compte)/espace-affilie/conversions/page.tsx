import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { COMMISSION_STATUS_LABELS, kmf } from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';
import { getMySpace, myCommissions, myConversions } from '@/lib/affiliation/space';
import { ATTRIBUTION_STATE_LABELS, attributionSourceLabel } from '@/lib/affiliation/space-labels';
import { ORDER_STATUS_LABELS, SETTLEMENT_STATUS_LABELS } from '@/lib/commerce/labels';

export const metadata: Metadata = {
  title: 'Mes conversions',
  robots: { index: false, follow: false },
};

const label = (table: Record<string, string>, key: string): string => (Object.hasOwn(table, key) ? (table[key] ?? key) : key);

/**
 * Conversions (phase 4H-8).
 *
 * Les commandes attribuées à l'affilié, par `my_affiliate_conversions` : la
 * référence, la première ligne, le montant, l'état — jamais le nom, l'e-mail
 * ni le téléphone du client. La commission liée est celle de la base, avec
 * son assiette réellement commissionnable.
 */
export default async function ConversionsPage() {
  const space = await getMySpace();
  if (space.state !== 'ready') return null;

  const [conversions, { commissions }] = await Promise.all([myConversions(space), myCommissions(space)]);
  const byOrder = new Map(commissions.filter((c) => c.status !== 'ANNULEE').map((c) => [c.order_reference, c]));

  return (
    <SpaceCard title="Mes conversions" intro="Les commandes qui vous sont attribuées. Par confidentialité, les coordonnées des clients ne sont jamais affichées.">
      {conversions.length === 0 ? (
        <SpaceEmpty title="Aucune commande attribuée pour le moment">
          Une commande passée par un client venu par votre lien, votre code ou un prospect reconnu apparaîtra ici.
        </SpaceEmpty>
      ) : (
        <SpaceList label="Commandes attribuées">
          {conversions.map((row) => {
            const commission = byOrder.get(row.order_reference);
            return (
              <SpaceItem
                key={row.order_reference}
                title={row.order_reference}
                amount={kmf(row.amount)}
                status={attributionSourceLabel(row.source)}
                tone={row.attribution === 'VALIDEE' ? 'ok' : 'todo'}
                meta={`${formatMoment(row.ordered_at)} · attribution ${(ATTRIBUTION_STATE_LABELS[row.attribution] ?? row.attribution).toLowerCase()}`}
              >
                <dl className="auth-meta">
                  <div>
                    <dt>Offre</dt>
                    <dd>{row.offer ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Commande</dt>
                    <dd>
                      {label(ORDER_STATUS_LABELS, row.order_status)} · {label(SETTLEMENT_STATUS_LABELS, row.settlement).toLowerCase()}
                    </dd>
                  </div>
                  <div>
                    <dt>Commission</dt>
                    <dd>
                      {commission ? (
                        <>
                          <Link href={`/espace-affilie/commissions/#${commission.reference}`}>{commission.reference}</Link> —{' '}
                          {kmf(commission.amount)}, {COMMISSION_STATUS_LABELS[commission.status].toLowerCase()} (assiette commissionnable{' '}
                          {kmf(commission.base_amount)})
                        </>
                      ) : (
                        'Aucune : la commande ne comporte pas d’offre éligible, ou elle n’est pas encore établie.'
                      )}
                    </dd>
                  </div>
                </dl>
              </SpaceItem>
            );
          })}
        </SpaceList>
      )}
    </SpaceCard>
  );
}
