import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SpaceCard } from '@/components/affiliation/SpaceUi';
import ClientConfirmAction from '@/components/client/ClientConfirmAction';
import OfficialDocumentActions from '@/components/documents/OfficialDocumentActions';
import { formatClientDate } from '@/lib/client/labels';
import { awaitsDecision, myQuote, todayInComoros } from '@/lib/client/relation';
import { respondToMyQuote } from '@/lib/client/relation-actions';
import { clientResultMessage } from '@/lib/client/results';
import { getMyClientSpace } from '@/lib/client/space';
import { formatAmount } from '@/lib/commerce/labels';
import { formatDay, formatMoment, QUOTE_STATUS_LABELS } from '@/lib/relation/labels';

export const metadata: Metadata = {
  title: 'Mon devis',
  robots: { index: false, follow: false },
};

/**
 * Un devis, vu par son destinataire (phase 4I-3).
 *
 * Présenté à l'écran (aucun PDF en 4I). Tant qu'il attend une réponse, le
 * client l'accepte ou le refuse, après confirmation ; la base vérifie
 * propriété, état et validité sous verrou. Accepter ne crée pas de commande :
 * MORA Shawiri l'établit ensuite.
 */
export default async function MonDevisPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ resultat?: string }>;
}) {
  const result = clientResultMessage((await searchParams).resultat);
  const { reference } = await params;
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const detail = await myQuote(space, decodeURIComponent(reference).toUpperCase());
  if (!detail) notFound();
  const { quote, request, serviceTitle, lines, documentStatus } = detail;
  const today = todayInComoros();
  const open = awaitsDecision(quote, today);
  const lapsed = quote.status === 'ENVOYE' && !open;

  return (
    <>
      {result ? (
        <div className="auth-notice auth-notice--ok" role="status">
          <p>{result}</p>
        </div>
      ) : null}
      <SpaceCard title={`Devis ${quote.reference}`} intro={`Envoyé le ${formatClientDate(quote.sent_at)} pour la demande ${request.reference}.`}>
        <dl className="auth-meta">
          <div>
            <dt>Montant</dt>
            <dd>
              <strong>{formatAmount(quote.amount, quote.currency)}</strong>
            </dd>
          </div>
          {serviceTitle ? (
            <div>
              <dt>Prestation</dt>
              <dd>{serviceTitle}</dd>
            </div>
          ) : null}
          <div>
            <dt>État</dt>
            <dd>{lapsed ? 'Expiré' : open ? 'En attente de votre réponse' : QUOTE_STATUS_LABELS[quote.status]}</dd>
          </div>
          <div>
            <dt>Validité</dt>
            <dd>{quote.valid_until ? `Jusqu’au ${formatDay(quote.valid_until)}` : 'Aucune date d’expiration indiquée'}</dd>
          </div>
          {quote.responded_at ? (
            <div>
              <dt>Réponse</dt>
              <dd>
                {quote.status === 'ACCEPTE' ? 'Accepté' : 'Refusé'} le {formatMoment(quote.responded_at)}
                {quote.responded_by === space.context.userId ? ' (par vous)' : ''}
              </dd>
            </div>
          ) : null}
          {quote.status === 'REFUSE' && quote.responded_by === space.context.userId && quote.client_response_reason ? (
            <div>
              <dt>Votre motif</dt>
              <dd>{quote.client_response_reason}</dd>
            </div>
          ) : null}
        </dl>
      </SpaceCard>

      <SpaceCard title="Contenu du devis">
        <p className="espace-longtext">{quote.summary}</p>
        {lines.length > 0 ? (
          <div className="espace-table-wrap">
            <table className="espace-table">
              <caption className="sr-only">Lignes du devis</caption>
              <thead>
                <tr>
                  <th scope="col">Prestation</th>
                  <th scope="col">Quantité</th>
                  <th scope="col">Prix unitaire</th>
                  <th scope="col">Montant</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <th scope="row">
                      {line.designation}
                      {line.description ? <span className="espace-table__sub">{line.description}</span> : null}
                    </th>
                    <td>{String(Number(line.quantity)).replace('.', ',')}</td>
                    <td>
                      {formatAmount(line.unit_price, quote.currency)}
                      {Number(line.discount_amount) > 0 ? (
                        <span className="espace-table__sub">remise {formatAmount(line.discount_amount, quote.currency)}</span>
                      ) : null}
                    </td>
                    <td>{formatAmount(line.line_total, quote.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    Total
                  </th>
                  <td>
                    <strong>{formatAmount(quote.amount, quote.currency)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
        {quote.notes ? (
          <>
            <h3 className="espace-subtitle">Observations</h3>
            <p className="espace-longtext">{quote.notes}</p>
          </>
        ) : null}
      </SpaceCard>

      {documentStatus === 'EMIS' || documentStatus === 'REMPLACE' ? (
        <SpaceCard
          title="Le devis au format PDF"
          intro={
            documentStatus === 'REMPLACE'
              ? 'Ce devis a été remplacé par une version plus récente ; le PDF reste consultable et l’indique.'
              : 'Le document officiel, tel qu’il a été émis. Il reste aussi disponible dans Mes documents.'
          }
        >
          <OfficialDocumentActions reference={quote.reference} title={`Devis ${quote.reference}`} space="espace" ownerOnly />
        </SpaceCard>
      ) : null}

      {open ? (
        <SpaceCard
          title="Votre réponse"
          intro="Accepter ce devis ne crée pas encore la commande : MORA Shawiri l’établit ensuite et vous la retrouverez dans Mes commandes."
        >
          <div className="btn-row">
            <ClientConfirmAction
              action={respondToMyQuote}
              fields={{ devis: quote.id, decision: 'ACCEPTE' }}
              trigger="Accepter le devis"
              consequence={`Vous acceptez le devis ${quote.reference} pour ${formatAmount(quote.amount, quote.currency)}. Votre accord est enregistré et transmis à MORA Shawiri.`}
              confirmLabel="Oui, j’accepte ce devis"
            />
            <ClientConfirmAction
              action={respondToMyQuote}
              fields={{ devis: quote.id, decision: 'REFUSE' }}
              trigger="Refuser le devis"
              variant="ghost"
              consequence={`Vous refusez le devis ${quote.reference}. Votre décision est enregistrée et transmise à MORA Shawiri.`}
              confirmLabel="Oui, je refuse ce devis"
              reason={{ label: 'Motif du refus', required: false, maxLength: 1000, hint: 'Il sera lu par MORA Shawiri.' }}
            />
          </div>
        </SpaceCard>
      ) : null}

      {lapsed ? (
        <div className="auth-notice auth-notice--warn" role="status">
          <p>La date de validité de ce devis est dépassée : contactez MORA Shawiri si vous souhaitez y donner suite.</p>
        </div>
      ) : null}

      <div className="auth-card">
        <div className="btn-row">
          <Link className="btn btn--ghost" href={`/espace-client/demandes/${request.reference}/`}>
            Voir la demande
          </Link>
          <Link className="btn btn--ghost" href="/espace-client/devis/">
            Retour à mes devis
          </Link>
        </div>
      </div>
    </>
  );
}
