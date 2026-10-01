/**
 * Moteur de règles d'affiliation — phase 4H.
 *
 * Le cas NextComTech sert de validation réelle : chaque chiffre ci-dessous
 * vient de la convention signée (articles 6, 7 et tableau indicatif), pas
 * d'une intuition. Le moteur ne le connaît pas — il ne voit qu'une règle à
 * deux paliers posée sur un affilié, et une exclusion posée sur une offre.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRate,
  centsToDecimal,
  computeCommission,
  describeRule,
  formatKmf,
  isRuleInForce,
  offerConstraint,
  resolveRule,
  ruleFromSnapshot,
  ruleSnapshot,
  toCents,
  validateRule,
  validateTiers,
  type Rule,
} from '../../src/lib/domain/affiliation';

const CAT_APPORTEUR = 'cat-apporteur';
const CAT_STANDARD = 'cat-standard';
const PARTENAIRE = 'aff-partenaire';
const AUTRE_APPORTEUR = 'aff-autre';
const SERVICE_AUDIT = 'svc-audit';
const SERVICE_SITE = 'svc-site';

/** La grille de la convention, exprimée comme n'importe quelle configuration. */
const conventionDeuxPaliers: Rule = {
  id: 'regle-partenaire-v1',
  version: 1,
  owner: { type: 'AFFILIATE', id: PARTENAIRE },
  target: { type: 'ALL' },
  kind: 'TIERED',
  tiers: [
    { from: 0, to: 200_000, rate: 20, minCommission: 10_000, label: 'Petit projet' },
    { from: 200_000, to: null, rate: 40, label: 'Grand projet' },
  ],
  validFrom: '2026-10-01T00:00:00Z',
};

/** Article 6.2 : l'audit facturé séparément sort de l'assiette. */
const exclusionAudit: Rule = {
  id: 'regle-partenaire-audit',
  version: 1,
  owner: { type: 'AFFILIATE', id: PARTENAIRE },
  target: { type: 'SERVICE', id: SERVICE_AUDIT },
  kind: 'EXCLUDED',
  validFrom: '2026-10-01T00:00:00Z',
};

const categorieApporteur: Rule = {
  id: 'regle-cat-apporteur',
  version: 1,
  owner: { type: 'CATEGORY', id: CAT_APPORTEUR },
  target: { type: 'ALL' },
  kind: 'PERCENT',
  rate: 10,
  validFrom: '2026-01-01T00:00:00Z',
};

const amount = (rule: Rule, base: number) => computeCommission(rule, base).amountCents;
const kmf = (value: number) => BigInt(value) * 100n;

// -----------------------------------------------------------------------------
// Convention NextComTech — tableau indicatif, ligne par ligne
// -----------------------------------------------------------------------------

test('convention — tableau indicatif de l’article 7, ligne par ligne', () => {
  const cases: [number, number, boolean][] = [
    // assiette, commission due, plancher appliqué
    [900_000, 360_000, false],
    [500_000, 200_000, false],
    [200_000, 80_000, false],
    [100_000, 20_000, false],
    [50_000, 10_000, false],
    [30_000, 10_000, true],
    [20_000, 10_000, true],
  ];
  for (const [base, due, floor] of cases) {
    const result = computeCommission(conventionDeuxPaliers, base);
    assert.equal(result.amountCents, kmf(due), `assiette ${base}`);
    assert.equal(result.minApplied, floor, `plancher pour ${base}`);
  }
});

test('convention — 30 000 KMF : 20 % donnerait 6 000, le minimum porte à 10 000', () => {
  const result = computeCommission(conventionDeuxPaliers, 30_000);
  assert.equal(result.rate, 20);
  assert.equal(result.tierIndex, 0);
  assert.equal(result.rawCents, kmf(6_000));
  assert.equal(result.amountCents, kmf(10_000));
  assert.equal(result.minApplied, true);
});

test('convention — le seuil de 200 000 KMF appartient au grand projet (≥)', () => {
  assert.equal(computeCommission(conventionDeuxPaliers, 200_000).tierIndex, 1);
  assert.equal(computeCommission(conventionDeuxPaliers, 199_999.99).tierIndex, 0);
  // 199 999,99 × 20 % = 39 999,998 → arrondi au centime supérieur.
  assert.equal(amount(conventionDeuxPaliers, 199_999.99), 4_000_000n);
});

