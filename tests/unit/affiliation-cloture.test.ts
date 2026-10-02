/**
 * Correctif de clôture 4H : éligibilité administrable des offres, ajout direct
 * d'un affilié. Fonctions pures, et barrières vérifiées dans le code source.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { affiliationChange, affiliationConsequence, formatRate, parseRate } from '../../src/lib/catalogue/affiliation';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const SQL = read('supabase/migrations/20261001220000_affiliation_eligibilite_et_ajout.sql');
const OFFER_ACTION = read('src/lib/catalogue/affiliation-actions.ts');
const CREATE_ACTION = read('src/lib/affiliation/creation-actions.ts');
const CREATE_FORM = read('src/components/admin/AffiliateCreateForm.tsx');

const body = (name: string) => {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return SQL.slice(start, SQL.indexOf('$fn$;', start));
};

test('un plafond se saisit en pourcentage, virgule comprise', () => {
  assert.equal(parseRate('8'), 8);
  assert.equal(parseRate(' 12,5 % '), 12.5);
  assert.equal(parseRate('100'), 100);
  assert.equal(parseRate(''), null);
  for (const bad of ['0', '100.01', '150', '-3', '1.234', 'dix', '8%8']) assert.equal(parseRate(bad), 'invalide', bad);
  assert.equal(formatRate('12.50'), '12,5 %');
  assert.equal(formatRate(null), '—');
});

test('la nature du changement décide de la confirmation', () => {
  const off = { eligible: false, rate: null };
  assert.equal(affiliationChange(off, { eligible: true, rate: 8 }), 'ACTIVATION');
  assert.equal(affiliationChange({ eligible: true, rate: 8 }, { eligible: false, rate: 8 }), 'DESACTIVATION');
  assert.equal(affiliationChange({ eligible: true, rate: 8 }, { eligible: true, rate: 5 }), 'PLAFOND');
  assert.equal(affiliationChange({ eligible: true, rate: 8 }, { eligible: true, rate: 8 }), 'AUCUN');
  assert.equal(affiliationChange(off, off), 'AUCUN');
});

test('A4 : la confirmation dit que seules les ventes à venir changent', () => {
  const disable = affiliationConsequence('DESACTIVATION', 'Site vitrine', 8, null, true);
  assert.match(disable, /nouvelles|à partir de maintenant/);
  assert.match(disable, /ne produiront plus de commission/);
  assert.match(disable, /restent intacts/);
  assert.match(disable, /prévisionnelles, acquises ou versées/);
  const cap = affiliationConsequence('PLAFOND', 'Site vitrine', 8, 5, true);
  assert.match(cap, /8 %.*5 %/);
  assert.match(cap, /gardent le plafond en vigueur à la date de leur vente/);
  assert.match(affiliationConsequence('ACTIVATION', 'X', null, 10, false), /n’est pas publiée/);
  assert.doesNotMatch(affiliationConsequence('ACTIVATION', 'X', null, 10, true), /n’est pas publiée/);
});

test('A5 : la migration ne rend aucune offre affiliable', () => {
  assert.doesNotMatch(SQL, /update public\.(services|products)\s+set affiliate_eligible\s*=\s*true/i);
  assert.match(SQL, /select 'SERVICE', s\.id, s\.affiliate_eligible, s\.affiliate_max_rate, '-infinity'/);
});

test('A3 : deux permissions, en base comme dans l’action', () => {
  assert.match(SQL, /tg_offer_affiliation_guard[\s\S]+has_permission\('affiliate_rules\.manage'\)/);
  for (const table of ['services', 'products']) {
    assert.match(SQL, new RegExp(`before insert or update of affiliate_eligible, affiliate_max_rate on public\\.${table}`));
  }
  const set = body('set_offer_affiliation');
  assert.match(set, /public\.has_permission\(v_edit\) and public\.has_permission\('affiliate_rules\.manage'\)/);
  assert.match(set, /'services\.update'/);
  assert.match(set, /'products\.update'/);
  assert.doesNotMatch(set, /status\s*=/, 'la publication n’est jamais touchée');
  assert.match(OFFER_ACTION, /assertPermission\(type === 'SERVICE' \? 'services\.update' : 'products\.update'/);
  assert.match(OFFER_ACTION, /assertPermission\('affiliate_rules\.manage'/);
});

test('le moteur lit l’éligibilité et le plafond à la date de l’affaire', () => {
  const lines = body('affiliate_order_lines');
  assert.match(lines, /offer_affiliation_at\(v_item\.service_id, v_item\.product_id, v_order\.created_at\)/);
  assert.doesNotMatch(lines, /from public\.services where id = v_item\.service_id/);
  // N1 inchangé : la dérogation lève le plafond, jamais l'inéligibilité.
  assert.match(lines, /v_rule\.contractual_derogation and v_rule\.owner_type = 'AFFILIATE' then null else v_offer\.max_rate/);
  assert.match(lines, /v_reason := 'OFFRE_NON_ELIGIBLE'/);
  assert.match(SQL, /L''historique d''éligibilité des offres ne se modifie pas/);
});

test('B : ajout direct sous affiliates.create, sans compte ni candidature', () => {
  const create = body('create_affiliate');
  assert.match(create, /has_permission\('affiliates\.create'\)/);
  assert.match(create, /'ADMINISTRATION', auth\.uid\(\)/);
  assert.match(create, /'PREPARATION'/);
  assert.doesNotMatch(create, /auth\.users|affiliate_applications/i);
  assert.match(body('affiliate_creation_check'), /has_permission\('affiliates\.create'\)/);
  assert.match(SQL, /create unique index if not exists affiliates_contact_email_unique on public\.affiliates \(lower\(contact_email\)\)/);
  assert.match(CREATE_ACTION, /assertPermission\('affiliates\.create'/);
  assert.doesNotMatch(CREATE_ACTION, /getAdminSupabaseClient|auth\.admin|createUser/);
  assert.match(CREATE_FORM, /ConfirmDialog/);
});
