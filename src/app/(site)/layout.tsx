import type { ReactNode } from 'react';

import SiteChrome from '@/components/layout/SiteChrome';

/**
 * Groupe de routes « site » : tout ce qui s'adresse au public.
 *
 * Il porte l'habillage du site vitrine — en-tête, pied de page, pastilles
 * flottantes — que le gabarit racine appliquait auparavant à l'ensemble des
 * routes, administration comprise.
 *
 * Les parenthèses sont une convention Next.js : le groupe n'apparaît dans
 * aucune URL. `/services/` reste `/services/`, `/connexion/` reste
 * `/connexion/`, et le rendu HTML des pages publiques est inchangé.
 *
 * Les écrans de compte (`(compte)`) sont **dedans** : la phase 4B avait décidé
 * qu'ils s'inscrivent dans le site plutôt que de former un univers à part, et
 * cette décision ne change pas. Seule l'administration en est sortie : elle a
 * sa propre coquille, dans le groupe `(pilotage)`.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}
