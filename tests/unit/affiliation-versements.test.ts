/**
 * Versements — phase 4H-6 : lecture des lignes et du moyen figés, forme du
 * justificatif, barrières SQL.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { PAYOUT_STATUS_LABELS, isIsoDate, proofPath, readMethodSnapshot, readPayoutLine } from '../../src/lib/affiliation/payouts';

const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261001190000_affiliation_versements.sql'), 'utf8');
const BASE = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261001180000_affiliation_commissions.sql'), 'utf8');
const SPACE = readFileSync(resolve(process.cwd(), 'src/app/(site)/(compte)/espace-affilie/page.tsx'), 'utf8');
const CONFIG = readFileSync(resolve(process.cwd(), 'next.config.ts'), 'utf8');

const body = (name: string) => {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return SQL.slice(start, SQL.indexOf('$fn$;', start));
};

test('chaque statut de versement a son libellé', () => {
  const statuses = BASE.match(/affiliate_payouts_status check \(status in \(([^)]+)\)\)/)?.[1] ?? '';
  assert.deepEqual(Object.keys(PAYOUT_STATUS_LABELS).sort(), [...statuses.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort());
});

test('les lignes figées se lisent sans faire confiance à leur forme', () => {
  assert.deepEqual(readPayoutLine({ type: 'COMMISSION', reference: 'MORA-COMAF-A0001', order: 'MORA-CMCL-A0001', amount: '24000.00' }), {
    type: 'COMMISSION', label: 'MORA-COMAF-A0001', detail: 'Commande MORA-CMCL-A0001', amount: 24000,
  });
  const adj = readPayoutLine({ type: 'AJUSTEMENT', kind: 'ANNULATION_APRES_VERSEMENT', commission: 'MORA-COMAF-A0001', reason: 'Affaire annulée', amount: -20000 });
  assert.equal(adj?.label, 'Annulation après versement — MORA-COMAF-A0001');
  assert.equal(adj?.amount, -20000);
  assert.equal(readPayoutLine('x'), null);
  assert.equal(readPayoutLine({ type: 'AUTRE' }), null);
});

test('le moyen figé ne garde que des chaînes', () => {
  const method = readMethodSnapshot({ code: 'MVOLA', label: 'Mvola', details: { numero: '•••• 2 34', titulaire: 'B', bad: 3 } });
  assert.deepEqual(method, { code: 'MVOLA', label: 'Mvola', details: { numero: '•••• 2 34', titulaire: 'B' } });
  assert.equal(readMethodSnapshot(null), null);
});

test('le chemin du justificatif est construit par le serveur', () => {
  const id = '2b5f2c8e-1d1a-4a6b-9c55-3a8a6f5d9e10';
  assert.equal(proofPath(id, id, 'pdf'), `RVAF/${id}/${id}.pdf`);
  assert.equal(proofPath(id, id, 'exe'), null);
  // Même forme que la contrainte de la table.
  const shape = BASE.match(/proof_path ~ '([^']+)'/)?.[1];
  assert.ok(shape && new RegExp(shape).test(`RVAF/${id}/${id}.pdf`));
});

test('une date de versement est une vraie date', () => {
  assert.equal(isIsoDate('2026-10-01'), true);
  assert.equal(isIsoDate('2026-02-31'), false);
  assert.equal(isIsoDate('01/10/2026'), false);
});

test('un versement confirmé ne se supprime ni ne se réécrit ; ses lignes non plus', () => {
  assert.match(SQL, /Un versement ne se supprime pas/);
  assert.match(SQL, /Un versement % ne se modifie plus/);
  assert.match(SQL, /Les lignes d''un versement % ne bougent plus/);
  assert.match(SQL, /Une ligne de versement ne se modifie pas/);
});

test('double paiement : verrou, appartenance revérifiée, brouillon unique', () => {
  const confirm = body('confirm_affiliate_payout');
  assert.match(confirm, /from public\.affiliate_payouts where id = p_payout_id for update/);
  assert.match(confirm, /c\.status <> 'A_VERSER' or c\.payout_id is distinct from p_payout_id/);
  assert.match(body('prepare_affiliate_payout'), /Un versement est déjà en préparation pour cet affilié/);
});

test('l’affilié ne prépare, ne confirme ni n’annule son propre versement', () => {
  for (const fn of ['prepare_affiliate_payout', 'confirm_affiliate_payout', 'cancel_affiliate_payout', 'remove_payout_item', 'attach_payout_proof']) {
    assert.match(body(fn), /affiliate_is_caller/, fn);
    assert.match(body(fn), /has_permission\('payouts\.manage'\)/, fn);
  }
});

test('la confirmation fige le moyen utilisé et émet le RVAF par le moteur commun', () => {
  const confirm = body('confirm_affiliate_payout');
  assert.match(confirm, /public\.issue_document\(\s*'RVAF'/);
  assert.match(confirm, /insert into public\.document_snapshots/);
  assert.match(confirm, /affiliate_mask_details\(v_account\.details\)/);
  assert.match(confirm, /La référence de la transaction est obligatoire/);
  assert.doesNotMatch(confirm, /allocate_document_number/);
});

test('K : aucun seuil global, seulement celui de l’affilié ou de sa catégorie', () => {
  assert.match(body('prepare_affiliate_payout'), /affiliate_effective_terms\(p_affiliate_id\)/);
  assert.doesNotMatch(SQL, /settings[^;]*payout_min/);
});

test('une annulation après versement est qualifiée comme telle', () => {
  assert.match(body('cancel_commission'), /when v_c\.status = 'VERSEE' then 'ANNULATION_APRES_VERSEMENT'/);
});

test('l’affilié ne lit ni la note interne ni le justificatif', () => {
  const grant = SQL.slice(SQL.indexOf('grant select (id, affiliate_id, status, reference'), SQL.indexOf('on public.affiliate_payouts to authenticated'));
  assert.doesNotMatch(grant, /note|proof_path|prepared_by|confirmed_by|payout_account_id/);
  const select = SPACE.match(/from\('affiliate_payouts'\)\s*\.select\(\s*'([^']+)'/)?.[1] ?? '';
  assert.ok(select.includes('reference'));
  assert.doesNotMatch(select, /note|proof_path/);
});

test('le justificatif est privé et le transport accepte sa taille', () => {
  assert.match(SQL, /'affiliation-justificatifs', 'affiliation-justificatifs', false/);
  assert.doesNotMatch(SQL, /on storage\.objects/);
  assert.match(CONFIG, /bodySizeLimit: '5mb'/);
});
