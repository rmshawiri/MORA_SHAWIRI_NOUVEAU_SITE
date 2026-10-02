import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { describeRequestEvent, formatClientDate } from '@/lib/client/labels';
import { myRequest } from '@/lib/client/relation';
import { getMyClientSpace } from '@/lib/client/space';
import { formatAmount } from '@/lib/commerce/labels';
import { formatMoment, QUOTE_REQUEST_STATUS_LABELS, QUOTE_STATUS_LABELS } from '@/lib/relation/labels';

export const metadata: Metadata = {
  title: 'Ma demande',
  robots: { index: false, follow: false },
};

/**
 * Une demande, vue par son titulaire (phase 4I-3).
 *
 * Informations utiles, message initial (immuable depuis 4F), devis réellement
 * envoyés, chronologie client. Jamais : note interne, agent affecté,
 * événement interne. Une demande d'autrui est introuvable (404), y compris
 * pour un compte qui détient des droits d'administration.
 */
export default async function MaDemandePage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const detail = await myRequest(space, decodeURIComponent(reference).toUpperCase());
  if (!detail) notFound();
  const { request, quotes, timeline } = detail;

  return (
    <>
      <SpaceCard title={`Demande ${request.reference}`} intro={`Envoyée le ${formatClientDate(request.created_at)}.`}>
        <dl className="auth-meta">
          <div>
            <dt>Objet</dt>
            <dd>{request.offer_title ?? request.subject}</dd>
          </div>
          {request.offer_title && request.subject !== request.offer_title ? (
            <div>
              <dt>Sujet</dt>
              <dd>{request.subject}</dd>
            </div>
          ) : null}
          <div>
            <dt>État</dt>
            <dd>{QUOTE_REQUEST_STATUS_LABELS[request.status]}</dd>
          </div>
          {request.budget_label ? (
            <div>
              <dt>Budget indiqué</dt>
              <dd>{request.budget_label}</dd>
            </div>
          ) : null}
          {request.organisation ? (
            <div>
              <dt>Organisation</dt>
              <dd>{request.organisation}</dd>
            </div>
          ) : null}
        </dl>
      </SpaceCard>

      <SpaceCard title="Votre message">
        <p className="espace-longtext">
          {request.message}
        </p>
      </SpaceCard>

      <SpaceCard title="Devis" intro={quotes.length > 0 ? 'Ouvrez un devis pour le consulter et y répondre.' : undefined}>
        {quotes.length === 0 ? (
          <SpaceEmpty title="Aucun devis pour le moment.">MORA Shawiri étudie votre demande ; un devis apparaîtra ici dès qu’il vous sera envoyé.</SpaceEmpty>
        ) : (
          <SpaceList label="Devis de cette demande">
            {quotes.map((quote) => (
              <SpaceItem
                key={quote.id}
                title={<Link href={`/espace-client/devis/${quote.reference}/`}>{quote.reference}</Link>}
                amount={formatAmount(quote.amount, quote.currency)}
                status={QUOTE_STATUS_LABELS[quote.status]}
                tone={quote.status === 'ENVOYE' ? 'todo' : quote.status === 'ACCEPTE' ? 'ok' : 'muted'}
                meta={`Envoyé le ${formatClientDate(quote.sent_at)}`}
              />
            ))}
          </SpaceList>
        )}
      </SpaceCard>

      {timeline.length > 0 ? (
        <SpaceCard title="Suivi">
          <ol className="espace-timeline">
            {timeline.map((entry, index) => (
              <li key={`${entry.occurred_at}-${index}`}>
                <p className="espace-timeline__when">{formatMoment(entry.occurred_at)}</p>
                <p className="espace-timeline__what">{describeRequestEvent(entry)}</p>
              </li>
            ))}
          </ol>
        </SpaceCard>
      ) : null}

      <div className="auth-card">
        <div className="btn-row">
          <Link className="btn btn--ghost" href="/espace-client/demandes/">
            Retour à mes demandes
          </Link>
        </div>
      </div>
    </>
  );
}