test('convention — le minimum ne s’applique jamais au grand projet', () => {
  const result = computeCommission(conventionDeuxPaliers, 200_000);
  assert.equal(result.minApplied, false);
  assert.equal(result.maxApplied, false);
  assert.equal(result.amountCents, kmf(80_000));
});

test('convention — audit 100 000 + service 900 000 : assiette 900 000, commission 360 000', () => {
  const rules = [conventionDeuxPaliers, exclusionAudit, categorieApporteur];
  const at = '2026-10-15T10:00:00Z';

  const audit = resolveRule(rules, {
    affiliateId: PARTENAIRE,
    categoryId: CAT_APPORTEUR,
    offer: { type: 'SERVICE', id: SERVICE_AUDIT },
    at,
  });
  assert.equal(audit.status, 'FOUND');
  assert.ok(audit.status === 'FOUND');
  assert.equal(audit.origin, 'OFFRE_AFFILIE');
  const auditResult = computeCommission(audit.rule, 100_000);
  assert.equal(auditResult.eligible, false);
  assert.equal(auditResult.reason, 'EXCLUE');
  assert.equal(auditResult.amountCents, 0n);

  const service = resolveRule(rules, {
    affiliateId: PARTENAIRE,
    categoryId: CAT_APPORTEUR,
    offer: { type: 'SERVICE', id: SERVICE_SITE },
    at,
  });
  assert.ok(service.status === 'FOUND');
  assert.equal(service.origin, 'INDIVIDUELLE');
  assert.equal(computeCommission(service.rule, 900_000).amountCents, kmf(360_000));
});

test('convention — la règle du partenaire ne touche aucun autre membre de sa catégorie', () => {
  const rules = [conventionDeuxPaliers, exclusionAudit, categorieApporteur];
  const autre = resolveRule(rules, {
    affiliateId: AUTRE_APPORTEUR,
    categoryId: CAT_APPORTEUR,
    offer: { type: 'SERVICE', id: SERVICE_AUDIT },
    at: '2026-10-15T10:00:00Z',
  });
  assert.ok(autre.status === 'FOUND');
  assert.equal(autre.origin, 'CATEGORIE');
  assert.equal(autre.rule.id, 'regle-cat-apporteur');
  // L'audit n'est exclu que pour le partenaire : l'autre apporteur est payé à 10 %.
  assert.equal(computeCommission(autre.rule, 100_000).amountCents, kmf(10_000));
});

test('le moteur ne nomme aucun partenaire : NextComTech n’est qu’une configuration', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/domain/affiliation.ts'), 'utf8');
  assert.doesNotMatch(source, /next\s*com/i);
});

// -----------------------------------------------------------------------------
// Non-rétroactivité
// -----------------------------------------------------------------------------

test('changer la règle n’altère aucune commission historique', () => {
  // Le 1er octobre : 20 % pour l'affilié. Le 5 octobre : 25 %.
  const v1: Rule = {
    id: 'aff-v1',
    version: 1,
    owner: { type: 'AFFILIATE', id: AUTRE_APPORTEUR },
    target: { type: 'ALL' },
    kind: 'PERCENT',
    rate: 20,
    validFrom: '2026-10-01T00:00:00Z',
    validTo: '2026-10-05T00:00:00Z',
  };
  const v2: Rule = { ...v1, id: 'aff-v2', version: 2, rate: 25, validFrom: '2026-10-05T00:00:00Z', validTo: null };
  const rules = [v1, v2, categorieApporteur];
  const ctx = { affiliateId: AUTRE_APPORTEUR, categoryId: CAT_APPORTEUR, offer: null };

  // Affaire du 1er octobre : instantané pris à 20 %.
  const ancienne = resolveRule(rules, { ...ctx, at: '2026-10-01T09:00:00Z' });
  assert.ok(ancienne.status === 'FOUND');
  const snapshot = ruleSnapshot(ancienne.rule, ancienne.origin);
  const commission = computeCommission(ancienne.rule, 100_000).amountCents;
  assert.equal(commission, kmf(20_000));

  // La nouvelle règle n'altère ni la résolution à l'ancienne date…
  const relue = resolveRule(rules, { ...ctx, at: '2026-10-01T09:00:00Z' });
  assert.ok(relue.status === 'FOUND');
  assert.equal(relue.rule.rate, 20);
  // … ni le calcul refait depuis l'instantané conservé.
  assert.equal(computeCommission(ruleFromSnapshot(snapshot), 100_000).amountCents, commission);

  // Les nouvelles affaires prennent 25 %, à partir de la date d'effet exacte.
  const nouvelle = resolveRule(rules, { ...ctx, at: '2026-10-05T00:00:00Z' });
  assert.ok(nouvelle.status === 'FOUND');
  assert.equal(nouvelle.rule.rate, 25);
});

