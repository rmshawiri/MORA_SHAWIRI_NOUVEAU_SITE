import type { ReactNode } from 'react';

import '@/styles/auth.css';

/**
 * Groupe de routes « compte » : authentification et espaces privés.
 *
 * Deux raisons d'exister.
 *
 * **La feuille de style.** `auth.css` n'est chargée que par les routes de ce
 * groupe. Le site public conserve `globals.css` et lui seul, comme la décision
 * D-13 le demande et comme la non-régression visuelle l'exige. Aucune page
 * publique ne télécharge une ligne de CSS supplémentaire.
 *
 * **Le rendu dynamique.** Toutes ces pages lisent la session. Aucune ne doit
 * être pré-rendue ni mise en cache : une page de compte servie depuis un cache
 * montrerait à un visiteur l'écran d'un autre.
 *
 * Les parenthèses du nom de dossier sont une convention Next.js : le groupe
 * n'apparaît pas dans les URLs. `/connexion/` reste `/connexion/`.
 *
 * L'en-tête, le pied de page et le dock restent ceux du site — ils viennent du
 * gabarit racine, qui n'est pas touché. Les écrans d'authentification
 * s'inscrivent dans le site plutôt que de former un univers à part.
 */
export const dynamic = 'force-dynamic';

export default function CompteLayout({ children }: { children: ReactNode }) {
  return children;
}
