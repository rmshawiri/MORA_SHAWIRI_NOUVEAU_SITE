import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SpaceCard } from '@/components/affiliation/SpaceUi';
import ClientConfirmAction from '@/components/client/ClientConfirmAction';
import { describeAppointmentEvent, formatClientDate } from '@/lib/client/labels';
import { canCancel, myAppointment } from '@/lib/client/relation';
import { cancelMyAppointment } from '@/lib/client/relation-actions';
import { clientResultMessage } from '@/lib/client/results';
import { getMyClientSpace } from '@/lib/client/space';
import { APPOINTMENT_CHANNEL_LABELS, APPOINTMENT_STATUS_LABELS, formatDay, formatMoment, formatSlot } from '@/lib/relation/labels';

export const metadata: Metadata = {
  title: 'Mon rendez-vous',
  robots: { index: false, follow: false },
};

/**
 * Un rendez-vous, vu par son titulaire (phase 4I-3).
 *
 * Le client l'annule tant qu'il n'a pas commencé, motif obligatoire, sans
 * aucun délai minimal (décision 2) ; la base le revérifie sous verrou. Aucune
 * reprogrammation : les disponibilités ne sont pas activées. Le motif d'une
 * annulation par MORA Shawiri n'est pas affiché : rien ne dit qu'il était
 * destiné au client.
 */
export default async function MonRendezVousPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ resultat?: string }>;
}) {
  const result = clientResultMessage((await searchParams).resultat);
  const { id } = await params;
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const detail = await myAppointment(space, id);
  if (!detail) notFound();
  const { appointment: row, timeline } = detail;
  const cancellable = canCancel(row);
  const channel = row.channel_label ?? APPOINTMENT_CHANNEL_LABELS[row.channel as keyof typeof APPOINTMENT_CHANNEL_LABELS] ?? row.channel;

  return (
    <>
      {result ? (
        <div className="auth-notice auth-notice--ok" role="status">
          <p>{result}</p>
        </div>
      ) : null}
      <SpaceCard title={row.reference ? `Rendez-vous ${row.reference}` : 'Demande de rendez-vous'} intro={`Demandé le ${formatClientDate(row.created_at)}.`}>
        <dl className="auth-meta">
          <div>
            <dt>Objet</dt>
            <dd>{row.subject}</dd>
          </div>
          <div>
            <dt>Date et heure</dt>
            <dd>
              {row.scheduled_at
                ? formatSlot(row.scheduled_at, row.scheduled_end)
                : `À confirmer${row.requested_date ? ` — souhaité le ${formatDay(row.requested_date)}${row.requested_slot ? ` (${row.requested_slot})` : ''}` : ''}`}
            </dd>
          </div>
          <div>
            <dt>Canal</dt>
            <dd>{channel}</dd>
          </div>
          <div>
            <dt>État</dt>
            <dd>{APPOINTMENT_STATUS_LABELS[row.status]}</dd>
          </div>
          {row.status === 'ANNULE' ? (
            <div>
              <dt>Annulation</dt>
              <dd>
                {row.cancelled_by === space.context.userId ? 'Par vous' : 'Par MORA Shawiri'}
                {row.cancelled_at ? `, le ${formatMoment(row.cancelled_at)}` : ''}
                {row.cancelled_by === space.context.userId && row.cancel_reason ? ` — motif : ${row.cancel_reason}` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
      </SpaceCard>

      {row.message ? (
        <SpaceCard title="Votre message">
          <p className="espace-longtext">{row.message}</p>
        </SpaceCard>
      ) : null}

      {cancellable ? (
        <SpaceCard title="Annuler ce rendez-vous" intro="Vous pouvez l’annuler tant qu’il n’a pas commencé. Pour changer de date, contactez MORA Shawiri.">
          <ClientConfirmAction
            action={cancelMyAppointment}
            fields={{ rendez_vous: row.id }}
            trigger="Annuler le rendez-vous"
            variant="ghost"
            consequence="Le rendez-vous sera annulé et MORA Shawiri en sera informé. Cette annulation est définitive."
            confirmLabel="Confirmer l’annulation"
            reason={{ label: 'Motif de l’annulation', required: true, maxLength: 500 }}
          />
        </SpaceCard>
      ) : null}

      {timeline.length > 0 ? (
        <SpaceCard title="Suivi">
          <ol className="espace-timeline">
            {timeline.map((entry, index) => (
              <li key={`${entry.occurred_at}-${index}`}>
                <p className="espace-timeline__when">{formatMoment(entry.occurred_at)}</p>
                <p className="espace-timeline__what">{describeAppointmentEvent(entry)}</p>
              </li>
            ))}
          </ol>
        </SpaceCard>
      ) : null}

      <div className="auth-card">
        <div className="btn-row">
          <Link className="btn btn--ghost" href="/espace-client/rendez-vous/">
            Retour à mes rendez-vous
          </Link>
        </div>
      </div>
    </>
  );
}
