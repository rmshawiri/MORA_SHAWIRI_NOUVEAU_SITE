/**
 * Durée de validité d'une lecture publique du catalogue, en secondes.
 *
 * Une seule constante pour deux réglages qui doivent impérativement
 * s'accorder : le `revalidate` des pages publiques et la durée de cache des
 * requêtes qu'elles émettent. Les laisser diverger produirait le pire des deux
 * mondes — une page régénérée qui relit une réponse périmée, ou l'inverse.
 *
 * Cinq minutes : le catalogue d'une agence ne change pas toutes les secondes,
 * et l'administrateur qui publie une offre la voit en ligne avant d'avoir fini
 * de vérifier le reste de sa fiche.
 *
 * ## Pourquoi un fichier à part
 *
 * Next.js n'accepte pour `export const revalidate` qu'un littéral : la valeur
 * est lue par analyse statique du fichier, pas à l'exécution, et une constante
 * importée est refusée au build. Les pages écrivent donc `300` en clair, et le
 * test `catalogue` vérifie qu'elles s'accordent avec cette constante.
 *
 * Ce module ne porte volontairement aucune dépendance — surtout pas
 * `server-only` — pour rester lisible depuis un test comme depuis le serveur.
 */
export const CATALOGUE_REVALIDATE_SECONDS = 300;
