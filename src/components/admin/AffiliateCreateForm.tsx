'use client';

import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';

import AdminNotice from './AdminNotice';
import ConfirmDialog from './ConfirmDialog';
import type { AdminActionState } from '@/lib/admin/actions';
import { checkAffiliateEmail, createAffiliateAction, type AffiliateCheckState } from '@/lib/affiliation/creation-actions';

/**
 * « Ajouter un affilié » — correctif de clôture 4H.
 *
 * Deux temps. D'abord l'adresse : le serveur dit ce qui existe déjà (fiche
 * affilié, candidature en cours, compte, client). Une fiche ou une
 * candidature existante arrête l'ajout et y renvoie. Ensuite la fiche :
 * « Continuer » vérifie la saisie et ouvre un récapitulatif, dont le bouton
 * crée la fiche « en préparation ». Aucun compte n'est créé à ce stade.
 */

type Category = { id: string; label: string; internal: boolean };

const INITIAL_CHECK: AffiliateCheckState = { status: 'idle', message: '' };
const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function AffiliateCreateForm({ categories }: { categories: readonly Category[] }) {
  const [checkState, checkAction, checking] = useActionState(checkAffiliateEmail, INITIAL_CHECK);
  const [state, createAction] = useActionState(createAffiliateAction, INITIAL);
  const [editingEmail, setEditingEmail] = useState(true);
  const [recap, setRecap] = useState<Record<string, string> | null>(null);
  const [openedOn, setOpenedOn] = useState<AdminActionState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const check = checkState.status === 'ok' && !editingEmail ? checkState.check : undefined;
  const blocked = Boolean(check?.affiliate || check?.application);

  if (!check) {
    return (
      <form
        action={(formData) => {
          setEditingEmail(false);
          checkAction(formData);
        }}
        className="admin-form"
      >
        <AdminNotice state={checkState.status === 'error' ? checkState : INITIAL} />
        <label className="admin-field">
          <span className="admin-field__label">Adresse e-mail de l’affilié</span>
          <input
            className="admin-input"
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="off"
            defaultValue={checkState.check?.email ?? ''}
          />
          <span className="admin-field__hint">
            Elle identifie la personne : un compte existant à cette adresse sera retrouvé à l’activation, jamais dupliqué.
          </span>
        </label>
        <div className="admin-table__actions">
          <button className="btn btn--primary" type="submit" disabled={checking}>
            {checking ? 'Vérification…' : 'Vérifier l’adresse'}
          </button>
        </div>
      </form>
    );
  }

  const categoryLabel = (id: string) => categories.find((category) => category.id === id)?.label ?? '—';

  return (
    <div className="admin-form">
      <section aria-labelledby="ajout-adresse">
        <h3 id="ajout-adresse">Adresse : {check.email}</h3>
        {check.affiliate ? (
          <div className="admin-notice admin-notice--error" role="alert">
            <p>
              Une fiche affilié existe déjà pour cette personne
              {check.affiliate.reference ? ` (${check.affiliate.reference})` : ' (en préparation)'} : {check.affiliate.name}.{' '}
              <Link href={`/administration/affiliation/affilies/${check.affiliate.id}/`}>Ouvrir la fiche</Link>
            </p>
          </div>
        ) : check.application ? (
          <div className="admin-notice admin-notice--error" role="alert">
            <p>
              Une candidature est en cours pour cette adresse : traitez-la plutôt que de créer une seconde fiche.{' '}
              <Link href={`/administration/affiliation/candidatures/${check.application.id}/`}>Ouvrir la candidature</Link>
            </p>
          </div>
        ) : (
          <div className="admin-notice" role="status">
            <p>
              {check.account
                ? `Un compte existe déjà à cette adresse${check.client ? ' (client de MORA Shawiri)' : ''}. Il sera retrouvé et réutilisé à l’activation : aucun second compte, et l’espace affilié s’ajoutera à son accès actuel.`
                : 'Aucun compte à cette adresse. Il sera créé à l’activation, et la personne choisira son mot de passe par l’e-mail d’activation.'}
            </p>
          </div>
        )}
        <div className="admin-table__actions">
          <button className="btn btn--ghost" type="button" onClick={() => setEditingEmail(true)}>
            Changer d’adresse
          </button>
        </div>
      </section>

      {blocked ? null : (
        <form ref={formRef} action={createAction} className="admin-form">
          <AdminNotice state={state} />
          <input type="hidden" name="email" value={check.email} />

          <div className="admin-form__grid">
            <label className="admin-field">
              <span className="admin-field__label">Nom affiché</span>
              <input className="admin-input" name="display_name" required minLength={2} maxLength={120} />
            </label>
            <label className="admin-field">
              <span className="admin-field__label">Nature</span>
              <select className="admin-input" name="party_type" defaultValue="PERSONNE">
                <option value="PERSONNE">Personne</option>
                <option value="ORGANISATION">Organisation</option>
              </select>
            </label>
          </div>
          <div className="admin-form__grid">
            <label className="admin-field">
              <span className="admin-field__label">Raison sociale (facultatif)</span>
              <input className="admin-input" name="legal_name" maxLength={160} />
            </label>
            <label className="admin-field">
              <span className="admin-field__label">WhatsApp / téléphone (facultatif)</span>
              <input className="admin-input" type="tel" name="contact_phone" maxLength={40} inputMode="tel" />
            </label>
          </div>
          <div className="admin-form__grid">
            <label className="admin-field">
              <span className="admin-field__label">Ville (facultatif)</span>
              <input className="admin-input" name="city" maxLength={80} />
            </label>
            <label className="admin-field">
              <span className="admin-field__label">Pays (facultatif)</span>
              <input className="admin-input" name="country" maxLength={80} />
            </label>
          </div>
          <label className="admin-field">
            <span className="admin-field__label">Catégorie</span>
            <select className="admin-input" name="category_id" required defaultValue="">
              <option value="" disabled>
                Choisir…
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                  {category.internal ? ' (interne)' : ''}
                </option>
              ))}
            </select>
            <span className="admin-field__hint">Les conditions, règles et dérogations se règlent ensuite sur la fiche.</span>
          </label>
          <div className="admin-form__grid">
            <label className="admin-field">
              <span className="admin-field__label">Référence de convention (facultatif)</span>
              <input className="admin-input" name="contract_reference" maxLength={80} />
            </label>
            <label className="admin-field">
              <span className="admin-field__label">Signée le (facultatif)</span>
              <input className="admin-input" type="date" name="contract_signed_on" />
            </label>
          </div>
          <label className="admin-field">
            <span className="admin-field__label">Motif (facultatif)</span>
            <textarea className="admin-input admin-input--area" name="reason" rows={2} maxLength={1000} />
            <span className="admin-field__hint">Il rejoint l’historique de la fiche, avec votre nom et la date.</span>
          </label>

          <div className="admin-table__actions">
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => {
                const form = formRef.current;
                if (!form?.reportValidity()) return;
                const data = new FormData(form);
                setRecap(Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value).trim()])));
                setOpenedOn(state);
              }}
            >
              Continuer
            </button>
          </div>

          <ConfirmDialog
            open={openedOn === state && recap !== null}
            onClose={() => setOpenedOn(null)}
            title="Créer cette fiche affilié ?"
            confirmLabel="Créer la fiche"
            variant="gold"
          >
            {recap ? (
              <>
                <dl className="admin-def">
                  <dt>Nom</dt>
                  <dd>{recap.display_name}</dd>
                  <dt>Nature</dt>
                  <dd>{recap.party_type === 'ORGANISATION' ? 'Organisation' : 'Personne'}</dd>
                  <dt>E-mail</dt>
                  <dd>{check.email}</dd>
                  <dt>Catégorie</dt>
                  <dd>{categoryLabel(recap.category_id ?? '')}</dd>
                  {recap.contract_reference ? (
                    <>
                      <dt>Convention</dt>
                      <dd>{recap.contract_reference}</dd>
                    </>
                  ) : null}
                </dl>
                <p>
                  La fiche est créée en préparation, sans compte ni référence : la catégorie, les règles, les
                  coordonnées de versement et l’activation se règlent ensuite, comme pour une candidature acceptée.
                  {check.account ? ' À l’activation, le compte existant sera réutilisé.' : ' À l’activation, un compte sera créé.'}
                </p>
              </>
            ) : null}
          </ConfirmDialog>
        </form>
      )}
    </div>
  );
}
