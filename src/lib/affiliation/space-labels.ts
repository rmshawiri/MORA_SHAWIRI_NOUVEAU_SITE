/**
 * Espace affilié — libellés et tons d'affichage (phase 4H-8). Module pur.
 *
 * Il ne décide de rien : il traduit un état déjà calculé par la base en mots
 * et en couleur de pastille, de la même façon partout dans l'espace.
 */

import type { AffiliateCodeRow, AttributionSource, CommissionStatus, ProspectStatus } from '@/lib/supabase/types-affiliation';

export type Tone = 'ok' | 'todo' | 'muted' | 'warn';

export function commissionTone(status: CommissionStatus): Tone {
  switch (status) {
    case 'ACQUISE':
    case 'VERSEE':
      return 'ok';
    case 'PREVISIONNELLE':
    case 'A_VERSER':
      return 'todo';
    case 'ANNULEE':
      return 'muted';
  }
}

export function prospectTone(status: ProspectStatus): Tone {
  switch (status) {
    case 'RECONNU':
    case 'CONVERTI':
      return 'ok';
    case 'DECLARE':
    case 'A_VERIFIER':
      return 'todo';
    case 'REFUSE':
      return 'warn';
    case 'ANNULE':
      return 'muted';
  }
}

/** Comment l'affaire vous a été attribuée — dit à l'affilié, sans détail interne. */
export const ATTRIBUTION_SOURCE_LABELS: Record<AttributionSource, string> = {
  LIEN: 'Par votre lien',
  CODE: 'Par votre code partenaire',
  PROSPECT: 'Prospect déclaré et reconnu',
  ADMINISTRATION: 'Attribuée par MORA Shawiri',
};

export function attributionSourceLabel(value: string): string {
  return Object.hasOwn(ATTRIBUTION_SOURCE_LABELS, value) ? ATTRIBUTION_SOURCE_LABELS[value as AttributionSource] : 'Attribuée';
}

/** Statut d'une affaire attribuée, en mots simples. */
export const ATTRIBUTION_STATE_LABELS: Record<string, string> = {
  ACTIVE: 'En cours',
  VALIDEE: 'Confirmée',
};

/** État d'un code partenaire à un instant donné : actif, à venir, expiré ou désactivé. */
export function codeState(
  code: Pick<AffiliateCodeRow, 'is_active' | 'valid_from' | 'valid_to'>,
  at: Date = new Date(),
): { label: string; tone: Tone } {
  const now = at.getTime();
  if (!code.is_active) return { label: 'Désactivé', tone: 'muted' };
  if (Date.parse(code.valid_from) > now) return { label: 'À venir', tone: 'todo' };
  if (code.valid_to && Date.parse(code.valid_to) <= now) return { label: 'Expiré', tone: 'muted' };
  return { label: 'Actif', tone: 'ok' };
}
