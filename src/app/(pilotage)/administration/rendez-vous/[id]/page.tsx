import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import AppointmentSlotForm from '@/components/admin/AppointmentSlotForm';
import ConfirmForm from '@/components/admin/ConfirmForm';
import RelationNoteForm from '@/components/admin/RelationNoteForm';
import RelationSelectForm from '@/components/admin/RelationSelectForm';
import { listAdministrators } from '@/lib/admin/administrators';
import { displayIdentity } from '@/lib/auth/identifiers';
import { requireModule } from '@/lib/rbac/guards';
import {
  assignAppointment,
  cancelAppointment,
  completeAppointment,
  deleteRelationNote,
} from '@/lib/relation/actions';
import {
  APPOINTMENT_CHANNEL_LABELS,
  APPOINTMENT_STATUS_LABELS,
  findAppointment,
  formatDay,
  formatMoment,
  formatSlot,
  toLocalInputValue,
} from '@/lib/relation/admin';
import type { AppointmentEventRow, Json } from '@/lib/supabase/types';

export const metadata: Metadata = {
  title: 'Rendez-vous',
  robots: { index: false, follow: false },
};

/**
 * Fiche d'un rendez-vous — phase 4F.
 *
 * ## L'identifiant dans l'URL est un UUID
 *
 * Pas une référence : un rendez-vous n'en reçoit qu'à sa confirmation (§ 43),
 * et il faut bien pouvoir ouvrir la fiche d'une demande encore en attente. Un
 * UUID ne porte aucune donnée personnelle, contrairement à un nom ou à une
 * adresse — que le point 17 du cadrage interdit de mettre dans une URL.
 *
 * Une fiche inaccessible rend la même réponse qu'une fiche inexistante : le
 * test IDOR exigé par le plan ne doit rien apprendre à celui qui essaie.
 *
 * ## Confirmer, déplacer, annuler, clore
 *
 * Quatre actes, trois permissions. Annuler a la sienne (`appointments.cancel`,
 * § 51-53) : un compte qui peut corriger un rendez-vous ne peut pas l'annuler
 * pour autant. Chaque acte est revérifié côté serveur, et la base refuse de
 * son côté.
 */
