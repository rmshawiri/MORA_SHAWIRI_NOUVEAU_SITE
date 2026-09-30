'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { modifierArticle } from '@/lib/contenus/actions';
import type { ContentPostRow } from '@/lib/supabase/types';

/**
 * Fiche d'un article.
 *
 * ## Deux champs sont volontairement absents
 *
 *   * **le statut** — publier n'est pas modifier (§ 61). Les boutons vivent sur
 *     la fiche, sous `content.publish` ;
 *   * **le corps de l'article** — il est stocké en blocs typés, et le modifier
 *     depuis un simple champ texte demanderait de saisir du JSON. C'est une
 *     limite assumée de cette livraison, signalée comme point différé dans le
 *     rapport de phase : les métadonnées, la date, le visuel, l'appel à
 *     l'action et le SEO sont administrables ; la rédaction du corps demande un
 *     éditeur de blocs, qui est un chantier d'interface à part entière.
 *
 * `required` et `pattern` évitent un aller-retour ; ils ne protègent rien, et
 * `src/lib/contenus/actions.ts` revalide tout.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function ContenuArticleForm({
  post,
  readOnly = false,
}: {
  post: ContentPostRow;
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(modifierArticle, INITIAL);

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      <input type="hidden" name="id" value={post.id} />

      <div className="admin-form__grid">
        <Field label="Titre" name="title" value={post.title} required readOnly={readOnly} />

        <Field
          label="Identifiant d’URL"
          name="slug"
          value={post.slug}
          required
          readOnly={readOnly}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          hint="Minuscules, chiffres et tirets. Le modifier change l’adresse publique de l’article (§ 74)."
        />

        <Field label="Rubrique" name="category" value={post.category} required readOnly={readOnly} />

        <Field
          label="Auteur"
          name="author"
          value={post.author ?? ''}
          readOnly={readOnly}
          hint="Affiché sous le titre de l’article."
        />

        <Area label="Accroche" name="lead" value={post.lead} required readOnly={readOnly} />

        <Area
          label="Résumé"
          name="excerpt"
          value={post.excerpt}
          required
          readOnly={readOnly}
          hint="Utilisé sur la carte du fil et comme description pour les moteurs et les réseaux."
        />

        <Field
          label="Date de publication"
          name="published_on"
          type="date"
          value={post.published_on ?? ''}
          readOnly={readOnly}
        />

        <Field
          label="Date affichée"
          name="date_label"
          value={post.date_label ?? ''}
          readOnly={readOnly}
          hint="Écrite en clair, telle qu’elle apparaît : « 8 juin 2026 »."
        />

        <Field
          label="Durée de lecture"
          name="reading_time"
          value={post.reading_time ?? ''}
          readOnly={readOnly}
        />

        <Field
          label="Rang d’affichage"
          name="sort_order"
          type="number"
          value={String(post.sort_order)}
          readOnly={readOnly}
        />
      </div>

      <fieldset className="admin-fieldset">
        <legend>Visuel</legend>
        <div className="admin-form__grid">
          <Field
            label="Chemin du visuel"
            name="cover_path"
            value={post.cover_path ?? ''}
            readOnly={readOnly}
            hint="Adresse du média, telle qu’elle figure dans la médiathèque."
          />
          <Field
            label="Largeur"
            name="cover_width"
            type="number"
            value={post.cover_width === null ? '' : String(post.cover_width)}
            readOnly={readOnly}
          />
          <Field
            label="Hauteur"
            name="cover_height"
            type="number"
            value={post.cover_height === null ? '' : String(post.cover_height)}
            readOnly={readOnly}
          />
        </div>
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Appel à l’action de fin d’article</legend>
        <div className="admin-form__grid">
          <Field label="Titre" name="cta_title" value={post.cta_title ?? ''} readOnly={readOnly} />
          <Area label="Texte" name="cta_text" value={post.cta_text ?? ''} readOnly={readOnly} />
          <Field
            label="Libellé du bouton"
            name="cta_label"
            value={post.cta_label ?? ''}
            readOnly={readOnly}
          />
          <Field
            label="Lien du bouton"
            name="cta_href"
            value={post.cta_href ?? ''}
            readOnly={readOnly}
            hint="Chemin interne au site, par exemple /contact/."
          />
        </div>
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Référencement</legend>
        <div className="admin-form__grid">
          <Field
            label="Titre SEO"
            name="seo_title"
            value={post.seo_title ?? ''}
            readOnly={readOnly}
            hint="Laisser vide pour utiliser le titre de l’article (§ 71)."
          />
          <Area
            label="Méta description"
            name="seo_description"
            value={post.seo_description ?? ''}
            readOnly={readOnly}
            hint="Laisser vide pour utiliser le résumé (§ 72)."
          />
        </div>
      </fieldset>

      {readOnly ? null : <Submit />}
    </form>
  );
}

/* ------------------------------------------------------------------ champs --- */

function Field({
  label,
  name,
  value,
  hint,
  required,
  readOnly,
  type = 'text',
  pattern,
}: {
  label: string;
  name: string;
  value: string;
  hint?: string;
  required?: boolean;
  readOnly?: boolean;
  type?: string;
  pattern?: string;
}) {
  return (
    <label className="admin-field">
      <span className="admin-field__label">
        {label}
        {required ? <abbr title="obligatoire"> *</abbr> : null}
      </span>
      <input
        className="admin-input"
        type={type}
        name={name}
        defaultValue={value}
        required={required}
        readOnly={readOnly}
        pattern={pattern}
      />
      {hint ? <span className="admin-field__hint">{hint}</span> : null}
    </label>
  );
}

function Area({
  label,
  name,
  value,
  hint,
  required,
  readOnly,
}: {
  label: string;
  name: string;
  value: string;
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
        defaultValue={value}
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
        {pending ? 'Enregistrement…' : 'Enregistrer l’article'}
      </button>
    </div>
  );
}
