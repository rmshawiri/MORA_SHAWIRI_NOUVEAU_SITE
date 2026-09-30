'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { createCategoryAction } from '@/lib/catalogue/actions';

/**
 * Création d'une catégorie de services (§ 12).
 *
 * L'univers n'est pas demandé : ce module administre les prestations, et
 * `createCategoryAction` fixe `kind = 'SERVICE'` côté serveur. Offrir le choix
 * ici permettrait de créer une catégorie de produits avec la seule permission
 * `services.create`.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function CategoryForm() {
  const [state, formAction] = useActionState(createCategoryAction, INITIAL);

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      <div className="admin-form__grid">
        <label className="admin-field">
          <span className="admin-field__label">
            Nom<abbr title="obligatoire"> *</abbr>
          </span>
          <input className="admin-input" type="text" name="nom" required />
          <span className="admin-field__hint">Le titre affiché au-dessus du groupe d’offres.</span>
        </label>

        <label className="admin-field">
          <span className="admin-field__label">
            Identifiant d’URL<abbr title="obligatoire"> *</abbr>
          </span>
          <input
            className="admin-input"
            type="text"
            name="slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
          <span className="admin-field__hint">Minuscules et tirets. Exemple : identite.</span>
        </label>

        <label className="admin-field">
          <span className="admin-field__label">Rang</span>
          <input className="admin-input" type="text" name="rang" inputMode="numeric" />
          <span className="admin-field__hint">
            Ordre d’apparition dans la Boutique. Les petits nombres passent en premier.
          </span>
        </label>
      </div>

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();

  return (
    <div className="admin-actions">
      <button className="btn btn--ghost" type="submit" disabled={pending}>
        {pending ? 'Création…' : 'Ajouter la catégorie'}
      </button>
    </div>
  );
}
