/**
 * Configuration commune aux scripts d'exploitation.
 *
 * La cible est toujours explicite : `--env` n'a aucune valeur par défaut.
 *
 *   --env shared   projet unique, servant tous les contextes. Lit les variables
 *                  de l'application : NEXT_PUBLIC_SUPABASE_URL,
 *                  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY.
 *
 *   --env dev      projets séparés, le jour où un second projet existe.
 *   --env prod     Variables préfixées : SUPABASE_DEV_* et SUPABASE_PROD_*.
 *
 * `shared` désigne une base qui porte les données réelles : les scripts la
 * traitent avec les mêmes précautions que `prod`, et toute opération
 * destructive y exige une confirmation explicite.
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

  // Un éditeur Windows peut préfixer le fichier d'une marque d'ordre des
  // octets. Sans ce retrait, la toute première variable serait ignorée — panne
  // discrète et pénible à diagnostiquer.
  const content = readFileSync(path, 'utf8').replace(/^﻿/, '');

  for (const line of content.split(/\r?\n/)) {
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

/** Extrait la référence de projet d'une URL `https://<ref>.supabase.co`. */
function projectRefFromUrl(url) {
  const host = new URL(url).host;
  const ref = host.split('.')[0];

  if (!/^[a-z0-9]{16,}$/.test(ref)) {
    throw new Error(
      'Impossible de déduire la référence du projet depuis NEXT_PUBLIC_SUPABASE_URL. ' +
        'Attendu : https://<ref>.supabase.co',
    );
  }

  return ref;
}

/** Normalise une URL Supabase vers la racine du projet. */
function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error('URL Supabase invalide. Attendu : https://<ref>.supabase.co');
  }
}

/**
 * Résout l'environnement cible.
 *
 * `--env` est obligatoire : aucune valeur par défaut n'est retenue, afin
 * qu'aucune commande ne puisse atteindre les données réelles par inadvertance.
 *
 * `shared` et `prod` désignent tous deux une base portant des données réelles.
 * Ils sont donc traités de la même façon : `isLiveData` vaut `true`, et les
 * commandes destructives doivent exiger une confirmation.
 */
export function resolveTarget({ allowLiveData = true } = {}) {
  loadLocalEnv();

  const env = readFlag('env');

  if (env !== 'dev' && env !== 'prod' && env !== 'shared') {
    throw new Error('Argument requis : --env shared | --env dev | --env prod');
  }

  const isLiveData = env !== 'dev';

  if (isLiveData && !allowLiveData) {
    throw new Error(
      `Cette commande est interdite sur « ${env} », qui porte les données réelles.`,
    );
  }

  if (env === 'prod' && !hasFlag('i-know-this-is-production')) {
    throw new Error(
      'Cible « prod » refusée sans confirmation explicite. ' +
        'Ajoutez --i-know-this-is-production pour confirmer.',
    );
  }

  if (env === 'shared') {
    const url = originOf(requireEnv('NEXT_PUBLIC_SUPABASE_URL'));

    return {
      env,
      isLiveData,
      isProduction: false,
      projectRef: process.env.SUPABASE_PROJECT_REF?.trim() || projectRefFromUrl(url),
      url,
      publishableKey: requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      secretKey: requireEnv('SUPABASE_SECRET_KEY'),
    };
  }

  const prefix = env === 'dev' ? 'SUPABASE_DEV' : 'SUPABASE_PROD';

  return {
    env,
    isLiveData,
    isProduction: env === 'prod',
    projectRef: requireEnv(`${prefix}_PROJECT_REF`),
    url: originOf(requireEnv(`${prefix}_URL`)),
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
  return (
    `environnement=${target.env} projet=${target.projectRef} ` +
    `donnees=${target.isLiveData ? 'reelles' : 'jetables'}`
  );
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
