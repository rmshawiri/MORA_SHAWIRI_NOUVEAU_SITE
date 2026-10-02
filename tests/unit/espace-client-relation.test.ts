/**
 * Espace client — demandes, devis, rendez-vous (phase 4I-3).
 *
 * Règles pures (à venir, annulable, en attente de décision), garde-fous de la
 * migration (compte actif, propriété, verrou, transitions, chronologies
 * filtrées, rattachement par adresse confirmée seulement, aucune donnée
 * réelle touchée), et filtrage des lectures sur le compte connecté.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { describeAppointmentEvent, describeRequestEvent } from '../../src/lib/client/labels';
import { awaitsDecision, canCancel, isUpcoming, todayInComoros } from '../../src/lib/client/relation-rules';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const MIGRATION = read('supabase/migrations/20261002130000_espace_client_relation.sql');
const CORRECTIF = read('supabase/migrations/20261002130100_espace_client_relation_correctif.sql');

/** Le code seul : les commentaires expliquent, ils n'exécutent rien. */
const sqlCode = (sql: string) => sql.replace(/--.*$/gm, '');
const tsCode = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function fn(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `fonction ${name} absente`);
  const ends = ['\n$$;', '\n$fn$;'].map((marker) => sql.indexOf(marker, start)).filter((index) => index > 0);
  return sql.slice(start, Math.min(...ends));
}

/* ------------------------------------------------------------- règles pures */

test('à venir : en attente, ou confirmé et pas encore commencé', () => {
  const now = '2026-10-02T12:00:00.000Z';
  assert.equal(isUpcoming({ status: 'EN_ATTENTE', scheduled_at: null }, now), true);
  assert.equal(isUpcoming({ status: 'CONFIRME', scheduled_at: '2026-10-03T08:00:00.000Z' }, now), true);
  assert.equal(isUpcoming({ status: 'CONFIRME', scheduled_at: '2026-10-02T11:00:00.000Z' }, now), false);
  assert.equal(isUpcoming({ status: 'ANNULE', scheduled_at: '2026-10-03T08:00:00.000Z' }, now), false);
});

test('annulable : pas commencé et un état qui le permet, sans aucun délai minimal', () => {
  const now = '2026-10-02T12:00:00.000Z';
  assert.equal(canCancel({ status: 'CONFIRME', scheduled_at: '2026-10-02T12:01:00.000Z' }, now), true, 'une minute avant : encore possible');
  assert.equal(canCancel({ status: 'CONFIRME', scheduled_at: '2026-10-02T12:00:00.000Z' }, now), false);
  assert.equal(canCancel({ status: 'EN_ATTENTE', scheduled_at: null }, now), true);
  assert.equal(canCancel({ status: 'TERMINE', scheduled_at: null }, now), false);
  assert.equal(canCancel({ status: 'ANNULE', scheduled_at: null }, now), false);
});

test('un devis attend une décision s’il est envoyé et pas dépassé', () => {
  assert.equal(awaitsDecision({ status: 'ENVOYE', valid_until: null }, '2026-10-02'), true);
  assert.equal(awaitsDecision({ status: 'ENVOYE', valid_until: '2026-10-02' }, '2026-10-02'), true);
  assert.equal(awaitsDecision({ status: 'ENVOYE', valid_until: '2026-10-01' }, '2026-10-02'), false);
  assert.equal(awaitsDecision({ status: 'ACCEPTE', valid_until: null }, '2026-10-02'), false);
  assert.equal(todayInComoros(new Date('2026-10-01T22:30:00Z')), '2026-10-02');
});

test('les chronologies disent « vous » et ne nomment jamais un agent', () => {
  const base = { occurred_at: '2026-10-02T10:00:00Z', from_status: 'ENVOYE', quote_reference: 'MORA-DVCL-A0001' };
  assert.equal(
    describeRequestEvent({ ...base, kind: 'DEVIS_STATUT', to_status: 'REFUSE', by_me: true, note: 'Trop cher' }),
    'Vous avez refusé le devis MORA-DVCL-A0001 — motif : Trop cher',
  );
  assert.equal(
    describeRequestEvent({ ...base, kind: 'DEVIS_STATUT', to_status: 'ANNULE', by_me: false, note: null }),
    'Devis MORA-DVCL-A0001 annulé par MORA Shawiri',
  );
  const appt = {
    occurred_at: '2026-10-02T10:00:00Z',
    kind: 'STATUT' as const,
    from_status: 'CONFIRME',
    to_status: 'ANNULE',
    scheduled_at_before: null,
    scheduled_at_after: null,
  };
  assert.equal(describeAppointmentEvent({ ...appt, by_me: false, note: null }), 'Rendez-vous annulé par MORA Shawiri');
  assert.equal(describeAppointmentEvent({ ...appt, by_me: true, note: 'Malade' }), 'Vous avez annulé le rendez-vous — motif : Malade');
});

/* --------------------------------------------------------------- migration */

test('aucune donnée réelle n’est modifiée par les migrations 4I-3', () => {
  for (const sql of [MIGRATION, CORRECTIF].map(sqlCode)) {
    assert.doesNotMatch(sql, /MORA-DMCL-A0001|MORA-CLI-A000/);
    // Les seules écritures sur les demandes et rendez-vous sont dans des fonctions.
    const outside = sql.replace(/create or replace function[\s\S]*?\n\$(?:fn)?\$;/g, '');
    assert.doesNotMatch(outside, /update public\.(quote_requests|appointments|leads)\b/);
  }
});