test('changer la grille du partenaire n’altère pas un instantané déjà pris', () => {
  const snapshot = ruleSnapshot(conventionDeuxPaliers, 'INDIVIDUELLE');
  const avenant: Rule = {
    ...conventionDeuxPaliers,
    id: 'regle-partenaire-v2',
    version: 2,
    tiers: [
      { from: 0, to: 300_000, rate: 25, minCommission: 15_000 },
      { from: 300_000, to: null, rate: 35 },
    ],
    validFrom: '2027-01-01T00:00:00Z',
  };
  assert.equal(computeCommission(avenant, 900_000).amountCents, kmf(315_000));
  assert.equal(computeCommission(ruleFromSnapshot(snapshot), 900_000).amountCents, kmf(360_000));
  assert.equal(computeCommission(ruleFromSnapshot(snapshot), 30_000).amountCents, kmf(10_000));
});

test('un instantané est sérialisable et stable', () => {
  const snapshot = ruleSnapshot(conventionDeuxPaliers, 'INDIVIDUELLE');
  const copie = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(copie, snapshot);
  assert.equal(snapshot.tiers[0]!.minCommission, '10000.00');
  assert.equal(snapshot.tiers[1]!.to, null);
  assert.equal(snapshot.schema, 'affiliation-regle-1');
});

// -----------------------------------------------------------------------------
// Héritage
// -----------------------------------------------------------------------------

test('héritage — offre affilié > offre catégorie > individuelle > catégorie', () => {
  const base = { version: 1, validFrom: '2026-01-01T00:00:00Z', kind: 'PERCENT' as const };
  const offreAffilie: Rule = { ...base, id: 'oa', owner: { type: 'AFFILIATE', id: PARTENAIRE }, target: { type: 'SERVICE', id: SERVICE_SITE }, rate: 25 };
  const offreCategorie: Rule = { ...base, id: 'oc', owner: { type: 'CATEGORY', id: CAT_STANDARD }, target: { type: 'SERVICE', id: SERVICE_SITE }, rate: 5 };
  const individuelle: Rule = { ...base, id: 'in', owner: { type: 'AFFILIATE', id: PARTENAIRE }, target: { type: 'ALL' }, rate: 15 };
  const categorie: Rule = { ...base, id: 'ca', owner: { type: 'CATEGORY', id: CAT_STANDARD }, target: { type: 'ALL' }, rate: 10 };

  const ctx = {
    affiliateId: PARTENAIRE,
    categoryId: CAT_STANDARD,
    offer: { type: 'SERVICE' as const, id: SERVICE_SITE },
    at: '2026-10-01T00:00:00Z',
  };
  const expect = (rules: Rule[], id: string, origin: string) => {
    const r = resolveRule(rules, ctx);
    assert.ok(r.status === 'FOUND', `attendu ${id}`);
    assert.equal(r.rule.id, id);
    assert.equal(r.origin, origin);
  };
  expect([categorie, individuelle, offreCategorie, offreAffilie], 'oa', 'OFFRE_AFFILIE');
  expect([categorie, individuelle, offreCategorie], 'oc', 'OFFRE_CATEGORIE');
  expect([categorie, individuelle], 'in', 'INDIVIDUELLE');
  expect([categorie], 'ca', 'CATEGORIE');
  assert.deepEqual(resolveRule([], ctx), { status: 'NONE' });
});

test('héritage — une règle d’offre ne s’applique qu’à son offre', () => {
  const rule: Rule = {
    id: 'oa', version: 1, owner: { type: 'AFFILIATE', id: PARTENAIRE },
    target: { type: 'PRODUCT', id: 'prod-1' }, kind: 'PERCENT', rate: 30, validFrom: '2026-01-01T00:00:00Z',
  };
  const ctx = { affiliateId: PARTENAIRE, categoryId: CAT_STANDARD, at: '2026-10-01T00:00:00Z' };
  assert.equal(resolveRule([rule], { ...ctx, offer: { type: 'PRODUCT', id: 'prod-2' } }).status, 'NONE');
  // Même identifiant, mais un service n'est pas un produit.
  assert.equal(resolveRule([rule], { ...ctx, offer: { type: 'SERVICE', id: 'prod-1' } }).status, 'NONE');
  // Ligne sans offre : seule une règle générale peut s'appliquer.
  assert.equal(resolveRule([rule], { ...ctx, offer: null }).status, 'NONE');
  assert.equal(resolveRule([rule], { ...ctx, offer: { type: 'PRODUCT', id: 'prod-1' } }).status, 'FOUND');
});

