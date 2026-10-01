/**
 * Versements — module pur partagé par l'administration et l'espace affilié.
 *
 * La base prépare, verrouille et confirme ; ce module lit : libellés, lignes
 * figées d'un versement, moyen figé, et règles de forme du justificatif.
 */

import type { Json } from '@/lib/supabase/types';
import type { PayoutStatus } from '@/lib/supabase/types-affiliation';

import { ADJUSTMENT_KIND_LABELS } from './commissions';

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  BROUILLON: 'En préparation',
  CONFIRME: 'Confirmé',
  ANNULE: 'Annulé',
};

export type PayoutLine = {
  type: 'COMMISSION' | 'AJUSTEMENT';
  label: string;
  detail: string | null;
  amount: number;
};

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Lit l'instantané d'une ligne de versement, sans faire confiance à sa forme. */
export function readPayoutLine(snapshot: Json): PayoutLine | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const s = snapshot as Record<string, Json>;
  if (s.type === 'COMMISSION') {
    return {
      type: 'COMMISSION',
      label: typeof s.reference === 'string' ? s.reference : 'Commission',
      detail: typeof s.order === 'string' ? `Commande ${s.order}` : null,
      amount: num(s.amount),
    };
  }
  if (s.type === 'AJUSTEMENT') {
    const kind = typeof s.kind === 'string' && Object.hasOwn(ADJUSTMENT_KIND_LABELS, s.kind)
      ? ADJUSTMENT_KIND_LABELS[s.kind as keyof typeof ADJUSTMENT_KIND_LABELS]
      : 'Ajustement';
    const about = typeof s.commission === 'string' ? ` — ${s.commission}` : '';
    return {
      type: 'AJUSTEMENT',
      label: `${kind}${about}`,
      detail: typeof s.reason === 'string' ? s.reason : null,
      amount: num(s.amount),
    };
  }
  return null;
}

export type MethodSnapshot = { code: string; label: string; details: Record<string, string> };

/** Moyen figé à la confirmation ; les coordonnées y sont déjà masquées. */
export function readMethodSnapshot(snapshot: Json | null): MethodSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const s = snapshot as Record<string, Json>;
  if (typeof s.code !== 'string') return null;
  const details: Record<string, string> = {};
  if (s.details && typeof s.details === 'object' && !Array.isArray(s.details)) {
    for (const [key, value] of Object.entries(s.details)) if (typeof value === 'string') details[key] = value;
  }
  return { code: s.code, label: typeof s.label === 'string' ? s.label : s.code, details };
}

// -----------------------------------------------------------------------------
// Justificatif — mêmes contrôles que les justificatifs de paiement (4G) :
// `sniffProof` lit le type réel ; le chemin est construit ici, jamais reçu.
// -----------------------------------------------------------------------------

export function proofPath(payoutId: string, fileId: string, extension: string): string | null {
  if (!/^(pdf|png|jpg|jpeg|webp)$/.test(extension)) return null;
  return `RVAF/${payoutId}/${fileId}.${extension}`;
}

/** Date réelle au format AAAA-MM-JJ (le 31 février est refusé). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Date d'un versement. Seul le jour est saisi : la base l'enregistre à midi
 * (heure de Moroni) pour qu'aucun fuseau ne le fasse changer de jour. L'heure
 * n'a donc pas de sens et ne s'affiche pas.
 */
export function formatPayoutDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Indian/Comoro' }).format(new Date(iso));
}
