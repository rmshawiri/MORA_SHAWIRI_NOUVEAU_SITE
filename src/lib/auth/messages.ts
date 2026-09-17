/**
 * Messages des parcours d'authentification.
 *
 * Ils sont rassemblés ici pour une raison de sécurité, pas de confort : la
 * protection contre l'énumération des comptes (`04_AUTHENTIFICATION.md`
 * § 31-32, § 101, § 171-173) tient entièrement à ce que **le même message soit
 * renvoyé quel que soit l'état réel du compte**. Éparpillés dans les
 * composants, ces libellés finiraient par diverger, et la première divergence
 * rendrait l'énumération possible.
 *
 * Trois règles tenues sans exception :
 *
 *   1. l'échec de connexion ne distingue jamais « compte inexistant » de
 *      « mot de passe erroné » ;
 *   2. la demande de réinitialisation répond la même chose à une adresse
 *      connue et à une adresse inconnue ;
 *   3. l'inscription ne révèle jamais qu'une adresse est déjà utilisée.
 *
 * Module pur : aucune entrée-sortie, couvert par `tests/unit/auth-messages.test.ts`.
 */

export const AUTH_MESSAGES = {
  /** § 32 — message générique d'échec de connexion. */
  invalidCredentials: 'Identifiants incorrects.',

  /** § 33-34 — compte suspendu ou désactivé. */
  accountUnavailable:
    'Ce compte n’est pas accessible actuellement. Contactez MORA Shawiri pour le rétablir.',

  /**
   * § 22 et § 171 — réponse unique à toute demande de réinitialisation.
   * Elle ne confirme ni n'infirme l'existence du compte.
   */
  resetRequested:
    'Si un compte correspond à cette adresse, un lien de réinitialisation vient d’y être envoyé. ' +
    'Vérifiez votre boîte de réception, ainsi que vos courriers indésirables.',

  /**
   * § 127 et § 171 — réponse unique à toute inscription.
   * Une adresse déjà utilisée reçoit exactement le même message.
   */
  registrationSubmitted:
    'Votre demande est enregistrée. Si cette adresse peut être utilisée, un message de ' +
    'confirmation vient d’y être envoyé : ouvrez le lien qu’il contient pour activer votre compte.',

  /** § 36-37 — limitation de fréquence atteinte. */
  rateLimited:
    'Trop de tentatives en peu de temps. Patientez quelques minutes avant de réessayer.',

  /** Erreur technique : ne décrit jamais la cause interne. */
  unexpected:
    'Une erreur est survenue et votre demande n’a pas abouti. Réessayez dans un instant.',

  /** Formulaire incomplet — ne dit rien de l'état du compte. */
  missingFields: 'Renseignez tous les champs obligatoires.',

  invalidEmail: 'Cette adresse e-mail semble incomplète. Exemple : nom@domaine.com',

  passwordMismatch: 'Les deux mots de passe saisis ne sont pas identiques.',

  passwordUnchanged: 'Choisissez un mot de passe différent de l’actuel.',

  passwordUpdated: 'Votre mot de passe a été modifié.',

  /** Consentement obligatoire à l'inscription. */
  termsRequired: 'Vous devez accepter les conditions générales d’utilisation pour créer un compte.',

  /** § 38 — soupçon d'automatisation (pot de miel rempli). */
  suspectedAutomation:
    'Votre demande n’a pas pu être traitée. Réessayez, ou contactez MORA Shawiri directement.',

  registrationClosed:
    'La création de compte n’est pas ouverte pour le moment. Contactez MORA Shawiri : ' +
    'nous ouvrirons votre accès manuellement.',

  /** Lien de confirmation ou de réinitialisation inutilisable. */
  linkUnusable:
    'Ce lien n’est plus valable. Il a peut-être expiré, déjà servi, ou été ouvert dans un autre ' +
    'navigateur que celui d’où la demande est partie. Recommencez la démarche.',

  sessionRequired: 'Votre session a expiré. Reconnectez-vous pour poursuivre.',

  /* ----------------------------------------------------- double facteur --- */

  mfaCodeInvalid:
    'Ce code n’a pas été accepté. Vérifiez qu’il provient bien de votre application ' +
    'd’authentification et qu’il n’a pas expiré.',

  mfaCodeFormat: 'Saisissez les six chiffres affichés par votre application d’authentification.',

  mfaEnrolled: 'La double authentification est active sur votre compte.',

  mfaFactorRemoved:
    'Le facteur a été retiré. Un nouveau facteur vous sera demandé à votre prochaine connexion.',

  mfaRemovalRefused:
    'Ce facteur ne peut pas être retiré : la double authentification est obligatoire pour les ' +
    'comptes d’administration, et votre compte n’en possède pas d’autre. Enrôlez d’abord un ' +
    'nouveau facteur.',
} as const;

export type AuthMessageKey = keyof typeof AUTH_MESSAGES;

/**
 * Résultat d'une action d'authentification, tel que les formulaires le lisent.
 *
 * `ok` ne porte jamais d'information sur l'existence d'un compte : une
 * inscription sur une adresse déjà prise renvoie `ok: true`, exactement comme
 * une inscription nouvelle.
 */
export type AuthActionState = {
  status: 'idle' | 'ok' | 'error';
  message: string;
  /** Motifs de refus d'un mot de passe, affichés sous le champ concerné. */
  reasons?: string[];
};

export const AUTH_IDLE: AuthActionState = { status: 'idle', message: '' };

/**
 * État du parcours d'enrôlement d'un facteur TOTP.
 *
 * Il transporte le code QR et le secret, qui doivent nécessairement parvenir à
 * l'écran de la personne qui enrôle son application. Ni l'un ni l'autre n'est
 * journalisé, ni enregistré en base : ils ne font que traverser.
 *
 * Défini ici et non dans `actions.ts`, parce qu'un fichier `'use server'`
 * n'exporte que des fonctions asynchrones — une constante y serait refusée à la
 * compilation.
 */
export type MfaEnrolmentState = AuthActionState & {
  factorId?: string;
  /** Code QR au format SVG, produit par Supabase Auth. */
  qrCode?: string;
  /** Secret en clair, pour une saisie manuelle lorsque la caméra fait défaut. */
  secret?: string;
};

export const MFA_ENROLMENT_IDLE: MfaEnrolmentState = { status: 'idle', message: '' };

export function authError(message: string, reasons?: string[]): AuthActionState {
  return { status: 'error', message, ...(reasons && reasons.length > 0 ? { reasons } : {}) };
}

export function authOk(message: string): AuthActionState {
  return { status: 'ok', message };
}