test('héritage — la règle d’un autre affilié ou d’une autre catégorie est ignorée', () => {
  const autre: Rule = { ...conventionDeuxPaliers, owner: { type: 'AFFILIATE', id: AUTRE_APPORTEUR } };
  const autreCat: Rule = { ...categorieApporteur, owner: { type: 'CATEGORY', id: CAT_STANDARD } };
  const r = resolveRule([autre, autreCat], {
    affiliateId: PARTENAIRE, categoryId: CAT_APPORTEUR, offer: null, at: '2026-10-15T00:00:00Z',
  });
  assert.deepEqual(r, { status: 'NONE' });
});

test('héritage — une règle expirée laisse la main au niveau suivant', () => {
  const expiree: Rule = { ...conventionDeuxPaliers, validTo: '2026-10-10T00:00:00Z' };
  const r = resolveRule([expiree, categorieApporteur], {
    affiliateId: PARTENAIRE, categoryId: CAT_APPORTEUR, offer: null, at: '2026-10-10T00:00:00Z',
  });
  assert.ok(r.status === 'FOUND');
  assert.equal(r.origin, 'CATEGORIE');
});

test('héritage — une règle future n’est pas encore en vigueur', () => {
  const future: Rule = { ...categorieApporteur, validFrom: '2027-01-01T00:00:00Z' };
  assert.equal(isRuleInForce(future, '2026-12-31T23:59:59Z'), false);
  assert.equal(isRuleInForce(future, '2027-01-01T00:00:00Z'), true);
});

test('héritage — deux règles en vigueur au même niveau : conflit, jamais un choix', () => {
  const doublon: Rule = { ...conventionDeuxPaliers, id: 'doublon' };
  const r = resolveRule([conventionDeuxPaliers, doublon], {
    affiliateId: PARTENAIRE, categoryId: CAT_APPORTEUR, offer: null, at: '2026-10-15T00:00:00Z',
  });
  assert.equal(r.status, 'CONFLICT');
  assert.ok(r.status === 'CONFLICT');
  assert.deepEqual(r.ruleIds.sort(), ['doublon', 'regle-partenaire-v1']);
});

// -----------------------------------------------------------------------------
// Types de rémunération
// -----------------------------------------------------------------------------

const simple = (overrides: Partial<Rule>): Rule => ({
  id: 'r', version: 1, owner: { type: 'CATEGORY', id: CAT_STANDARD }, target: { type: 'ALL' },
  kind: 'PERCENT', rate: 10, validFrom: '2026-01-01T00:00:00Z', ...overrides,
});

test('pourcentage — exemples du document de référence (§ 17-22)', () => {
  assert.equal(amount(simple({ rate: 10 }), 30_000), kmf(3_000));
  assert.equal(amount(simple({ rate: 15 }), 30_000), kmf(4_500));
  assert.equal(amount(simple({ rate: 20 }), 30_000), kmf(6_000));
  assert.equal(amount(simple({ rate: 10 }), 2_500), kmf(250));
  assert.equal(amount(simple({ rate: 15 }), 2_500), kmf(375));
  // § 22 : 750 × 15 % = 112,50 KMF — deux décimales conservées.
  assert.equal(amount(simple({ rate: 15 }), 750), 11_250n);
});

test('pourcentage — arrondi au demi supérieur au centime, sans flottant', () => {
  assert.equal(applyRate(toCents('0.05'), 10), 1n); // 0,005 → 0,01
  assert.equal(applyRate(toCents('0.04'), 10), 0n); // 0,004 → 0,00
  assert.equal(applyRate(toCents('333.33'), 12.5), 4_167n); // 41,66625 → 41,67
  // Un montant que la virgule flottante représente mal :
  // 1 234 567,89 × 7,77 % = 95 925,9250… → 95 925,93.
  assert.equal(applyRate(toCents('1234567.89'), 7.77), 9_592_593n);
});

