'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { enregistrerBlocBrouillon } from '@/lib/contenus/actions';

/**
 * Formulaire d'un bloc éditorial.
 *
 * ## Ce formulaire n'a aucun bouton de publication, et c'est le point essentiel
 *
 * Il enregistre un **brouillon**, rien d'autre. Le § 61 fait de la publication
 * « une action explicite », et le point 13 du cadrage exige qu'un compte doté de
 * `content.update` seul ne puisse pas mettre un texte en ligne. Les boutons de
 * publication vivent donc sur la fiche, sous leur propre permission — et le
 * refus est prononcé par la base, pas par l'absence du bouton.
 *
 * ## Les champs dépendent de la nature du bloc
 *
 * Un bandeau d'ouverture porte un sur-titre, un titre, un chapô et trois
 * preuves ; un en-tête de section n'a pas de preuves et son chapô est
 * facultatif ; un bandeau d'appel à l'action porte un texte et un message
 * WhatsApp. Afficher les champs inutiles ferait croire qu'ils ont un effet.
 *
 * `required` et `maxLength` évitent un aller-retour ; ils ne protègent rien.
 * `src/lib/contenus/actions.ts` et `validation.ts` revalident tout.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

type Fields = Record<string, unknown>;

export default function ContenuBlocForm({
  cle,
  kind,
  defaults,
  draft,
  published,
  readOnly = false,
}: {
  cle: string;
  kind: string;
  defaults: Fields;
  draft: Fields | null;
  published: Fields | null;
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(enregistrerBlocBrouillon, INITIAL);

  // Ce que le formulaire préremplit, par ordre de proximité avec l'intention :
  // le brouillon en cours s'il existe, sinon ce qui est en ligne, sinon la
  // valeur du code. Partir d'un champ vide obligerait à tout ressaisir pour
  // corriger un mot.
  const source: Fields = draft ?? published ?? defaults;

  const text = (name: string) => (typeof source[name] === 'string' ? (source[name] as string) : '');
  const proof = Array.isArray(source.proof) ? (source.proof as string[]).join('\n') : '';

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      <input type="hidden" name="key" value={cle} />

      <div className="admin-form__grid">
        {kind === 'CTA' ? (
          <>
            <Field
              label="Titre"
              name="title"
              defaultValue={text('title')}
              required
              readOnly={readOnly}
            />
            <Area
              label="Texte"
              name="text"
              defaultValue={text('text')}
              required
              readOnly={readOnly}
            />
            <Field
              label="Libellé du bouton"
              name="primaryLabel"
              defaultValue={text('primaryLabel')}
              required
              readOnly={readOnly}
            />
            <Area
              label="Message WhatsApp prérempli"
              name="whatsappMessage"
              defaultValue={text('whatsappMessage')}
              required
              readOnly={readOnly}
              hint="Texte inséré dans la conversation lorsque le visiteur clique sur WhatsApp (§ 82)."
            />
          </>
        ) : (
          <>
            <Field
              label="Sur-titre"
              name="eyebrow"
              defaultValue={text('eyebrow')}
              required
              readOnly={readOnly}
              hint="La petite ligne au-dessus du titre."
            />
            <Field
              label="Titre"
              name="title"
              defaultValue={text('title')}
              required
              readOnly={readOnly}
              hint="Entourez un mot de doubles crochets pour le mettre en doré : [[Performance]]."
            />
            <Area
              label={kind === 'SECTION' ? 'Chapô (facultatif)' : 'Chapô'}
              name="lead"
              defaultValue={text('lead')}
              required={kind !== 'SECTION'}
              readOnly={readOnly}
              hint={
                kind === 'SECTION'
                  ? 'Laisser vide retire le chapô de la section.'
                  : undefined
              }
            />
            {kind === 'HERO' ? (
              <Area
                label="Preuves"
                name="proof"
                defaultValue={proof}
                required
                readOnly={readOnly}
                hint="Exactement trois lignes, une preuve par ligne."
              />
            ) : null}
          </>
        )}
      </div>

      {readOnly ? null : <Submit />}
    </form>
  );
}

/**
 * Éditeur d'une liste.
 *
 * Saisie en JSON, et il faut le dire franchement : c'est la limite assumée de
 * cette livraison. Construire un éditeur de tableau par forme — icône choisie
 * dans une liste, lien vérifié, éléments réordonnables — représentait un
 * travail d'interface disproportionné face au reste de la phase, et le § 101
 * met en garde contre une administration inutilement complexe.
 *
 * Ce qui est **entièrement** en place, en revanche, c'est la validation : une
 * icône inconnue, un lien externe, un champ manquant ou un JSON mal formé sont
 * refusés avec un message, et rien n'est enregistré. La saisie est austère ;
 * elle n'est pas dangereuse.
 */
export function ContenuListeForm({
  cle,
  defaults,
  draft,
  published,
  shape,
  readOnly = false,
}: {
  cle: string;
  defaults: unknown;
  draft: unknown;
  published: unknown;
  shape: string;
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(enregistrerBlocBrouillon, INITIAL);

  const source = draft ?? published ?? defaults;

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      <input type="hidden" name="key" value={cle} />

      <label className="admin-field">
        <span className="admin-field__label">
          Éléments<abbr title="obligatoire"> *</abbr>
        </span>
        <textarea
          className="admin-input admin-input--area"
          name="items"
          rows={18}
          defaultValue={JSON.stringify(source, null, 2)}
          required
          readOnly={readOnly}
          spellCheck={false}
        />
        <span className="admin-field__hint">
          Forme attendue : {shape}. Toute la liste est refusée si un élément est incomplet,
          si une icône est inconnue ou si un lien n’est pas interne au site.
        </span>
      </label>

      {readOnly ? null : <Submit />}
    </form>
  );
}

/* ------------------------------------------------------------------ champs --- */

function Field({
  label,
  name,
  defaultValue,
  hint,
  required,
  readOnly,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  hint?: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className="admin-field">
      <span className="admin-field__label">
        {label}
        {required ? <abbr title="obligatoire"> *</abbr> : null}
      </span>
      <input
        className="admin-input"
        type="text"
        name={name}
        defaultValue={defaultValue ?? ''}
        required={required}
        readOnly={readOnly}
      />
      {hint ? <span className="admin-field__hint">{hint}</span> : null}
    </label>
  );
}

function Area({
  label,
  name,
  defaultValue,
  hint,
  required,
  readOnly,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  hint?: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className="admin-field">
      <span className="admin-field__label">
        {label}
        {required ? <abbr title="obligatoire"> *</abbr> : null}
      </span>
      <textarea
        className="admin-input admin-input--area"
        name={name}
        rows={4}
        defaultValue={defaultValue ?? ''}
        required={required}
        readOnly={readOnly}
      />
      {hint ? <span className="admin-field__hint">{hint}</span> : null}
    </label>
  );
}

/** Le § 97 demande d'empêcher les doubles soumissions. */
function Submit() {
  const { pending } = useFormStatus();

  return (
    <div className="admin-actions">
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? 'Enregistrement…' : 'Enregistrer le brouillon'}
      </button>
    </div>
  );
}
