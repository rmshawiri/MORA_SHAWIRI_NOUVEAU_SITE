/**
 * Affichage de l'espace client (phase 4I).
 *
 * `formatDay` (4F) lit une **date seule** (« 2026-10-05 ») : c'est la forme
 * d'une date souhaitée de rendez-vous. Une date de création est un
 * **horodatage** : elle se lit ici, dans le fuseau des Comores — un compte
 * créé à 23 h 30 à Moroni l'a été ce jour-là, pas le lendemain en UTC.
 */

import { APPOINTMENT_STATUS_LABELS, formatMoment, QUOTE_REQUEST_STATUS_LABELS } from '@/lib/relation/labels';
import type { AppointmentTimelineEntry, RequestTimelineEntry } from '@/lib/supabase/types-client';

const ZONE = 'Indian/Comoro';

/** « 2 octobre 2026 » à partir d'un horodatage. */
export function formatClientDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONE }).format(date);
}

/* ------------------------------------------------------------------ */
/* Chronologies client (phase 4I-3)                                    */
/* ------------------------------------------------------------------ */


/**
 * Ce que dit au client un événement de sa demande. Jamais le nom d'un agent :
 * « vous » quand l'acte vient du client, la marque sinon. Le motif n'apparaît
 * que s'il vient du client lui-même (la base ne rend pas les autres).
 */
export function describeRequestEvent(entry: RequestTimelineEntry): string {
  const ref = entry.quote_reference ?? '';
  switch (entry.kind) {
    case 'CREATION':
      return 'Demande envoyée';
    case 'STATUT':
      return `Demande : ${QUOTE_REQUEST_STATUS_LABELS[entry.to_status as keyof typeof QUOTE_REQUEST_STATUS_LABELS] ?? entry.to_status ?? '—'}`;
    case 'DEVIS_STATUT':
      switch (entry.to_status) {
        case 'ENVOYE':
          return `Devis ${ref} envoyé par MORA Shawiri`;
        case 'ACCEPTE':
          return entry.by_me ? `Vous avez accepté le devis ${ref}` : `Devis ${ref} accepté`;
        case 'REFUSE':
          return entry.by_me
            ? `Vous avez refusé le devis ${ref}${entry.note ? ` — motif : ${entry.note}` : ''}`
            : `Devis ${ref} refusé`;
        case 'EXPIRE':
          return `Devis ${ref} expiré`;
        case 'ANNULE':
          return `Devis ${ref} annulé par MORA Shawiri`;
        default:
          return `Devis ${ref}`;
      }
    default:
      return 'Mise à jour';
  }
}

export function describeAppointmentEvent(entry: AppointmentTimelineEntry): string {
  switch (entry.kind) {
    case 'CREATION':
      return 'Demande de rendez-vous envoyée';
    case 'REPROGRAMMATION':
      return `Rendez-vous déplacé au ${formatMoment(entry.scheduled_at_after)}`;
    case 'STATUT':
      if (entry.to_status === 'ANNULE') {
        return entry.by_me ? `Vous avez annulé le rendez-vous${entry.note ? ` — motif : ${entry.note}` : ''}` : 'Rendez-vous annulé par MORA Shawiri';
      }
      if (entry.to_status === 'CONFIRME') return `Rendez-vous confirmé${entry.scheduled_at_after ? ` pour le ${formatMoment(entry.scheduled_at_after)}` : ''}`;
      return `Rendez-vous : ${APPOINTMENT_STATUS_LABELS[entry.to_status as keyof typeof APPOINTMENT_STATUS_LABELS] ?? entry.to_status ?? '—'}`;
    default:
      return 'Mise à jour';
  }
}
