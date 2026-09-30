/**
 * Invariants structurels des migrations.
 *
 * Ces contrôles s'exécutent sans base de données. Ils ne remplacent pas
 * `scripts/verify-security.mjs`, qui interroge une base réelle, mais ils
 * attrapent avant tout déploiement l'oubli le plus coûteux du projet : une
 * table créée sans RLS.
 *
 * Référence : `10_DEPLOIEMENT/00_SUPABASE.md` § 32-35 et § 129.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase', 'migrations');

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const sqlByFile = new Map(
  files.map((name) => [name, readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8')]),
);

const allSql = [...sqlByFile.values()].join('\n');

/**
 * Tables volontairement dépourvues de politique : RLS activée sans politique
 * équivaut à un refus total, ce qui est exactement l'intention.
 */
const DENY_ALL_TABLES = new Set([
  'rate_limit_counters',
  // Le compteur du Moteur de Documents. Aucune session ne doit pouvoir le lire
  // ni l'écrire : seule `allocate_document_number()` y touche, sous verrou
  // (prompt maître § 36 et § 38).
  'document_sequences',
]);

function createdTables(sql: string): string[] {
  return [...sql.matchAll(/create table if not exists public\.([a-z_]+)/g)].map(
    (match) => match[1]!,
  );
}

test('au moins une migration existe et les noms sont ordonnables', () => {
  assert.ok(files.length > 0, 'aucune migration trouvée');

  for (const name of files) {
    assert.match(name, /^\d{14}_[a-z0-9_]+\.sql$/, `nom de migration non conforme : ${name}`);
  }

  const versions = files.map((name) => name.slice(0, 14));
  assert.equal(new Set(versions).size, versions.length, 'deux migrations partagent une version');
  assert.deepEqual([...versions].sort(), versions, 'les migrations ne sont pas triées');
});

test('chaque table créée a RLS activée', () => {
  const tables = createdTables(allSql);
  assert.ok(tables.length > 0);

  for (const table of tables) {
    assert.ok(
      new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(allSql),
      `RLS absente sur public.${table}`,
    );
  }
});

test('chaque table porte une politique explicite, ou un refus total assumé', () => {
  for (const table of createdTables(allSql)) {
    if (DENY_ALL_TABLES.has(table)) continue;

    assert.ok(
      new RegExp(`create policy [a-z_]+\\s+on public\\.${table}\\b`).test(allSql),
      `aucune politique sur public.${table}`,
    );
  }
});

test('aucune politique n\'est ouverte au rôle « public »', () => {
  const openPolicies = [...allSql.matchAll(/create policy[\s\S]{0,200}?\bto\s+([a-z_,\s]+)/g)]
    .map((match) => match[1]!.trim())
    .filter((roles) => /\bpublic\b/.test(roles));

  assert.deepEqual(openPolicies, [], 'une politique cible le rôle public');
});

/**
 * Tables que le visiteur non connecté peut atteindre.
 *
 * La liste s'est allongée en phase 4E, et c'est une décision, pas une dérive :
 * la Boutique lit désormais son catalogue en base, donc le rôle anonyme doit
 * pouvoir atteindre les trois tables qui la composent. Ce que RLS filtre
 * ensuite — seules les lignes publiées, seules les catégories actives — reste
 * entier ; un privilège de table n'a jamais valu autorisation de lire une
 * ligne.
 *
 * Ajouter une entrée ici doit rester un acte délibéré. C'est tout l'intérêt du
 * test : il échoue dès qu'une migration ouvre une table de plus au public,
 * fût-ce par inadvertance.
 */
const ANON_READABLE_TABLES = ['categories', 'products', 'services', 'settings'];

test('le rôle anonyme ne reçoit que la lecture, et seulement sur les tables publiques', () => {
  const grantsToAnon = [
    ...allSql.matchAll(/grant\s+([a-z,\s]+?)\s+on\s+public\.([a-z_]+)\s+to\s+([^;]+);/g),
  ].filter((match) => /\banon\b/.test(match[3]!));

  assert.deepEqual(
    [...new Set(grantsToAnon.map((match) => match[2]!))].sort(),
    ANON_READABLE_TABLES,
  );

  // Et jamais autre chose que la lecture : un `insert` accordé au rôle anonyme
  // ouvrirait l'écriture à n'importe quel visiteur, politique RLS ou non.
  for (const match of grantsToAnon) {
    assert.deepEqual(
      match[1]!.split(',').map((privilege) => privilege.trim()),
      ['select'],
      `le rôle anonyme reçoit autre chose que la lecture sur public.${match[2]}`,
    );
  }
});

