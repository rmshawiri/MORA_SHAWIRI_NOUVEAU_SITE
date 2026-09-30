'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { createServiceAction, updateServiceAction } from '@/lib/catalogue/actions';
import type { CatalogueCategory } from '@/lib/catalogue/admin';
import type { ServiceRow } from '@/lib/supabase/types';

/**
 * Formulaire d'une offre — création et modification.
 *
 * Un seul composant pour les deux, parce qu'ils décrivent exactement la même
 * fiche. En écrire deux garantirait qu'un champ ajouté demain n'existe que
 * d'un côté.
 *
 * ## Ce que ce formulaire ne fait pas
 *
 * Il ne contient **aucun** champ de statut. Publier n'est pas modifier : le
 * § 61 fait de la publication « une action explicite », et le catalogue des
 * permissions lui réserve `services.publish`. Les boutons correspondants
 * vivent sur la fiche, pas ici.
 *
 * Il ne valide pas non plus à la place du serveur. Les attributs `required`
 * et `pattern` évitent un aller-retour inutile ; ils ne protègent rien, et
 * `src/lib/catalogue/actions.ts` revalide tout.
 *
 * Références : `09_ADMINISTRATION/00_GESTION_SERVICES.md` § 7, § 61, § 94-97.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

type ServiceFormProps = {
  categories: readonly CatalogueCategory[];
  mode: 'creation' | 'modification';
  service?: ServiceRow;
  /** Un compte sans droit d'écriture consulte la fiche en lecture seule. */
  readOnly?: boolean;
};

