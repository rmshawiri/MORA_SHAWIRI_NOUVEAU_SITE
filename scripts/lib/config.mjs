/**
 * Configuration commune aux scripts d'exploitation.
 *
 * Deux projets Supabase coexistent. Les scripts ne lisent JAMAIS les variables
 * de l'application (`NEXT_PUBLIC_SUPABASE_*`), qui décrivent l'environnement
 * dans lequel le site tourne. Ils lisent des variables préfixées par
 * l'environnement visé, ce qui rend la cible explicite à chaque exécution :
 *
 *   SUPABASE_DEV_PROJECT_REF   SUPABASE_PROD_PROJECT_REF
 *   SUPABASE_DEV_URL           SUPABASE_PROD_URL
 *   SUPABASE_DEV_PUBLISHABLE_KEY   SUPABASE_PROD_PUBLISHABLE_KEY
 *   SUPABASE_DEV_SECRET_KEY    SUPABASE_PROD_SECRET_KEY
 *
 * Aucune valeur n'est affichée : les fonctions de ce module renvoient les
 * secrets à l'appelant mais ne les journalisent jamais, et `describeTarget()`
 * ne produit que des informations non sensibles.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Charge `.env.local` dans `process.env` sans écraser l'existant. */
export function loadLocalEnv() {
  const path = resolve(PROJECT_ROOT, '.env.local');
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    if (process.env[key] !== undefined) continue;

    process.env[key] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

/** Lit un argument `--nom valeur` ou `--nom=valeur`. */
export function readFlag(name, fallback = undefined) {
  const argv = process.argv.slice(2);
  const exact = argv.indexOf(`--${name}`);
  if (exact !== -1 && argv[exact + 1] && !argv[exact + 1].startsWith('--')) {
    return argv[exact + 1];
  }

  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);

  return fallback;
}

export function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}. ` +
        'Renseignez-la dans .env.local — ce fichier n\'est jamais versionné.',
    );
  }
  return value;
}

/**
 * Résout l'environnement cible.
 *
 * `--env` est obligatoire : aucune valeur par défaut n'est retenue, afin
 * qu'aucune commande ne puisse atteindre la production par inadvertance.
 * Viser la production exige en outre `--i-know-this-is-production`.
 */
export function resolveTarget({ allowProduction = true } = {}) {
  loadLocalEnv();

  const env = readFlag('env');

  if (env !== 'dev' && env !== 'prod') {
    throw new Error('Argument requis : --env dev | --env prod');
  }

  if (env === 'prod') {
    if (!allowProduction) {
      throw new Error(
        'Cette commande est interdite sur la production. ' +
          'La base de production ne sert jamais d\'environnement de test.',
      );
    }

    if (!hasFlag('i-know-this-is-production')) {
      throw new Error(
        'Cible « prod » refusée sans confirmation explicite. ' +
          'Ajoutez --i-know-this-is-production pour confirmer.',
      );
    }
  }

  const prefix = env === 'dev' ? 'SUPABASE_DEV' : 'SUPABASE_PROD';

  return {
    env,
    isProduction: env === 'prod',
    projectRef: requireEnv(`${prefix}_PROJECT_REF`),
    url: requireEnv(`${prefix}_URL`),
    publishableKey: requireEnv(`${prefix}_PUBLISHABLE_KEY`),
    secretKey: requireEnv(`${prefix}_SECRET_KEY`),
  };
}

/** Jeton d'accès à l'API de gestion Supabase. */
export function resolveAccessToken() {
  loadLocalEnv();
  return requireEnv('SUPABASE_ACCESS_TOKEN');
}

/** Description non sensible de la cible, sûre à journaliser. */
export function describeTarget(target) {
  return `environnement=${target.env} projet=${target.projectRef}`;
}

/**
 * Exécute du SQL via l'API de gestion Supabase.
 *
 * L'API est utilisée plutôt qu'une connexion Postgres directe : elle ne réclame
 * pas le mot de passe de la base, ce qui réduit d'un le nombre de secrets à
 * faire circuler.
 */
export async function runSql(target, accessToken, sql) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${target.projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`SQL refusé (HTTP ${response.status}) : ${text.slice(0, 800)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Journalisation compacte, sans jamais transporter de secret. */
export const log = {
  step: (message) => console.log(`\n▸ ${message}`),
  ok: (message) => console.log(`  ✓ ${message}`),
  skip: (message) => console.log(`  · ${message}`),
  warn: (message) => console.log(`  ! ${message}`),
  fail: (message) => console.error(`  ✗ ${message}`),
};