test('montant fixe — indépendant de l’assiette', () => {
  const fixe = simple({ kind: 'FIXED', rate: null, fixedAmount: 5_000 });
  assert.equal(amount(fixe, 10_000), kmf(5_000));
  assert.equal(amount(fixe, 1_000_000), kmf(5_000));
});

test('seuil — en deçà de l’assiette minimale, aucune commission', () => {
  const rule = simple({ rate: 10, minBase: 50_000 });
  const sous = computeCommission(rule, 49_999);
  assert.equal(sous.eligible, false);
  assert.equal(sous.reason, 'SOUS_SEUIL');
  assert.equal(sous.amountCents, 0n);
  assert.equal(amount(rule, 50_000), kmf(5_000));
});

test('minimum et maximum de la règle', () => {
  const rule = simple({ rate: 10, minCommission: 2_000, maxCommission: 50_000 });
  assert.equal(amount(rule, 5_000), kmf(2_000));
  assert.equal(computeCommission(rule, 5_000).minApplied, true);
  assert.equal(amount(rule, 100_000), kmf(10_000));
  assert.equal(amount(rule, 1_000_000), kmf(50_000));
  assert.equal(computeCommission(rule, 1_000_000).maxApplied, true);
});

test('paliers — montant fixe par palier et plafond de palier', () => {
  const rule = simple({
    kind: 'TIERED', rate: null,
    tiers: [
      { from: 0, to: 100_000, fixedAmount: 3_000 },
      { from: 100_000, to: 1_000_000, rate: 10, maxCommission: 60_000 },
      { from: 1_000_000, to: null, rate: 8 },
    ],
  });
  assert.equal(amount(rule, 40_000), kmf(3_000));
  assert.equal(amount(rule, 500_000), kmf(50_000));
  assert.equal(amount(rule, 900_000), kmf(60_000));
  assert.equal(computeCommission(rule, 900_000).maxApplied, true);
  assert.equal(amount(rule, 2_000_000), kmf(160_000));
});

test('exclusion et assiette nulle ne rémunèrent rien', () => {
  const exclue = computeCommission(simple({ kind: 'EXCLUDED', rate: null }), 500_000);
  assert.equal(exclue.eligible, false);
  assert.equal(exclue.amountCents, 0n);
  const nulle = computeCommission(simple({ rate: 10, minCommission: 1_000 }), 0);
  assert.equal(nulle.reason, 'ASSIETTE_NULLE');
  assert.equal(nulle.amountCents, 0n, 'un plancher ne crée pas de commission sur une assiette nulle');
});

test('une assiette négative ou une règle invalide sont refusées', () => {
  assert.throws(() => computeCommission(simple({}), -1));
  assert.throws(() => computeCommission(simple({ rate: 0 }), 1_000));
  assert.throws(() => computeCommission(simple({ rate: 120 }), 1_000));
  assert.throws(() => computeCommission(simple({ rate: 10.555 }), 1_000));
});

// -----------------------------------------------------------------------------
// Validation de configuration
// -----------------------------------------------------------------------------

test('validation — la grille de la convention est valide', () => {
  assert.deepEqual(validateRule(conventionDeuxPaliers), []);
  assert.deepEqual(validateRule(exclusionAudit), []);
});

test('validation — trous, recouvrements et grilles fermées sont refusés', () => {
  assert.match(validateTiers([{ from: 1, to: null, rate: 10 }]).join(), /commencer à 0/);
  assert.match(
    validateTiers([{ from: 0, to: 100, rate: 10 }, { from: 150, to: null, rate: 20 }]).join(),
    /où finit le précédent/,
  );
  assert.match(
    validateTiers([{ from: 0, to: 100, rate: 10 }, { from: 50, to: null, rate: 20 }]).join(),
    /où finit le précédent/,
  );
  assert.match(validateTiers([{ from: 0, to: 100, rate: 10 }]).join(), /dernier palier doit être ouvert/);
  assert.match(validateTiers([{ from: 0, to: null, rate: 10, fixedAmount: 5 }]).join(), /exactement/);
  assert.match(validateTiers([]).join(), /Au moins un palier/);
});

