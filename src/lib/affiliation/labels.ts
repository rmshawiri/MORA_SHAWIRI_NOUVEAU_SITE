/**
 * Libellés de l'affiliation, sans dépendance serveur : lus par les pages de
 * l'administration comme par les composants.
 */

import type { EmailOutboxStatus } from '@/lib/supabase/types-affiliation';

export const EMAIL_STATUS_LABELS: Record<EmailOutboxStatus, string> = {
  EN_ATTENTE: 'En attente',
  ENVOYE: 'Envoyé',
  ECHEC: 'Échec',
};

/** Moments affichés à l'heure de Moroni, comme partout dans l'administration. */
export function formatMoment(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Indian/Comoro',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
