import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import ClientConfirmAction from '@/components/client/ClientConfirmAction';
import { formatClientDate } from '@/lib/client/labels';
import { myClaimable, myRequests, OPEN_REQUEST_STATUSES } from '@/lib/client/relation';
import { claimMyRequests } from '@/lib/client/relation-actions';
import { clientResultMessage } from '@/lib/client/results';
import { getMyClientSpace } from '@/lib/client/space';
import { QUOTE_REQUEST_STATUS_LABELS } from '@/lib/relation/labels';

export const metadata: Metadata = {
  title: 'Mes demandes',
  robots: { index: false, follow: false },
};

/**
 * Mes demandes (phase 4I-3).
 *
 * Les demandes de devis du compte connecté, et elles seules. En tête, s'il y
 * en a : les demandes envoyées **hors connexion** avec l'adresse confirmée du
 * compte, que le client peut rattacher à son espace (décision 3) — il voit ce
 * qui a été envoyé avec son adresse, et décide de le reprendre.
 */
export default async function MesDemandesPage({ searchParams }: { searchParams: Promise<{ resultat?: string }> }) {
  const result = clientResultMessage((await searchParams).resultat);
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const [{ requests, failed }, claimable] = await Promise.all([myRequests(space), myClaimable(space)]);
  const open = requests.filter((request) => OPEN_REQUEST_STATUSES.includes(request.status));

  return (
    <>
      {result ? (
        <div className="auth-notice auth-notice--ok" role="status">
          <p>{result}</p>
        </div>
      ) : null}
      {failed ? (
        <div className="auth-notice auth-notice--warn" role="alert">
          <p>Vos demandes n’ont pas pu être chargées. Veuillez réessayer dans un instant.</p>
        </div>
      ) : null}

      {claimable.length > 0 ? (
        <SpaceCard
          title="Envoyées avec votre adresse"
          intro="Ces demandes ont été envoyées sans être connecté, avec l’adresse e-mail confirmée de votre compte. Rattachez-les pour les suivre ici."
        >
          <SpaceList label="Éléments à rattacher">
            {claimable.map((item) => (
              <SpaceItem
                key={item.item_id}
                title={item.reference ?? (item.item_kind === 'RENDEZ_VOUS' ? 'Demande de rendez-vous' : 'Demande')}
                meta={`${item.item_kind === 'RENDEZ_VOUS' ? 'Rendez-vous' : 'Demande de devis'} · ${item.subject} · ${formatClientDate(item.created_at)}`}
              />
            ))}
          </SpaceList>
          <ClientConfirmAction
            action={claimMyRequests}
            fields={{ rattacher: '1' }}
            trigger="Les rattacher à mon espace"
            consequence="Ces éléments rejoindront votre espace. Ne le faites que si vous les avez bien envoyés vous-même."
            confirmLabel="Rattacher"
          />
        </SpaceCard>
      ) : null}

      <SpaceCard
        title="Mes demandes"
        intro={requests.length > 0 ? `${open.length} en cours sur ${requests.length}. Ouvrez une demande pour voir son suivi et ses devis.` : undefined}
      >
        {requests.length === 0 ? (
          <SpaceEmpty title="Vous n’avez encore aucune demande.">
            Les demandes de devis que vous envoyez apparaissent ici. <Link href="/contact/">Faire une demande</Link>
          </SpaceEmpty>
        ) : (
          <SpaceList label="Mes demandes">
            {requests.map((request) => (
              <SpaceItem
                key={request.id}
                title={<Link href={`/espace-client/demandes/${request.reference}/`}>{request.reference}</Link>}
                status={QUOTE_REQUEST_STATUS_LABELS[request.status]}
                tone={OPEN_REQUEST_STATUSES.includes(request.status) ? 'todo' : request.status === 'ACCEPTEE' || request.status === 'TERMINEE' ? 'ok' : 'muted'}
                meta={`${request.offer_title ?? request.subject} · ${formatClientDate(request.created_at)}`}
              />
            ))}
          </SpaceList>
        )}
      </SpaceCard>
    </>
  );
}
