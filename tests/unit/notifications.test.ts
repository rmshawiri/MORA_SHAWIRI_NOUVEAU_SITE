/**
 * Socle des notifications — phase 4J-1.
 *
 * Ce que ces tests épinglent, sans base :
 *   * le catalogue TypeScript et le catalogue SQL décrivent les mêmes types ;
 *   * trois espaces, trois niveaux, pas un de plus (N9, N12) ;
 *   * aucune donnée sensible n'entre dans une notification (N13) ;
 *   * aucune cible n'est une URL libre : seulement des chemins internes de
 *     l'espace attendu, calculés depuis une table fermée ;
 *   * lue et traitée sont indépendantes (N6) ;
 *   * aucun rechargement, aucune minuterie, aucun temps réel (N11) ;
 *   * la migration ne crée aucune notification (N16) et n'ouvre la création
 *     à aucune session.
 *
 * Le comportement réel (RLS, idempotence, retrait de permission, multi-rôle)
 * est contrôlé contre la base par `scripts/verify-notifications.mjs`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_LEVELS,
  NOTIFICATION_LEVEL_LABELS,
  NOTIFICATION_TYPES,
  isNotificationType,
  notificationType,
} from '../../src/lib/notifications/catalogue';
import { notificationParamsOk, readNotificationParams } from '../../src/lib/notifications/params';
import { isSafeInternalPath, notificationTarget } from '../../src/lib/notifications/targets';
import { toNotificationView } from '../../src/lib/notifications/view';
import { PERMISSIONS } from '../../src/lib/rbac/catalogue';
import type { NotificationRow } from '../../src/lib/supabase/types-notifications';

const ROOT = process.cwd();
const MIGRATION = readFileSync(resolve(ROOT, 'supabase', 'migrations', '20261003200000_notifications_socle.sql'), 'utf8');
const LIB_DIR = resolve(ROOT, 'src', 'lib', 'notifications');
const UUID = '3f2b8c4e-1d2a-4b5c-8d9e-0a1b2c3d4e5f';

/** Les lignes du catalogue telles que la migration les insère. */
function sqlCatalogue(): Map<string, { audience: string; level: string; entity: string; permission: string | null; label: string }> {
  const rows = new Map();
  const pattern =
    /\(\s*'([a-z_.]+)',\s*'([A-Z]+)',\s*'([A-Z_]+)',\s*'([a-z_]+)',\s*(null|'[a-z_.]+'),\s*'((?:[^']|'')+)'\s*\)/g;
  for (const match of MIGRATION.matchAll(pattern)) {
    rows.set(match[1], {
      audience: match[2],
      level: match[3],
      entity: match[4],
      permission: match[5] === 'null' ? null : match[5]!.slice(1, -1),
      label: match[6]!.replace(/''/g, '’'),
    });
  }
  return rows;
}

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: UUID,
    recipient_id: UUID,
    audience: 'CLIENT',
    type_code: 'client.commande.confirmee',
    level: 'INFORMATION',
    required_permission: null,
    entity_type: 'order',
    entity_id: UUID,
    params: { reference: 'MORA-CMCL-A0001' },
    source_table: 'order_events',
    source_id: '42',
    created_at: '2026-10-03T10:00:00Z',
    read_at: null,
    resolved_at: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                    */
/* -------------------------------------------------------------------------- */

test('le catalogue TypeScript et le catalogue SQL sont identiques', () => {
  const sql = sqlCatalogue();
  const ts = Object.entries(NOTIFICATION_TYPES);
  assert.equal(sql.size, ts.length, `${sql.size} types en SQL, ${ts.length} en TypeScript`);
  for (const [code, spec] of ts) {
    const line = sql.get(code);
    assert.ok(line, `type ${code} absent de la migration`);
    assert.equal(line.audience, spec.audience, `${code} : espace`);
    assert.equal(line.level, spec.level, `${code} : niveau`);
    assert.equal(line.entity, spec.entityType, `${code} : ressource`);
    assert.equal(line.permission, spec.permission, `${code} : permission`);
    assert.equal(line.label, spec.label, `${code} : libellé`);
  }
});

