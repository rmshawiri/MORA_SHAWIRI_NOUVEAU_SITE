import 'server-only';

/**
 * Gardes des pages et routes privées — application du verdict d'`access.ts`.
 *
 * Ces fonctions sont la **barrière réelle**, celle que le § 7 du cadrage
 * appelle le niveau 2. Le middleware, lui, ne fait qu'éviter à un visiteur
 * non connecté de voir un écran vide : il est contournable par construction,
 * puisqu'une requête peut l'ignorer.
 *
 * Toute page privée appelle donc un garde, sans exception. Un garde oublié est
 * une page ouverte, quoi qu'en dise le middleware.
 *
 * `04_AUTHENTIFICATION.md` § 104-107 ; § 8 du cadrage de la phase 4B.
 */

import { notFound, redirect } from 'next/navigation';

import { adminAccessObstacle, factorManagementObstacle, privateAccessObstacle } from './access';
import type { AccessObstacle } from './access';
import { AUTH_ROUTES, signInUrlFor } from './routes';
import { getAuthContext, type AuthContext } from './session';

/**
 * Traduit un obstacle en destination.
 *
 * `role-insuffisant` est absent de la table : il ne se traite pas par une
 * redirection, mais par `notFound()`. Rediriger un client vers la connexion
 * lui apprendrait qu'il existe une administration à cette adresse ; le § 102
 * demande l'inverse. Une page absente ne renseigne personne.
 */
function destinationFor(obstacle: Exclude<AccessObstacle, 'role-insuffisant'>, from: string): string {
  switch (obstacle) {
    case 'aucune-session':
      return signInUrlFor(from);
    case 'mot-de-passe-a-changer':
      return AUTH_ROUTES.changePassword;
    case 'second-facteur-a-enroler':
      return AUTH_ROUTES.mfaSettings;
    case 'second-facteur-a-verifier':
      return AUTH_ROUTES.mfaChallenge;
  }
}

/**
 * Exige une session valide sur un espace privé ordinaire.
 *
 * Redirige vers la connexion en mémorisant la page demandée, afin que la
 * personne y revienne d'elle-même une fois authentifiée.
 */
export async function requirePrivateAccess(from: string): Promise<AuthContext> {
  const context = await getAuthContext();
  const obstacle = privateAccessObstacle(context);

  if (obstacle) redirect(destinationFor(obstacle as Exclude<AccessObstacle, 'role-insuffisant'>, from));

  return context as AuthContext;
}

/**
 * Exige un accès administratif complet : rôle, mot de passe changé, second
 * facteur vérifié **et présenté pour cette session**.
 *
 * C'est ici que se joue l'interdiction de contourner le second facteur par une
 * URL directe (§ 8 du cadrage). Une session `AAL1` sur un compte administrateur
 * correctement enrôlé n'obtient rien : elle repart vers la vérification.
 */
export async function requireAdminAccess(from: string): Promise<AuthContext> {
  const context = await getAuthContext();
  const obstacle = adminAccessObstacle(context);

  if (obstacle === 'role-insuffisant') notFound();
  if (obstacle) redirect(destinationFor(obstacle, from));

  return context as AuthContext;
}

/**
 * Exige le droit de gérer ses facteurs.
 *
 * Accessible en `AAL1` tant qu'aucun facteur n'existe — il faut bien enrôler le
 * premier —, puis en `AAL2` uniquement.
 */
export async function requireFactorManagement(from: string): Promise<AuthContext> {
  const context = await getAuthContext();
  const obstacle = factorManagementObstacle(context);

  if (obstacle) redirect(destinationFor(obstacle as Exclude<AccessObstacle, 'role-insuffisant'>, from));

  return context as AuthContext;
}

/**
 * Exige une session, sans autre condition.
 *
 * Réservé aux deux écrans qui doivent rester atteignables *pendant* qu'un
 * obstacle est en cours de levée : le changement de mot de passe obligatoire et
 * la vérification du second facteur. Les y soumettre créerait une boucle de
 * redirection.
 */
export async function requireSession(from: string): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) redirect(signInUrlFor(from));

  return context;
}
