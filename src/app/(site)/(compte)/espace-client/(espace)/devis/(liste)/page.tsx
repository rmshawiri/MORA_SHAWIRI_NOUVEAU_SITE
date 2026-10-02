import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { formatClientDate } from '@/lib/client/labels';
import { awaitsDecision, myQuotes, todayInComoros } from '@/lib/client/relation';
import { getMyClientSpace } from '@/lib/client/space';
import { formatAmount } from '@/lib/commerce/labels';
import { QUOTE_STATUS_LABELS } from '@/lib/relation/labels';

export const metadata: Metadata = {
  title: 'Mes devis',
  robots: { index: false, follow: false },
};

/**
 * Mes devis (phase 4I-3).
 *
 * Les devis réellement envoyés au compte connecté — jamais un brouillon. Le
 * devis se consulte à l'écran (aucun PDF en 4I, décision 4).
 */
export default async function MesDevisPage() {
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const { quotes, requests, failed } = await myQuotes(space);
  const today = todayInComoros();
  const requestRef = (id: string) => requests.find((request) => request.id === id)?.reference ?? '—';
  const pending = quotes.filter((quote) => awaitsDecision(quote, today)).length;

  return (
    <>
      {failed ? (
        <div className="auth-notice auth-notice--warn" role="alert">
          <p>Vos devis n’ont pas pu être chargés. Veuillez réessayer dans un instant.</p>
        </div>
      ) : null}
      <SpaceCard
        title="Mes devis"
        intro={quotes.length > 0 ? (pending > 0 ? `${pending} devis attend${pending > 1 ? 'ent' : ''} votre réponse.` : 'Aucun devis n’attend votre réponse.') : undefined}
      >
        {quotes.length === 0 ? (
          <SpaceEmpty title="Vous n’avez encore reçu aucun devis.">
            Un devis vous est envoyé par MORA Shawiri en réponse à une demande ; il apparaîtra ici.
          </SpaceEmpty>
        ) : (
          <SpaceList label="Mes devis">
            {quotes.map((quote) => (
              <SpaceItem
                key={quote.id}
                title={<Link href={`/espace-client/devis/${quote.reference}/`}>{quote.reference}</Link>}
                amount={formatAmount(quote.amount, quote.currency)}
                status={awaitsDecision(quote, today) ? 'En attente de votre réponse' : QUOTE_STATUS_LABELS[quote.status]}
                tone={awaitsDecision(quote, today) ? 'todo' : quote.status === 'ACCEPTE' ? 'ok' : 'muted'}
                meta={`Demande ${requestRef(quote.quote_request_id)} · envoyé le ${formatClientDate(quote.sent_at)}`}
              />
            ))}
          </SpaceList>
        )}
      </SpaceCard>
    </>
  );
}
