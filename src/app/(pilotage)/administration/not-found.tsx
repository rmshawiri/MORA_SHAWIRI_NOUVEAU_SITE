import Link from 'next/link';

import { AUTH_ROUTES } from '@/lib/auth/routes';

export const metadata = {
  title: 'Page introuvable',
  robots: { index: false, follow: false },
};

/**
 * Page introuvable de l'espace de pilotage.
 *
 * ## Pourquoi elle existe
 *
 * Les gardes de la phase 4C refusent par `notFound()` et non par 403 : une
 * page absente ne renseigne personne sur ce qui existe. Ce refus est donc
 * fréquent et parfaitement normal — un administrateur qui ouvre l'adresse d'un
 * module auquel il n'a pas droit arrive ici.
 *
 * Sans cette page, le refus remontait jusqu'à la 404 globale du site, qui
 * porte l'en-tête, le pied de page et la pastille WhatsApp du site vitrine.
 * Autrement dit : la seule adresse d'`/administration/` qui continuait
 * d'afficher l'habillage public était celle qu'un administrateur rencontre le
 * plus souvent. Elle réintroduisait de surcroît ce balisage dans la charge
 * utile de **toutes** les pages d'administration, puisque Next.js pré-calcule
 * la limite « introuvable » de chaque route.
 *
 * Posée sous `administration/`, elle est rendue dans la coquille du gabarit :
 * la barre latérale reste là, et le module suivant est à un clic.
 *
 * ## Ce qu'elle ne dit pas
 *
 * Ni le module demandé, ni la permission manquante, ni si l'adresse existe.
 * Le § 102 du tableau de bord demande que l'interface ne révèle pas
 * inutilement ce qui existe, et c'est précisément ce que le choix du 404
 * cherchait à obtenir : le confirmer ici l'annulerait.
 */
export default function AdministrationNotFound() {
  return (
    <div className="admin-seule">
      <p className="admin-head__eyebrow">Espace de pilotage</p>
      <h1>Page introuvable</h1>
      <p>
        Cette adresse ne correspond à aucun écran que vous puissiez ouvrir. Revenez au tableau de
        bord pour retrouver vos modules.
      </p>
      <div className="admin-actions">
        <Link className="btn btn--primary" href={AUTH_ROUTES.adminArea}>
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
