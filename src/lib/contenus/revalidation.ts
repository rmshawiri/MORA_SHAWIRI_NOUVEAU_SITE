/**
 * Durée de validité d'une lecture publique des contenus, en secondes.
 *
 * Une seule constante pour deux réglages qui doivent impérativement s'accorder :
 * le `revalidate` des pages publiques et la durée de cache des requêtes
 * qu'elles émettent. Les laisser diverger produirait le pire des deux mondes —
 * une page régénérée qui relit une réponse périmée, ou l'inverse.
 *
 * Cinq minutes, comme le catalogue (4E-1) : aligner les deux évite qu'une page
 * serve un catalogue frais sous des titres périmés.
 *
 * ## Pourquoi un fichier à part
 *
 * Next.js n'accepte pour `export const revalidate` qu'un littéral : la valeur
 * est lue par analyse statique du fichier, pas à l'exécution, et une constante
 * importée est refusée au build — « Invalid segment configuration export
 * detected ». Les pages écrivent donc `300` en clair, et le test
 * `contenus-revalidation` vérifie qu'elles s'accordent avec cette constante.
 *
 * Ce module ne porte volontairement **aucune** dépendance — surtout pas
 * `server-only` — pour rester lisible depuis un test comme depuis le serveur.
 * C'est le même parti que `src/lib/catalogue/revalidation.ts`.
 */
export const CONTENUS_REVALIDATE_SECONDS = 300;
