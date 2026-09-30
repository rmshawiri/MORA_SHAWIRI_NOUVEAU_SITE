import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import AvailabilityForm from '@/components/admin/AvailabilityForm';
import ConfirmForm from '@/components/admin/ConfirmForm';
import { requireModule } from '@/lib/rbac/guards';
import { deleteAvailability } from '@/lib/relation/actions';
import {
  APPOINTMENT_CHANNEL_LABELS,
  APPOINTMENT_STATUS_LABELS,
  AVAILABILITY_KIND_LABELS,
  countAppointmentsByStatus,
  formatDay,
  formatRange,
  formatSlot,
  listAppointments,
  listAvailabilities,
  WEEKDAY_LABELS,
} from '@/lib/relation/admin';
import type { AppointmentStatus } from '@/lib/supabase/types';

export const metadata: Metadata = {
  title: 'Rendez-vous',
  robots: { index: false, follow: false },
};

/**
 * Module « Rendez-vous » — phase 4F.
 *
 * Ouvre sous `appointments.view`. Les autres droits gouvernent les actes :
 *
 *   * `appointments.update` confirme, déplace, clôt et affecte ;
 *   * `appointments.cancel` annule — un acte distinct, avec sa permission ;
 *   * `appointments.manage` administre les disponibilités.
 *
 * ## Ce que ce module n'est pas
 *
 * Ce n'est pas un calendrier public. La décision A3 du propriétaire est
 * explicite : le formulaire de prise de rendez-vous reste celui qui a été
 * validé — le visiteur exprime une date souhaitée et une préférence de
 * demi-journée, pas un créneau. Le § 23 interdit d'ailleurs de « créer un
 * calendrier visuel contenant des créneaux fictifs simplement pour donner
 * l'impression que la fonctionnalité fonctionne ».
 *
 * Le créneau ferme est décidé ici, à la confirmation. C'est là qu'un créneau
 * est réellement pris, et là que la double réservation est rendue impossible —
 * par une contrainte d'exclusion, pas par une vérification applicative.
 *
 * ## Les disponibilités sont vides, et le disent
 *
 * Aucun horaire n'est proposé par défaut : le § 86 interdit d'inventer les
 * jours non disponibles, et les horaires réels de MORA Shawiri ne sont pas
 * arrêtés. Tant que rien n'est déclaré, aucun créneau n'est refusé.
 */
export default async function RendezVousPage() {
  const context = await requireModule('rendez-vous');

  const canManage = context.can('appointments.manage');

  const [appointments, availabilities] = await Promise.all([
    listAppointments(),
    canManage || context.can('appointments.view')
      ? listAvailabilities()
      : Promise.resolve([]),
  ]);

  const counts = countAppointmentsByStatus(appointments);

  return (
    <AdminPage
      eyebrow="Activité"
      title="Rendez-vous"
      lead="Les demandes de rendez-vous reçues depuis le site, les créneaux confirmés et les disponibilités déclarées. Toutes les heures sont celles de Moroni."
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Demandes et rendez-vous</h2>
          <p>
            {appointments.length} au total : {counts.EN_ATTENTE} en attente de confirmation,{' '}
            {counts.CONFIRME} confirmé(s), {counts.TERMINE} terminé(s), {counts.ANNULE} annulé(s).
            Les demandes en attente apparaissent en premier, la plus ancienne d’abord.
          </p>
        </div>

        {appointments.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun rendez-vous enregistré</p>
            <p>
              C’est l’état réel de la base. Les demandes envoyées depuis la page de prise de
              rendez-vous apparaissent ici dès leur réception.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">
                Rendez-vous, les demandes en attente en premier
              </caption>
              <thead>
                <tr>
                  <th scope="col">Référence</th>
                  <th scope="col">Demandeur</th>
                  <th scope="col">Sujet</th>
                  <th scope="col">Canal</th>
                  <th scope="col">Souhait</th>
                  <th scope="col">Créneau confirmé</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      {entry.reference ? (
                        <code>{entry.reference}</code>
                      ) : (
                        <span className="admin-field__hint">Sans numéro</span>
                      )}
                    </th>
                    <td>{entry.leads?.full_name ?? '—'}</td>
                    <td>{entry.subject}</td>
                    <td>{APPOINTMENT_CHANNEL_LABELS[entry.channel]}</td>
                    <td>
                      {formatDay(entry.requested_date)}
                      {entry.requested_slot ? (
                        <>
                          <br />
                          <span className="admin-field__hint">{entry.requested_slot}</span>
                        </>
                      ) : null}
                    </td>
                    <td>{formatSlot(entry.scheduled_at, entry.scheduled_end)}</td>
                    <td>{statusBadge(entry.status)}</td>
                    <td>
                      <Link
                        className="btn btn--ghost"
                        href={`/administration/rendez-vous/${entry.id}/`}
                      >
                        Ouvrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Disponibilités</h2>
          <p>
            Vos jours et horaires. Tant que rien n’est déclaré ici, aucun créneau n’est refusé à la
            confirmation : le système ne suppose ni jour ouvré, ni horaire d’ouverture. Dès qu’une
            ouverture est déclarée, un créneau qui sort des plages déclarées est refusé.
          </p>
        </div>

        {availabilities.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune disponibilité déclarée</p>
            <p>
              Ce n’est pas un écran en attente : la table est réellement vide. Les horaires affichés
              ailleurs sur le site n’ont jamais été confirmés comme règle de réservation, et les
              reprendre ici d’office en ferait une donnée inventée.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Nature</th>
                  <th scope="col">Quand</th>
                  <th scope="col">Horaires</th>
                  <th scope="col">Intitulé</th>
                  {canManage ? <th scope="col">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {availabilities.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">{AVAILABILITY_KIND_LABELS[entry.kind]}</th>
                    <td>
                      {entry.kind === 'OUVERTURE'
                        ? (WEEKDAY_LABELS[entry.weekday ?? 0] ?? '—')
                        : formatDay(entry.on_date)}
                    </td>
                    <td>{formatRange(entry.starts_at, entry.ends_at)}</td>
                    <td>{entry.label ?? '—'}</td>
                    {canManage ? (
                      <td>
                        <ConfirmForm
                          action={deleteAvailability}
                          fields={{ availabilityId: entry.id }}
                          trigger="Retirer"
                          consequence="Cette plage sera supprimée. Les rendez-vous déjà confirmés ne bougent pas : ils portent leur propre créneau."
                          confirmLabel="Retirer la plage"
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManage ? (
          <div className="admin-card__foot">
            <h3>Déclarer une disponibilité</h3>
            <AvailabilityForm />
          </div>
        ) : (
          <div className="admin-notice">
            <p>
              La permission <code>appointments.manage</code> est nécessaire pour modifier les
              disponibilités.
            </p>
          </div>
        )}
      </section>
    </AdminPage>
  );
}

function statusBadge(status: AppointmentStatus) {
  const className =
    status === 'CONFIRME'
      ? 'admin-badge--ok'
      : status === 'EN_ATTENTE'
        ? 'admin-badge--gold'
        : status === 'ANNULE'
          ? 'admin-badge--danger'
          : 'admin-badge--muted';

  return <span className={`admin-badge ${className}`}>{APPOINTMENT_STATUS_LABELS[status]}</span>;
}
