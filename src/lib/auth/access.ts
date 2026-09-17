/**
 * Règles d'accès aux espaces privés — le cœur décisionnel, isolé et pur.
 *
 * Ce module ne lit rien, n'écrit rien et n'importe rien. C'est délibéré : les
 * règles qui décident si un administrateur entre ou non dans l'administration
 * sont ce qu'il y a de plus important à tester, et une fonction pure se teste
 * exhaustivement, sans base de données ni session.
 * `tests/unit/auth-access.test.ts` couvre chaque combinaison.
 *
 * `session.ts` fournit les faits — rôle, statut, niveau d'assurance, facteurs
 * vérifiés — et applique le verdict rendu ici. Les deux responsabilités restent
 * séparées : établir la vérité d'un côté, en tirer les conséquences de l'autre.
 *
 * Références : `04_AUTHENTIFICATION.md` § 104-108 ; § 2 et § 8 du cadrage de la
 * phase 4B.
 */

/** Niveau d'assurance de la session, au sens de Supabase Auth. */
export type AssuranceLevel = 'aal1' | 'aal2';

/**
 * Raison pour laquelle l'accès n'est pas encore accordé.
 *
 * Nommer les obstacles plutôt que de renvoyer un simple booléen a deux
 * vertus : la redirection devient une traduction mécanique, et le journal
 * d'audit peut dire *pourquoi* un accès a été refusé.
 */
export type AccessObstacle =
  | 'aucune-session'
  | 'role-insuffisant'
  | 'mot-de-passe-a-changer'
  | 'second-facteur-a-enroler'
  | 'second-facteur-a-verifier';

/**
 * Les seuls faits nécessaires à la décision.
 *
 * Volontairement réduit : tout ce qui n'entre pas dans la règle n'a pas à
 * figurer ici.
 */
export type AccessSnapshot = {
  /** Porte au moins un rôle d'administration. */
  isAdmin: boolean;
  /** Le mot de passe d'amorçage n'a pas encore été remplacé. */
  mustChangePassword: boolean;
  /** Décision D-12 telle qu'elle est enregistrée en base. */
  adminMfaRequired: boolean;
  /** Niveau d'assurance réellement porté par le jeton. */
  assuranceLevel: AssuranceLevel;
  /** Nombre de facteurs TOTP **vérifiés**. Un facteur abandonné ne compte pas. */
  totpFactorCount: number;
};

/**
 * Le compte doit-il présenter un second facteur ?
 *
 * Décision D-12 : obligatoire pour `SUPER_ADMIN` et `ADMIN`, hors périmètre
 * pour les clients ordinaires dans cette phase.
 */
export function mfaIsRequiredFor(snapshot: AccessSnapshot): boolean {
  return snapshot.isAdmin && snapshot.adminMfaRequired;
}

/**
 * Obstacle restant avant l'accès à l'administration, ou `null` si la voie est
 * libre.
 *
 * L'ordre des contrôles porte du sens, et il suit le § 3 du cadrage :
 *
 *   1. être connecté ;
 *   2. être administrateur ;
 *   3. avoir remplacé le mot de passe d'amorçage — avant toute chose, car
 *      enrôler un second facteur sur un compte dont le mot de passe initial
 *      circule encore reviendrait à sceller la porte en laissant la clé
 *      dessus ;
 *   4. posséder un facteur vérifié ;
 *   5. l'avoir présenté pour cette session.
 *
 * Le point 5 est celui qui compte : une session `AAL1` ne suffit pas, même sur
 * un compte correctement enrôlé. C'est ce qui empêche d'accéder à
 * l'administration par une URL directe après une simple connexion par mot de
 * passe.
 */
export function adminAccessObstacle(snapshot: AccessSnapshot | null): AccessObstacle | null {
  if (!snapshot) return 'aucune-session';
  if (!snapshot.isAdmin) return 'role-insuffisant';
  if (snapshot.mustChangePassword) return 'mot-de-passe-a-changer';

  if (mfaIsRequiredFor(snapshot)) {
    if (snapshot.totpFactorCount === 0) return 'second-facteur-a-enroler';
    if (snapshot.assuranceLevel !== 'aal2') return 'second-facteur-a-verifier';
  }

  return null;
}

/**
 * Obstacle restant avant l'accès à un espace privé ordinaire.
 *
 * Un client n'a pas de second facteur à présenter dans cette phase ; le
 * changement du mot de passe d'amorçage, lui, s'impose à tout compte marqué
 * comme tel — y compris un compte créé par l'administration.
 */
export function privateAccessObstacle(snapshot: AccessSnapshot | null): AccessObstacle | null {
  if (!snapshot) return 'aucune-session';
  if (snapshot.mustChangePassword) return 'mot-de-passe-a-changer';
  return null;
}

/**
 * Obstacle restant avant de pouvoir **gérer** ses facteurs.
 *
 * L'enrôlement d'un premier facteur se fait nécessairement en `AAL1` : le
 * compte n'a encore rien à présenter. En revanche, dès qu'un facteur vérifié
 * existe, le retirer ou en ajouter un autre exige `AAL2` — sans quoi le vol
 * d'un mot de passe suffirait à désarmer la double authentification.
 */
export function factorManagementObstacle(
  snapshot: AccessSnapshot | null,
): AccessObstacle | null {
  if (!snapshot) return 'aucune-session';
  if (snapshot.mustChangePassword) return 'mot-de-passe-a-changer';

  if (snapshot.totpFactorCount > 0 && snapshot.assuranceLevel !== 'aal2') {
    return 'second-facteur-a-verifier';
  }

  return null;
}

/**
 * Un facteur peut-il être retiré ?
 *
 * Garde-fou demandé au § 9 du cadrage : « Un SUPER_ADMIN ne doit pas pouvoir se
 * retrouver dans une situation où il se verrouille définitivement lui-même. »
 *
 * Retirer le dernier facteur d'un administrateur soumis au second facteur
 * obligatoire ne le verrouille pas *définitivement* — il serait renvoyé vers
 * l'enrôlement —, mais cela ouvre une fenêtre pendant laquelle son compte n'est
 * plus protégé que par un mot de passe. Le retrait est donc refusé tant qu'un
 * autre facteur n'a pas été enrôlé. La marche à suivre reste possible :
 * enrôler le nouveau téléphone, puis retirer l'ancien.
 */
export function canRemoveFactor(snapshot: AccessSnapshot): boolean {
  if (!mfaIsRequiredFor(snapshot)) return true;
  return snapshot.totpFactorCount > 1;
}
