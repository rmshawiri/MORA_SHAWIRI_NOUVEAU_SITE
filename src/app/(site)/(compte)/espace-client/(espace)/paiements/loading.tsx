/**
 * Chargement d'une rubrique de l'espace client (phase 4I-1).
 *
 * Le gabarit (bandeau, navigation) reste affiché ; seule la rubrique attend.
 * Aucun contenu fictif : un simple message, annoncé aux lecteurs d'écran.
 *
 * Placé rubrique par rubrique, jamais au-dessus de la fiche d'une commande :
 * une zone de chargement fait partir la réponse avant que la page ne sache si
 * la commande existe, et une commande d'autrui répondrait 200 au lieu de 404.
 */
export default function Loading() {
  return (
    <div className="auth-card" role="status" aria-live="polite">
      <p>Chargement de vos informations…</p>
    </div>
  );
}
