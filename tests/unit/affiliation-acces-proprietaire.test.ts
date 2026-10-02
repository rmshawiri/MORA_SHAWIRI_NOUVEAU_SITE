/**
 * Exception minimale au gel de 4H (phase 4I-5) : accès propriétaire affilié.
 *
 * Un profil réellement suspendu ne lit plus ses données d'affilié ; le
 * blocage CLIENT n'y joue aucun rôle ; `affiliate_is_caller`, employée par les
 * gardes anti-auto-décision, reste inchangée ; les politiques
 * d'administration et les règles métier de 4H ne bougent pas.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const DIR = resolve(import.meta.dirname, '..', '..', 'supabase', 'migrations');
const NAMES = readdirSync(DIR).filter((name) => name.endsWith('.sql')).sort();
const ALL = NAMES.map((name) => ({ name, sql: readFileSync(resolve(DIR, name), 'utf8').replace(/--.*$/gm, '') }));
const MIGRATION = ALL.find((entry) => entry.name === '20261002150000_affiliation_acces_proprietaire.sql')!.sql;

function latestPolicy(name: string): string {
  let found = '';
  for (const { sql } of ALL) for (const match of sql.matchAll(new RegExp(`create policy ${name}\\b[\\s\\S]*?;\\n`, 'g'))) found = match[0];
  assert.ok(found, name);
  return found;
}

function latestFunctionFile(name: string): string {
  return ALL.filter(({ sql }) => sql.includes(`create or replace function public.${name}(`)).at(-1)!.name;
}

test('chaque lecture propriétaire d’affilié exige un profil actif', () => {
  for (const name of [
    'affiliate_payout_accounts_select',
    'affiliate_campaigns_select',
    'affiliate_codes_select',
    'affiliate_prospects_select',
    'affiliate_commissions_select',
    'affiliate_adjustments_select',
    'affiliate_payouts_select',
    'affiliate_payout_items_select',
  ]) {
    const policy = latestPolicy(name);
    assert.match(policy, /affiliate_owner_access_ok\(/, name);
    assert.doesNotMatch(policy, /affiliate_is_caller\(/, name);
  }
  for (const name of ['affiliates_select_own', 'affiliate_rules_select_own']) {
    assert.match(latestPolicy(name), /\(select public\.profile_owner_access_ok\(\)\)/, name);
  }
});

test('le prédicat suit le statut du profil, jamais le blocage CLIENT', () => {
  const start = MIGRATION.indexOf('create or replace function public.profile_owner_access_ok(');
  const body = MIGRATION.slice(start, MIGRATION.indexOf('$$;', MIGRATION.indexOf('as $$', start)));
  assert.match(body, /p\.status = 'ACTIF' and p\.deleted_at is null/);
  assert.doesNotMatch(body, /clients|blocked_at/);
  assert.match(MIGRATION, /select public\.affiliate_is_caller\(p_affiliate_id\) and public\.profile_owner_access_ok\(\)/);
});

test('affiliate_is_caller et les gardes anti-auto-décision de 4H ne sont pas modifiées', () => {
  assert.equal(latestFunctionFile('affiliate_is_caller'), '20261001160000_affiliation_affilies.sql');
  assert.doesNotMatch(MIGRATION, /create or replace function public\.affiliate_is_caller\(/);
});

test('les fonctions de lecture de l’espace affilié exigent un profil actif', () => {
  for (const name of ['affiliate_stats', 'affiliate_click_stats', 'affiliate_commission_totals', 'affiliate_sheet_preview', 'payout_account_details', 'my_affiliate_conversions']) {
    assert.equal(latestFunctionFile(name), '20261002150000_affiliation_acces_proprietaire.sql', name);
  }
  assert.match(MIGRATION, /a\.user_id = auth\.uid\(\) and public\.profile_owner_access_ok\(\)/);
});

test('aucune règle métier de 4H n’est touchée', () => {
  for (const forbidden of [
    'affiliate_compute',
    'affiliate_order_lines',
    'prepare_affiliate_payout',
    'confirm_affiliate_payout',
    'issue_affiliate_sheet',
    'publish_affiliate_rule',
    'set_offer_affiliation',
    'activate_affiliate',
  ]) {
    assert.doesNotMatch(MIGRATION, new RegExp(`function public\\.${forbidden}\\(`), forbidden);
  }
  assert.doesNotMatch(MIGRATION, /policy [a-z_]*_(insert|update|delete)\b/);
  assert.doesNotMatch(MIGRATION, /\b(update|insert into|delete from) public\.affiliate/);
});
