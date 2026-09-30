'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { addRelationNote } from '@/lib/relation/actions';

/**
 * Note interne sur une demande ou un rendez-vous (§ 60, § 75).
 *
 * ## L'auteur n'est pas dans ce formulaire
 *
 * Aucun champ ne le porte, et ce n'est pas un oubli : un déclencheur l'impose
 * depuis `auth.uid()` et écrase ce que le navigateur aurait pu envoyer. Le
 * point 9 du cadrage l'exige — « l'auteur d'une note » figure parmi les
 * valeurs qui ne doivent jamais venir du client.
 *
 * ## Interne veut dire interne
 *
 * Aucune politique RLS n'ouvre `relation_notes` au demandeur. Ce qui est écrit
 * ici ne lui sera pas montré, et c'est une propriété de la base, pas une
 * promesse de l'interface.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function RelationNoteForm({
  reference,
  appointmentId,
}: {
  /** Référence de la demande, pour une note sur une demande. */
  reference?: string;
  /** Identifiant du rendez-vous, pour une note sur un rendez-vous. */
  appointmentId?: string;
}) {
  const [state, formAction] = useActionState(addRelationNote, INITIAL);

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      <input type="hidden" name="reference" value={reference ?? ''} />
      <input type="hidden" name="appointmentId" value={appointmentId ?? ''} />

      <label className="admin-field">
        <span className="admin-field__label">Nouvelle note interne</span>
        <textarea
          className="admin-input admin-input--area"
          name="body"
          rows={4}
          maxLength={4000}
          required
          placeholder="Ce qu’il faut savoir avant de rappeler, ce qui a été dit, ce qui reste à vérifier."
        />
        <span className="admin-field__hint">
          Visible des seuls comptes habilités. Le demandeur n’y a pas accès.
        </span>
      </label>

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
        {pending ? 'Enregistrement…' : 'Ajouter la note'}
      </button>
    </div>
  );
}