test('validation — paramètres incohérents avec le type de règle', () => {
  assert.notDeepEqual(validateRule(simple({ kind: 'FIXED', rate: 10, fixedAmount: 100 })), []);
  assert.notDeepEqual(validateRule(simple({ kind: 'EXCLUDED', rate: 10 })), []);
  assert.notDeepEqual(validateRule(simple({ minCommission: 500, maxCommission: 100 })), []);
  assert.notDeepEqual(
    validateRule(simple({ validFrom: '2026-10-05T00:00:00Z', validTo: '2026-10-01T00:00:00Z' })),
    [],
  );
});

// -----------------------------------------------------------------------------
// Lecture humaine
// -----------------------------------------------------------------------------

test('affichage — montants et description d’une règle', () => {
  assert.equal(formatKmf(kmf(360_000)), '360 000 KMF');
  assert.equal(formatKmf(11_250n), '112,50 KMF');
  assert.equal(centsToDecimal(-150n), '-1.50');
  assert.equal(
    describeRule(conventionDeuxPaliers),
    'moins de 200 000 KMF : 20 % (minimum 10 000 KMF) ; à partir de 200 000 KMF : 40 %',
  );
  assert.equal(describeRule(exclusionAudit), 'Exclue de la commission');
});

// -----------------------------------------------------------------------------
// N1 — éligibilité et plafond de l'offre, dérogation contractuelle
// -----------------------------------------------------------------------------


test('N1 — une offre non éligible n’ouvre aucune commission, dérogation comprise', () => {
  const derogation: Rule = { ...conventionDeuxPaliers, contractualDerogation: true };
  assert.deepEqual(offerConstraint(derogation, { eligible: false, maxRate: 20 }), {
    allowed: false,
    reason: 'OFFRE_NON_ELIGIBLE',
  });
  assert.deepEqual(offerConstraint(derogation, { eligible: true, maxRate: null }), {
    allowed: false,
    reason: 'OFFRE_NON_ELIGIBLE',
  });
  assert.deepEqual(offerConstraint(derogation, null), { allowed: false, reason: 'OFFRE_ABSENTE' });
});

test('N1 — le plafond de l’offre s’applique, plancher compris', () => {
  const offre = { eligible: true, maxRate: 15 };
  const constraint = offerConstraint(conventionDeuxPaliers, offre);
  assert.ok(constraint.allowed);
  assert.equal(constraint.capRate, 15);
  // 900 000 × 40 % = 360 000, plafonné à 15 % = 135 000.
  const grand = computeCommission(conventionDeuxPaliers, 900_000, { capRate: constraint.capRate });
  assert.equal(grand.amountCents, kmf(135_000));
  assert.equal(grand.capApplied, true);
  // 30 000 : le plancher de 10 000 dépasse 15 % (4 500) — le plafond protège la marge.
  const petit = computeCommission(conventionDeuxPaliers, 30_000, { capRate: constraint.capRate });
  assert.equal(petit.amountCents, kmf(4_500));
  assert.equal(petit.capApplied, true);
});

test('N1 — la dérogation contractuelle lève le plafond, pour son seul affilié', () => {
  const derogation: Rule = { ...conventionDeuxPaliers, contractualDerogation: true };
  const constraint = offerConstraint(derogation, { eligible: true, maxRate: 15 });
  assert.ok(constraint.allowed);
  assert.equal(constraint.capRate, null);
  assert.equal(computeCommission(derogation, 900_000, { capRate: constraint.capRate }).amountCents, kmf(360_000));

  // Un autre membre de la catégorie reste plafonné : sa règle n'a pas de dérogation.
  const autre = offerConstraint(categorieApporteur, { eligible: true, maxRate: 5 });
  assert.ok(autre.allowed);
  assert.equal(autre.capRate, 5);
  assert.equal(computeCommission(categorieApporteur, 100_000, { capRate: autre.capRate }).amountCents, kmf(5_000));
});

test('N1 — une dérogation posée sur une catégorie est sans effet', () => {
  const surCategorie: Rule = { ...categorieApporteur, contractualDerogation: true };
  const constraint = offerConstraint(surCategorie, { eligible: true, maxRate: 5 });
  assert.ok(constraint.allowed);
  assert.equal(constraint.capRate, 5);
});

test('N1 — l’instantané conserve la dérogation', () => {
  const snapshot = ruleSnapshot({ ...conventionDeuxPaliers, contractualDerogation: true }, 'INDIVIDUELLE');
  assert.equal(snapshot.contractualDerogation, true);
  assert.equal(ruleFromSnapshot(snapshot).contractualDerogation, true);
});