export default async function RendezVousFichePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireModule('rendez-vous');
  const { id } = await params;

  const detail = await findAppointment(id);
  if (!detail) notFound();

  const { appointment, lead, serviceTitle, requestReference, events, notes } = detail;

  const canUpdate = context.can('appointments.update');
  const canCancel = context.can('appointments.cancel');

  const administrators = canUpdate ? await listAdministrators() : [];
  const details = readDetails(appointment.details);

  const isPending = appointment.status === 'EN_ATTENTE';
  const isConfirmed = appointment.status === 'CONFIRME';
  const isClosed = appointment.status === 'ANNULE' || appointment.status === 'TERMINE';

  return (
    <AdminPage
      eyebrow="Activité"
      title={appointment.reference ?? 'Demande de rendez-vous'}
      lead={`${APPOINTMENT_STATUS_LABELS[appointment.status]} — reçue le ${formatMoment(appointment.created_at)}.`}
      actions={
        <Link className="btn btn--ghost" href="/administration/rendez-vous/">
          Retour à la liste
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>La demande</h2>
          <p>
            Le souhait exprimé par le demandeur. Le formulaire public annonce lui-même qu’une
            alternative peut lui être proposée : cette date n’est pas une réservation.
          </p>
        </div>

        <dl className="admin-def">
          <dt>Sujet</dt>
          <dd>{appointment.subject}</dd>

          <dt>Canal souhaité</dt>
          <dd>
            {APPOINTMENT_CHANNEL_LABELS[appointment.channel]}
            {appointment.channel_label && appointment.channel === 'AUTRE' ? (
              <span className="admin-field__hint"> — « {appointment.channel_label} »</span>
            ) : null}
          </dd>

          <dt>Date souhaitée</dt>
          <dd>{formatDay(appointment.requested_date)}</dd>

          <dt>Demi-journée préférée</dt>
          <dd>{appointment.requested_slot ?? 'Non précisée'}</dd>

          <dt>Prestation</dt>
          <dd>{serviceTitle ?? '—'}</dd>

          <dt>Budget envisagé</dt>
          <dd>{appointment.budget_label ?? 'Non renseigné'}</dd>

          <dt>Demande de devis liée</dt>
          <dd>
            {requestReference ? (
              <Link href={`/administration/demandes/${requestReference}/`}>
                <code>{requestReference}</code>
              </Link>
            ) : (
              'Aucune'
            )}
          </dd>

          <dt>Origine</dt>
          <dd>{appointment.source ?? '—'}</dd>
        </dl>

        {appointment.message ? (
          <>
            <h3>Précisions du demandeur</h3>
            <p className="admin-longtext">{appointment.message}</p>
          </>
        ) : null}

        {details.length > 0 ? (
          <>
            <h3>Réponses au questionnaire</h3>
            <dl className="admin-def">
              {details.map((row, index) => (
                <div key={`${row.label}-${index}`}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Le demandeur</h2>
          <p>
            {appointment.user_id
              ? 'Rattaché à un compte client, par la session au moment de l’envoi.'
              : 'Demande envoyée sans compte.'}
          </p>
        </div>

        <dl className="admin-def">
          <dt>Nom</dt>
          <dd>{lead?.full_name ?? '—'}</dd>

          <dt>Adresse e-mail</dt>
          <dd>{lead?.email ?? '—'}</dd>

          <dt>Téléphone</dt>
          <dd>{lead?.phone ?? 'Non renseigné'}</dd>

          <dt>Demandes de ce contact</dt>
          <dd>{lead?.request_count ?? 1}</dd>
        </dl>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Créneau</h2>
          <p>
            {isConfirmed
              ? `Confirmé le ${formatMoment(appointment.confirmed_at)} — ${formatSlot(appointment.scheduled_at, appointment.scheduled_end)}. Heure de Moroni.`
              : isPending
                ? 'Aucun créneau ferme. La confirmation attribue la référence définitive du rendez-vous et réserve le créneau.'
                : `Ce rendez-vous est ${APPOINTMENT_STATUS_LABELS[appointment.status].toLowerCase()}.`}
          </p>
        </div>

        {appointment.status === 'ANNULE' ? (
          <dl className="admin-def">
            <dt>Annulé par</dt>
            <dd>{appointment.cancelled_by ? 'Le client, depuis son espace' : 'MORA Shawiri'}</dd>
          </dl>
        ) : null}

        {appointment.cancel_reason ? (
          <dl className="admin-def">
            <dt>Motif d’annulation</dt>
            <dd>{appointment.cancel_reason}</dd>
          </dl>
        ) : null}

        {isPending && canUpdate ? (
          <AppointmentSlotForm
            appointmentId={appointment.id}
            mode="confirmation"
            suggestedDate={appointment.requested_date ?? undefined}
          />
        ) : null}

        {isConfirmed && canUpdate ? (
          <>
            <h3>Déplacer le rendez-vous</h3>
            <AppointmentSlotForm
              appointmentId={appointment.id}
              mode="reprogrammation"
              start={toLocalInputValue(appointment.scheduled_at)}
              end={toLocalInputValue(appointment.scheduled_end)}
            />
          </>
        ) : null}

        {!isClosed && !canUpdate ? (
          <div className="admin-notice">
            <p>
              La permission <code>appointments.update</code> est nécessaire pour confirmer ou
              déplacer un rendez-vous.
            </p>
          </div>
        ) : null}
      </section>

      {isClosed ? null : (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Clôture</h2>
            <p>
              Annuler et clore sont deux actes distincts, sous deux permissions distinctes. Un
              créneau annulé redevient immédiatement disponible.
            </p>
          </div>

          <div className="admin-table__actions">
            {isConfirmed && canUpdate ? (
              <ConfirmForm
                action={completeAppointment}
                fields={{ appointmentId: appointment.id }}
                trigger="Marquer comme terminé"
                consequence="Le rendez-vous sera clos. Son statut n’évoluera plus, et son créneau restera occupé dans l’historique."
                confirmLabel="Marquer comme terminé"
              />
            ) : null}

            {canCancel ? (
              <ConfirmForm
                action={cancelAppointment}
                fields={{ appointmentId: appointment.id }}
                trigger="Annuler le rendez-vous"
                consequence="Le rendez-vous sera annulé définitivement et son créneau redeviendra disponible. L’historique conserve la trace de l’annulation. Aucun courriel n’est envoyé automatiquement au demandeur."
                confirmLabel="Annuler le rendez-vous"
                variant="ghost"
              />
            ) : null}
          </div>

          {canCancel ? (
            <details className="admin-details">
              <summary>Annuler en indiquant un motif</summary>
              <RelationSelectForm
                action={cancelAppointment}
                fields={{ appointmentId: appointment.id }}
                name="reason"
                label="Motif de l’annulation"
                options={[
                  { value: 'Créneau indisponible', label: 'Créneau indisponible' },
                  { value: 'À la demande du client', label: 'À la demande du client' },
                  { value: 'Sans réponse du client', label: 'Sans réponse du client' },
                  { value: 'Doublon', label: 'Doublon' },
                ]}
                submitLabel="Annuler avec ce motif"
                hint="Le motif entre dans l’historique métier, où il explique la ligne (§ 54)."
              />
            </details>
          ) : null}
        </section>
      )}

      {canUpdate && administrators.length > 0 ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Affectation</h2>
          </div>

          <RelationSelectForm
            action={assignAppointment}
            fields={{ appointmentId: appointment.id }}
            name="assignedTo"
            label="Affecté à"
            current={appointment.assigned_to ?? ''}
            options={[
              { value: '', label: 'Personne' },
              ...administrators.map((admin) => ({
                value: admin.userId,
                label: displayIdentity(admin.profile, null),
              })),
            ]}
            submitLabel="Enregistrer l’affectation"
          />
        </section>
      ) : null}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Historique</h2>
          <p>
            Le suivi métier, reprogrammations comprises (§ 57). Distinct du{' '}
            <Link href="/administration/journal/">journal d’activité</Link>.
          </p>
        </div>

        <ol className="admin-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <p className="admin-timeline__when">{formatMoment(event.created_at)}</p>
              <p className="admin-timeline__what">{describeAppointmentEvent(event)}</p>
              <p className="admin-timeline__who">{event.actor_label ?? 'Depuis le site public'}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Notes internes</h2>
          <p>Réservées aux comptes habilités. Le demandeur n’y a pas accès.</p>
        </div>

        {notes.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune note</p>
          </div>
        ) : (
          <ul className="admin-notes">
            {notes.map((note) => (
              <li key={note.id}>
                <p className="admin-longtext">{note.body}</p>
                <p className="admin-timeline__who">
                  {note.author_label ?? 'Compte supprimé'} — {formatMoment(note.created_at)}
                </p>
                {canUpdate ? (
                  <ConfirmForm
                    action={deleteRelationNote}
                    fields={{ noteId: note.id, appointmentId: appointment.id }}
                    trigger="Supprimer"
                    consequence="La note sera définitivement supprimée. Le journal d’activité en garde la trace."
                    confirmLabel="Supprimer la note"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canUpdate ? <RelationNoteForm appointmentId={appointment.id} /> : null}
      </section>
    </AdminPage>
  );
}

/** Libellé lisible d'un événement de rendez-vous. */
function describeAppointmentEvent(event: AppointmentEventRow): string {
  const label = (value: string | null) =>
    value
      ? (APPOINTMENT_STATUS_LABELS[value as keyof typeof APPOINTMENT_STATUS_LABELS] ?? value)
      : '—';

  switch (event.kind) {
    case 'CREATION':
      return 'Demande reçue depuis le site';
    case 'STATUT': {
      const base = `Statut : ${label(event.from_status)} → ${label(event.to_status)}`;
      return event.note ? `${base} — ${event.note}` : base;
    }
    case 'REPROGRAMMATION':
      return `Créneau déplacé : ${formatMoment(event.scheduled_at_before)} → ${formatMoment(event.scheduled_at_after)}`;
    case 'AFFECTATION':
      return 'Affectation modifiée';
    default:
      return 'Note';
  }
}

/** Même prudence que sur la fiche d'une demande : le JSONB n'est pas supposé conforme. */
function readDetails(value: Json): { label: string; value: string }[] {
  if (!Array.isArray(value)) return [];

  const rows: { label: string; value: string }[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, Json>;
    if (typeof record.label === 'string' && typeof record.value === 'string') {
      rows.push({ label: record.label, value: record.value });
    }
  }

  return rows;
}
