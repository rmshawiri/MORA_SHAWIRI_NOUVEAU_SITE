import type { AdminActionState } from '@/lib/admin/actions';

/**
 * Retour d'une action d'administration.
 *
 * Deux exigences se rencontrent ici. Le § 129 interdit d'afficher une trace
 * technique, une erreur SQL ou un secret : ce composant ne rend donc qu'un
 * texte, jamais un objet d'erreur. Et le message d'échec doit être lu : il est
 * annoncé aux lecteurs d'écran par `role="alert"`, sans quoi une personne qui
 * navigue au clavier validerait un formulaire refusé sans jamais l'apprendre.
 */
export default function AdminNotice({ state }: { state: AdminActionState }) {
  if (state.status === 'idle' || !state.message) return null;

  const failed = state.status === 'error';

  return (
    <div
      className={`admin-notice ${failed ? 'admin-notice--error' : 'admin-notice--ok'}`}
      role={failed ? 'alert' : 'status'}
    >
      <p>{state.message}</p>
    </div>
  );
}
