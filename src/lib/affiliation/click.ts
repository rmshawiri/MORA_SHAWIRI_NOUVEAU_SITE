import { createHmac } from 'node:crypto';

/**
 * Empreinte d'un visiteur — fonction pure, testée seule. L'enregistrement du
 * clic, qui lit la clé secrète, vit dans `click-record.ts` (server-only).
 *
 * L'adresse IP et l'agent utilisateur ne quittent jamais le processus : seule
 * une empreinte HMAC **journalière** est transmise, qui sert à ne pas compter
 * deux fois le même visiteur dans la demi-heure. Changer de jour change
 * l'empreinte : elle ne permet pas de suivre quelqu'un dans le temps.
 */

export type ClickResult = { token: string; windowDays: number } | null;

export function visitorHash(secret: string, ip: string, userAgent: string, day: string): string {
  return createHmac('sha256', `${secret}:affiliation:${day}`).update(`${ip}|${userAgent}`).digest('hex');
}
