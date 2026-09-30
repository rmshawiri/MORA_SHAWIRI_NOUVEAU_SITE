'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { createQuoteDraft } from '@/lib/relation/actions';

/**
 * Création d'un devis à partir d'une demande (§ 40 du tableau de bord).
 *
 * ## Toujours un brouillon
 *
 * Aucun champ de statut : un devis est créé en brouillon, et l'émission est un
 * second geste, sous `quotes.manage`. Créer directement un devis envoyé ferait
 * de la création une émission déguisée, que `quotes.create` suffirait à
 * obtenir — c'est la même règle que « publier n'est pas modifier » en 4E.
 *
 * Tant qu'il est en brouillon, le devis ne consomme **aucun numéro** et le
 * client ne le voit pas : la politique `quotes_select_own` exclut les
 * brouillons, comme le § 27 de l'espace client le demande.
 *
 * ## La validité reste vide
 *
 * Le § 134 est formel : « si le système prévoit une durée de validité des
 * devis, celle-ci doit être configurée officiellement. Ne pas inventer de
 * délai. » Aucune durée n'est décidée, donc aucune n'est proposée par défaut.
 * Le champ existe pour une date choisie au cas par cas, et rien ne l'exige.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function QuoteDraftForm({
  reference,
  currency,
}: {
  reference: string;
  /** Devise du site, lue en base. Affichée, non modifiable ici. */
  currency: string;
}) {
  const [state, formAction] = useActionState(createQuoteDraft, INITIAL);

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      <input type="hidden" name="reference" value={reference} />

      <div className="admin-form__grid">
        <label className="admin-field">
          <span className="admin-field__label">
            Montant proposé<abbr title="obligatoire"> *</abbr>
          </span>
          <input
            className="admin-input"
            type="text"
            name="amount"
            inputMode="decimal"
            required
            placeholder="150000"
          />
          <span className="admin-field__hint">
            En {currency}. La virgule est acceptée. Ce montant est figé au devis et ne suit pas
            une évolution ultérieure du catalogue.
          </span>
        </label>

        <label className="admin-field">
          <span className="admin-field__label">
            Ce que couvre le devis<abbr title="obligatoire"> *</abbr>
          </span>
          <textarea
            className="admin-input admin-input--area"
            name="summary"
            rows={5}
            maxLength={2000}
            required
            placeholder="Périmètre, livrables, ce qui est inclus et ce qui ne l’est pas."
          />
        </label>

        <label className="admin-field">
          <span className="admin-field__label">Valable jusqu’au</span>
          <input className="admin-input" type="date" name="validUntil" />
          <span className="admin-field__hint">
            Facultatif. Laissé vide, le devis n’expire pas : aucune durée de validité n’est
            officiellement définie, et le § 134 interdit d’en inventer une.
          </span>
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
        {pending ? 'Création…' : 'Créer le devis en brouillon'}
      </button>
    </div>
  );
}
