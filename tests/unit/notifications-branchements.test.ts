/**
 * Branchement des notifications — phase 4J-2.
 *
 * Ce que ces tests épinglent, sans base :
 *   * les huit sources réelles sont branchées, chacune par un seul
 *     déclencheur AFTER INSERT, et aucune autre table ;
 *   * chaque branchement est isolé : une panne de notification est consignée
 *     et n'annule jamais l'acte métier ;
 *   * les 37 types du catalogue sont produits, et chaque type « à traiter »
 *     a au moins un événement qui le résout ;
 *   * aucun montant, aucun e-mail, aucun Realtime, aucune tâche planifiée,
 *     aucune rétroactivité ;
 *   * le socle 4J-1 n'est pas modifié.
 *
 * Le comportement réel est contrôlé contre la base par
 * `scripts/verify-notifications-branchements.mjs` et, pour la chaîne complète
 * des commissions, par `scripts/verify-affiliation.mjs`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { NOTIFICATION_TYPES } from '../../src/lib/notifications/catalogue';

const DIR = resolve(process.cwd(), 'supabase', 'migrations');
const MAIN = readFileSync(resolve(DIR, '20261004120000_notifications_branchements.sql'), 'utf8');
const FIX = readFileSync(resolve(DIR, '20261004120100_notifications_resolution_demande.sql'), 'utf8');
const SOCLE = readFileSync(resolve(DIR, '20261003200000_notifications_socle.sql'), 'utf8');
const ALL = `${MAIN}\n${FIX}`;
const CODE = ALL.replace(/^\s*--.*$/gm, '');

const SOURCES = [
  'quote_request_events',
  'appointment_events',
  'order_status_history',
  'order_events',
  'affiliate_events',
  'notification_events',
  'affiliate_application_events',
  'clients',
];

test('les huit sources réelles sont branchées par un déclencheur AFTER INSERT, et elles seules', () => {
  const triggers = [...MAIN.matchAll(/create trigger (notify_[a-z_]+)\s+after insert on public\.([a-z_]+)/g)];
  assert.deepEqual(triggers.map((m) => m[2]).sort(), [...SOURCES].sort());
  for (const [, name] of triggers) {
    assert.ok(MAIN.includes(`drop trigger if exists ${name}`), `${name} n’est pas rejouable`);
  }
  assert.ok(!/create trigger notify_[a-z_]+\s+(before|after)\s+(update|delete)/.test(MAIN), 'aucun branchement sur une mise à jour');
});

test('chaque branchement isole la panne : l’échec est consigné, l’acte métier continue', () => {
  const wrappers = [...MAIN.matchAll(/create or replace function public\.(tg_notify_[a-z_]+)\(\)[\s\S]*?\$\$;/g)];
  assert.equal(wrappers.length, SOURCES.length);
  for (const [body, name] of wrappers) {
    assert.match(body, /begin\s+begin\s+perform public\.notifications_route_[a-z_]+\(new\);\s+exception when others then(\s+--[^\n]*)*\s+perform public\.notifications_record_failure\(/, name);
    assert.match(body, /return null;/, name);
  }
  // Consigner un échec ne lève jamais.
  const record = MAIN.match(/function public\.notifications_record_failure[\s\S]*?\$\$;/)![0];
  assert.match(record, /exception when others then\s+raise warning/);
});

test('les routeurs, la consignation et la reprise sont fermés aux sessions', () => {
  for (const fn of ['notifications_record_failure(text, text, text, text)', 'notifications_retry_failures(integer)']) {
    const escaped = fn.replace(/[()]/g, '\\$&');
    assert.match(MAIN, new RegExp(`revoke execute on function public\\.${escaped} from public, anon, authenticated;`), fn);
  }
  assert.match(MAIN, /execute format\('revoke execute on function public\.%s from public, anon, authenticated', v_fn\)/);
  assert.match(FIX, /revoke execute on function public\.notifications_route_quote_request_event\(public\.quote_request_events\) from public, anon, authenticated;/);
});

test('les 37 types du catalogue sont produits par un branchement', () => {
  for (const code of Object.keys(NOTIFICATION_TYPES)) {
    assert.ok(new RegExp(`'${code.replace(/\./g, '\\.')}'`).test(CODE), `${code} n’est produit nulle part`);
  }
});

test('chaque type « à traiter » a au moins un événement qui le résout', () => {
  const resolved = new Set([...CODE.matchAll(/notifications_resolve\(array\[([^\]]+)\]/g)]
    .flatMap((m) => [...m[1]!.matchAll(/'([a-z_.]+)'/g)].map((x) => x[1])));
  for (const [code, spec] of Object.entries(NOTIFICATION_TYPES)) {
    if (spec.level === 'A_TRAITER') assert.ok(resolved.has(code), `${code} ne se résout jamais`);
  }
});

test('« nouvelle demande » est résolue aussi à l’émission d’un devis (correctif 4J-2)', () => {
  const sent = FIX.match(/if e\.to_status = 'ENVOYE' then([\s\S]*?)else/)![1]!;
  assert.match(sent, /notifications_resolve\(array\['admin\.demande\.nouvelle'\], 'quote_request', v_req\.id\)/);
});

test('aucun montant ni donnée personnelle n’entre dans une notification', () => {
  // Les seules données passées sont notif_params(référence), une date, ou rien.
  for (const m of CODE.matchAll(/notifications_create(?:_for_admins)?\(([\s\S]*?)\);/g)) {
    const args = m[1]!;
    assert.ok(!/montant|amount|email|phone|full_name|message|reason|motif/i.test(args), args.slice(0, 160));
  }
  assert.match(MAIN, /p_reference ~ '\^MORA-\[A-Z\]\{3,6\}-\[A-Z\]\{1,2\}\[0-9\]\{4\}\$'/);
});

test('remboursement : la permission du catalogue reste celle qu’exige l’application (payments.refund)', () => {
  assert.equal(NOTIFICATION_TYPES['admin.remboursement.a_executer'].permission, 'payments.refund');
  const actions = readFileSync(resolve(process.cwd(), 'src', 'lib', 'commerce', 'actions.ts'), 'utf8');
  assert.match(actions, /assertPermission\('payments\.refund', 'commerce\.remboursement\.enregistrement'\)/);
  assert.match(actions, /assertPermission\('payments\.refund', 'commerce\.remboursement\.execution'\)/);
});

test('rendez-vous : appointments.update, la permission de la confirmation et de la reprogrammation', () => {
  assert.equal(NOTIFICATION_TYPES['admin.rendez_vous.nouveau'].permission, 'appointments.update');
  const actions = readFileSync(resolve(process.cwd(), 'src', 'lib', 'relation', 'actions.ts'), 'utf8');
  assert.match(actions, /assertPermission\('appointments\.update', 'relation\.rendez_vous\.reprogrammation'\)/);
});

test('validation manuelle d’une commission : une seule notification pour une seule transition', () => {
  const queue = MAIN.match(/function public\.notifications_route_queue_event[\s\S]*?\$\$;/)![0];
  assert.match(queue, /ae\.event_type = 'COMMISSION_VALIDEE' and ae\.created_at = now\(\)/);
  assert.match(queue, /v_type := 'affilie\.commission\.validee';/);
  // Le journal 4H n'est pas lu pour les transitions déjà portées par la file.
  const journal = MAIN.match(/function public\.notifications_route_affiliate_event[\s\S]*?\$\$;/)![0];
  assert.ok(!/'COMMISSION_ACQUISE'|'COMMISSION_VALIDEE'|'COMMISSION_AJUSTEE'|'VERSEMENT_CONFIRME'/.test(journal));
});

test('aucun e-mail, aucun Realtime, aucune tâche planifiée, aucun rappel, aucune rétroactivité', () => {
  assert.ok(!/email_outbox|sendLoggedEmail|smtp/i.test(CODE));
  assert.ok(!/supabase_realtime|cron\.|pg_cron/.test(CODE));
  assert.ok(!/rappel/i.test(CODE.replace(/'[^']*'/g, '')));
  assert.ok(!/insert into public\.notifications/.test(CODE), 'la création passe toujours par le socle');
  // Aucun parcours de l'historique : les routeurs ne lisent que la ligne reçue.
  assert.ok(!/for \w+ in\s+select \* from public\.(orders|payments|quotes|appointments|affiliate_commissions|affiliate_payouts)\b/.test(CODE));
});

test('le socle 4J-1 n’est pas modifié par 4J-2', () => {
  for (const fn of ['notifications_create', 'notifications_create_for_admins', 'notifications_resolve', 'notification_visible',
    'mark_notification_read', 'mark_all_notifications_read', 'my_notification_counts', 'tg_notifications_from_catalogue', 'tg_notifications_immutable']) {
    assert.ok(!new RegExp(`create or replace function public\\.${fn}\\(`).test(ALL), `${fn} est réécrite`);
  }
  assert.ok(!/alter table public\.notifications\b|create policy [a-z_]+\s+on public\.notifications\b/.test(ALL));
  assert.ok(SOCLE.length > 0);
});

test('une notification ne survit pas à sa ressource', () => {
  const gone = [...MAIN.matchAll(/after delete on public\.([a-z_]+)\s+for each row execute function public\.tg_notifications_entity_gone\('([a-z_]+)', '([a-z_]+)'\)/g)];
  const map = Object.fromEntries(gone.map((m) => [m[2], m[1]]));
  for (const spec of Object.values(NOTIFICATION_TYPES)) {
    assert.ok(map[spec.entityType], `aucun nettoyage pour la ressource ${spec.entityType}`);
  }
});

test('la panne simulée n’existe que sur demande explicite d’une transaction d’outillage', () => {
  const fault = MAIN.match(/function public\.notifications_fault_check[\s\S]*?\$\$;/)![0];
  assert.match(fault, /current_setting\('mora\.notifications_panne', true\)/);
  const routers = [...MAIN.matchAll(/function public\.notifications_route_[a-z_]+\([\s\S]*?\$\$;/g)];
  for (const [body] of routers) assert.match(body, /perform public\.notifications_fault_check\(\);/);
});
