/**
 * Administration Clients et durcissement des accès propriétaire (phase 4I-4).
 *
 * Audit automatique : la dernière définition de chaque politique
 * « propriétaire » des données client, toutes migrations confondues, exige un
 * compte actif et un client non bloqué. Puis : blocage sans suppression,
 * multi-rôles, notes en ajout seul, rattachement historique par type de
 * permission, trois barrières pour chaque acte, aucune donnée réelle touchée.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIR = resolve(ROOT, 'supabase', 'migrations');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const MIGRATION = read('supabase/migrations/20261002140000_administration_clients.sql');
const ALL = readdirSync(DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(resolve(DIR, name), 'utf8'));
const code = (sql: string) => sql.replace(/--.*$/gm, '');

/** Dernière définition d'une politique, toutes migrations confondues. */
function latestPolicy(name: string): string {
  let found = '';
  for (const sql of ALL) {
    const re = new RegExp(`create policy ${name}\\b[\\s\\S]*?;\\n`, 'g');
    for (const match of code(sql).matchAll(re)) found = match[0];
  }
  assert.ok(found, `politique ${name} introuvable`);
  return found;
}

function fn(name: string): string {
  const start = MIGRATION.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `fonction ${name} absente`);
  const ends = ['\n$$;', '\n$fn$;'].map((marker) => MIGRATION.indexOf(marker, start)).filter((index) => index > 0);
  return MIGRATION.slice(start, Math.min(...ends));
}

/* ----------------------------------------------------- audit des politiques */

const OWNER_POLICIES = [
  'quote_requests_select_own',
  'quotes_select_own',
  'appointments_select_own',
  'orders_select_own',
  'order_items_select_own',
  'payments_select_own',
  'payment_proofs_select_own',
  'refunds_select_own',
  'osh_select_own',
  'order_events_select_own',
  'justificatifs_read',
  'justificatifs_insert',
  'clients_select_own_or_authorised',
];
const DOCUMENT_POLICIES = ['documents_select_owner_or_authorised', 'document_snapshots_select', 'documents_officiels_read'];

test('chaque accès propriétaire aux données client exige un compte actif et un client non bloqué', () => {
  for (const name of OWNER_POLICIES) {
    assert.match(latestPolicy(name), /\(select public\.client_owner_access_ok\(\)\)/, name);
  }
  for (const name of DOCUMENT_POLICIES) {
    assert.match(latestPolicy(name), /public\.document_owner_access_ok\((d\.)?doc_type\)/, name);
  }
});

test('les historiques d’événements n’ont plus de politique propriétaire (chronologies par fonctions)', () => {
  for (const name of ['qr_events_select_own', 'ap_events_select_own']) {
    const last = ALL.map(code).filter((sql) => sql.includes(name)).at(-1) ?? '';
    assert.match(last, new RegExp(`drop policy if exists ${name}`));
    assert.doesNotMatch(last.slice(last.lastIndexOf(`drop policy if exists ${name}`)), new RegExp(`create policy ${name}`));
  }
});

test('le prédicat refuse un profil non actif, supprimé, ou un client bloqué', () => {
  const predicate = fn('client_owner_access_ok');
  assert.match(predicate, /p\.status = 'ACTIF' and p\.deleted_at is null/);
  assert.match(predicate, /c\.blocked_at is not null/);
  const session = fn('client_session_is_active');
  assert.match(session, /c\.blocked_at is not null/);
  // Les pièces d'affiliation suivent le seul statut du profil.
  assert.match(fn('document_owner_access_ok'), /p_doc_type in \('FIAF', 'RVAF'\)/);
});

test('les politiques administratives ne sont pas modifiées', () => {
  for (const name of ['orders_select_admin', 'payments_select_admin', 'quote_requests_select_admin', 'appointments_select_admin']) {
    assert.doesNotMatch(code(MIGRATION), new RegExp(`policy ${name}\\b`));
  }
});

test('le titulaire suspendu ou bloqué ne dépose plus de paiement ni de justificatif', () => {
  const guard = fn('tg_commerce_owner_write_guard');
  assert.match(guard, /has_permission\('payments\.verify'\)/);
  assert.match(guard, /not public\.client_owner_access_ok\(\)/);
  assert.match(MIGRATION, /before insert on public\.payments/);
  assert.match(MIGRATION, /before insert on public\.payment_proofs/);
});

/* ------------------------------------------------------------------ blocage */

