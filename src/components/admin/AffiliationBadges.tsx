import {
  APPLICATION_STATUS_LABELS,
  type ApplicationStatus,
} from '@/lib/affiliation/applications';
import { EMAIL_STATUS_LABELS } from '@/lib/affiliation/labels';
import type { EmailOutboxStatus } from '@/lib/supabase/types-affiliation';

/** Statut d'une candidature, dans les couleurs de l'administration. */
export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const className =
    status === 'ACCEPTEE'
      ? 'admin-badge--ok'
      : status === 'NOUVELLE'
        ? 'admin-badge--gold'
        : status === 'REFUSEE'
          ? 'admin-badge--danger'
          : 'admin-badge--muted';
  return <span className={`admin-badge ${className}`}>{APPLICATION_STATUS_LABELS[status]}</span>;
}

/** Résultat d'un e-mail journalisé. */
export function EmailStatusBadge({ status }: { status: EmailOutboxStatus }) {
  const className =
    status === 'ENVOYE' ? 'admin-badge--ok' : status === 'ECHEC' ? 'admin-badge--danger' : 'admin-badge--muted';
  return <span className={`admin-badge ${className}`}>{EMAIL_STATUS_LABELS[status]}</span>;
}
