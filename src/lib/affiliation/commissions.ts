/**
 * Commissions — module pur partagé par l'administration et l'espace affilié.
 *
 * La base calcule, fige et fait vivre les commissions ; ce module ne fait que
 * les lire : libellés, graphe des statuts (miroir de
 * `affiliate_commission_transition_ok`, vérifié par un test), lecture des
 * lignes figées. Aucun montant n'est recalculé ici.
 */

import { formatKmf, toCents } from '@/lib/domain/affiliation';
import type { AdjustmentKind, CommissionStatus } from '@/lib/supabase/types-affiliation';
import type { Json } from '@/lib/supabase/types';

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  PREVISIONNELLE: 'Prévisionnelle',
  ACQUISE: 'Acquise',
  A_VERSER: 'À verser',
  VERSEE: 'Versée',
  ANNULEE: 'Annulée',
};

/** Ce que chaque statut veut dire pour l'affilié — affiché dans son espace. */
export const COMMISSION_STATUS_HINTS: Record<CommissionStatus, string> = {
  PREVISIONNELLE: 'L’affaire est en cours : le montant peut encore évoluer.',
  ACQUISE: 'La condition est remplie : le montant est définitif.',
  A_VERSER: 'Incluse dans un versement en préparation.',
  VERSEE: 'Versée.',
  ANNULEE: 'Annulée.',
};

export const COMMISSION_TRANSITIONS: Record<CommissionStatus, readonly CommissionStatus[]> = {
  PREVISIONNELLE: ['ACQUISE', 'ANNULEE'],
  ACQUISE: ['A_VERSER', 'ANNULEE'],
  A_VERSER: ['ACQUISE', 'VERSEE'],
  VERSEE: [],
  ANNULEE: [],
};

export const ADJUSTMENT_KIND_LABELS: Record<AdjustmentKind, string> = {
  REMBOURSEMENT: 'Remboursement du client',
  ANNULATION_APRES_VERSEMENT: 'Annulation après versement',
  CORRECTION: 'Correction',
  REATTRIBUTION: 'Affaire réattribuée',
};

export const LINE_REASON_LABELS: Record<string, string> = {
  OK: 'Commissionnée',
  OFFRE_ABSENTE: 'Ligne hors catalogue',
  OFFRE_NON_ELIGIBLE: 'Offre non éligible',
  AUCUNE_REGLE: 'Aucune règle applicable',
  EXCLUE: 'Exclue par la règle',
  ASSIETTE_NULLE: 'Montant nul',
  SOUS_SEUIL: 'Sous le seuil de la règle',
};

export function isCommissionStatus(value: unknown): value is CommissionStatus {
  return typeof value === 'string' && Object.hasOwn(COMMISSION_STATUS_LABELS, value);
}

export type CommissionLine = {
  designation: string;
  base: number;
  eligible: boolean;
  reason: string;
  rate: number | null;
  amount: number;
  capApplied: boolean;
  capRate: number | null;
  ruleLabel: string | null;
  ruleVersion: number | null;
  derogation: boolean;
};

const num = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
};

/** Lit les lignes figées d'une commission, sans jamais faire confiance à leur forme. */
export function readCommissionLines(lines: Json): CommissionLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const line = raw as Record<string, Json>;
    const rule = line.rule && typeof line.rule === 'object' && !Array.isArray(line.rule) ? (line.rule as Record<string, Json>) : null;
    return [{
      designation: typeof line.designation === 'string' ? line.designation : '—',
      base: num(line.base) ?? 0,
      eligible: line.eligible === true,
      reason: typeof line.reason === 'string' ? line.reason : 'OK',
      rate: num(line.rate),
      amount: num(line.amount) ?? 0,
      capApplied: line.capApplied === true,
      capRate: num(line.capRate),
      ruleLabel: rule && typeof rule.label === 'string' ? rule.label : null,
      ruleVersion: rule ? num(rule.version) : null,
      derogation: rule?.contractualDerogation === true,
    }];
  });
}

export function lineReasonLabel(reason: string): string {
  return (Object.hasOwn(LINE_REASON_LABELS, reason) ? LINE_REASON_LABELS[reason] : undefined) ?? reason;
}

/**
 * Montant d'ajustement saisi en KMF : entier ou décimal à deux chiffres,
 * signé, jamais nul. Rend `null` si la saisie est invalide.
 */
export function parseAdjustmentAmount(input: string): number | null {
  const normalized = input.replace(/\s| | /g, '').replace(',', '.');
  if (!/^[+-]?\d{1,10}(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return value === 0 ? null : value;
}

/** Montant lu en base (numeric) → « 24 000 KMF », signe compris. */
export function kmf(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '—';
  const cents = toCents(Math.abs(amount).toFixed(2));
  return amount < 0 ? `−${formatKmf(cents)}` : formatKmf(cents);
}