test('trois espaces et trois niveaux, exactement (N9, N12)', () => {
  assert.deepEqual([...NOTIFICATION_AUDIENCES], ['ADMINISTRATION', 'CLIENT', 'AFFILIE']);
  assert.deepEqual([...NOTIFICATION_LEVELS], ['A_TRAITER', 'INFORMATION', 'ATTENTION']);
  assert.deepEqual(Object.values(NOTIFICATION_LEVEL_LABELS), ['À traiter', 'Information', 'Attention']);
  assert.match(MIGRATION, /audience in \('ADMINISTRATION', 'CLIENT', 'AFFILIE'\)/);
  assert.match(MIGRATION, /level in \('A_TRAITER', 'INFORMATION', 'ATTENTION'\)/);
  for (const spec of Object.values(NOTIFICATION_TYPES)) {
    assert.ok((NOTIFICATION_LEVELS as readonly string[]).includes(spec.level));
  }
});

test('les types de ressource TypeScript et SQL sont les mêmes', () => {
  const block = MIGRATION.match(/notification_types_entity check \(entity_type in \(([\s\S]*?)\)\)/);
  assert.ok(block, 'contrainte des ressources introuvable');
  const sqlTypes = [...block[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(sqlTypes, [...NOTIFICATION_ENTITY_TYPES].sort());
});

test('chaque code annonce son espace, et seule l’administration exige une permission existante', () => {
  for (const [code, spec] of Object.entries(NOTIFICATION_TYPES)) {
    const prefix = code.split('.')[0];
    assert.equal(prefix, spec.audience === 'ADMINISTRATION' ? 'admin' : spec.audience === 'CLIENT' ? 'client' : 'affilie', code);
    if (spec.audience === 'ADMINISTRATION') {
      assert.ok(spec.permission, `${code} : permission manquante`);
      assert.ok((PERMISSIONS as readonly string[]).includes(spec.permission), `${code} : permission inconnue ${spec.permission}`);
    } else {
      assert.equal(spec.permission, null, `${code} : un client ou un affilié n’a pas de permission`);
    }
  }
});

test('paiement déclaré : seuls ceux qui peuvent vérifier un paiement sont visés (N4)', () => {
  assert.equal(NOTIFICATION_TYPES['admin.paiement.a_verifier'].permission, 'payments.verify');
  assert.equal(NOTIFICATION_TYPES['admin.remboursement.a_executer'].permission, 'payments.refund');
});

test('isNotificationType refuse ce qui n’est pas au catalogue, y compris les clés héritées', () => {
  assert.equal(isNotificationType('client.devis.disponible'), true);
  assert.equal(isNotificationType('client.devis.inconnu'), false);
  assert.equal(isNotificationType('toString'), false);
  assert.equal(isNotificationType('__proto__'), false);
  assert.equal(notificationType('constructor'), null);
});

test('les phrases ne contiennent jamais de montant ni de donnée personnelle', () => {
  for (const [code, spec] of Object.entries(NOTIFICATION_TYPES)) {
    for (const reference of [null, 'MORA-CMCL-A0001']) {
      const title = spec.title(reference);
      assert.ok(title.length > 10 && title.length <= 140, `${code} : longueur`);
      assert.ok(!/KMF|€|\d{3,}\s?(?:KMF|F)\b|@|\+269/.test(title), `${code} : « ${title} »`);
      assert.ok(!title.includes('undefined') && !title.includes('null'), `${code} : variable vide`);
      if (reference) assert.ok(title.includes(reference) || !title.includes('MORA-'), code);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Données minimales (N13)                                                      */
/* -------------------------------------------------------------------------- */

test('seules reference, statut et date sont admises', () => {
  assert.equal(notificationParamsOk({}), true);
  assert.equal(notificationParamsOk({ reference: 'MORA-CMCL-A0001', statut: 'CONFIRMEE', date: '2026-10-05' }), true);
  assert.equal(notificationParamsOk({ reference: 'MORA-CLI-A0002' }), true);
  assert.equal(notificationParamsOk({ reference: 'MORA-DMCL-AA0001' }), true);
  assert.equal(notificationParamsOk({ date: '2026-10-05T09:30:00+03:00' }), true);
  for (const forbidden of ['montant', 'amount', 'email', 'telephone', 'phone', 'nom', 'name', 'message', 'iban', 'url', 'href']) {
    assert.equal(notificationParamsOk({ [forbidden]: 'x' }), false, forbidden);
  }
  assert.equal(notificationParamsOk({ reference: 'Jean Dupont' }), false);
  assert.equal(notificationParamsOk({ reference: 'MORA-CMCL-A0001/../x' }), false);
  assert.equal(notificationParamsOk({ reference: 'https://exemple.test/' }), false);
  assert.equal(notificationParamsOk({ statut: 'payé 150000' }), false);
  assert.equal(notificationParamsOk({ statut: 150000 }), false);
  assert.equal(notificationParamsOk({ date: 'demain' }), false);
  assert.equal(notificationParamsOk([]), false);
  assert.equal(notificationParamsOk(null), false);
  assert.deepEqual(readNotificationParams({ montant: '150000', reference: 'MORA-CMCL-A0001' }), {});
});

test('la base applique la même liste blanche', () => {
  assert.match(MIGRATION, /k\.key not in \('reference', 'statut', 'date'\)/);
  assert.match(MIGRATION, /constraint notifications_params check \(public\.notification_params_ok\(params\)\)/);
});

/* -------------------------------------------------------------------------- */
/* Cibles : aucune URL arbitraire                                               */
/* -------------------------------------------------------------------------- */

test('chaque type mène à un chemin interne de son propre espace', () => {
  for (const [code, spec] of Object.entries(NOTIFICATION_TYPES)) {
    const path = notificationTarget({
      audience: spec.audience,
      typeCode: code,
      entityType: spec.entityType,
      entityId: UUID,
      params: { reference: 'MORA-CMCL-A0001' },
    });
    assert.ok(path, `${code} : aucune cible`);
    assert.ok(isSafeInternalPath(path, spec.audience), `${code} : ${path}`);
    const prefix = spec.audience === 'ADMINISTRATION' ? '/administration/' : spec.audience === 'CLIENT' ? '/espace-client/' : '/espace-affilie/';
    assert.ok(path.startsWith(prefix), `${code} : ${path}`);
  }
});

test('une donnée malformée ne produit aucune cible, jamais une cible approximative', () => {
  const base = { audience: 'CLIENT' as const, typeCode: 'client.commande.confirmee', entityType: 'order' as const, entityId: UUID };
  assert.equal(notificationTarget({ ...base, params: {} }), null);
  assert.equal(notificationTarget({ ...base, params: { reference: '../../administration' } }), null);
  assert.equal(notificationTarget({ ...base, params: { reference: 'https://exemple.test' } }), null);
  assert.equal(notificationTarget({ ...base, params: { reference: 'MORA-CMCL-A0001?x=1' } }), null);
  const byId = { audience: 'CLIENT' as const, typeCode: 'client.rendez_vous.confirme', entityType: 'appointment' as const, params: {} };
  assert.equal(notificationTarget({ ...byId, entityId: 'pas-un-uuid' }), null);
  assert.equal(notificationTarget({ ...byId, entityId: `${UUID}/../x` }), null);
  assert.equal(notificationTarget({ ...byId, entityId: UUID }), `/espace-client/rendez-vous/${UUID}/`);
});

test('un espace ne mène jamais vers la ressource d’un autre espace', () => {
  // Une commission n'a pas de page dans l'espace client ; un paiement n'en a
  // pas dans l'espace affilié.
  assert.equal(notificationTarget({ audience: 'CLIENT', typeCode: 'x', entityType: 'affiliate_commission', entityId: UUID, params: {} }), null);
  assert.equal(notificationTarget({ audience: 'AFFILIE', typeCode: 'x', entityType: 'payment', entityId: UUID, params: { reference: 'MORA-CMCL-A0001' } }), null);
  assert.equal(isSafeInternalPath('/administration/commandes/MORA-CMCL-A0001/', 'CLIENT'), false);
  assert.equal(isSafeInternalPath('//exemple.test/espace-client/', 'CLIENT'), false);
  assert.equal(isSafeInternalPath('https://exemple.test/espace-client/', 'CLIENT'), false);
  assert.equal(isSafeInternalPath('/espace-client/../administration/', 'CLIENT'), false);
});

test('la table des notifications ne porte aucune colonne d’URL', () => {
  const table = MIGRATION.match(/create table if not exists public\.notifications \(([\s\S]*?)\n\);/);
  assert.ok(table);
  assert.ok(!/\b(url|href|link|lien|redirect|target)\b\s+text/i.test(table[1]!));
  assert.ok(!/\b(amount|montant|email|phone|telephone|title|body|message)\b\s+(text|numeric)/i.test(table[1]!));
});

/* -------------------------------------------------------------------------- */
/* Présentation : lue et traitée sont indépendantes (N6)                        */
/* -------------------------------------------------------------------------- */

test('lue et traitée sont deux états distincts', () => {
  const pending = row({ type_code: 'client.devis.disponible', level: 'A_TRAITER', entity_type: 'quote', params: { reference: 'MORA-DVCL-A0004' } });
  const cases = [
    [null, null, false, false],
    ['2026-10-03T11:00:00Z', null, true, false],
    ['2026-10-03T11:00:00Z', '2026-10-03T12:00:00Z', true, true],
    [null, '2026-10-03T12:00:00Z', false, true],
  ] as const;
  for (const [readAt, resolvedAt, read, resolved] of cases) {
    const view = toNotificationView({ ...pending, read_at: readAt, resolved_at: resolvedAt });
    assert.ok(view);
    assert.equal(view.read, read);
    assert.equal(view.resolved, resolved);
    assert.equal(view.levelLabel, 'À traiter');
    assert.equal(view.href, '/espace-client/devis/MORA-DVCL-A0004/');
    assert.equal(view.title, 'Votre devis MORA-DVCL-A0004 est disponible.');
  }
});

test('une ligne incohérente avec le catalogue n’est pas affichée', () => {
  assert.equal(toNotificationView(row({ type_code: 'client.inconnu.type' })), null);
  assert.equal(toNotificationView(row({ audience: 'AFFILIE' })), null);
  const leaked = toNotificationView(row({ params: { reference: 'MORA-CMCL-A0001', montant: '150000' } }));
  assert.ok(leaked);
  assert.ok(!leaked.title.includes('150000'));
});

test('la base fait la même distinction : « traitée » n’est jamais posée par une session', () => {
  const markOne = MIGRATION.match(/function public\.mark_notification_read[\s\S]*?\$\$;/)![0];
  const markAll = MIGRATION.match(/function public\.mark_all_notifications_read[\s\S]*?\$\$;/)![0];
  for (const body of [markOne, markAll]) {
    assert.match(body, /set read_at = now\(\)/);
    assert.ok(!/resolved_at\s*=/.test(body));
    assert.match(body, /recipient_id = auth\.uid\(\)/);
    assert.match(body, /notification_visible\(/);
  }
  assert.match(MIGRATION, /constraint notifications_resolved_level check \(resolved_at is null or level = 'A_TRAITER'\)/);
});

/* -------------------------------------------------------------------------- */
/* Base : création réservée, unicité, aucune rétroactivité                      */
/* -------------------------------------------------------------------------- */

test('aucune session ne peut créer, résoudre ni lire les droits d’autrui', () => {
  for (const fn of [
    'notifications_create(text, uuid, text, uuid, jsonb, text, text, uuid)',
    'notifications_create_for_admins(text, text, uuid, jsonb, text, text, uuid)',
    'notifications_resolve(text[], text, uuid)',
    'user_has_effective_permission(uuid, text)',
  ]) {
    const escaped = fn.replace(/[()[\]]/g, '\\$&');
    assert.match(MIGRATION, new RegExp(`revoke execute on function public\\.${escaped} from public, anon, authenticated;`), fn);
    assert.match(MIGRATION, new RegExp(`grant  execute on function public\\.${escaped} to service_role;`), fn);
  }
  assert.match(MIGRATION, /revoke all on public\.notifications\s+from anon, authenticated;/);
  assert.match(MIGRATION, /grant select on public\.notifications\s+to authenticated;/);
  assert.ok(!/grant (insert|update|delete|all)[^;]*on public\.notifications\s+to authenticated/.test(MIGRATION));
  assert.ok(!/create policy[^;]*on public\.notifications[^;]*for (insert|update|delete|all)/i.test(MIGRATION));
});

test('l’unicité destinataire / espace / type / événement est garantie par un index unique', () => {
  assert.match(
    MIGRATION,
    /create unique index if not exists notifications_dedup_key\s+on public\.notifications \(recipient_id, audience, type_code, source_table, source_id\);/,
  );
  assert.match(MIGRATION, /on conflict \(recipient_id, audience, type_code, source_table, source_id\) do nothing/);
});

test('l’auteur d’un acte n’est jamais notifié de sa propre action (N5)', () => {
  assert.match(MIGRATION, /if p_actor is not null and p_actor = p_recipient then\s+return null;/);
});

test('la migration ne crée aucune notification et ne branche rien (N16, N18)', () => {
  assert.ok(!/insert into public\.notifications\b(?![\s\S]{0,20}\(recipient_id, type_code)/.test(MIGRATION));
  assert.equal([...MIGRATION.matchAll(/insert into public\.notifications \(/g)].length, 1);
  assert.ok(!/from public\.notification_events/.test(MIGRATION), 'la file 4H n’est pas consommée en 4J-1');
  for (const journal of ['order_events', 'quote_request_events', 'appointment_events', 'affiliate_events', 'affiliate_application_events', 'notification_events', 'clients']) {
    assert.ok(!new RegExp(`create trigger [a-z_]+\\s+(after|before)[^;]*on public\\.${journal}\\b`).test(MIGRATION), journal);
  }
  assert.ok(!/cron\./.test(MIGRATION), 'aucune tâche planifiée (N15, N19)');
  assert.ok(!/notification_preferences/.test(MIGRATION.replace(/^--.*$/gm, '')), 'préférences reportées à 4K (N14)');
});

/* -------------------------------------------------------------------------- */
/* Aucun automatisme (N11)                                                      */
/* -------------------------------------------------------------------------- */

test('aucune minuterie, aucun temps réel, aucun rechargement', () => {
  for (const name of readdirSync(LIB_DIR)) {
    const source = readFileSync(resolve(LIB_DIR, name), 'utf8');
    for (const pattern of [/setInterval/, /setTimeout/, /\.channel\(/, /realtime/i, /postgres_changes/, /location\.reload/, /router\.refresh/, /visibilitychange/, /addEventListener/]) {
      assert.ok(!pattern.test(source.replace(/^\s*(\*|\/\/).*$/gm, '')), `${name} : ${pattern}`);
    }
  }
  assert.ok(!/supabase_realtime/.test(MIGRATION), 'aucune publication Realtime');
});

test('la couche serveur lit avec la session, jamais avec la clé de service', () => {
  const server = readFileSync(resolve(LIB_DIR, 'server.ts'), 'utf8');
  assert.match(server, /^import 'server-only';/);
  assert.match(server, /getServerSupabaseClient/);
  assert.ok(!/getAdminSupabaseClient|SECRET_KEY|service_role/.test(server));
  assert.ok(!/notifications_create|notifications_resolve/.test(server));
});