test('bloquer : users.disable, motif, jamais soi-même, rien de supprimé, profil suspendu seulement pour un client seul', () => {
  const block = fn('block_client');
  assert.match(block, /has_permission\('users\.disable'\)/);
  assert.match(block, /length\(v_reason\) < 3/);
  assert.match(block, /p_user_id = auth\.uid\(\)/);
  assert.match(block, /r\.code <> 'CLIENT'/);
  assert.match(block, /profile_suspended_by_block = \(v_only and v_profile\.status = 'ACTIF'\)/);
  assert.match(block, /record_audit_event\(\s*'clients\.blocage'/);
  assert.doesNotMatch(block, /\bdelete\b/);
  const unblock = fn('unblock_client');
  assert.match(unblock, /if v_revived then/);
  assert.match(unblock, /status = 'ACTIF' where id = p_user_id and status = 'SUSPENDU'/);
  assert.match(unblock, /record_audit_event\(\s*'clients\.deblocage'/);
});

test('notes et historique de blocage : ajout seul, lecture sous users.view, écriture par fonction', () => {
  assert.match(fn('tg_client_append_only'), /tg_op = 'UPDATE'/);
  assert.match(MIGRATION, /before update or delete on public\.client_notes/);
  assert.match(MIGRATION, /before update or delete on public\.client_status_events/);
  assert.doesNotMatch(MIGRATION, /grant (insert|update|delete)[^;]*on public\.client_(notes|status_events)/);
  assert.match(MIGRATION, /policy client_notes_select_admin[\s\S]*?has_permission\('users\.view'\)/);
  const add = fn('add_client_note');
  assert.match(add, /has_permission\('users\.update'\)/);
  assert.match(add, /auth\.uid\(\)/);
  assert.match(add, /record_audit_event\(\s*'clients\.note'/);
});

/* ------------------------------------------------- rattachement historique */

test('rattachement historique : chaque type sous sa permission 4F, sur le mécanisme existant', () => {
  const detect = fn('historical_claimable_requests');
  assert.match(detect, /and public\.has_permission\('quotes\.view'\)/);
  assert.match(detect, /and public\.has_permission\('appointments\.view'\)/);
  const attach = fn('attach_historical_request');
  assert.match(attach, /p_kind = 'DEMANDE' and not public\.has_permission\('quotes\.manage'\)/);
  assert.match(attach, /p_kind = 'RENDEZ_VOUS' and not public\.has_permission\('appointments\.update'\)/);
  assert.match(attach, /Motif obligatoire/);
  // Aucun second moteur : pas d'autre fonction de rattachement.
  assert.doesNotMatch(MIGRATION, /function public\.(attach_client|link_request|claim_for)/);
});

test('aucune donnée réelle n’est écrite par la migration 4I-4', () => {
  const outside = code(MIGRATION).replace(/create or replace function[\s\S]*?\n\$(?:fn)?\$;/g, '');
  assert.doesNotMatch(outside, /MORA-DMCL-A0001|MORA-CLI-A000/);
  assert.doesNotMatch(outside, /\b(update|delete from|insert into) public\.(quote_requests|appointments|leads|clients|profiles|orders)\b/);
});

/* -------------------------------------------------------- trois barrières */

test('chaque acte d’administration est revérifié par l’action serveur avant la base', () => {
  const actions = read('src/lib/clients/actions.ts');
  assert.match(actions, /assertPermission\('users\.disable', 'clients\.blocage'\)/);
  assert.match(actions, /assertPermission\('users\.disable', 'clients\.deblocage'\)/);
  assert.match(actions, /assertPermission\('users\.update', 'clients\.note'\)/);
  assert.match(actions, /assertPermission\(kind === 'DEMANDE' \? 'quotes\.manage' : 'appointments\.update'/);
  // Rattachement : l'élément doit être détecté pour CE client avant l'appel.
  assert.ok(actions.indexOf("rpc('historical_claimable_requests')") < actions.indexOf("rpc('attach_historical_request'"));
  assert.match(actions, /item\.client_user_id === client\.userId/);
});

test('le module Clients est ouvert, gardé par users.view, et chaque bloc par sa permission', () => {
  const modules = read('src/lib/rbac/modules.ts');
  assert.match(modules, /slug: 'clients',[\s\S]*?permission: 'users\.view',\s*status: 'DISPONIBLE'/);
  for (const page of ['src/app/(pilotage)/administration/clients/page.tsx', 'src/app/(pilotage)/administration/clients/[reference]/page.tsx']) {
    assert.match(read(page), /requireModule\('clients'\)/);
  }
  const admin = read('src/lib/clients/admin.ts');
  for (const permission of ['orders.view', 'quotes.view', 'appointments.view', 'affiliates.view']) {
    assert.match(admin, new RegExp(`context\\.can\\('${permission.replace('.', '\\.')}'\\)`));
  }
  const fiche = read('src/app/(pilotage)/administration/clients/[reference]/page.tsx');
  assert.match(fiche, /canDisable = context\.can\('users\.disable'\)/);
  assert.match(fiche, /canUpdate = context\.can\('users\.update'\)/);
});

test('statistiques : les vérités de 4G, jamais un statut', () => {
  const admin = read('src/lib/clients/admin.ts');
  assert.match(admin, /amount\(o\.paid_amount\)/);
  assert.match(admin, /amount\(o\.refunded_amount\)/);
  assert.match(admin, /o\.status !== 'ANNULEE'/);
  assert.doesNotMatch(admin, /settlement_status === 'PAYEE'|status === 'PAYE'/);
});

test('l’espace client d’un client bloqué ne lit rien', () => {
  const space = read('src/lib/client/space.ts');
  const blocked = space.indexOf("if (spaceState === 'BLOQUE')");
  assert.ok(blocked > 0 && blocked < space.indexOf("supabase.from('clients')"));
});

test('ajout seul, sauf l’auteur remis à nul quand son compte disparaît — lu en JSON, quelle que soit la table', () => {
  const latest = read('supabase/migrations/20261002140200_administration_clients_correctif_auteur.sql');
  assert.match(latest, /\(to_jsonb\(new\) - v_col\) = \(to_jsonb\(old\) - v_col\)/);
  assert.doesNotMatch(code(latest), /old\.(author_id|actor_id)/);
});
