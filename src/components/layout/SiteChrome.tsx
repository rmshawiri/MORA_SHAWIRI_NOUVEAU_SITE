import type { ReactNode } from 'react';

import Dock from '@/components/layout/Dock';
import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';

/**
 * Habillage du site public : en-tête, contenu, pied de page, pastilles.
 *
 * ## Pourquoi il ne vit plus dans le gabarit racine
 *
 * Il y vivait jusqu'au contrôle visuel du propriétaire après la phase 4G. Le
 * gabarit racine s'applique à **toutes** les routes : l'espace
 * d'administration héritait donc d'une navigation vitrine, d'un pied de page
 * de huit colonnes et d'un bouton « Écrire sur WhatsApp » flottant par-dessus
 * les écrans de travail. L'en-tête public étant `position: fixed`, ses 80
 * pixels recouvraient de surcroît le haut de chaque page d'administration,
 * qui n'a pas de `PageHero` pour les compenser.
 *
 * Une première tentative avait consisté à envelopper ces composants dans une
 * enveloppe cliente qui ne rendait rien sous `/administration/`. Elle ne
 * suffisait pas : le pied de page est un composant **serveur**, et un
 * composant serveur passé en enfant d'un composant client est rendu sur le
 * serveur puis sérialisé dans la charge utile, que le client l'affiche ou
 * non. Le pied de page ne s'affichait plus, mais il voyageait encore.
 *
 * La solution retenue est celle que Next.js prévoit : un **groupe de routes**.
 * `(site)` porte l'habillage, `(pilotage)` ne le porte pas. Les parenthèses
 * n'apparaissent dans aucune URL — `/services/` reste `/services/`. Rien n'est
 * rendu puis masqué : ce qui ne doit pas exister n'est tout simplement pas
 * construit.
 *
 * ## Pourquoi un composant et non le gabarit lui-même
 *
 * La page 404 globale (`src/app/not-found.tsx`) répond aux adresses qui ne
 * correspondent à aucune route. Next.js la rend dans le gabarit **racine**,
 * hors de tout groupe : sans ce composant partagé, elle perdrait l'en-tête et
 * le pied de page du site. Elle s'habille donc elle-même, avec exactement le
 * même assemblage.
 */
export default function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main id="main" data-page-transition>
        {children}
      </main>
      <Footer />
      <Dock />
    </>
  );
}
