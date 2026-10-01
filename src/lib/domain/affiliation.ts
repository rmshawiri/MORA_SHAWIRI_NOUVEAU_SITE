/**
 * Moteur de règles d'affiliation — module pur (phase 4H).
 *
 * Aucune dépendance serveur, aucun accès réseau. Ce fichier répond à deux
 * questions, et à elles seules :
 *
 *   1. **Quelle règle s'applique ?** — `resolveRule()`, à partir des règles
 *      d'une catégorie et d'un affilié, d'une offre et d'une date.
 *   2. **Combien ?** — `computeCommission()`, à partir d'une règle et d'une
 *      assiette.
 *
 * Il ne décide ni de l'attribution d'une affaire, ni du moment où une
 * commission devient exigible, ni de son versement : ces questions dépendent
 * de décisions propriétaire encore ouvertes (rapport 4H § 41) et vivent
 * ailleurs.
 *
 * ## L'héritage, tel que le propriétaire l'a fixé
 *
 * > RÈGLE SPÉCIFIQUE SERVICE / PRODUIT / OFFRE
 * > ↓ sinon RÈGLE INDIVIDUELLE AFFILIÉ
 * > ↓ sinon RÈGLE PAR DÉFAUT DE LA CATÉGORIE
 *
 * Une règle spécifique à une offre peut être posée sur l'affilié ou sur sa
 * catégorie. L'ordre complet, déterministe, est donc :
 *
 *   1. offre spécifique, posée sur l'affilié ;
 *   2. offre spécifique, posée sur la catégorie ;
 *   3. règle générale de l'affilié ;
 *   4. règle générale de la catégorie.
 *
 * Le premier niveau qui porte une règle en vigueur à la date demandée gagne.
 * Deux règles en vigueur au même niveau, à la même date, sont une erreur de
 * configuration — le moteur la signale au lieu de choisir (la base l'empêche
 * en amont par une contrainte d'exclusion).
 *
 * ## Les règles ne se modifient pas : elles se succèdent
 *
 * Une règle porte une période de validité `[validFrom, validTo)`. Changer un
 * taux, c'est clore la version en cours et en ouvrir une nouvelle. Résoudre à
 * la date d'une affaire ancienne rend donc toujours la version d'alors — et
 * une commission enregistrée garde de toute façon l'instantané complet de la
 * règle (`ruleSnapshot`) : rien n'est recalculé après coup.
 *
 * ## Monnaie
 *
 * Tous les calculs se font en **centimes entiers** (`bigint`), avec un arrondi
 * au demi supérieur au centime — la précision des montants en base
 * (`numeric(12, 2)`) et celle des exemples du document de référence
 * (`05_FONCTIONNALITES/01` § 22 : 112,50 KMF). Aucun flottant n'intervient
 * dans un montant (§ 145).
 *
 * ## Ce que ce module ne connaît pas
 *
 * Aucun affilié n'y est nommé. Un partenariat contractuel n'est qu'une
 * configuration parmi d'autres — par exemple deux paliers et un plancher sur
 * le premier. Les tests en reproduisent une à partir d'une convention signée,
 * sans qu'une ligne de ce fichier ne lui soit propre (un test y veille).
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Montant tel qu'il circule : PostgREST sérialise `numeric` en nombre. */
export type MoneyInput = number | string;

export type RuleKind = 'PERCENT' | 'FIXED' | 'TIERED' | 'EXCLUDED';

export type RuleOwner =
  | { type: 'CATEGORY'; id: string }
  | { type: 'AFFILIATE'; id: string };

export type RuleTarget =
  | { type: 'ALL' }
  | { type: 'SERVICE'; id: string }
  | { type: 'PRODUCT'; id: string };

/**
 * Un palier : `[from, to)` en KMF. `to = null` ferme la grille vers le haut.
 * Chaque palier rémunère soit en pourcentage, soit en montant fixe, et peut
 * porter son propre plancher et son propre plafond.
 */
export type Tier = {
  from: MoneyInput;
  to: MoneyInput | null;
  rate?: number | null;
  fixedAmount?: MoneyInput | null;
  minCommission?: MoneyInput | null;
  maxCommission?: MoneyInput | null;
  label?: string | null;
};

