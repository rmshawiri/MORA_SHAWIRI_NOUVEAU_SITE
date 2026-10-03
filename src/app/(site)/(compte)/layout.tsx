import type { ReactNode } from 'react';

import ReloadOnRestore from '@/components/auth/ReloadOnRestore';

import '@/styles/espace.css';
import '@/styles/auth.css';

/**
 * Groupe de routes « compte » : authentification et espaces privés.
 *
 * Trois raisons d'exister.
 *
 * **Les feuilles de style.** `espace.css` et `auth.css` ne sont chargées que
 * par les routes de ce groupe. Le site public conserve `globals.css` et lui
 * seul, comme la décision D-13 le demande et comme la non-régression visuelle
 * l'exige. Aucune page publique ne télécharge une ligne de CSS supplémentaire.
 *
 * **La densité des espaces privés.** Le conteneur `.espace` est la portée dans
 * laquelle `espace.css` redéfinit les jetons du design system : titres,
 * espacements, champs et boutons y prennent l'échelle resserrée validée pour
 * l'administration, sans qu'aucune page n'ait de taille qui lui soit propre.
 * L'en-tête et le pied de page du site sont rendus par le gabarit parent,
 * **hors** de ce conteneur : ils ne bougent pas.
 *
 * **Le rendu dynamique.** Toutes ces pages lisent la session. Aucune ne doit
 * être pré-rendue ni mise en cache : une page de compte servie depuis un cache
 * montrerait à un visiteur l'écran d'un autre.
 *
 * Les parenthèses du nom de dossier sont une convention Next.js : le groupe
 * n'apparaît pas dans les URLs. `/connexion/` reste `/connexion/`.
 *
 * Ce groupe est imbriqué dans `(site)` : les écrans de compte gardent donc
 * l'en-tête, le pied de page et les pastilles du site, comme la phase 4B
 * l'avait voulu. Seule l'administration a quitté ce groupe, pour `(pilotage)`
 * — elle n'utilise aucune classe d'`auth.css`, et elle n'a que faire de la
 * navigation vitrine.
 *
 * Les écrans d'authentification s'inscrivent dans le site plutôt que de former
 * un univers à part.
 */
export const dynamic = 'force-dynamic';

export default function CompteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ReloadOnRestore />
      <div className="espace">{children}</div>
    </>
  );
}
