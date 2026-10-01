/**
 * Affiliés — module pur partagé par l'administration et l'espace affilié.
 *
 * Une seule source pour les libellés, la forme des liens et la lecture d'une
 * règle stockée : l'administration et l'affilié voient donc exactement la même
 * chose, lue au même endroit (« une seule source de vérité », § 15 du cahier).
 */

import {
  describeRule,
  type Rule,
  type RuleOrigin,
  type Tier,
} from '@/lib/domain/affiliation';
import type {
  AcquisitionTrigger,
  AffiliateRuleRow,
  AffiliateStatus,
  PayoutAccountStatus,
  PayoutFrequency,
  ProspectProtectionMode,
} from '@/lib/supabase/types-affiliation';

export const AFFILIATE_STATUS_LABELS: Record<AffiliateStatus, string> = {
  PREPARATION: 'En préparation',
  ACTIF: 'Actif',
  SUSPENDU: 'Suspendu',
  TERMINE: 'Terminé',
};

export const PAYOUT_FREQUENCY_LABELS: Record<PayoutFrequency, string> = {
  HEBDOMADAIRE: 'Chaque semaine',
  FIN_DE_MOIS: 'En fin de mois',
  TRIMESTRIEL: 'Chaque trimestre',
  A_LA_DEMANDE: 'À la demande',
};

export const ACQUISITION_TRIGGER_LABELS: Record<AcquisitionTrigger, string> = {
  PAIEMENT_INTEGRAL: 'Quand l’affaire est intégralement payée',
  PREMIER_PAIEMENT: 'Dès le premier paiement confirmé',
  VALIDATION_MANUELLE: 'Sur validation de MORA Shawiri',
};

export const PROTECTION_MODE_LABELS: Record<ProspectProtectionMode, string> = {
  DUREE: 'Pendant une durée fixe après reconnaissance',
  PARTENARIAT: 'Pendant toute la durée du partenariat',
};

export const PAYOUT_ACCOUNT_STATUS_LABELS: Record<PayoutAccountStatus, string> = {
  DEMANDE: 'En attente de validation',
  ACTIF: 'Validé',
  REFUSE: 'Refusé',
  REMPLACE: 'Remplacé',
  RETIRE: 'Retiré',
};

/** Transitions offertes à l'administration — miroir de `change_affiliate_status`. */
export const AFFILIATE_STATUS_ACTIONS: Record<AffiliateStatus, readonly AffiliateStatus[]> = {
  PREPARATION: ['TERMINE'],
  ACTIF: ['SUSPENDU', 'TERMINE'],
  SUSPENDU: ['ACTIF', 'TERMINE'],
  TERMINE: [],
};

// -----------------------------------------------------------------------------
// Liens
// -----------------------------------------------------------------------------

export const REF_PARAM = 'ref';
export const CAMPAIGN_PARAM = 'c';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Lien d'affiliation. Construit sur l'URL réellement configurée du site
 * (`05_FONCTIONNALITES/01` § 126) ; aucune donnée personnelle dans la requête.
 */
export function affiliateLink(siteUrl: string, slug: string, campaign?: string | null): string {
  if (!SLUG.test(slug)) throw new RangeError('Identifiant de lien invalide.');
  const url = new URL('/', siteUrl);
  url.searchParams.set(REF_PARAM, slug);
  if (campaign) {
    if (!SLUG.test(campaign)) throw new RangeError('Code de campagne invalide.');
    url.searchParams.set(CAMPAIGN_PARAM, campaign);
  }
  return url.toString();
}

/** Code de campagne proposé à partir d'un libellé : « WhatsApp mai » → `whatsapp-mai`. */
export function campaignCode(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
}

// -----------------------------------------------------------------------------
// Règles stockées → moteur
// -----------------------------------------------------------------------------

/** Lecture d'une ligne `affiliate_rules` dans le vocabulaire du moteur pur. */
export function ruleFromRow(row: AffiliateRuleRow): Rule {
  return {
    id: row.id,
    version: row.version,
    owner:
      row.owner_type === 'AFFILIATE'
        ? { type: 'AFFILIATE', id: row.affiliate_id! }
        : { type: 'CATEGORY', id: row.category_id! },
    target:
      row.target_type === 'SERVICE'
        ? { type: 'SERVICE', id: row.service_id! }
        : row.target_type === 'PRODUCT'
          ? { type: 'PRODUCT', id: row.product_id! }
          : { type: 'ALL' },
    kind: row.kind,
    rate: row.rate,
    fixedAmount: row.fixed_amount,
    tiers: Array.isArray(row.tiers) ? (row.tiers as unknown as Tier[]) : null,
    minCommission: row.min_commission,
    maxCommission: row.max_commission,
    minBase: row.min_base,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    label: row.label,
    contractualDerogation: row.contractual_derogation,
  };
}

