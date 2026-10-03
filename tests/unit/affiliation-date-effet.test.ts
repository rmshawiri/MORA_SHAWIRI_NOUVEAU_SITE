/**
 * Date d'effet d'une règle de commission — correctif du 3 octobre 2026.
 *
 * Le formulaire n'offrait qu'un champ `datetime-local` : « 03/10/2026 » seule
 * restait incomplète, et la compléter partait de 00:00 — minuit à Moroni,
 * donc déjà passé. La prise d'effet est désormais un choix explicite :
 * « Immédiatement » (la base prend son `now()`) ou une date ET une heure de
 * Moroni strictement à venir.
 *
 * Les cas suivent la demande du propriétaire (CAS 1 à 9). La preuve en base
 * et dans le navigateur est faite par le parcours de contrôle.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { ruleState } from '../../src/lib/affiliation/affiliates';
import { formatMoroniMoment, moroniLocalToIso, moroniToday, resolveEffectiveStart } from '../../src/lib/affiliation/time';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
// 3 octobre 2026, 11:34:27 à Moroni (08:34:27 UTC) : l'instant du refus observé.
const NOW = new Date('2026-10-03T08:34:27Z');

test('CAS 1 — « Immédiatement » : aucune date envoyée, la base prend now()', () => {
  assert.deepEqual(resolveEffectiveStart('IMMEDIAT', '', '', NOW), { ok: true, iso: null });
  // Des champs restés remplis après être revenu à « Immédiatement » ne comptent pas.
  assert.deepEqual(resolveEffectiveStart('IMMEDIAT', '2026-10-03', '00:00', NOW), { ok: true, iso: null });
  // Un formulaire sans choix (ancien onglet) reste « immédiatement ».
  assert.deepEqual(resolveEffectiveStart('', '', '', NOW), { ok: true, iso: null });

  const publication = read('supabase/migrations/20261001140100_affiliation_correctif_publication.sql');
  assert.match(publication, /v_at\s+timestamptz := coalesce\(p_effective_at, now\(\)\);/);
});

test('CAS 2 — date et heure futures : instant exact, état « Programmée »', () => {
  const start = resolveEffectiveStart('PROGRAMME', '2026-10-05', '11:34', NOW);
  assert.deepEqual(start, { ok: true, iso: '2026-10-05T08:34:00.000Z' });
  assert.equal(ruleState({ valid_from: start.ok ? start.iso! : '', valid_to: null }, NOW), 'PROGRAMMEE');
});

test('CAS 3 — l’instant programmé atteint, la règle devient « En vigueur »', () => {
  const row = { valid_from: '2026-10-05T08:34:00.000Z', valid_to: null };
  assert.equal(ruleState(row, new Date('2026-10-05T08:33:59.999Z')), 'PROGRAMMEE');
  assert.equal(ruleState(row, new Date('2026-10-05T08:34:00.000Z')), 'EN_VIGUEUR');
});

test('CAS 4 — un instant réellement passé est refusé, avec l’heure de Moroni', () => {
  const past = resolveEffectiveStart('PROGRAMME', '2026-10-03', '11:33', NOW);
  assert.equal(past.ok, false);
  assert.match(!past.ok ? past.message : '', /03\/10\/2026 à 11:33 \(heure de Moroni\) est déjà atteint : il est 03\/10\/2026 à 11:34 à Moroni/);
  assert.match(!past.ok ? past.message : '', /« Immédiatement »/);
  // La minute en cours est atteinte : « Immédiatement », pas une programmation.
  assert.equal(resolveEffectiveStart('PROGRAMME', '2026-10-03', '11:34', NOW).ok, false);
  // La base garde son propre garde-fou.
  const publication = read('supabase/migrations/20261001140100_affiliation_correctif_publication.sql');
  assert.match(publication, /if v_at < now\(\) - interval '1 minute' then/);
});

test('CAS 5 — aujourd’hui à Moroni : jamais complété en minuit', () => {
  const laterToday = resolveEffectiveStart('PROGRAMME', '2026-10-03', '15:00', NOW);
  assert.deepEqual(laterToday, { ok: true, iso: '2026-10-03T12:00:00.000Z' });
  // La date seule n'est pas acceptée : aucune heure n'est supposée.
  const dateOnly = resolveEffectiveStart('PROGRAMME', '2026-10-03', '', NOW);
  assert.deepEqual(dateOnly, { ok: false, message: 'Indiquez l’heure de prise d’effet (heure de Moroni).' });
  assert.deepEqual(resolveEffectiveStart('PROGRAMME', '', '15:00', NOW), { ok: false, message: 'Indiquez la date de prise d’effet.' });
});

test('CAS 6 — frontière UTC / Moroni : 3 heures d’écart, sans heure d’été', () => {
  assert.equal(moroniLocalToIso('2026-10-03T02:30'), '2026-10-02T23:30:00.000Z');
  assert.equal(moroniLocalToIso('2026-01-15T12:00'), '2026-01-15T09:00:00.000Z');
  assert.equal(moroniLocalToIso('2026-07-15T12:00'), '2026-07-15T09:00:00.000Z');
  assert.equal(formatMoroniMoment('2026-10-02T23:30:00Z'), '03/10/2026 à 02:30');
  // Le serveur (Vercel, UTC) et la base (UTC) lisent le même instant que Moroni.
  const instant = moroniLocalToIso('2026-10-05T11:34')!;
  assert.equal(formatMoroniMoment(instant), '05/10/2026 à 11:34');
});

test('CAS 7 — minuit à Moroni : aucune journée ajoutée ni retirée', () => {
  // 21:00 UTC le 3 = 00:00 le 4 à Moroni.
  const midnight = new Date('2026-10-03T21:00:00Z');
  assert.equal(moroniToday(new Date('2026-10-03T20:59:59Z')), '2026-10-03');
  assert.equal(moroniToday(midnight), '2026-10-04');
  assert.deepEqual(resolveEffectiveStart('PROGRAMME', '2026-10-04', '00:30', midnight), { ok: true, iso: '2026-10-03T21:30:00.000Z' });
  assert.equal(resolveEffectiveStart('PROGRAMME', '2026-10-03', '23:59', midnight).ok, false);
  assert.deepEqual(resolveEffectiveStart('PROGRAMME', '2026-10-31', '23:30', NOW), { ok: true, iso: '2026-10-31T20:30:00.000Z' });
  // Une date impossible n'est pas reportée au lendemain.
  assert.deepEqual(resolveEffectiveStart('PROGRAMME', '2026-09-31', '10:00', NOW), { ok: false, message: 'Cette date n’existe pas.' });
  assert.deepEqual(resolveEffectiveStart('PROGRAMME', '2026-10-04', '24:00', NOW), { ok: false, message: 'Cette heure n’existe pas.' });
});

const BLOCKERS = read('supabase/migrations/20261001160100_affiliation_correctif_blocages.sql');

test('CAS 8 — une règle immédiate satisfait la condition d’activation, inchangée', () => {
  assert.match(BLOCKERS, /r\.valid_from <= now\(\) and \(r\.valid_to is null or r\.valid_to > now\(\)\)/);
  assert.match(BLOCKERS, /r\.target_type = 'ALL'\s+and r\.kind <> 'EXCLUDED'/);
});

test('CAS 9 — une règle seulement future ne compte pas : le blocage demeure', () => {
  assert.match(BLOCKERS, /Aucune règle de commission générale en vigueur \(affilié ou catégorie\)\./);
  assert.equal(ruleState({ valid_from: '2026-10-05T08:34:00Z', valid_to: null }, NOW), 'PROGRAMMEE');
});

test('le formulaire ne propose plus de champ date-heure unique', () => {
  const editor = read('src/components/admin/AffiliateRuleEditor.tsx');
  assert.doesNotMatch(editor, /datetime-local/);
  assert.match(editor, /name="effective_mode"[\s\S]*value="IMMEDIAT"/);
  assert.match(editor, /type="date"[\s\S]*name="effective_date"[\s\S]*required/);
  assert.match(editor, /type="time"[\s\S]*name="effective_time"[\s\S]*required/);
  const actions = read('src/lib/affiliation/affiliate-actions.ts');
  assert.match(actions, /resolveEffectiveStart\(\s*field\(formData, 'effective_mode', 10\)/);
});
