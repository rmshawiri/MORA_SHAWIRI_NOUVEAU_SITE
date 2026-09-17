/**
 * Suppression du schéma hérité du socle précédent.
 *
 *   node scripts/reset-legacy-schema.mjs --env shared --dry-run
 *   node scripts/reset-legacy-schema.mjs --env shared --confirm-destroy
 *   node scripts/reset-legacy-schema.mjs --env shared --confirm-destroy --purge-auth-users
 *
 * POURQUOI CE SCRIPT EXISTE, ET POURQUOI CE N'EST PAS UNE MIGRATION
 *
 * Le projet Supabase porte encore le schéma d'une implémentation antérieure,
 * remplacée dans le dépôt par le commit `6dc6946` mais jamais retirée de la
 * base. Ce schéma n'a jamais été décrit par une migration versionnée : il a été
 * appliqué par un script ad hoc. Il est donc invisible pour l'outillage actuel,
 * et ses tables entrent en collision avec celles de la phase 4A.
 *
 * Le nettoyage est une opération ponctuelle, liée à l'histoire de CE projet.
 * En faire une migration reviendrait à laisser dans le dépôt un fichier dont le
 * rôle est de supprimer des tables — une arme chargée que la moindre erreur de
 * suivi ferait rejouer sur des données réelles. Les migrations restent donc
 * strictement additives, et la destruction est une action d'exploitation,
 * explicite et confirmée à la main.
 *
 * Aucune donnée n'est supprimée sans `--confirm-destroy`. Sans ce drapeau, le
 * script se contente de décrire ce qu'il ferait.
 */

import {
  describeTarget,
  hasFlag,
  log,
  resolveAccessToken,
  resolveTarget,
  runSql,
} from './lib/config.mjs';

/**
 * Tables du socle précédent, dans un ordre indifférent : `cascade` se charge
 * des dépendances. La liste est explicite plutôt que déduite d'un balayage du
 * schéma : un script destructeur doit nommer ce qu'il détruit.
 */
const LEGACY_TABLES = [
  'affiliate_clicks',
  'affiliates',
  'appointment_availabilities',
  'appointments',
  'audit_logs',
  'categories',
  'commission_rules',
  'commissions',
  'faqs',
  'media',
  'notifications',
  'order_items',
  'orders',
  'pages',
  'payments',
  'payouts',
  'permissions',
  'popups',
  'product_files',
  'products',
  'profiles',
  'promo_codes',
  'quote_requests',
  'refunds',
  'role_permissions',
  'roles',
  'services',
  'settings',
  'user_roles',
];

/** Fonctions et déclencheurs laissés par le socle précédent. */
const LEGACY_FUNCTIONS = [
  'public.rls_auto_enable()',
  'public.handle_new_user()',
  'public.set_updated_at()',
];

const LEGACY_TRIGGERS = [['on_auth_user_created', 'auth.users']];

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();
  const dryRun = !hasFlag('confirm-destroy');
  const purgeAuth = hasFlag('purge-auth-users');

  log.step(`Réinitialisation du socle précédent — ${describeTarget(target)}`);

  // --- Inventaire avant action ---------------------------------------------
  const existing = await runSql(
    target,
    accessToken,
    `select c.relname as table_name, coalesce(s.n_live_tup, 0) as approx_rows
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname;`,
  );

  const present = (Array.isArray(existing) ? existing : []).map((row) => row.table_name);

  log.step(`État actuel : ${present.length} table(s) dans le schéma public`);
  for (const row of Array.isArray(existing) ? existing : []) {
    const known = LEGACY_TABLES.includes(row.table_name) ? 'héritée' : 'INCONNUE';
    log.skip(`${row.table_name.padEnd(30)} ~${row.approx_rows} ligne(s)  [${known}]`);
  }

  const unknown = present.filter((name) => !LEGACY_TABLES.includes(name));
  if (unknown.length > 0) {
    log.warn(
      `${unknown.length} table(s) non prévue(s) par la liste : ${unknown.join(', ')}. ` +
        'Elles ne seront PAS supprimées.',
    );
  }

  if (dryRun) {
    const toDrop = present.filter((name) => LEGACY_TABLES.includes(name));
    log.step(`Simulation : ${toDrop.length} table(s) seraient supprimée(s).`);
    log.warn('Ajoutez --confirm-destroy pour exécuter réellement.');
    return;
  }

  // --- Suppression ----------------------------------------------------------
  log.step('Suppression des objets hérités');

  for (const [trigger, table] of LEGACY_TRIGGERS) {
    await runSql(target, accessToken, `drop trigger if exists ${trigger} on ${table};`);
    log.ok(`déclencheur ${trigger} retiré`);
  }

  const dropList = LEGACY_TABLES.map((name) => `public.${name}`).join(', ');
  await runSql(target, accessToken, `drop table if exists ${dropList} cascade;`);
  log.ok(`${LEGACY_TABLES.length} table(s) supprimée(s)`);

  for (const fn of LEGACY_FUNCTIONS) {
    await runSql(target, accessToken, `drop function if exists ${fn} cascade;`);
  }
  log.ok(`${LEGACY_FUNCTIONS.length} fonction(s) supprimée(s)`);

  // Le suivi des migrations est réinitialisé : le schéma reconstruit doit être
  // celui des migrations du dépôt, pas un héritage partiel.
  await runSql(target, accessToken, 'drop table if exists public.schema_migrations cascade;');
  log.ok('suivi des migrations réinitialisé');

  const remaining = await runSql(
    target,
    accessToken,
    `select count(*)::int as n from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r';`,
  );
  log.ok(`tables restantes dans public : ${remaining?.[0]?.n ?? '?'}`);

  // --- Comptes d'authentification ------------------------------------------
  if (!purgeAuth) {
    log.skip('comptes Supabase Auth conservés (--purge-auth-users non fourni)');
    return;
  }

  log.step('Purge des comptes Supabase Auth');
  log.warn(
    'Ces comptes sont des utilisateurs de l\'application, pas le compte ' +
      'propriétaire du tableau de bord Supabase, qui n\'est pas touché.',
  );

  const users = await fetch(`${target.url}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: target.secretKey, Authorization: `Bearer ${target.secretKey}` },
  });

  if (!users.ok) {
    throw new Error(`Lecture des comptes impossible (HTTP ${users.status}).`);
  }

  const { users: list = [] } = await users.json();

  for (const user of list) {
    const res = await fetch(`${target.url}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { apikey: target.secretKey, Authorization: `Bearer ${target.secretKey}` },
    });
    // Seul l'identifiant technique est journalisé, jamais l'adresse.
    log.ok(`compte ${user.id.slice(0, 8)}… supprimé (HTTP ${res.status})`);
  }

  log.step(`${list.length} compte(s) supprimé(s).`);
}

main().catch((error) => {
  log.fail(error.message);
  process.exit(1);
});
