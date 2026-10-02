/**
 * Affichage de l'espace client (phase 4I).
 *
 * `formatDay` (4F) lit une **date seule** (« 2026-10-05 ») : c'est la forme
 * d'une date souhaitée de rendez-vous. Une date de création est un
 * **horodatage** : elle se lit ici, dans le fuseau des Comores — un compte
 * créé à 23 h 30 à Moroni l'a été ce jour-là, pas le lendemain en UTC.
 */

const ZONE = 'Indian/Comoro';

/** « 2 octobre 2026 » à partir d'un horodatage. */
export function formatClientDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONE }).format(date);
}