export type Rule = {
  id: string;
  version: number;
  owner: RuleOwner;
  target: RuleTarget;
  kind: RuleKind;
  /** Pourcentage, 0 < rate ≤ 100, deux décimales au plus. */
  rate?: number | null;
  fixedAmount?: MoneyInput | null;
  tiers?: readonly Tier[] | null;
  /** Plancher et plafond de la commission, après palier. */
  minCommission?: MoneyInput | null;
  maxCommission?: MoneyInput | null;
  /** Seuil : en deçà de cette assiette, aucune commission. */
  minBase?: MoneyInput | null;
  /** Début inclus, fin exclue. ISO 8601. */
  validFrom: string;
  validTo?: string | null;
  label?: string | null;
  /**
   * N1 : règle individuelle autorisée à dépasser le plafond de l'offre.
   * Jamais à lever son inéligibilité.
   */
  contractualDerogation?: boolean;
};

/** Réglages d'affiliation d'une offre du catalogue (`services`, `products`). */
export type OfferAffiliation = {
  eligible: boolean;
  /** `affiliate_max_rate`. Nul : affiliation indisponible (§ 11). */
  maxRate: number | null;
};

/**
 * Décision N1, en une fonction : l'offre doit être éligible — sans exception,
 * dérogation comprise ; son plafond s'applique ensuite, sauf à une règle
 * individuelle marquée « dérogation contractuelle ».
 */
export function offerConstraint(
  rule: Pick<Rule, 'owner' | 'contractualDerogation'>,
  offer: OfferAffiliation | null,
): { allowed: true; capRate: number | null } | { allowed: false; reason: 'OFFRE_ABSENTE' | 'OFFRE_NON_ELIGIBLE' } {
  if (offer === null) return { allowed: false, reason: 'OFFRE_ABSENTE' };
  if (!offer.eligible || offer.maxRate === null) return { allowed: false, reason: 'OFFRE_NON_ELIGIBLE' };
  const derogation = rule.contractualDerogation === true && rule.owner.type === 'AFFILIATE';
  return { allowed: true, capRate: derogation ? null : offer.maxRate };
}

export type RuleOrigin =
  | 'OFFRE_AFFILIE'
  | 'OFFRE_CATEGORIE'
  | 'INDIVIDUELLE'
  | 'CATEGORIE';

export const RULE_ORIGIN_LABELS: Record<RuleOrigin, string> = {
  OFFRE_AFFILIE: 'Offre/service spécifique — individuelle',
  OFFRE_CATEGORIE: 'Offre/service spécifique — catégorie',
  INDIVIDUELLE: 'Individuelle',
  CATEGORIE: 'Catégorie',
};

export type ResolveContext = {
  affiliateId: string;
  categoryId: string;
  /** Offre de la ligne commissionnée ; `null` si la ligne n'est rattachée à aucune offre. */
  offer: { type: 'SERVICE' | 'PRODUCT'; id: string } | null;
  /** Date de l'affaire. ISO 8601 ou `Date`. */
  at: string | Date;
};

export type Resolution =
  | { status: 'FOUND'; rule: Rule; origin: RuleOrigin }
  | { status: 'NONE' }
  | { status: 'CONFLICT'; origin: RuleOrigin; ruleIds: string[] };

export type CommissionResult = {
  /** La règle exclut l'affaire, ou l'assiette n'atteint pas le seuil. */
  eligible: boolean;
  reason: 'OK' | 'EXCLUE' | 'SOUS_SEUIL' | 'ASSIETTE_NULLE';
  baseCents: bigint;
  /** Taux effectivement appliqué, s'il y en a un. */
  rate: number | null;
  /** Index du palier retenu (règle à paliers). */
  tierIndex: number | null;
  /** Montant avant plancher et plafond. */
  rawCents: bigint;
  amountCents: bigint;
  minApplied: boolean;
  maxApplied: boolean;
  /** Le plafond de l'offre (N1) a réduit le montant. */
  capApplied: boolean;
};

