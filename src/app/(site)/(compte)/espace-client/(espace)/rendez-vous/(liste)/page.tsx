import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { isUpcoming, myAppointments, type MyAppointment } from '@/lib/client/relation';
import { getMyClientSpace } from '@/lib/client/space';
import { APPOINTMENT_CHANNEL_LABELS, APPOINTMENT_STATUS_LABELS, formatDay, formatMoment } from '@/lib/relation/labels';

export const metadata: Metadata = {
  title: 'Mes rendez-vous',
  robots: { index: false, follow: false },
};

function when(row: MyAppointment): string {
  if (row.scheduled_at) return formatMoment(row.scheduled_at);
  const wished = row.requested_date ? `souhaité le ${formatDay(row.requested_date)}${row.requested_slot ? ` (${row.requested_slot})` : ''}` : 'date à convenir';
  return `En attente de confirmation · ${wished}`;
}

function channel(row: MyAppointment): string {
  return row.channel_label ?? APPOINTMENT_CHANNEL_LABELS[row.channel as keyof typeof APPOINTMENT_CHANNEL_LABELS] ?? row.channel;
}

/**
 * Mes rendez-vous (phase 4I-3).
 *
 * À venir (en attente, ou confirmés et pas encore commencés — la règle même
 * du compteur du tableau de bord), puis passés et clos. Données réelles
 * uniquement ; aucune reprogrammation proposée (disponibilités non activées).
 */
export default async function MesRendezVousPage() {
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const { appointments, failed } = await myAppointments(space);
  const now = new Date().toISOString();
  const upcoming = appointments
    .filter((row) => isUpcoming(row, now))
    .sort((a, b) => (a.scheduled_at ?? '9999').localeCompare(b.scheduled_at ?? '9999'));
  const past = appointments.filter((row) => !isUpcoming(row, now));

  const item = (row: MyAppointment) => (
    <SpaceItem
      key={row.id}
      title={<Link href={`/espace-client/rendez-vous/${row.id}/`}>{row.reference ?? row.subject}</Link>}
      status={APPOINTMENT_STATUS_LABELS[row.status]}
      tone={row.status === 'CONFIRME' ? 'ok' : row.status === 'EN_ATTENTE' ? 'todo' : 'muted'}
      meta={`${when(row)} · ${channel(row)}`}
    >
      {row.reference ? <p>{row.subject}</p> : null}
    </SpaceItem>
  );

  return (
    <>
      {failed ? (
        <div className="auth-notice auth-notice--warn" role="alert">
          <p>Vos rendez-vous n’ont pas pu être chargés. Veuillez réessayer dans un instant.</p>
        </div>
      ) : null}
      <SpaceCard title="Mes rendez-vous à venir">
        {upcoming.length === 0 ? (
          <SpaceEmpty title="Aucun rendez-vous à venir.">
            <Link href="/rendez-vous/">Prendre rendez-vous</Link>
          </SpaceEmpty>
        ) : (
          <SpaceList label="Rendez-vous à venir">{upcoming.map(item)}</SpaceList>
        )}
      </SpaceCard>
      <SpaceCard title="Rendez-vous passés et clos">
        {past.length === 0 ? (
          <SpaceEmpty title="Aucun rendez-vous passé." />
        ) : (
          <SpaceList label="Rendez-vous passés et clos">{past.map(item)}</SpaceList>
        )}
      </SpaceCard>
    </>
  );
}