test('toute fonction SECURITY DEFINER fige son search_path', () => {
  const functions = [...allSql.matchAll(/create or replace function public\.([a-z_]+)\(([\s\S]*?)\$\$/g)];

  let checked = 0;

  for (const match of functions) {
    const body = match[0]!;
    if (!/security definer/i.test(body)) continue;

    checked += 1;
    assert.match(
      body,
      /set search_path\s*=/i,
      `search_path non figé dans public.${match[1]}`,
    );
  }

  assert.ok(checked >= 5, `trop peu de fonctions SECURITY DEFINER analysées (${checked})`);
});

/**
 * Une fonction `SECURITY DEFINER` s'exécute sous l'identité de son
 * propriétaire : `current_user` y vaut `postgres`, quelle que soit la session
 * qui l'a déclenchée. Or `is_privileged_db_role()` interroge précisément
 * `current_user` pour reconnaître une migration ou la clé de service.
 *
 * Combiner les deux produit un garde-fou qui répond « requête privilégiée » à
 * tout le monde, et ne refuse donc jamais rien — une porte dont le verrou
 * s'ouvre pour quiconque frappe. Le défaut est silencieux : le SQL se lit
 * correctement, la fonction s'installe sans un mot, et rien ne signale que le
 * contrôle est mort. Il a été introduit puis détecté pendant la phase 4E, par
 * `scripts/verify-catalogue.mjs` ; ce test est ce qui l'empêchera de revenir.
 */
test('un garde-fou qui interroge le rôle courant n\'est jamais SECURITY DEFINER', () => {
  const functions = [...allSql.matchAll(/create or replace function public\.([a-z_]+)\(([\s\S]*?)\$\$;/g)];

  let checked = 0;

  for (const match of functions) {
    const body = match[0]!;
    if (!/is_privileged_db_role\(\)/.test(body)) continue;
    if (match[1] === 'is_privileged_db_role') continue;

    checked += 1;
    assert.ok(
      !/security definer/i.test(body),
      `public.${match[1]} interroge is_privileged_db_role() en SECURITY DEFINER : le contrôle serait inopérant`,
    );
  }

  assert.ok(checked >= 3, `trop peu de garde-fous analysés (${checked})`);
});

test('le journal d\'audit n\'accepte ni modification ni suppression', () => {
  assert.ok(!/create policy[^;]*on public\.audit_logs[^;]*for (update|delete)/i.test(allSql));
});

test('aucune migration ne contient de mot de passe ni de secret', () => {
  const forbidden: [RegExp, string][] = [
    [/sb_secret_[A-Za-z0-9_-]+/, 'clé secrète Supabase'],
    [/sbp_[A-Za-z0-9]{20,}/, 'jeton d\'accès Supabase'],
    [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'jeton JWT'],
    [/ghp_[A-Za-z0-9]{20,}/, 'jeton GitHub'],
    [/crypt\s*\(/i, 'hachage de mot de passe en SQL'],
    [/\bencrypted_password\b/i, 'écriture directe dans encrypted_password'],
    [/insert\s+into\s+auth\.users/i, 'création de compte depuis une migration'],
  ];

  for (const [name, sql] of sqlByFile) {
    for (const [pattern, label] of forbidden) {
      assert.ok(!pattern.test(sql), `${label} détecté dans ${name}`);
    }
  }
});

test('les migrations sont rejouables', () => {
  for (const [name, sql] of sqlByFile) {
    const creates = [...sql.matchAll(/create table (?!if not exists)/g)];
    assert.equal(creates.length, 0, `${name} : « create table » sans « if not exists »`);

    const policies = [...sql.matchAll(/create policy ([a-z_]+)/g)].map((match) => match[1]!);
    for (const policy of policies) {
      assert.ok(
        sql.includes(`drop policy if exists ${policy}`),
        `${name} : la politique ${policy} n'est pas supprimée avant recréation`,
      );
    }

    const triggers = [...sql.matchAll(/create trigger ([a-z_]+)/g)].map((match) => match[1]!);
    for (const trigger of triggers) {
      assert.ok(
        sql.includes(`drop trigger if exists ${trigger}`),
        `${name} : le déclencheur ${trigger} n'est pas supprimé avant recréation`,
      );
    }
  }
});

test('aucun taux commercial n\'est figé dans une migration', () => {
  assert.ok(
    !/(taux|rate)\s*[:=]\s*(10|12|15|20)\b/i.test(allSql),
    'un taux de commission semble codé en dur',
  );
  assert.ok(!/commission_rate|affiliate_rate/i.test(allSql));
});