export type ComputeOptions = {
  /**
   * Plafond de commission de l'offre, en pourcentage de l'assiette
   * (`affiliate_max_rate`). Décision N1 : il s'applique, plancher compris,
   * sauf règle individuelle marquée « dérogation contractuelle » — l'appelant
   * passe alors `null`. Il ne remplace jamais l'éligibilité de l'offre, qui se
   * vérifie avant tout calcul.
   */
  capRate?: number | null;
};

// -----------------------------------------------------------------------------
// Monnaie
// -----------------------------------------------------------------------------

const MONEY_PATTERN = /^-?\d+(?:[.,]\d{1,2})?$/;

/** Convertit un montant en centimes entiers. Refuse plus de deux décimales. */
export function toCents(value: MoneyInput): bigint {
  const text = typeof value === 'number' ? numberToText(value) : value.trim();
  if (!MONEY_PATTERN.test(text)) {
    throw new RangeError(`Montant invalide : ${String(value)}`);
  }
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').replace(',', '.').split('.');
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

function numberToText(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Montant invalide : ${value}`);
  // Deux décimales au plus : au-delà, c'est une erreur d'appelant, pas un arrondi.
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded - value) > 1e-9) {
    throw new RangeError(`Montant à plus de deux décimales : ${value}`);
  }
  return rounded.toFixed(2);
}

/** Centimes → chaîne décimale `1234.50`, sans séparateur de milliers. */
export function centsToDecimal(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Taux en points de base : 12,5 % → 1250. Deux décimales au plus. */
export function rateToBasisPoints(rate: number): bigint {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
    throw new RangeError(`Taux invalide : ${rate}`);
  }
  const bp = Math.round(rate * 100);
  if (Math.abs(bp / 100 - rate) > 1e-9) {
    throw new RangeError(`Taux à plus de deux décimales : ${rate}`);
  }
  return BigInt(bp);
}

/** `base × taux`, arrondi au demi supérieur au centime. Assiette positive. */
export function applyRate(baseCents: bigint, rate: number): bigint {
  const bp = rateToBasisPoints(rate);
  return (baseCents * bp + 5000n) / 10000n;
}

// -----------------------------------------------------------------------------
// Validation d'une règle
// -----------------------------------------------------------------------------

/**
 * Liste les défauts de configuration d'une règle. Une liste vide signifie
 * qu'elle est calculable sans ambiguïté. Le serveur refuse d'enregistrer une
 * règle qui en a ; l'interface les affiche.
 */
export function validateRule(rule: Rule): string[] {
  const errors: string[] = [];
  const money = (value: MoneyInput | null | undefined, field: string, allowZero = true) => {
    if (value === null || value === undefined) return null;
    try {
      const cents = toCents(value);
      if (cents < 0n || (!allowZero && cents === 0n)) errors.push(`${field} doit être positif.`);
      return cents;
    } catch {
      errors.push(`${field} est invalide.`);
      return null;
    }
  };
  const rate = (value: number | null | undefined, field: string) => {
    try {
      rateToBasisPoints(value as number);
    } catch {
      errors.push(`${field} doit être compris entre 0 et 100 %, deux décimales au plus.`);
    }
  };

  if (!rule.validFrom || Number.isNaN(Date.parse(rule.validFrom))) {
    errors.push('La date de début est invalide.');
  }
  if (rule.validTo) {
    if (Number.isNaN(Date.parse(rule.validTo))) errors.push('La date de fin est invalide.');
    else if (Date.parse(rule.validTo) <= Date.parse(rule.validFrom)) {
      errors.push('La date de fin doit suivre la date de début.');
    }
  }

  const min = money(rule.minCommission, 'La commission minimale');
  const max = money(rule.maxCommission, 'La commission maximale', false);
  if (min !== null && max !== null && min > max) {
    errors.push('La commission minimale dépasse la commission maximale.');
  }
  money(rule.minBase, 'Le seuil d’assiette');

  switch (rule.kind) {
    case 'PERCENT':
      rate(rule.rate, 'Le taux');
      if (rule.fixedAmount != null || rule.tiers?.length) {
        errors.push('Une règle en pourcentage ne porte ni montant fixe ni palier.');
      }
      break;
    case 'FIXED':
      money(rule.fixedAmount ?? null, 'Le montant fixe', false);
      if (rule.fixedAmount == null) errors.push('Le montant fixe est requis.');
      if (rule.rate != null || rule.tiers?.length) {
        errors.push('Une règle à montant fixe ne porte ni taux ni palier.');
      }
      break;
    case 'TIERED':
      if (rule.rate != null || rule.fixedAmount != null) {
        errors.push('Une règle à paliers porte ses taux dans ses paliers.');
      }
      errors.push(...validateTiers(rule.tiers ?? []));
      break;
    case 'EXCLUDED':
      if (
        rule.rate != null ||
        rule.fixedAmount != null ||
        rule.tiers?.length ||
        rule.minCommission != null ||
        rule.maxCommission != null
      ) {
        errors.push('Une exclusion ne porte aucun paramètre de rémunération.');
      }
      break;
    default:
      errors.push('Type de règle inconnu.');
  }
  return errors;
}

/**
 * Une grille de paliers doit couvrir `[0, +∞)` sans trou ni recouvrement,
 * dans l'ordre. Sans cela, une assiette tomberait hors grille, ou dans deux
 * paliers à la fois — et le calcul ne serait plus déterministe.
 */
export function validateTiers(tiers: readonly Tier[]): string[] {
  const errors: string[] = [];
  if (tiers.length === 0) return ['Au moins un palier est requis.'];

  let expectedFrom = 0n;
  tiers.forEach((tier, index) => {
    const n = index + 1;
    let from: bigint;
    try {
      from = toCents(tier.from);
    } catch {
      errors.push(`Palier ${n} : borne basse invalide.`);
      return;
    }
    if (from !== expectedFrom) {
      errors.push(
        index === 0
          ? 'Le premier palier doit commencer à 0.'
          : `Palier ${n} : doit commencer exactement où finit le précédent.`,
      );
    }
    const last = index === tiers.length - 1;
    if (tier.to === null || tier.to === undefined) {
      if (!last) errors.push(`Palier ${n} : seul le dernier palier peut être ouvert.`);
    } else {
      let to: bigint;
      try {
        to = toCents(tier.to);
      } catch {
        errors.push(`Palier ${n} : borne haute invalide.`);
        return;
      }
      if (to <= from) errors.push(`Palier ${n} : la borne haute doit dépasser la borne basse.`);
      if (last) errors.push('Le dernier palier doit être ouvert (sans borne haute).');
      expectedFrom = to;
    }

    const hasRate = tier.rate !== null && tier.rate !== undefined;
    const hasFixed = tier.fixedAmount !== null && tier.fixedAmount !== undefined;
    if (hasRate === hasFixed) {
      errors.push(`Palier ${n} : un taux OU un montant fixe, exactement.`);
    }
    if (hasRate) {
      try {
        rateToBasisPoints(tier.rate as number);
      } catch {
        errors.push(`Palier ${n} : taux invalide.`);
      }
    }
    const tierMoney = (value: MoneyInput | null | undefined, field: string) => {
      if (value === null || value === undefined) return null;
      try {
        const cents = toCents(value);
        if (cents < 0n) errors.push(`Palier ${n} : ${field} négatif.`);
        return cents;
      } catch {
        errors.push(`Palier ${n} : ${field} invalide.`);
        return null;
      }
    };
    tierMoney(tier.fixedAmount, 'montant fixe');
    const min = tierMoney(tier.minCommission, 'minimum');
    const max = tierMoney(tier.maxCommission, 'maximum');
    if (min !== null && max !== null && min > max) {
      errors.push(`Palier ${n} : le minimum dépasse le maximum.`);
    }
  });
  return errors;
}

// -----------------------------------------------------------------------------
// Résolution : quelle règle s'applique ?
// -----------------------------------------------------------------------------

function toTime(value: string | Date): number {
  const time = typeof value === 'string' ? Date.parse(value) : value.getTime();
  if (Number.isNaN(time)) throw new RangeError(`Date invalide : ${String(value)}`);
  return time;
}

/** Vrai si la règle est en vigueur à l'instant donné : début inclus, fin exclue. */
export function isRuleInForce(rule: Pick<Rule, 'validFrom' | 'validTo'>, at: string | Date): boolean {
  const time = toTime(at);
  if (Date.parse(rule.validFrom) > time) return false;
  if (rule.validTo && Date.parse(rule.validTo) <= time) return false;
  return true;
}

/**
 * Rend la règle applicable et son origine, selon l'héritage fixé par le
 * propriétaire. Ne choisit jamais entre deux règles de même niveau.
 */
export function resolveRule(rules: readonly Rule[], context: ResolveContext): Resolution {
  const inForce = rules.filter((rule) => isRuleInForce(rule, context.at));

  const sameOffer = (rule: Rule) =>
    context.offer !== null &&
    rule.target.type === context.offer.type &&
    rule.target.id === context.offer.id;

  const levels: { origin: RuleOrigin; match: (rule: Rule) => boolean }[] = [
    {
      origin: 'OFFRE_AFFILIE',
      match: (r) => r.owner.type === 'AFFILIATE' && r.owner.id === context.affiliateId && sameOffer(r),
    },
    {
      origin: 'OFFRE_CATEGORIE',
      match: (r) => r.owner.type === 'CATEGORY' && r.owner.id === context.categoryId && sameOffer(r),
    },
    {
      origin: 'INDIVIDUELLE',
      match: (r) =>
        r.owner.type === 'AFFILIATE' && r.owner.id === context.affiliateId && r.target.type === 'ALL',
    },
    {
      origin: 'CATEGORIE',
      match: (r) =>
        r.owner.type === 'CATEGORY' && r.owner.id === context.categoryId && r.target.type === 'ALL',
    },
  ];

  for (const level of levels) {
    const found = inForce.filter(level.match);
    if (found.length === 1) return { status: 'FOUND', rule: found[0]!, origin: level.origin };
    if (found.length > 1) {
      return { status: 'CONFLICT', origin: level.origin, ruleIds: found.map((r) => r.id) };
    }
  }
  return { status: 'NONE' };
}

// -----------------------------------------------------------------------------
// Calcul : combien ?
// -----------------------------------------------------------------------------

function clamp(
  cents: bigint,
  min: MoneyInput | null | undefined,
  max: MoneyInput | null | undefined,
): { cents: bigint; minApplied: boolean; maxApplied: boolean } {
  let value = cents;
  let minApplied = false;
  let maxApplied = false;
  if (min !== null && min !== undefined) {
    const floor = toCents(min);
    if (value < floor) {
      value = floor;
      minApplied = true;
    }
  }
  if (max !== null && max !== undefined) {
    const ceiling = toCents(max);
    if (value > ceiling) {
      value = ceiling;
      maxApplied = true;
      minApplied = false;
    }
  }
  return { cents: value, minApplied, maxApplied };
}

/** Index du palier qui contient l'assiette : `from ≤ base < to`. */
export function findTier(tiers: readonly Tier[], baseCents: bigint): number {
  return tiers.findIndex((tier) => {
    const from = toCents(tier.from);
    const to = tier.to === null || tier.to === undefined ? null : toCents(tier.to);
    return baseCents >= from && (to === null || baseCents < to);
  });
}

/**
 * Calcule la commission d'une assiette selon une règle.
 *
 * Ordre des opérations, toujours le même — et le même que
 * `public.affiliate_compute()` en base :
 *   exclusion → seuil d'assiette → palier (taux ou fixe) → plancher/plafond du
 *   palier → plancher/plafond de la règle → plafond de l'offre.
 *
 * Une règle invalide lève une erreur : un calcul ne s'improvise pas sur une
 * configuration ambiguë.
 */
export function computeCommission(
  rule: Rule,
  base: MoneyInput,
  options: ComputeOptions = {},
): CommissionResult {
  const errors = validateRule(rule);
  if (errors.length > 0) {
    throw new Error(`Règle ${rule.id} invalide : ${errors.join(' ')}`);
  }

  const baseCents = toCents(base);
  if (baseCents < 0n) throw new RangeError('L’assiette ne peut pas être négative.');

  const empty = (reason: CommissionResult['reason']): CommissionResult => ({
    eligible: false,
    reason,
    baseCents,
    rate: null,
    tierIndex: null,
    rawCents: 0n,
    amountCents: 0n,
    minApplied: false,
    maxApplied: false,
    capApplied: false,
  });

  if (rule.kind === 'EXCLUDED') return empty('EXCLUE');
  if (baseCents === 0n) return empty('ASSIETTE_NULLE');
  if (rule.minBase !== null && rule.minBase !== undefined && baseCents < toCents(rule.minBase)) {
    return empty('SOUS_SEUIL');
  }

  let rate: number | null = null;
  let tierIndex: number | null = null;
  let rawCents: bigint;
  let afterTier: { cents: bigint; minApplied: boolean; maxApplied: boolean };

  if (rule.kind === 'PERCENT') {
    rate = rule.rate as number;
    rawCents = applyRate(baseCents, rate);
    afterTier = { cents: rawCents, minApplied: false, maxApplied: false };
  } else if (rule.kind === 'FIXED') {
    rawCents = toCents(rule.fixedAmount as MoneyInput);
    afterTier = { cents: rawCents, minApplied: false, maxApplied: false };
  } else {
    const tiers = rule.tiers ?? [];
    // validateTiers garantit la couverture de [0, +∞) : l'index existe.
    tierIndex = findTier(tiers, baseCents);
    const tier = tiers[tierIndex]!;
    if (tier.rate !== null && tier.rate !== undefined) {
      rate = tier.rate;
      rawCents = applyRate(baseCents, tier.rate);
    } else {
      rawCents = toCents(tier.fixedAmount as MoneyInput);
    }
    afterTier = clamp(rawCents, tier.minCommission, tier.maxCommission);
  }

  const final = clamp(afterTier.cents, rule.minCommission, rule.maxCommission);
  const changed = final.cents !== afterTier.cents;

  // N1 : le plafond de l'offre protège la marge, plancher compris.
  let amountCents = final.cents;
  let capApplied = false;
  if (options.capRate !== null && options.capRate !== undefined) {
    const capCents = applyRate(baseCents, options.capRate);
    if (amountCents > capCents) {
      amountCents = capCents;
      capApplied = true;
    }
  }

  return {
    eligible: true,
    reason: 'OK',
    baseCents,
    rate,
    tierIndex,
    rawCents,
    amountCents,
    capApplied,
    // Le dernier bornage qui a modifié le montant est celui qu'on rapporte.
    minApplied: changed ? final.minApplied : afterTier.minApplied,
    maxApplied: changed ? final.maxApplied : afterTier.maxApplied,
  };
}

// -----------------------------------------------------------------------------
// Instantané
// -----------------------------------------------------------------------------

export const RULE_SNAPSHOT_SCHEMA = 'affiliation-regle-1';

export type RuleSnapshot = {
  schema: typeof RULE_SNAPSHOT_SCHEMA;
  ruleId: string;
  version: number;
  origin: RuleOrigin;
  owner: RuleOwner;
  target: RuleTarget;
  kind: RuleKind;
  rate: number | null;
  fixedAmount: string | null;
  tiers: {
    from: string;
    to: string | null;
    rate: number | null;
    fixedAmount: string | null;
    minCommission: string | null;
    maxCommission: string | null;
    label: string | null;
  }[];
  minCommission: string | null;
  maxCommission: string | null;
  minBase: string | null;
  validFrom: string;
  validTo: string | null;
  label: string | null;
  contractualDerogation: boolean;
};

const decimalOrNull = (value: MoneyInput | null | undefined) =>
  value === null || value === undefined ? null : centsToDecimal(toCents(value));

/**
 * Copie normalisée et autonome de la règle appliquée. C'est elle qu'une
 * commission conserve : la règle source peut être close, remplacée ou
 * supprimée de l'affichage, l'instantané continue de dire ce qui a été
 * appliqué, et de permettre de refaire le calcul à l'identique.
 */
export function ruleSnapshot(rule: Rule, origin: RuleOrigin): RuleSnapshot {
  return {
    schema: RULE_SNAPSHOT_SCHEMA,
    ruleId: rule.id,
    version: rule.version,
    origin,
    owner: { ...rule.owner },
    target: { ...rule.target },
    kind: rule.kind,
    rate: rule.rate ?? null,
    fixedAmount: decimalOrNull(rule.fixedAmount),
    tiers: (rule.tiers ?? []).map((tier) => ({
      from: centsToDecimal(toCents(tier.from)),
      to: decimalOrNull(tier.to),
      rate: tier.rate ?? null,
      fixedAmount: decimalOrNull(tier.fixedAmount),
      minCommission: decimalOrNull(tier.minCommission),
      maxCommission: decimalOrNull(tier.maxCommission),
      label: tier.label ?? null,
    })),
    minCommission: decimalOrNull(rule.minCommission),
    maxCommission: decimalOrNull(rule.maxCommission),
    minBase: decimalOrNull(rule.minBase),
    validFrom: rule.validFrom,
    validTo: rule.validTo ?? null,
    label: rule.label ?? null,
    contractualDerogation: rule.contractualDerogation === true,
  };
}

/** Reconstruit une règle calculable depuis un instantané. */
export function ruleFromSnapshot(snapshot: RuleSnapshot): Rule {
  return {
    id: snapshot.ruleId,
    version: snapshot.version,
    owner: snapshot.owner,
    target: snapshot.target,
    kind: snapshot.kind,
    rate: snapshot.rate,
    fixedAmount: snapshot.fixedAmount,
    tiers: snapshot.tiers,
    minCommission: snapshot.minCommission,
    maxCommission: snapshot.maxCommission,
    minBase: snapshot.minBase,
    validFrom: snapshot.validFrom,
    validTo: snapshot.validTo,
    label: snapshot.label,
    contractualDerogation: snapshot.contractualDerogation,
  };
}

// -----------------------------------------------------------------------------
// Lecture humaine
// -----------------------------------------------------------------------------

const groupThousands = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** `360000.00` → `360 000 KMF` ; `112.50` → `112,50 KMF`. Sans `Intl`. */
export function formatKmf(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = groupThousands((abs / 100n).toString());
  const fraction = abs % 100n;
  const text = fraction === 0n ? whole : `${whole},${fraction.toString().padStart(2, '0')}`;
  return `${negative ? '–' : ''}${text} KMF`;
}

export function formatRate(rate: number): string {
  return `${String(rate).replace('.', ',')} %`;
}

/** Résumé d'une règle en une ligne, pour l'administration et l'espace affilié. */
export function describeRule(rule: Rule): string {
  const bounds = (min?: MoneyInput | null, max?: MoneyInput | null) => {
    const parts: string[] = [];
    if (min !== null && min !== undefined) parts.push(`minimum ${formatKmf(toCents(min))}`);
    if (max !== null && max !== undefined) parts.push(`maximum ${formatKmf(toCents(max))}`);
    return parts.length ? ` (${parts.join(', ')})` : '';
  };
  let text: string;
  switch (rule.kind) {
    case 'EXCLUDED':
      return 'Exclue de la commission';
    case 'PERCENT':
      text = formatRate(rule.rate as number);
      break;
    case 'FIXED':
      text = formatKmf(toCents(rule.fixedAmount as MoneyInput));
      break;
    case 'TIERED':
      text = (rule.tiers ?? [])
        .map((tier) => {
          const from = toCents(tier.from);
          const to = tier.to === null || tier.to === undefined ? null : toCents(tier.to);
          const range =
            to === null
              ? `à partir de ${formatKmf(from)}`
              : from === 0n
                ? `moins de ${formatKmf(to)}`
                : `de ${formatKmf(from)} à moins de ${formatKmf(to)}`;
          const value =
            tier.rate !== null && tier.rate !== undefined
              ? formatRate(tier.rate)
              : formatKmf(toCents(tier.fixedAmount as MoneyInput));
          return `${range} : ${value}${bounds(tier.minCommission, tier.maxCommission)}`;
        })
        .join(' ; ');
      break;
  }
  const threshold =
    rule.minBase !== null && rule.minBase !== undefined
      ? ` — à partir d’une assiette de ${formatKmf(toCents(rule.minBase))}`
      : '';
  return `${text}${bounds(rule.minCommission, rule.maxCommission)}${threshold}`;
}
