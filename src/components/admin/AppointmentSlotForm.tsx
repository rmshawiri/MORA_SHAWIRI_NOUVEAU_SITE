'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { confirmAppointment, rescheduleAppointment } from '@/lib/relation/actions';

/**
 * Créneau ferme d'un rendez-vous — confirmation et reprogrammation.
 *
 * ## Pourquoi un début et une fin, et non une durée
 *
 * Le § 25 interdit d'inventer une durée : « la durée exacte doit être
 * configurée par MORA Shawiri », et elle ne l'est pas. Proposer « 30 minutes »
 * par défaut reviendrait à décider à sa place. L'administrateur donne donc les
 * deux bornes, qu'il connaît, et rien n'est supposé.
 *
 * Le jour où des durées par type seront configurées (§ 27), la fin pourra s'en
 * déduire. La colonne et la contrainte sont déjà là pour l'accueillir.
 *
 * ## Les heures sont celles de Moroni
 *
 * Une entrée `datetime-local` ne porte aucun fuseau : « 09:00 » est neuf
 * heures quelque part. Le § 34 exige d'éviter l'ambiguïté, donc l'action
 * serveur interprète la valeur dans le fuseau du site — celui de la montre de
 * l'administrateur, et celui qu'il annoncera au client.
 *
 * ## Le chevauchement n'est pas vérifié ici
 *
 * Il ne peut pas l'être honnêtement : entre une vérification faite dans le
 * navigateur et l'écriture, un autre rendez-vous peut être confirmé. C'est
 * exactement le § 32 — revérifier « au moment de la confirmation définitive ».
 * La contrainte d'exclusion de la base refuse le chevauchement sans laisser
 * cette fenêtre, et le message du § 33 remonte de son refus.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function AppointmentSlotForm({
  appointmentId,
  mode,
  start,
  end,
  suggestedDate,
}: {
  appointmentId: string;
  mode: 'confirmation' | 'reprogrammation';
  /** Créneau actuel, pour une reprogrammation. */
  start?: string;
  end?: string;
  /**
   * Date souhaitée par le visiteur, proposée comme point de départ.
   *
   * C'est son souhait, pas une disponibilité : le formulaire public annonce
   * lui-même qu'une alternative peut être proposée. Aucune heure n'est
   * préremplie — il n'y en a aucune à supposer.
   */
  suggestedDate?: string;
}) {
  const action = mode === 'confirmation' ? confirmAppointment : rescheduleAppointment;
  const [state, formAction] = useActionState(action, INITIAL);

  const defaultStart = start ?? (suggestedDate ? `${suggestedDate}T` : '');

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      <input type="hidden" name="appointmentId" value={appointmentId} />

      <div className="admin-form__grid">
        <label className="admin-field">
          <span className="admin-field__label">
            Début<abbr title="obligatoire"> *</abbr>
          </span>
          <input
            className="admin-input"
            type="datetime-local"
            name="start"
            defaultValue={defaultStart.endsWith('T') ? '' : defaultStart}
            required
          />
          <span className="admin-field__hint">Heure de Moroni.</span>
        </label>

        <label className="admin-field">
          <span className="admin-field__label">
            Fin<abbr title="obligatoire"> *</abbr>
          </span>
          <input
            className="admin-input"
            type="datetime-local"
            name="end"
            defaultValue={end ?? ''}
            required
          />
          <span className="admin-field__hint">
            À vous de la fixer : aucune durée de rendez-vous n’est configurée, et en supposer une
            serait l’inventer.
          </span>
        </label>
      </div>

      <Submit
        label={
          mode === 'confirmation' ? 'Confirmer le rendez-vous' : 'Déplacer le rendez-vous'
        }
      />
    </form>
  );
}

/** Le § 97 et le § 99 demandent d'empêcher les doubles soumissions. */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <div className="admin-actions">
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? 'Enregistrement…' : label}
      </button>
    </div>
  );
}