export function describeRuleRow(row: AffiliateRuleRow): string {
  return describeRule(ruleFromRow(row));
}

export function ruleOriginFor(row: AffiliateRuleRow): RuleOrigin {
  if (row.target_type !== 'ALL') return row.owner_type === 'AFFILIATE' ? 'OFFRE_AFFILIE' : 'OFFRE_CATEGORIE';
  return row.owner_type === 'AFFILIATE' ? 'INDIVIDUELLE' : 'CATEGORIE';
}

/** Une règle est en vigueur à l'instant donné : début inclus, fin exclue. */
export function ruleInForce(row: Pick<AffiliateRuleRow, 'valid_from' | 'valid_to'>, at: Date = new Date()): boolean {
  const time = at.getTime();
  return Date.parse(row.valid_from) <= time && (row.valid_to === null || Date.parse(row.valid_to) > time);
}

export type RuleState = 'EN_VIGUEUR' | 'PROGRAMMEE' | 'CLOSE';

export function ruleState(row: Pick<AffiliateRuleRow, 'valid_from' | 'valid_to'>, at: Date = new Date()): RuleState {
  if (Date.parse(row.valid_from) > at.getTime()) return 'PROGRAMMEE';
  return ruleInForce(row, at) ? 'EN_VIGUEUR' : 'CLOSE';
}

export const RULE_STATE_LABELS: Record<RuleState, string> = {
  EN_VIGUEUR: 'En vigueur',
  PROGRAMMEE: 'Programmée',
  CLOSE: 'Close',
};

export const RULE_KIND_LABELS: Record<Rule['kind'], string> = {
  PERCENT: 'Pourcentage',
  FIXED: 'Montant fixe',
  TIERED: 'Paliers',
  EXCLUDED: 'Exclusion',
};

// -----------------------------------------------------------------------------
// Codes de réduction
// -----------------------------------------------------------------------------

export type CodeDraft = {
  code: string;
  label: string;
  discountKind: 'PERCENT' | 'FIXED';
  discountValue: string;
  validFrom: string;
  validTo: string;
  minOrderAmount: string;
  maxDiscountAmount: string;
  maxUses: string;
  maxUsesPerCustomer: string;
};

const CODE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const DECIMAL = /^\d+(?:[.,]\d{1,2})?$/;
const INTEGER = /^\d+$/;

/** Erreurs d'un code saisi ; vide si le code est enregistrable. */
export function validateCode(draft: CodeDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const code = draft.code.trim().toUpperCase();
  if (!CODE.test(code) || code.length < 3 || code.length > 24) {
    errors.code = 'Lettres, chiffres et tirets, de 3 à 24 caractères.';
  }
  const value = draft.discountValue.trim().replace(',', '.');
  if (!DECIMAL.test(value) || Number(value) <= 0) errors.discountValue = 'Une valeur positive, deux décimales au plus.';
  else if (draft.discountKind === 'PERCENT' && Number(value) > 100) errors.discountValue = 'Un pourcentage ne dépasse pas 100.';
  for (const key of ['minOrderAmount', 'maxDiscountAmount'] as const) {
    const raw = draft[key].trim().replace(',', '.');
    if (raw && (!DECIMAL.test(raw) || Number(raw) <= 0)) errors[key] = 'Un montant positif, ou rien.';
  }
  for (const key of ['maxUses', 'maxUsesPerCustomer'] as const) {
    const raw = draft[key].trim();
    if (raw && (!INTEGER.test(raw) || Number(raw) <= 0)) errors[key] = 'Un nombre entier positif, ou rien.';
  }
  if (draft.validFrom && Number.isNaN(Date.parse(draft.validFrom))) errors.validFrom = 'Date invalide.';
  if (draft.validTo) {
    if (Number.isNaN(Date.parse(draft.validTo))) errors.validTo = 'Date invalide.';
    else if (draft.validFrom && Date.parse(draft.validTo) <= Date.parse(draft.validFrom)) {
      errors.validTo = 'La fin doit suivre le début.';
    }
  }
  return errors;
}

/** « 10 % » ou « 5 000 KMF » — la réduction accordée au client, jamais une commission. */
export function describeDiscount(kind: 'PERCENT' | 'FIXED', value: number): string {
  if (kind === 'PERCENT') return `${String(value).replace('.', ',')} % de réduction`;
  const whole = Math.trunc(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const cents = Math.round((value - Math.trunc(value)) * 100);
  return `${whole}${cents ? `,${String(cents).padStart(2, '0')}` : ''} KMF de réduction`;
}

/** Un code est utilisable : actif, commencé, pas encore échu. */
export function codeIsCurrent(
  code: { is_active: boolean; valid_from: string; valid_to: string | null },
  at: Date = new Date(),
): boolean {
  const time = at.getTime();
  return code.is_active && Date.parse(code.valid_from) <= time && (!code.valid_to || Date.parse(code.valid_to) > time);
}
