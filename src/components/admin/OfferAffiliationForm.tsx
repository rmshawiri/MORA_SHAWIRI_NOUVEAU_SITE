'use client';

import { useActionState, useRef, useState } from 'react';

import AdminNotice from './AdminNotice';
import ConfirmDialog from './ConfirmDialog';
import type { AdminActionState } from '@/lib/admin/actions';
import { setOfferAffiliationAction } from '@/lib/catalogue/affiliation-actions';
import { affiliationChange, affiliationConsequence, formatRate, parseRate } from '@/lib/catalogue/affiliation';

/**
 * Éligibilité d'une offre à l'affiliation et plafond de commission —
 * correctif de clôture 4H.
 *
 * Une case et un pourcentage. « Enregistrer » vérifie la saisie, puis ouvre
 * la fenêtre de confirmation, dont le texte dépend du changement : rendre
 * affiliable, ne plus l'être, ou changer le plafond. Elle dit chaque fois que
 * seules les ventes à venir sont concernées.
 *
 * `compact` : la même chose sur une ligne, pour la liste des produits.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function OfferAffiliationForm({
  type,
  offerId,
  title,
  published,
  eligible,
  maxRate,
  compact = false,
}: {
  type: 'SERVICE' | 'PRODUCT';
  offerId: string;
  title: string;
  published: boolean;
  eligible: boolean;
  maxRate: string | null;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(setOfferAffiliationAction, INITIAL);
  const [checked, setChecked] = useState(eligible);
  const [rate, setRate] = useState(maxRate === null ? '' : String(Number(maxRate)).replace('.', ','));
  const [error, setError] = useState('');
  const [openedOn, setOpenedOn] = useState<AdminActionState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const stored = maxRate === null ? null : Number(maxRate);
  const parsed = parseRate(rate);
  const after = typeof parsed === 'number' ? parsed : null;
  const change = affiliationChange({ eligible, rate: stored }, { eligible: checked, rate: checked ? after : stored });
  const consequence = affiliationConsequence(change, title, stored, after, published);
  const confirming = openedOn === state && change !== 'AUCUN';

  const review = () => {
    setError('');
    if (parsed === 'invalide') return setError('Le plafond est un pourcentage supérieur à 0 et au plus égal à 100, deux décimales au plus.');
    if (checked && parsed === null) return setError('Une offre éligible à l’affiliation doit porter un plafond de commission.');
    if (change === 'AUCUN') return setError('Aucun changement à enregistrer.');
    setOpenedOn(state);
  };

  const id = (suffix: string) => `aff-${offerId}-${suffix}`;

  return (
    <form ref={formRef} action={formAction} className={compact ? 'admin-offer-aff admin-offer-aff--compact' : 'admin-form admin-offer-aff'}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="offre" value={offerId} />
      <input type="hidden" name="eligible" value={checked ? '1' : '0'} />
      {state.status !== 'idle' ? <AdminNotice state={state} /> : null}

      <label className="admin-check" htmlFor={id('eligible')}>
        <input
          id={id('eligible')}
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          aria-describedby={compact ? undefined : id('aide')}
        />
        <span>
          Éligible au programme d’affiliation
          {compact ? null : (
            <small id={id('aide')}>
              Indépendant de la publication. Sans éligibilité, aucune vente de cette offre ne produit de commission.
            </small>
          )}
        </span>
      </label>

      <label className="admin-field" htmlFor={id('plafond')}>
        <span className="admin-field__label">Plafond de commission (%)</span>
        <input
          id={id('plafond')}
          className="admin-input"
          name="plafond"
          inputMode="decimal"
          maxLength={6}
          value={rate}
          disabled={!checked}
          required={checked}
          placeholder="Ex. 10"
          onChange={(event) => setRate(event.target.value)}
        />
        {compact ? null : (
          <span className="admin-field__hint">
            Taux maximal qu’une règle peut appliquer à cette offre ; une règle individuelle en dérogation contractuelle n’y est pas soumise.
          </span>
        )}
      </label>
      {/* Un champ désactivé n'est pas envoyé : le plafond conservé l'est par la base. */}

      {error ? <AdminNotice state={{ status: 'error', message: error }} /> : null}

      <div className="admin-table__actions">
        <button className="btn btn--primary" type="button" onClick={review} disabled={pending}>
          {compact ? 'Enregistrer' : 'Enregistrer l’affiliation'}
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setOpenedOn(null)}
        title={
          change === 'ACTIVATION'
            ? 'Rendre cette offre affiliable ?'
            : change === 'DESACTIVATION'
              ? 'Retirer cette offre de l’affiliation ?'
              : `Plafond à ${formatRate(after)} ?`
        }
        confirmLabel={change === 'DESACTIVATION' ? 'Retirer de l’affiliation' : 'Confirmer'}
        variant={change === 'DESACTIVATION' ? 'danger' : 'primary'}
      >
        <p>{consequence}</p>
      </ConfirmDialog>
    </form>
  );
}
