'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { addClientNoteAction } from '@/lib/clients/actions';

/**
 * Note interne sur un client (phase 4I-4) — même forme que les notes des
 * demandes et rendez-vous.
 *
 * Ajout seul : une note ne se modifie pas et ne se supprime pas. Pour
 * corriger, on écrit une nouvelle note qui désigne celle qu'elle corrige —
 * l'ancienne reste lisible. L'auteur n'est pas dans ce formulaire : la base
 * l'impose depuis la session. Aucune politique n'ouvre ces notes au client.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function ClientNoteForm({
  userId,
  reference,
  corrects,
}: {
  userId: string;
  reference: string;
  /** Note corrigée, pour une correction traçable. */
  corrects?: { id: string; label: string };
}) {
  const [state, formAction] = useActionState(addClientNoteAction, INITIAL);

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />
      <input type="hidden" name="client" value={userId} />
      <input type="hidden" name="reference" value={reference} />
      {corrects ? <input type="hidden" name="corrige" value={corrects.id} /> : null}

      <label className="admin-field">
        <span className="admin-field__label">{corrects ? `Correction de la note du ${corrects.label}` : 'Nouvelle note interne'}</span>
        <textarea
          className="admin-input admin-input--area"
          name="note"
          rows={corrects ? 3 : 4}
          maxLength={4000}
          required
          placeholder="Contexte commercial, préférence exprimée, information à connaître avant de recontacter."
        />
        <span className="admin-field__hint">
          {corrects
            ? 'La note d’origine reste lisible : la correction s’y rattache, avec votre nom et la date.'
            : 'Visible des seuls comptes habilités, jamais du client. Ni modifiable ni supprimable : corrigez-la par une nouvelle note.'}
        </span>
      </label>

      <Submit corrects={Boolean(corrects)} />
    </form>
  );
}

function Submit({ corrects }: { corrects: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="admin-actions">
      <button className={`btn ${corrects ? 'btn--ghost' : 'btn--primary'}`} type="submit" disabled={pending}>
        {pending ? 'Enregistrement…' : corrects ? 'Ajouter la correction' : 'Ajouter la note'}
      </button>
    </div>
  );
}
