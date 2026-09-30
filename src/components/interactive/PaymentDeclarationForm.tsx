'use client';

import { useActionState, useState } from 'react';

import SubmitButton from '@/components/auth/SubmitButton';
import type { AdminActionState } from '@/lib/admin/actions';
import type { ActivePaymentMethod } from '@/lib/commerce/client';
import { PROOF_MAX_BYTES, PROOF_MIME_TYPES } from '@/lib/commerce/labels';

/**
 * Déclaration de paiement, côté client.
 *
 * C'est la seule porte par laquelle un client pose un acte financier, et elle
 * ne confirme rien : le texte le dit, la base le garantit. Ce que le client
 * envoie devient une déclaration « en vérification », que MORA Shawiri
 * examine. D-10, vue depuis l'écran.
 *
 * ## Le formulaire s'adapte au moyen choisi
 *
 * Le § 17 demande une référence **ou** un reçu selon le moyen ; le point 10 du
 * cadrage interdit de forcer le même parcours pour tous. Choisir « espèces »
 * ne réclame donc ni référence ni fichier, tandis que Mvola demande la
 * référence reçue par SMS. Les instructions affichées sont celles que
 * l'administration a saisies pour ce moyen — jamais un numéro écrit dans ce
 * composant.
 *
 * Le contrôle côté navigateur ne protège rien : il évite un aller-retour
 * inutile. Le refus qui compte vient de `declare_payment`, du bucket et de la
 * RLS.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function PaymentDeclarationForm({
  action,
  orderId,
  methods,
  suggestedAmount,
  currency,
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  orderId: string;
  methods: readonly ActivePaymentMethod[];
  suggestedAmount: string;
  currency: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [selected, setSelected] = useState(methods[0]?.code ?? '');

  if (methods.length === 0) {
    return (
      <div className="auth-notice auth-notice--warn">
        <p>
          Aucun moyen de paiement n’est disponible en ligne pour le moment. Contactez MORA Shawiri
          pour convenir des modalités de règlement.
        </p>
      </div>
    );
  }

  // `methods[0]` existe : le cas de la liste vide est traité juste au-dessus.
  // TypeScript ne le déduit pas, d'où le repli explicite.
  const method = methods.find((entry) => entry.code === selected) ?? methods[0]!;

  if (state.status === 'ok') {
    return (
      <div className="auth-notice auth-notice--ok" role="status">
        <p>{state.message}</p>
      </div>
    );
  }

  return (
    <form className="form" action={formAction}>
      {state.status === 'error' ? (
        <div className="form-alert" role="alert">
          <strong>Votre déclaration n’a pas abouti.</strong>
          <span>{state.message}</span>
        </div>
      ) : null}

      <input type="hidden" name="commande" value={orderId} />

      <div className="field">
        <label htmlFor="moyen">
          Comment avez-vous payé&nbsp;?{' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <select
          id="moyen"
          name="moyen"
          required
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {methods.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      {method.instructions ? (
        <div className="auth-notice">
          <p>{method.instructions}</p>
          {method.account_number ? (
            <p>
              <strong>{method.account_number}</strong>
              {method.account_holder ? ` — ${method.account_holder}` : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="montant">
          Montant réglé ({currency}){' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="montant"
          name="montant"
          type="text"
          inputMode="decimal"
          required
          defaultValue={suggestedAmount}
        />
        <p className="field__hint">
          Indiquez ce que vous avez réellement envoyé, même s’il s’agit d’un règlement partiel.
        </p>
      </div>

      {method.requires_proof ? (
        <>
          <div className="field">
            <label htmlFor="reference">
              Référence de la transaction{' '}
              <span className="req" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="reference"
              name="reference"
              type="text"
              required
              minLength={3}
              maxLength={120}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="field__hint">
              Elle figure dans le message que votre opérateur vous a envoyé après le paiement.
            </p>
          </div>

          <div className="field">
            <label htmlFor="justificatif">Reçu ou capture d’écran</label>
            <input
              id="justificatif"
              name="justificatif"
              type="file"
              accept={PROOF_MIME_TYPES.join(',')}
            />
            <p className="field__hint">
              Facultatif mais utile : JPEG, PNG, WebP ou PDF, {Math.round(PROOF_MAX_BYTES / 1048576)}
              &nbsp;Mo au maximum. Votre reçu reste privé — seule MORA Shawiri peut le consulter.
            </p>
          </div>
        </>
      ) : (
        <div className="field">
          <label htmlFor="note">Précision (facultatif)</label>
          <textarea id="note" name="note" rows={3} maxLength={1000} />
          <p className="field__hint">
            Ce moyen ne demande aucun justificatif : MORA Shawiri confirmera le règlement après
            l’avoir constaté.
          </p>
        </div>
      )}

      <SubmitButton label="Déclarer mon paiement" pendingLabel="Enregistrement…" />

      <p className="field__hint">
        Votre déclaration est enregistrée puis vérifiée par MORA Shawiri. Elle ne vaut pas
        confirmation : votre commande sera marquée comme réglée une fois le paiement vérifié.
      </p>
    </form>
  );
}
