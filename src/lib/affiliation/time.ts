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
