import {
  APPLICATION_STATUS_LABELS,
  type ApplicationStatus,
} from '@/lib/affiliation/applications';
import { AFFILIATE_STATUS_LABELS, PAYOUT_ACCOUNT_STATUS_LABELS, RULE_STATE_LABELS, type RuleState } from '@/lib/affiliation/affiliates';
import { COMMISSION_STATUS_LABELS } from '@/lib/affiliation/commissions';
import { EMAIL_STATUS_LABELS } from '@/lib/affiliation/labels';
import type { AffiliateStatus, CommissionStatus, EmailOutboxStatus, PayoutAccountStatus } from '@/lib/supabase/types-affiliation';

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

export function AffiliateStatusBadge({ status }: { status: AffiliateStatus }) {
  const className =
    status === 'ACTIF'
      ? 'admin-badge--ok'
      : status === 'PREPARATION'
        ? 'admin-badge--gold'
        : status === 'TERMINE'
          ? 'admin-badge--danger'
          : 'admin-badge--muted';
  return <span className={`admin-badge ${className}`}>{AFFILIATE_STATUS_LABELS[status]}</span>;
}

export function RuleStateBadge({ state }: { state: RuleState }) {
  const className =
    state === 'EN_VIGUEUR' ? 'admin-badge--ok' : state === 'PROGRAMMEE' ? 'admin-badge--gold' : 'admin-badge--muted';
  return <span className={`admin-badge ${className}`}>{RULE_STATE_LABELS[state]}</span>;
}

export function PayoutAccountBadge({ status }: { status: PayoutAccountStatus }) {
  const className =
    status === 'ACTIF'
      ? 'admin-badge--ok'
      : status === 'DEMANDE'
        ? 'admin-badge--gold'
        : status === 'REFUSE'
          ? 'admin-badge--danger'
          : 'admin-badge--muted';
  return <span className={`admin-badge ${className}`}>{PAYOUT_ACCOUNT_STATUS_LABELS[status]}</span>;
}

export function CommissionStatusBadge({ status }: { status: CommissionStatus }) {
  const className =
    status === 'ACQUISE' || status === 'VERSEE'
      ? 'admin-badge--ok'
      : status === 'A_VERSER' || status === 'PREVISIONNELLE'
        ? 'admin-badge--gold'
        : 'admin-badge--muted';
  return <span className={`admin-badge ${className}`}>{COMMISSION_STATUS_LABELS[status]}</span>;
}
