/**
 * Politique de robustesse des mots de passe.
 *
 * Référence : `04_AUTHENTIFICATION.md` § 26-28.
 *
 *   « Le système doit privilégier : longueur ; unicité ; résistance aux mots de
 *     passe courants […] Éviter d'imposer inutilement des règles artificielles
 *     complexes. »
 *
 * La règle retenue est donc celle de la longueur, complétée par un refus des
 * mots de passe manifestement faibles. Aucune exigence décorative du type
 * « un chiffre et un caractère spécial » n'est imposée : elle produit des mots
 * de passe courts et prévisibles, ce que le § 26 demande précisément d'éviter.
 *
 * Ce module est volontairement **pur** : aucune entrée-sortie, aucun secret,
 * aucune dépendance. Il est donc couvert par des tests unitaires
 * (`tests/unit/auth-passwords.test.ts`) et partagé par tous les parcours —
 * inscription, changement, réinitialisation.
 *
 * Il ne journalise jamais la valeur examinée (§ 141, § 160).
 */

/** Longueur minimale. Alignée sur `scripts/provision-admins.mjs`. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Longueur maximale acceptée avant transmission à Supabase Auth.
 *
 * bcrypt ne prend en compte que les 72 premiers octets : au-delà, la fin du
 * mot de passe n'apporte plus rien et un champ non borné devient un vecteur de
 * déni de service. La limite est haute pour ne gêner aucun gestionnaire de
 * mots de passe.
 */
export const PASSWORD_MAX_LENGTH = 72;

/**
 * Mots de passe à refuser sans autre examen (§ 27).
 *
 * La liste est courte et assumée comme telle : elle attrape la saisie
 * paresseuse, pas un dictionnaire complet. Le § 28 réserve la détection des
 * mots de passe *compromis* à un mécanisme externe, qui n'existe pas encore.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'motdepasse',
  'motdepasse1',
  'motdepasse123',
  '123456789',
  '1234567890',
  '12345678',
  'azertyuiop',
  'qwertyuiop',
  'administrateur',
  'admin1234',
  'admin12345',
  'changeme',
  'changemenow',
  'bienvenue1',
  'morashawiri',
  'shawiri2026',
]);

/**
 * Motifs de refus, rédigés pour être affichés tels quels au visiteur.
 *
 * Une liste vide signifie que le mot de passe est accepté.
 *
 * @param password Valeur examinée. Jamais restituée, ni entière ni tronquée.
 * @param context  Éléments d'identité que le mot de passe ne doit pas répéter :
 *                 identifiant, partie locale de l'adresse e-mail, nom.
 */
export function assessPassword(password: string, context: readonly string[] = []): string[] {
  const reasons: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    reasons.push(`Utilisez au moins ${PASSWORD_MIN_LENGTH} caractères.`);
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    reasons.push(`Restez en deçà de ${PASSWORD_MAX_LENGTH} caractères.`);
  }

  if (password.trim().length === 0) {
    reasons.push('Un mot de passe ne peut pas être composé uniquement d’espaces.');
  }

  const lowered = password.toLowerCase();

  if (COMMON_PASSWORDS.has(lowered)) {
    reasons.push('Ce mot de passe est trop courant pour protéger un compte.');
  }

  for (const value of context) {
    const needle = value.trim().toLowerCase();
    // En deçà de trois caractères, la coïncidence serait fortuite.
    if (needle.length >= 3 && lowered.includes(needle)) {
      reasons.push('Votre mot de passe ne doit pas contenir votre identifiant ni votre adresse.');
      break;
    }
  }

  // Une suite de lettres minuscules reste devinable même longue : c'est le
  // défaut relevé sur le mot de passe d'amorçage du super-administrateur.
  if (/^[a-z]+$/.test(password)) {
    reasons.push('Mélangez majuscules, chiffres ou caractères de ponctuation.');
  }

  if (/^(.)\1*$/.test(password)) {
    reasons.push('Un caractère répété ne constitue pas un mot de passe.');
  }

  return reasons;
}

/** Vrai lorsque le mot de passe satisfait la politique. */
export function isPasswordAcceptable(
  password: string,
  context: readonly string[] = [],
): boolean {
  return assessPassword(password, context).length === 0;
}

/** Énoncé affiché sous le champ, avant toute saisie. */
export const PASSWORD_POLICY_HINT =
  `Au moins ${PASSWORD_MIN_LENGTH} caractères. ` +
  'Une phrase dont vous vous souvenez vaut mieux qu’un mot compliqué.';

/**
 * Éléments d'identité à interdire dans un mot de passe, déduits des
 * informations connues du compte.
 */
export function passwordContext(input: {
  username?: string | null;
  email?: string | null;
  fullName?: string | null;
}): string[] {
  const values: string[] = [];

  if (input.username) values.push(input.username);
  if (input.fullName) values.push(input.fullName);
  if (input.email) {
    values.push(input.email);
    const local = input.email.split('@')[0];
    if (local) values.push(local);
  }

  return values.filter((value) => value.trim().length >= 3);
}
