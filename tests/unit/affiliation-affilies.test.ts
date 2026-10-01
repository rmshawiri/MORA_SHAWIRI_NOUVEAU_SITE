/**
 * Affiliés — phase 4H-3 : liens, codes, statuts, règles stockées, e-mails.
 *
 * Les règles de la base sont éprouvées par `npm run affiliation:verify` ;
 * ici, les modules purs et la lecture du SQL.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AFFILIATE_STATUS_ACTIONS,
  affiliateLink,
  campaignCode,
  codeIsCurrent,
  describeDiscount,
  describeRuleRow,
  ruleFromRow,
  ruleOriginFor,
  ruleState,
  validateCode,
  type CodeDraft,
} from '../../src/lib/affiliation/affiliates';
import { moroniLocalToIso, moroniToday } from '../../src/lib/affiliation/time';
import { computeCommission } from '../../src/lib/domain/affiliation';
import { renderAffiliateActivated, renderAffiliateStatus, renderPayoutAccountReviewed } from '../../src/lib/emails/affiliation';
import type { AffiliateRuleRow } from '../../src/lib/supabase/types-affiliation';

const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261001160000_affiliation_affilies.sql'), 'utf8');
const FIX = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261001160100_affiliation_correctif_blocages.sql'), 'utf8');
const SITE = 'https://mora-shawiri-nouveau-site.vercel.app';

// -----------------------------------------------------------------------------
// Liens
// -----------------------------------------------------------------------------

test('le lien principal et les campagnes suivent /?ref=…&c=…', () => {
  assert.equal(affiliateLink(SITE, 'amina-ahmed'), `${SITE}/?ref=amina-ahmed`);
  assert.equal(affiliateLink(SITE, 'amina-ahmed', 'whatsapp'), `${SITE}/?ref=amina-ahmed&c=whatsapp`);
});

test('un lien ne transporte jamais une adresse, un numéro ou un caractère libre', () => {
  assert.throws(() => affiliateLink(SITE, 'amina@exemple.km'));
  assert.throws(() => affiliateLink(SITE, 'amina', '+269 321'));
  assert.throws(() => affiliateLink(SITE, 'Amina'));
});

test('le code de campagne se déduit proprement du libellé', () => {
  assert.equal(campaignCode('WhatsApp – Mai 2026'), 'whatsapp-mai-2026');
  assert.equal(campaignCode('  Salon de l’Étudiant  '), 'salon-de-l-etudiant');
  assert.equal(campaignCode('x'.repeat(50)).length, 32);
});

// -----------------------------------------------------------------------------
// Codes de réduction
// -----------------------------------------------------------------------------

const code: CodeDraft = {
  code: 'PARTENAIRE10',
  label: '',
  discountKind: 'PERCENT',
  discountValue: '10',
  validFrom: '',
  validTo: '',
  minOrderAmount: '',
  maxDiscountAmount: '',
  maxUses: '',
  maxUsesPerCustomer: '',
};

test('un code valide passe ; ses défauts sont nommés un par un', () => {
  assert.deepEqual(validateCode(code), {});
  assert.ok(validateCode({ ...code, code: 'AB' }).code);
  assert.ok(validateCode({ ...code, code: 'avec espace' }).code);
  assert.ok(validateCode({ ...code, discountValue: '150' }).discountValue);
  assert.ok(validateCode({ ...code, discountValue: '0' }).discountValue);
  assert.ok(validateCode({ ...code, maxUses: '2.5' }).maxUses);
  assert.ok(validateCode({ ...code, validFrom: '2026-10-05T10:00', validTo: '2026-10-01T10:00' }).validTo);
  assert.deepEqual(validateCode({ ...code, discountKind: 'FIXED', discountValue: '5000' }), {});
});

test('une réduction client ne se décrit jamais comme une commission', () => {
  assert.equal(describeDiscount('PERCENT', 10), '10 % de réduction');
  assert.equal(describeDiscount('FIXED', 5000), '5 000 KMF de réduction');
  assert.doesNotMatch(describeDiscount('PERCENT', 10), /commission/i);
});

test('un code n’est utilisable qu’actif et dans sa période', () => {
  const at = new Date('2026-10-10T00:00:00Z');
  const base = { is_active: true, valid_from: '2026-10-01T00:00:00Z', valid_to: '2026-10-31T00:00:00Z' };
  assert.equal(codeIsCurrent(base, at), true);
  assert.equal(codeIsCurrent({ ...base, is_active: false }, at), false);
  assert.equal(codeIsCurrent({ ...base, valid_to: '2026-10-10T00:00:00Z' }, at), false);
  assert.equal(codeIsCurrent({ ...base, valid_from: '2026-10-11T00:00:00Z' }, at), false);
});

// -----------------------------------------------------------------------------
// Statuts — graphe TypeScript et SQL
// -----------------------------------------------------------------------------

test('les transitions d’affilié offertes sont celles que la base accepte', () => {
  const guard = SQL.slice(SQL.indexOf('create or replace function public.tg_affiliates_status_guard'), SQL.indexOf('drop trigger if exists affiliates_status_guard'));
  for (const [from, targets] of Object.entries(AFFILIATE_STATUS_ACTIONS)) {
    for (const to of targets) {
      assert.match(guard, new RegExp(`old\\.status = '${from}'\\s+and new\\.status in \\([^)]*'${to}'`), `${from} → ${to}`);
    }
  }
  assert.deepEqual(AFFILIATE_STATUS_ACTIONS.TERMINE, [], 'une affiliation close ne revient pas');
});

// -----------------------------------------------------------------------------
// Règles stockées
// -----------------------------------------------------------------------------

const row = (overrides: Partial<AffiliateRuleRow>): AffiliateRuleRow => ({
  id: 'r1', version: 1, supersedes_id: null, owner_type: 'AFFILIATE', category_id: null, affiliate_id: 'a1',
  target_type: 'ALL', service_id: null, product_id: null, kind: 'TIERED', rate: null, fixed_amount: null,
  tiers: [
    { from: 0, to: 200000, rate: 20, minCommission: 10000 },
    { from: 200000, to: null, rate: 40 },
  ],
  min_commission: null, max_commission: null, min_base: null, valid_from: '2026-10-01T00:00:00Z', valid_to: null,
  label: null, contractual_derogation: true, derogation_reason: 'Convention', derogation_granted_by: null,
  derogation_granted_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', created_by: null, closed_at: null,
  closed_by: null, owner_key: 'a1', target_key: '00000000-0000-0000-0000-000000000000', ...overrides,
});

test('une règle lue en base calcule comme le moteur (cas de la convention)', () => {
  const rule = ruleFromRow(row({}));
  assert.equal(computeCommission(rule, 30_000).amountCents, 1_000_000n);
  assert.equal(computeCommission(rule, 900_000).amountCents, 36_000_000n);
  assert.equal(rule.contractualDerogation, true);
  assert.match(describeRuleRow(row({})), /20 %.*minimum 10 000 KMF.*40 %/);
});

test('origine et état d’une règle stockée', () => {
  assert.equal(ruleOriginFor(row({})), 'INDIVIDUELLE');
  assert.equal(ruleOriginFor(row({ target_type: 'SERVICE', service_id: 's1' })), 'OFFRE_AFFILIE');
  assert.equal(ruleOriginFor(row({ owner_type: 'CATEGORY', affiliate_id: null, category_id: 'c1' })), 'CATEGORIE');
  const at = new Date('2026-10-15T00:00:00Z');
  assert.equal(ruleState(row({}), at), 'EN_VIGUEUR');
  assert.equal(ruleState(row({ valid_from: '2026-11-01T00:00:00Z' }), at), 'PROGRAMMEE');
  assert.equal(ruleState(row({ valid_to: '2026-10-10T00:00:00Z' }), at), 'CLOSE');
});

// -----------------------------------------------------------------------------
// Heure de Moroni
// -----------------------------------------------------------------------------

test('une date d’effet saisie à Moroni devient un instant exact (UTC+3)', () => {
  assert.equal(moroniLocalToIso('2026-10-05T09:00'), '2026-10-05T06:00:00.000Z');
  assert.equal(moroniLocalToIso('2026-10-05'), null);
  assert.equal(moroniLocalToIso('n’importe quoi'), null);
  assert.equal(moroniToday(new Date('2026-10-01T22:30:00Z')), '2026-10-02');
});

// -----------------------------------------------------------------------------
// E-mails
// -----------------------------------------------------------------------------

test('l’activation donne l’accès, la référence et le lien, sans taux ni délai', () => {
  const fresh = renderAffiliateActivated({
    firstName: 'Amina', reference: 'MORA-AFIL-A0001', link: `${SITE}/?ref=amina`, spaceUrl: `${SITE}/espace-affilie/`,
    newAccount: true, passwordUrl: `${SITE}/mot-de-passe-oublie/`, email: 'amina@example.com',
  });
  assert.match(fresh.rendered.text, /MORA-AFIL-A0001/);
  assert.match(fresh.rendered.text, /\?ref=amina/);
  assert.match(fresh.rendered.text, /mot-de-passe-oublie/);
  assert.doesNotMatch(fresh.rendered.text, /\d+\s?%|\b(24|48)\s?h\b/);
  // La personne choisit elle-même son mot de passe : aucun n'est transmis.
  assert.doesNotMatch(fresh.rendered.text, /votre mot de passe est|password|Aa1!/i, 'aucun mot de passe transmis');
  const existing = renderAffiliateActivated({
    firstName: 'Amina', reference: 'MORA-AFIL-A0001', link: `${SITE}/?ref=amina`, spaceUrl: `${SITE}/espace-affilie/`,
    newAccount: false, passwordUrl: `${SITE}/mot-de-passe-oublie/`, email: 'amina@example.com',
  });
  assert.match(existing.rendered.text, /compte habituel/);
  assert.doesNotMatch(existing.rendered.text, /mot-de-passe-oublie/);
});

test('suspension, réactivation, clôture et coordonnées : des e-mails sobres et exacts', () => {
  const suspended = renderAffiliateStatus('SUSPENDU', { firstName: 'Amina', spaceUrl: `${SITE}/espace-affilie/` });
  assert.match(suspended.rendered.text, /conservés/);
  const ended = renderAffiliateStatus('TERMINE', { firstName: 'Amina', message: 'Merci <b>', spaceUrl: '' });
  assert.match(ended.rendered.text, /restent dues/);
  assert.ok(!ended.rendered.html.includes('<b>'));
  const refused = renderPayoutAccountReviewed(false, { firstName: 'Amina', methodLabel: 'Mvola', note: 'Titulaire différent' });
  assert.match(refused.rendered.text, /précédentes restent en vigueur/);
});

// -----------------------------------------------------------------------------
// Sécurité de la migration
// -----------------------------------------------------------------------------

test('les coordonnées de versement ne sont accordées à aucune session', () => {
  const grant = SQL.slice(SQL.indexOf('grant select (id, affiliate_id, method_code'), SQL.indexOf('on public.affiliate_payout_accounts to authenticated'));
  assert.ok(grant.length > 0);
  assert.doesNotMatch(grant, /details/);
});

test('aucune écriture directe sur les coordonnées et les campagnes', () => {
  assert.doesNotMatch(SQL, /grant (insert|update|delete)[^;]*on public\.(affiliate_payout_accounts|affiliate_campaigns) to authenticated/);
});

test('l’activation exige que le compte porte l’adresse de l’affilié et refuse l’auto-activation', () => {
  const fn = SQL.slice(SQL.indexOf('create or replace function public.activate_affiliate('), SQL.indexOf('comment on function public.activate_affiliate'));
  assert.match(fn, /v_email <> lower\(v_aff\.contact_email\)/);
  assert.match(fn, /p_user_id = auth\.uid\(\)/);
  assert.match(fn, /allocate_document_number\('AFIL'\)/);
  assert.match(fn, /for update/);
});

test('aucune auto-décision : règles, statut, codes, coordonnées', () => {
  for (const marker of [
    'tg_affiliate_rules_not_self',
    "public.affiliate_is_caller(p_affiliate_id) then\n    raise exception 'Vous ne pouvez pas changer le statut",
    'Vous ne pouvez pas gérer les codes de votre propre affiliation',
    'Vous ne pouvez pas valider les coordonnées de votre propre affiliation',
    'Vous ne pouvez pas saisir les coordonnées de votre propre affiliation',
  ]) {
    assert.ok(SQL.includes(marker), marker);
  }
});

test('le correctif des blocages n’emploie plus de concaténation de tableau ambiguë', () => {
  const body = FIX.slice(FIX.indexOf('create or replace function'));
  assert.doesNotMatch(body, /v_blockers \|\| '/);
  assert.equal((FIX.match(/array_append\(v_blockers/g) ?? []).length, 4);
});
