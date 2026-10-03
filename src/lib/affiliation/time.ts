/**
 * Heure de Moroni ↔ instant absolu — module pur.
 *
 * Un champ `datetime-local` ne porte aucun fuseau : « 2026-10-05T09:00 » est
 * neuf heures *quelque part*. Pour une date d'effet de règle, c'est l'heure de
 * Moroni, celle que l'administrateur lit sur sa montre. Le décalage est
 * demandé à `Intl`, jamais écrit en dur (même choix qu'en 4F).
 */

export const MORONI = 'Indian/Comoro';

function zoneOffsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'));
  return asUtc - instant;
}

/** `2026-10-05T09:00` (heure de Moroni) → ISO 8601 absolu, ou `null` si invalide. */
export function moroniLocalToIso(value: string): string | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(naive)) return null;
  const instant = naive - zoneOffsetMs(naive, MORONI);
  return new Date(instant).toISOString();
}

/** Date du jour à Moroni, `AAAA-MM-JJ`. */
export function moroniToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MORONI }).format(now);
}

/** `2026-10-05T08:34:00Z` → `05/10/2026 à 11:34` (heure de Moroni). */
export function formatMoroniMoment(iso: string): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: MORONI,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} à ${part('hour')}:${part('minute')}`;
}

/**
 * Prise d'effet d'une règle, telle que l'administrateur l'a demandée.
 *
 * Deux choix explicites, jamais déduits d'un champ à moitié rempli :
 *
 *   * `IMMEDIAT` — `iso` vaut `null` : la base prend son propre `now()` au
 *     moment de la publication, et la règle est aussitôt en vigueur ;
 *   * `PROGRAMME` — une date **et** une heure de Moroni, toutes deux
 *     obligatoires. Une date seule n'est jamais complétée en minuit : c'est ce
 *     minuit implicite qui rendait « passée » la date du jour.
 *
 * Un instant programmé doit être strictement à venir : un instant atteint ou
 * dépassé relève de « Immédiatement », et le message le dit, heure de Moroni
 * à l'appui.
 */
export type EffectiveStart = { ok: true; iso: string | null } | { ok: false; message: string };

export function resolveEffectiveStart(
  mode: string,
  date: string,
  time: string,
  now: Date = new Date(),
): EffectiveStart {
  if (mode !== 'PROGRAMME') return { ok: true, iso: null };

  const day = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!day) return { ok: false, message: 'Indiquez la date de prise d’effet.' };
  const hour = time.trim().match(/^(\d{2}):(\d{2})$/);
  if (!hour) return { ok: false, message: 'Indiquez l’heure de prise d’effet (heure de Moroni).' };

  const [y, mo, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
  const [h, mi] = [Number(hour[1]), Number(hour[2])];
  // `Date.UTC` reporterait un 31 septembre au 1er octobre : on refuse.
  const calendar = new Date(Date.UTC(y, mo - 1, d));
  if (calendar.getUTCFullYear() !== y || calendar.getUTCMonth() !== mo - 1 || calendar.getUTCDate() !== d) {
    return { ok: false, message: 'Cette date n’existe pas.' };
  }
  if (h > 23 || mi > 59) return { ok: false, message: 'Cette heure n’existe pas.' };

  const iso = moroniLocalToIso(`${day[0]}T${hour[0]}`);
  if (!iso) return { ok: false, message: 'Date d’effet invalide.' };
  if (Date.parse(iso) <= now.getTime()) {
    return {
      ok: false,
      message: `Le ${formatMoroniMoment(iso)} (heure de Moroni) est déjà atteint : il est ${formatMoroniMoment(now.toISOString())} à Moroni. Choisissez « Immédiatement » ou une heure à venir.`,
    };
  }
  return { ok: true, iso };
}
