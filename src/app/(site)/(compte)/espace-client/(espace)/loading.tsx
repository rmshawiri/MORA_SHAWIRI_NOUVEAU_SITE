/**
 * Chargement d'une rubrique de l'espace client (phase 4I-1).
 *
 * Le gabarit (bandeau, navigation) reste affiché ; seule la rubrique attend.
 * Aucun contenu fictif : un simple message, annoncé aux lecteurs d'écran.
 */
export default function Loading() {
  return (
    <div className="auth-card" role="status" aria-live="polite">
      <p>Chargement de vos informations…</p>
    </div>
  );
}
