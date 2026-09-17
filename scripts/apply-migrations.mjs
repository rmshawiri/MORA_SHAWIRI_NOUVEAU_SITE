/**
 * Application des migrations Supabase.
 *
 *   node scripts/apply-migrations.mjs --env dev
 *   node scripts/apply-migrations.mjs --env dev --dry-run
 *   node scripts/apply-migrations.mjs --env prod --i-know-this-is-production
 *
 * Le code définit l'architecture, les migrations définissent l'évolution de la
 * base (`10_DEPLOIEMENT/00_SUPABASE.md` § 130). Ce script est le seul chemin
 * d'évolution du schéma : rien ne se modifie à la main dans l'interface
 * Supabase sans être répercuté ici (§ 4 et § 10).
 *
 * Les migrations appliquées sont enregistrées avec leur empreinte. Une
 * migration déjà appliquée dont le contenu a changé est signalée comme dérive
 * plutôt que rejouée silencieusement.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PROJECT_ROOT,
  describeTarget,
  hasFlag,
  log,
  resolveAccessToken,
  resolveTarget,
  runSql,
} from './lib/config.mjs';

const MIGRATIONS_DIR = resolve(PROJECT_ROOT, 'supabase', 'migrations');

const BOOTSTRAP = `
create table if not exists public.schema_migrations (
  version     text primary key,
  name        text not null,
  checksum    text not null,
  applied_at  timestamptz not null default now()
);

comment on table public.schema_migrations is
  'Migrations appliquées à cette base, avec empreinte du fichier source.';

revoke all on public.schema_migrations from anon, authenticated;
alter table public.schema_migrations enable row level security;
-- Aucune politique : table réservée à l'outillage serveur.
`;

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
      return {
        name,
        version: name.replace(/_.*$/, ''),
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();
  const dryRun = hasFlag('dry-run');

  log.step(`Migrations — ${describeTarget(target)}${dryRun ? ' (simulation)' : ''}`);

  const migrations = listMigrations();
  if (migrations.length === 0) {
    log.warn('Aucune migration trouvée.');
    return;
  }

  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Deux migrations portent la version ${migration.version}.`);
    }
    versions.add(migration.version);
  }

  await runSql(target, accessToken, BOOTSTRAP);

  const applied = await runSql(
    target,
    accessToken,
    'select version, checksum from public.schema_migrations;',
  );

  const appliedByVersion = new Map(
    (Array.isArray(applied) ? applied : []).map((row) => [row.version, row.checksum]),
  );

  let pending = 0;
  let drift = 0;

  for (const migration of migrations) {
    const knownChecksum = appliedByVersion.get(migration.version);

    if (knownChecksum === migration.checksum) {
      log.skip(`${migration.name} — déjà appliquée`);
      continue;
    }

    if (knownChecksum !== undefined) {
      drift += 1;
      log.warn(
        `${migration.name} — DÉRIVE : le fichier a changé depuis son application. ` +
          'Créez une nouvelle migration plutôt que de modifier celle-ci.',
      );
      continue;
    }

    pending += 1;

    if (dryRun) {
      log.ok(`${migration.name} — à appliquer`);
      continue;
    }

    await runSql(target, accessToken, migration.sql);
    await runSql(
      target,
      accessToken,
      `insert into public.schema_migrations (version, name, checksum)
       values (${quote(migration.version)}, ${quote(migration.name)}, ${quote(migration.checksum)})
       on conflict (version) do update set name = excluded.name,
                                           checksum = excluded.checksum,
                                           applied_at = now();`,
    );

    log.ok(`${migration.name} — appliquée`);
  }

  log.step(
    dryRun
      ? `${pending} migration(s) en attente, ${drift} dérive(s).`
      : `${pending} migration(s) appliquée(s), ${drift} dérive(s).`,
  );

  if (drift > 0) process.exitCode = 1;
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

main().catch((error) => {
  log.fail(error.message);
  process.exit(1);
});