test('le client ne lit plus les historiques bruts ; l’administration garde les siens', () => {
  assert.match(MIGRATION, /drop policy if exists qr_events_select_own on public\.quote_request_events;/);
  assert.match(MIGRATION, /drop policy if exists ap_events_select_own on public\.appointment_events;/);
  assert.doesNotMatch(MIGRATION, /drop policy if exists (qr|ap)_events_select_admin/);
});

test('les chronologies client ne rendent que les événements publics, sans acteur', () => {
  const req = fn(MIGRATION, 'my_request_timeline');
  assert.match(req, /e\.kind in \('CREATION', 'STATUT'\)/);
  assert.match(req, /not \(e\.from_status = 'BROUILLON' and e\.to_status <> 'ENVOYE'\)/);
  assert.doesNotMatch(req, /actor_label|'AFFECTATION'|'DEVIS_CREE'/);
  assert.match(req, /case when e\.actor_id = v_uid then e\.note end/);
  const appt = fn(MIGRATION, 'my_appointment_timeline');
  assert.match(appt, /e\.kind in \('CREATION', 'STATUT', 'REPROGRAMMATION'\)/);
  assert.doesNotMatch(appt, /actor_label/);
  for (const body of [req, appt]) {
    assert.match(body, /client_session_is_active\(v_uid\)/);
    assert.match(body, /user_id = v_uid/);
  }
});

test('décider d’un devis : compte actif, propriété, verrou, état, validité ; jamais de commande', () => {
  const respond = fn(CORRECTIF, 'respond_to_my_quote');
  assert.match(respond, /v_uid\s+uuid := auth\.uid\(\)/);
  assert.match(respond, /client_session_is_active\(v_uid\)/);
  assert.match(respond, /qr\.user_id = v_uid/);
  assert.match(respond, /q\.status <> 'BROUILLON' and q\.reference is not null/);
  assert.match(respond, /for update of q/);
  assert.match(respond, /v_quote\.status <> 'ENVOYE'/);
  assert.match(respond, /valid_until/);
  assert.doesNotMatch(respond, /orders|place_order_from_quote|create_manual_order/);
});

test('annuler un rendez-vous : compte actif, propriété, verrou, motif, pas commencé — aucun délai', () => {
  const cancel = fn(MIGRATION, 'cancel_my_appointment');
  assert.match(cancel, /client_session_is_active\(v_uid\)/);
  assert.match(cancel, /user_id = v_uid\s+for update/);
  assert.match(cancel, /length\(v_reason\) < 3/);
  assert.match(cancel, /now\(\) >= v_appt\.scheduled_at/);
  assert.doesNotMatch(cancel, /interval/, 'aucun délai minimal');
  assert.doesNotMatch(cancel, /scheduled_at\s*=/, 'aucune reprogrammation');
});

test('rattachement : adresse confirmée seulement, égalité exacte, depuis la mise en service, idempotent', () => {
  const email = fn(MIGRATION, 'client_confirmed_email');
  assert.match(email, /email_confirmed_at is not null/);
  assert.match(email, /r\.code = 'CLIENT'/);
  const claim = fn(MIGRATION, 'claim_my_requests');
  assert.match(claim, /where email = v_email for update/);
  assert.match(claim, /v_lead\.user_id is not null and v_lead\.user_id <> v_uid/);
  assert.match(claim, /user_id is null and created_at >= v_since/);
  assert.match(claim, /record_audit_event/);
  for (const body of [claim, fn(MIGRATION, 'my_claimable_requests')]) {
    assert.doesNotMatch(body, /full_name|phone|whatsapp|ilike|similarity/);
  }
  const historical = fn(MIGRATION, 'attach_historical_request');
  assert.match(historical, /has_permission\('users\.update'\) and public\.has_permission\('quotes\.manage'\)/);
  assert.match(historical, /Motif obligatoire/);
});

test('les colonnes de décision ne sont accordées en écriture à aucune session', () => {
  assert.doesNotMatch(MIGRATION, /grant (update|insert)[^;]*(responded_by|client_response_reason|cancelled_by)/);
});

/* ------------------------------------------------------------ l'espace */

test('chaque lecture de l’espace client est filtrée sur le compte connecté', () => {
  const relation = read('src/lib/client/relation.ts');
  for (const name of ['myRequests', 'myRequest', 'myAppointments', 'myAppointment']) {
    const body = relation.slice(relation.indexOf(`export async function ${name}(`));
    assert.match(body.slice(0, 900), /\.eq\('user_id', space\.context\.userId\)/, name);
  }
  const quote = relation.slice(relation.indexOf('export async function myQuote('));
  assert.match(quote.slice(0, 1200), /\.eq\('user_id', space\.context\.userId\)/);
  // Jamais un brouillon, ni un brouillon abandonné (sans référence).
  assert.equal((relation.match(/\.neq\('status', 'BROUILLON'\)/g) ?? []).length, 3);
  assert.equal((relation.match(/\.not\('reference', 'is', null\)/g) ?? []).length, 2);
  assert.doesNotMatch(tsCode(relation), /assigned_to|relation_notes|from\('quote_request_events'\)|from\('appointment_events'\)/);
});

test('la navigation suit l’ordre demandé', () => {
  const nav = read('src/components/client/ClientSpaceNav.tsx');
  const labels = [...nav.matchAll(/label: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    'Tableau de bord',
    'Mes commandes',
    'Mes paiements',
    'Mes demandes',
    'Mes devis',
    'Mes rendez-vous',
    'Mes documents',
    'Mon profil',
  ]);
});

test('le tableau de bord et la rubrique partagent les mêmes règles de comptage', () => {
  const space = read('src/lib/client/space.ts');
  assert.match(space, /from '\.\/relation-rules'/);
  assert.match(space, /isUpcoming\(row, now\)/);
  assert.match(space, /OPEN_REQUEST_STATUSES\.includes/);
});
