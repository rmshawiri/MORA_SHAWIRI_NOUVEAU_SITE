/**
 * Commissions — phase 4H-5 : graphe des statuts, lecture des lignes figées,
 * saisie des ajustements, barrières SQL.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMISSION_STATUS_LABELS,
  COMMISSION_TRANSITIONS,
  LINE_REASON_LABELS,
  kmf,
  parseAdjustmentAmount,
  readCommissionLines,
} from '../../src/lib/affiliation/commissions';

const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261001180000_affiliation_commissions.sql'), 'utf8');
const FIX = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261001180100_affiliation_acquisition.sql'), 'utf8');

test('le graphe des statuts est le même en TypeScript et en SQL', () => {
  const block = SQL.slice(SQL.indexOf('affiliate_commission_transition_ok(p_from'), SQL.indexOf('tg_affiliate_commissions_guard()'));
  const sqlPairs = [...block.matchAll(/\('([A-Z_]+)',\s+'([A-Z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  const tsPairs = Object.entries(COMMISSION_TRANSITIONS).flatMap(([from, to]) => to.map((t) => `${from}>${t}`)).sort();
  assert.deepEqual(tsPairs, sqlPairs);
  // Versée et annulée sont terminales.
  assert.deepEqual(COMMISSION_TRANSITIONS.VERSEE, []);
  assert.deepEqual(COMMISSION_TRANSITIONS.ANNULEE, []);
});

test('chaque statut de la base a son libellé', () => {
  const statuses = SQL.match(/affiliate_commissions_status check \(status in \(([^)]+)\)\)/)?.[1] ?? '';
  const sqlStatuses = [...statuses.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(COMMISSION_STATUS_LABELS).sort(), sqlStatuses);
});

test('chaque motif d’exclusion d’une ligne a son libellé', () => {
  for (const reason of ['OFFRE_ABSENTE', 'OFFRE_NON_ELIGIBLE', 'AUCUNE_REGLE', 'EXCLUE', 'SOUS_SEUIL', 'ASSIETTE_NULLE', 'OK']) {
    assert.ok(Object.hasOwn(LINE_REASON_LABELS, reason), reason);
  }
});

test('les lignes figées se lisent sans faire confiance à leur forme', () => {
  const lines = readCommissionLines([
    {
      designation: 'Site vitrine', base: 300000, eligible: true, reason: 'OK', rate: 8, amount: 24000,
      capApplied: true, capRate: 8, rule: { version: 2, label: 'Standard', contractualDerogation: false },
    },
    { designation: 'Ligne libre', base: '50000', eligible: false, reason: 'OFFRE_ABSENTE', amount: 0, rule: null },
    'pas une ligne',
    null,
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.amount, 24000);
  assert.equal(lines[0]?.capApplied, true);
  assert.equal(lines[0]?.ruleVersion, 2);
  assert.equal(lines[1]?.base, 50000);
  assert.equal(lines[1]?.ruleVersion, null);
  assert.deepEqual(readCommissionLines({ not: 'an array' }), []);
});

test('un ajustement se saisit en KMF, signé, jamais nul', () => {
  assert.equal(parseAdjustmentAmount('-5000'), -5000);
  assert.equal(parseAdjustmentAmount('+1 500,50'), 1500.5);
  assert.equal(parseAdjustmentAmount('0'), null);
  assert.equal(parseAdjustmentAmount('12.345'), null);
  assert.equal(parseAdjustmentAmount('abc'), null);
  assert.equal(parseAdjustmentAmount(''), null);
});

test('les montants s’affichent signés, en KMF', () => {
  assert.match(kmf(24000), /^24\s000 KMF$/u);
  assert.match(kmf(-4800), /^−4\s800 KMF$/u);
  assert.match(kmf('19200.00'), /^19\s200 KMF$/u);
});

test('une commission ne porte aucune donnée de client', () => {
  const table = SQL.slice(SQL.indexOf('create table if not exists public.affiliate_commissions'), SQL.indexOf('comment on table public.affiliate_commissions'));
  assert.doesNotMatch(table, /customer|email|phone|full_name/);
  const lines = SQL.slice(SQL.indexOf('create or replace function public.affiliate_order_lines'), SQL.indexOf('comment on function public.affiliate_order_lines'));
  assert.doesNotMatch(lines, /customer_|email|phone/);
});

test('aucune session n’écrit une commission, un ajustement ou un versement', () => {
  for (const table of ['affiliate_commissions', 'affiliate_commission_adjustments', 'affiliate_payouts', 'affiliate_payout_items']) {
    assert.match(SQL, new RegExp(`revoke all on public\\.${table}\\s+from anon, authenticated`));
    assert.doesNotMatch(SQL, new RegExp(`grant (insert|update|delete)[^;]*on public\\.${table} to authenticated`));
  }
});

test('une seule commission vivante par commande, un élément jamais versé deux fois', () => {
  assert.match(SQL, /affiliate_commissions_one_per_order[\s\S]*?where status <> 'ANNULEE'/);
  assert.match(SQL, /commission_id\s+uuid unique references public\.affiliate_commissions/);
  assert.match(SQL, /adjustment_id\s+uuid unique references public\.affiliate_commission_adjustments/);
  assert.match(SQL, /affiliate_payouts_one_draft[\s\S]*?where status = 'BROUILLON'/);
});

test('l’affilié ne valide, n’annule ni n’ajuste ses propres commissions', () => {
  for (const fn of ['validate_commission', 'cancel_commission', 'adjust_commission']) {
    const body = SQL.slice(SQL.indexOf(`create or replace function public.${fn}`));
    const end = body.indexOf('$fn$;');
    assert.match(body.slice(0, end), /affiliate_is_caller/, fn);
  }
});

test('N1 : le plafond de l’offre ne se lève que par une dérogation individuelle', () => {
  assert.match(SQL, /v_rule\.contractual_derogation and v_rule\.owner_type = 'AFFILIATE' then null else v_offer\.max_rate/);
  assert.match(SQL, /'OFFRE_NON_ELIGIBLE'/);
});

test('G et H : un remboursement ajoute un ajustement, il ne réécrit pas la commission', () => {
  assert.match(SQL, /insert into public\.affiliate_commission_adjustments[\s\S]*?'REMBOURSEMENT'/);
  assert.match(SQL, /Une commission acquise est figée : corrigez-la par un ajustement\./);
  assert.match(SQL, /Une commission versée ne se modifie plus\./);
  // L'acquisition se fait sur le montant conservé, et un remboursement total n'acquiert rien.
  assert.match(FIX, /v_order\.paid_amount > v_order\.refunded_amount/);
});

test('la règle appliquée est celle à la date de l’affaire, jamais la règle actuelle', () => {
  assert.match(SQL, /affiliate_resolve_rule\(p_affiliate_id, v_item\.service_id, v_item\.product_id, v_order\.created_at\)/);
  // Le recalcul d'un remboursement réutilise l'instantané figé de chaque ligne.
  assert.match(SQL, /affiliate_commission_scaled_lines[\s\S]*?v_rule := v_line -> 'rule'/);
});
