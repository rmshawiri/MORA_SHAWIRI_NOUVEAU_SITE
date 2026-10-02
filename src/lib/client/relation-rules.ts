/**
 * Règles pures de l'espace client — demandes, devis, rendez-vous (phase 4I-3).
 *
 * Partagées par le tableau de bord, les rubriques et les tests : un compteur
 * et une liste qui ne suivraient pas la même règle finiraient par se
 * contredire. Aucun accès réseau ici.
 */

import type { AppointmentStatus, QuoteRequestStatus, QuoteStatus } from '@/lib/supabase/types';

type Appointment = { status: AppointmentStatus; scheduled_at: string | null };
type Quote = { status: QuoteStatus; valid_until: string | null };

export const OPEN_REQUEST_STATUSES: readonly QuoteRequestStatus[] = ['NOUVELLE', 'EN_ETUDE', 'DEVIS_ENVOYE'];

/**
 * Un rendez-vous « à venir » : en attente de confirmation, ou confirmé et pas
 * encore commencé. La même règle sert au tableau de bord et à la rubrique.
 */
export function isUpcoming(row: Appointment, now = new Date().toISOString()): boolean {
  return row.status === 'EN_ATTENTE' || (row.status === 'CONFIRME' && row.scheduled_at !== null && row.scheduled_at > now);
}

/** Le client peut-il annuler ? Pas commencé, et un état qui le permet. Aucun délai. */
export function canCancel(row: Appointment, now = new Date().toISOString()): boolean {
  if (row.status !== 'EN_ATTENTE' && row.status !== 'CONFIRME') return false;
  return row.scheduled_at === null || row.scheduled_at > now;
}

/** Le devis attend-il la décision du client ? Envoyé, et pas dépassé. */
export function awaitsDecision(quote: Quote, today: string): boolean {
  return quote.status === 'ENVOYE' && (quote.valid_until === null || quote.valid_until >= today);
}

/** Date du jour à Moroni (AAAA-MM-JJ), pour comparer à `valid_until`. */
export function todayInComoros(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Comoro', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
