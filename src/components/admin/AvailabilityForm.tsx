'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { createAvailability } from '@/lib/relation/actions';
import { AVAILABILITY_KIND_LABELS, WEEKDAY_LABELS } from '@/lib/relation/labels';
import type { AvailabilityKind } from '@/lib/supabase/types';

/**
 * Déclaration d'une disponibilité (§ 85-88).
 *
 * ## Rien n'est prérempli, et c'est le sujet
 *
 * Ni jour ouvré, ni plage horaire, ni jour férié. Le § 86 l'interdit — « ne
 * pas inventer automatiquement les jours non disponibles » — et les horaires
 * réels de MORA Shawiri ne sont pas arrêtés. Un formulaire qui proposerait
 * « Lundi 08:00-17:00 » présenterait une supposition comme une donnée.
 *
 * Tant que rien n'est déclaré, aucun créneau n'est refusé à la confirmation :
 * la fonction `appointment_slot_is_open` répond vrai quand la table est vide.
 * C'est la différence entre « on ne sait pas » et « c'est fermé ».
 *
 * ## Trois natures, trois formes
 *
 * Le champ visible change avec la nature choisie, parce que les trois ne
 * décrivent pas la même chose :
 *
 *   * une **ouverture** se répète : un jour de semaine et des horaires ;
 *   * une **ouverture exceptionnelle** vise une date (le samedi du § 88) ;
 *   * une **indisponibilité** vise une date, et couvre la journée entière si
 *     on ne donne pas d'horaires (§ 87).
 *
 * Le masquage est un confort. Les trois formes sont vérifiées par l'action
 * serveur, et par trois contraintes de base qu'un appel direct ne contourne
 * pas davantage.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

const KINDS: readonly AvailabilityKind[] = ['OUVERTURE', 'EXCEPTION', 'BLOCAGE'];

export default function AvailabilityForm() {
  const [state, formAction] = useActionState(createAvailability, INITIAL);
  const [kind, setKind] = useState<AvailabilityKind>('OUVERTURE');

  const recurring = kind === 'OUVERTURE';
  const hoursRequired = kind !== 'BLOCAGE';

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      <div className="admin-form__grid">
        <label className="admin-field">
          <span className="admin-field__label">Nature</span>
          <select
            className="admin-input"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as AvailabilityKind)}
          >
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {AVAILABILITY_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        {recurring ? (
          <label className="admin-field">
            <span className="admin-field__label">
              Jour de la semaine<abbr title="obligatoire"> *</abbr>
            </span>
            <select className="admin-input" name="weekday" defaultValue="1" required>
              {WEEKDAY_LABELS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="admin-field">
            <span className="admin-field__label">
              Date<abbr title="obligatoire"> *</abbr>
            </span>
            <input className="admin-input" type="date" name="onDate" required />
          </label>
        )}

        <label className="admin-field">
          <span className="admin-field__label">
            De{hoursRequired ? <abbr title="obligatoire"> *</abbr> : null}
          </span>
          <input
            className="admin-input"
            type="time"
            name="startsAt"
            required={hoursRequired}
          />
        </label>

        <label className="admin-field">
          <span className="admin-field__label">
            À{hoursRequired ? <abbr title="obligatoire"> *</abbr> : null}
          </span>
          <input className="admin-input" type="time" name="endsAt" required={hoursRequired} />
          {kind === 'BLOCAGE' ? (
            <span className="admin-field__hint">
              Laissez les deux horaires vides pour bloquer la journée entière.
            </span>
          ) : null}
        </label>

        <label className="admin-field">
          <span className="admin-field__label">Intitulé</span>
          <input
            className="admin-input"
            type="text"
            name="label"
            maxLength={120}
            placeholder={kind === 'BLOCAGE' ? 'Congé, déplacement, réunion…' : 'Matinée, après-midi…'}
          />
          <span className="admin-field__hint">Facultatif. Sert à vous relire.</span>
        </label>
      </div>

      <Submit />
    </form>
  );
}

/** Le § 97 demande d'empêcher les doubles soumissions. */
function Submit() {
  const { pending } = useFormStatus();

  return (
    <div className="admin-actions">
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? 'Enregistrement…' : 'Ajouter la disponibilité'}
      </button>
    </div>
  );
}