export default function ServiceForm({
  categories,
  mode,
  service,
  readOnly = false,
}: ServiceFormProps) {
  const action = mode === 'creation' ? createServiceAction : updateServiceAction;
  const [state, formAction] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      {service ? <input type="hidden" name="offre" value={service.id} /> : null}

      <div className="admin-form__grid">
        <Field
          label="Titre de l’offre"
          name="titre"
          defaultValue={service?.title}
          required
          readOnly={readOnly}
          hint="Le nom commercial, tel qu’il apparaît sur la carte de la Boutique."
        />

        <Field
          label="Identifiant d’URL"
          name="slug"
          defaultValue={service?.slug}
          required
          readOnly={readOnly}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          hint="Minuscules, chiffres et tirets. Exemple : site-vitrine."
        />

        <label className="admin-field">
          <span className="admin-field__label">Catégorie</span>
          <select
            className="admin-input"
            name="categorie"
            defaultValue={service?.category_id ?? ''}
            required
            disabled={readOnly}
          >
            <option value="" disabled>
              Choisir une catégorie
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.is_active ? '' : ' (désactivée)'}
              </option>
            ))}
          </select>
        </label>

        <Field
          label="Étiquette"
          name="etiquette"
          defaultValue={service?.tag}
          required
          readOnly={readOnly}
          hint="Le badge affiché sur le visuel. Exemple : Site web."
        />

        <Field
          label="Étiquette courte"
          name="etiquette_courte"
          defaultValue={service?.featured_tag ?? ''}
          readOnly={readOnly}
          hint="Facultative : remplace l’étiquette dans l’aperçu de la page d’accueil."
        />

        <Field
          label="Visuel"
          name="image"
          defaultValue={service?.image_path}
          required
          readOnly={readOnly}
          hint="Chemin du fichier, par exemple /images/offre-logo.webp."
        />

        <Field
          label="Texte alternatif du visuel"
          name="texte_alternatif"
          defaultValue={service?.image_alt ?? ''}
          readOnly={readOnly}
          hint="Facultatif. Sans valeur, le site décrit l’image à partir du titre."
        />
      </div>

      <Area
        label="Description courte"
        name="description_courte"
        defaultValue={service?.short_description}
        required
        readOnly={readOnly}
        hint="Une ou deux phrases. Utilisée dans l’aperçu de la page d’accueil."
      />

      <Area
        label="Description complète"
        name="description"
        defaultValue={service?.description}
        required
        readOnly={readOnly}
        hint="Affichée sur la carte de la Boutique et reprise dans les données structurées."
      />

      <Area
        label="Avantages"
        name="avantages"
        defaultValue={service?.benefits.join('\n')}
        readOnly={readOnly}
        hint="Un avantage par ligne. Les lignes vides sont ignorées."
      />

      <div className="admin-form__grid">
        <Field
          label="Prix affiché"
          name="prix"
          defaultValue={service?.price_label}
          required
          readOnly={readOnly}
          hint="Ce que lit le visiteur : « Sur devis », « 15 000 KMF »…"
        />

        <Field
          label="Précision de prix"
          name="note_prix"
          defaultValue={service?.price_note ?? ''}
          readOnly={readOnly}
          hint="Exemple : Tarif fixe, par image, Selon le périmètre du projet."
        />

        <Field
          label="Montant exploitable"
          name="montant"
          defaultValue={service?.price_amount ?? ''}
          readOnly={readOnly}
          inputMode="decimal"
          hint="En KMF, sans espace. Laissez vide pour une offre sur devis : aucun prix ne sera déclaré au référencement."
        />

        <Field
          label="Libellé du bouton"
          name="cta"
          defaultValue={service?.cta_label}
          required
          readOnly={readOnly}
          hint="Exemple : Demander cette offre."
        />

        <Field
          label="Besoin transmis au formulaire"
          name="sujet"
          defaultValue={service?.request_subject}
          required
          readOnly={readOnly}
          hint="Doit correspondre exactement à une option du champ « Votre besoin » du formulaire de contact."
        />

        <Field
          label="Lien interne"
          name="lien_interne"
          defaultValue={service?.internal_href ?? ''}
          readOnly={readOnly}
          hint="Facultatif. Sans lien, le bouton mène au formulaire contextualisé."
        />

        <Field
          label="Rang d’affichage"
          name="rang"
          defaultValue={service?.sort_order ?? 0}
          readOnly={readOnly}
          inputMode="numeric"
          hint="Les petits nombres passent en premier dans leur catégorie."
        />

        <Field
          label="Rang de mise en avant"
          name="rang_avant"
          defaultValue={service?.featured_order ?? ''}
          readOnly={readOnly}
          inputMode="numeric"
          hint="Obligatoire si l’offre est mise en avant sur la page d’accueil."
        />
      </div>

      <fieldset className="admin-fieldset" disabled={readOnly}>
        <legend>Emplacements</legend>

        <Check
          name="afficher_boutique"
          label="Proposer dans la Boutique"
          defaultChecked={service?.show_in_shop ?? true}
          hint="La présence dans la Boutique est explicite : une offre n’y figure jamais d’office."
        />
        <Check
          name="afficher_services"
          label="Afficher sur la page Services"
          defaultChecked={service?.show_in_services ?? false}
        />
        <Check
          name="mise_en_avant"
          label="Mettre en avant sur la page d’accueil"
          defaultChecked={service?.is_featured ?? false}
        />
      </fieldset>

      {readOnly ? (
        <div className="admin-notice">
          <p>
            Vous consultez cette fiche sans pouvoir l’enregistrer. La permission
            <code> services.update </code>
            est nécessaire pour la modifier.
          </p>
        </div>
      ) : (
        <Submit
          label={mode === 'creation' ? 'Créer le brouillon' : 'Enregistrer les modifications'}
        />
      )}
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
  pattern,
  inputMode,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  hint?: string;
  required?: boolean;
  readOnly?: boolean;
  pattern?: string;
  inputMode?: 'numeric' | 'decimal';
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
        pattern={pattern}
        inputMode={inputMode}
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

function Check({
  name,
  label,
  defaultChecked,
  hint,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <label className="admin-check">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

/**
 * Le § 97 demande d'empêcher les doubles soumissions. `useFormStatus` désarme
 * le bouton pendant l'envoi — ce qui vaut mieux qu'un garde-fou côté serveur
 * seul, puisque le second envoi n'a alors même pas lieu.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <div className="admin-actions">
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? 'Enregistrement…' : label}
      </button>
    </div>
  );
}
