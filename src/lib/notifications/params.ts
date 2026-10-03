/**
 * Données minimales d'une notification — phase 4J-1.
 *
 * Miroir de `public.notification_params_ok()` : au plus une référence
 * MORA-…, un code d'état et une date. Aucune autre clé n'est admise — ni
 * montant, ni nom, ni adresse, ni téléphone, ni texte libre (arbitrage N13).
 * La base refuse de toute façon ce que ce module refuserait ; il sert à lire
 * proprement ce qui revient de la base, et aux tests.
 */

export type NotificationParams = {
  reference?: string;
  statut?: string;
  date?: string;
};

export const NOTIFICATION_PARAM_KEYS = ['reference', 'statut', 'date'] as const;

export const REFERENCE_PATTERN = /^MORA-[A-Z]{3,6}-[A-Z]{1,2}[0-9]{4}$/;
const STATUS_PATTERN = /^[A-Z][A-Z_]{1,39}$/;
const DATE_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:?[0-9]{2})?)?$/;
const MAX_LENGTH = 300;

/** Vrai si l'objet serait accepté par la base. */
export function notificationParamsOk(value: unknown): value is NotificationParams {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (JSON.stringify(value).length > MAX_LENGTH) return false;
  for (const [key, raw] of Object.entries(value)) {
    if (!(NOTIFICATION_PARAM_KEYS as readonly string[]).includes(key)) return false;
    if (typeof raw !== 'string') return false;
    if (key === 'reference' && !REFERENCE_PATTERN.test(raw)) return false;
    if (key === 'statut' && !STATUS_PATTERN.test(raw)) return false;
    if (key === 'date' && !DATE_PATTERN.test(raw)) return false;
  }
  return true;
}

/** Lecture défensive : ce qui ne passe pas le contrôle est ignoré, jamais affiché. */
export function readNotificationParams(value: unknown): NotificationParams {
  return notificationParamsOk(value) ? value : {};
}
