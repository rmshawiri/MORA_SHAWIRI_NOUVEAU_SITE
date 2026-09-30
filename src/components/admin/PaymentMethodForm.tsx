'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';

/**
 * Configuration d'un moyen de paiement.
 *
 * Ce formulaire est le seul endroit du site où une coordonnée de paiement se
 * saisit. Le § 19 interdit d'en inventer une ; la contrepartie est qu'il faut
 * un endroit pour saisir les vraies, et qu'il n'y en ait qu'un — sans quoi le
 * numéro Mvola finirait recopié dans trois composants.
 *
 * ## Ce qu'on ne peut pas saisir ici
 *
 * Aucun secret d'API. Le champ n'existe pas, et la table refuserait les clés
 * les plus courantes dans ses métadonnées (§ 192). Le jour où une passerelle
 * sera branchée, sa clé ira dans les variables d'environnement, pas dans une
 * ligne que tout client connecté peut lire.
 *
 * ## Le verrou sur l'activation
 *
 * Un moyen ne s'active pas sans instructions : le client doit savoir où et
 * comment payer. L'action le refuse, et la contrainte
 * `payment_methods_active_is_usable` le refuserait de toute façon. C'est le
 * § 194 — mieux vaut afficher une indisponibilité qu'une option muette.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function PaymentMethodForm({
  action,
  code,
  label,
  isActive,
  instructions,
  accountNumber,
  accountHolder,
  requiresProof,
  note,
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  code: string;
  label: string;
  isActive: boolean;
  instructions: string;
  accountNumber: string | null;
  accountHolder: string | null;
  requiresProof: boolean;
  /** Précision propre à ce moyen : Wakati non lancé, PayPal en attente… */
  note?: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      <input type="hidden" name="code" value={code} />

      <div className="admin-card__head">
        <h3>{label}</h3>
        <p>
          <code>{code}</code> ·{' '}
          {requiresProof
            ? 'Un justificatif ou une référence est demandé au client.'
            : 'Aucun justificatif n’est demandé au client ; la confirmation est administrative.'}
        </p>
        {note ? <p>{note}</p> : null}
      </div>

      <div className="admin-form__grid">
        <label className="admin-check">
          <input type="checkbox" name="actif" defaultChecked={isActive} />
          <span>
            Proposer ce moyen aux clients
            <small>Un moyen désactivé n’apparaît nulle part, et ne peut pas être utilisé.</small>
          </span>
        </label>

        <label className="admin-field">
          <span className="admin-field__label">Numéro ou compte</span>
          <input
            className="admin-input"
            type="text"
            name="numero"
            maxLength={64}
            defaultValue={accountNumber ?? ''}
            placeholder="Laissez vide si le moyen n’en utilise pas"
          />
        </label>

        <label className="admin-field">
          <span className="admin-field__label">Titulaire</span>
          <input
            className="admin-input"
            type="text"
            name="titulaire"
            maxLength={120}
            defaultValue={accountHolder ?? ''}
          />
        </label>
      </div>

      <label className="admin-field">
        <span className="admin-field__label">Instructions affichées au client</span>
        <textarea
          className="admin-input"
          name="instructions"
          rows={4}
          maxLength={2000}
          defaultValue={instructions}
          placeholder="Où payer, quoi transmettre, et sous quel délai la vérification a lieu."
        />
        <span className="admin-field__hint">
          Obligatoire pour activer le moyen. C’est ce texte que le client lit au moment de payer.
        </span>
      </label>

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();

  return (
    <div className="admin-actions">
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? 'Enregistrement…' : 'Enregistrer ce moyen'}
      </button>
    </div>
  );
}
