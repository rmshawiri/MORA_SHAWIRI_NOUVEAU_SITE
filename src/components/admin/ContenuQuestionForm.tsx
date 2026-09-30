'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import type { AdminActionState } from '@/lib/admin/actions';
import { creerQuestion, modifierQuestion } from '@/lib/contenus/actions';

/**
 * Formulaire d'une question fréquente — création et modification.
 *
 * Un seul composant pour les deux, parce qu'ils décrivent la même fiche. En
 * écrire deux garantirait qu'un champ ajouté demain n'existe que d'un côté.
 *
 * ## Aucun champ de statut, ici non plus
 *
 * Le § 61 fait de la publication une action explicite, et `content.publish` la
 * réserve. Une question est donc **toujours créée en brouillon** : créer
 * directement en ligne ferait de la création une publication déguisée, que
 * `content.create` suffirait à obtenir. Les boutons de statut vivent dans la
 * liste, sous leur propre permission.
 *
 * ## La réponse est du texte brut, et c'est un choix de sécurité
 *
 * Aucun balisage n'est accepté, donc aucun n'est à nettoyer : le composant
 * public rend la réponse dans un `<details>` sans jamais l'interpréter. Les 45
 * réponses reprises n'en contiennent aucun, et en ouvrir la possibilité créerait
 * une surface XSS pour un besoin qui n'existe pas (§ 98).
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function ContenuQuestionForm({
  mode,
  categoryId,
  question,
  readOnly = false,
}: {
  mode: 'creation' | 'modification';
  categoryId: string;
  question?: {
    id: string;
    question: string;
    answer: string;
    sort_order: number;
  };
  readOnly?: boolean;
}) {
  const action = mode === 'creation' ? creerQuestion : modifierQuestion;
  const [state, formAction] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="admin-form">
      <AdminNotice state={state} />

      {mode === 'creation' ? (
        <input type="hidden" name="category_id" value={categoryId} />
      ) : (
        <input type="hidden" name="id" value={question?.id ?? ''} />
      )}

      <div className="admin-form__grid">
        <label className="admin-field">
          <span className="admin-field__label">
            Question<abbr title="obligatoire"> *</abbr>
          </span>
          <input
            className="admin-input"
            type="text"
            name="question"
            defaultValue={question?.question ?? ''}
            required
            readOnly={readOnly}
          />
        </label>

        <label className="admin-field">
          <span className="admin-field__label">
            Réponse<abbr title="obligatoire"> *</abbr>
          </span>
          <textarea
            className="admin-input admin-input--area"
            name="answer"
            rows={6}
            defaultValue={question?.answer ?? ''}
            required
            readOnly={readOnly}
          />
          <span className="admin-field__hint">
            Texte simple, sans mise en forme : il est affiché tel quel, jamais interprété.
          </span>
        </label>

        <label className="admin-field">
          <span className="admin-field__label">Rang d’affichage</span>
          <input
            className="admin-input"
            type="number"
            name="sort_order"
            min={0}
            step={10}
            defaultValue={question?.sort_order ?? 0}
            readOnly={readOnly}
          />
          <span className="admin-field__hint">
            Les questions sont affichées par rang croissant.
          </span>
        </label>
      </div>

      {readOnly ? null : (
        <Submit
          label={mode === 'creation' ? 'Créer en brouillon' : 'Enregistrer la question'}
        />
      )}
    </form>
  );
}

/** Le § 97 demande d'empêcher les doubles soumissions. */
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
