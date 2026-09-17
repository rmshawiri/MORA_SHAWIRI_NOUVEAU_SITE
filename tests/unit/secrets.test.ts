/**
 * Aucun secret dans le dépôt.
 *
 * Le contrôle porte sur les fichiers réellement suivis par Git — pas sur le
 * dossier de travail —, ce qui est la seule question qui compte : qu'est-ce qui
 * partira sur GitHub ?
 *
 * Référence : `10_DEPLOIEMENT/00_SUPABASE.md` § 43-44 et § 126 ;
 *             `07_ARCHITECTURE_TECHNIQUE/06_VARIABLES_ENVIRONNEMENT.md`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
}

const trackedFiles = git('ls-files')
  .split(/\r?\n/)
  .filter(Boolean);

const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|sql|md|css|yml|yaml|html|txt|example)$/;

const textFiles = trackedFiles.filter((file) => {
  if (!TEXT_EXTENSIONS.test(file)) return false;
  try {
    return statSync(resolve(process.cwd(), file)).size < 2_000_000;
  } catch {
    return false;
  }
});

/**
 * Motifs de secrets. Chaque motif est assez spécifique pour ne pas produire de
 * faux positif sur du texte ordinaire ou de la documentation.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'clé secrète Supabase'],
  [/sb_publishable_[A-Za-z0-9_-]{10,}/, 'clé publiable Supabase en dur'],
  [/sbp_[a-f0-9]{40}/, 'jeton d\'accès Supabase'],
  [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\./, 'jeton JWT'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'jeton GitHub'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée'],
  [/postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/, 'chaîne de connexion avec mot de passe'],
];

/** Variables dont une valeur non vide dans un fichier suivi serait une fuite. */
const SENSITIVE_ENV_KEYS = [
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DEV_SECRET_KEY',
  'SUPABASE_PROD_SECRET_KEY',
  'SMTP_PASSWORD',
  'GITHUB_TOKEN',
  'VERCEL_TOKEN',
];

test('aucun fichier .env réel n\'est suivi par Git', () => {
  const envFiles = trackedFiles.filter((file) => /(^|\/)\.env/.test(file));
  assert.deepEqual(envFiles, ['.env.example']);
});

test('.gitignore exclut bien les fichiers d\'environnement', () => {
  const ignored = git('check-ignore', '-v', '--no-index', '.env.local', '.env', '.env.production');
  assert.match(ignored, /\.env\.local/);
  assert.match(ignored, /\.env\.production/);
});

test('aucun secret reconnaissable dans les fichiers suivis', () => {
  const findings: string[] = [];

  for (const file of textFiles) {
    // Ce fichier contient les motifs eux-mêmes : les chercher ici n'aurait
    // aucun sens.
    if (file.endsWith('tests/unit/secrets.test.ts')) continue;

    const content = readFileSync(resolve(process.cwd(), file), 'utf8');

    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(content)) findings.push(`${file} : ${label}`);
    }
  }

  assert.deepEqual(findings, []);
});

test('aucune variable sensible ne porte de valeur dans un fichier suivi', () => {
  const findings: string[] = [];

  for (const file of textFiles) {
    if (file.endsWith('tests/unit/secrets.test.ts')) continue;

    const content = readFileSync(resolve(process.cwd(), file), 'utf8');

    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      if (!SENSITIVE_ENV_KEYS.includes(key!)) continue;

      const value = rawValue!.trim().replace(/^["']|["']$/g, '');
      if (value.length > 0) findings.push(`${file} : ${key} porte une valeur`);
    }
  }

  assert.deepEqual(findings, []);
});

test('aucun mot de passe de provisionnement n\'est présent dans le dépôt', () => {
  const findings: string[] = [];

  for (const file of textFiles) {
    const content = readFileSync(resolve(process.cwd(), file), 'utf8');

    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(ADMIN_SEED_[A-Z0-9_]*PASSWORD)\s*=\s*(.+)$/);
      if (!match) continue;

      const value = match[2]!.trim().replace(/^["']|["']$/g, '');
      // Un espace réservé documentaire est acceptable ; une valeur ne l'est pas.
      if (value.length > 0 && !/^[…<.]/.test(value)) {
        findings.push(`${file} : ${match[1]} porte une valeur`);
      }
    }
  }

  assert.deepEqual(findings, []);
});

test('la clé secrète n\'est lue que côté serveur', () => {
  // On cherche une LECTURE effective de la variable, pas une mention de son nom
  // dans un commentaire : une documentation qui nomme la clé ne l'expose pas.
  const READ = /process\s*\.\s*env\s*(?:\.\s*SUPABASE_SECRET_KEY|\[\s*['"]SUPABASE_SECRET_KEY['"]\s*\])/;

  const offenders: string[] = [];

  for (const file of trackedFiles.filter((f) => /^src\/.*\.tsx?$/.test(f))) {
    const content = readFileSync(resolve(process.cwd(), file), 'utf8');
    if (!READ.test(content)) continue;

    const isServerOnly = content.includes("import 'server-only'");
    const isClientComponent = /^\s*['"]use client['"]/m.test(content);

    if (!isServerOnly || isClientComponent) offenders.push(file);
  }

  assert.deepEqual(offenders, []);
});

test('aucun composant client n\'importe la couche à privilèges', () => {
  const offenders: string[] = [];

  for (const file of trackedFiles.filter((f) => /^src\/.*\.tsx?$/.test(f))) {
    const content = readFileSync(resolve(process.cwd(), file), 'utf8');
    const isClientComponent = /^\s*['"]use client['"]/m.test(content);
    if (!isClientComponent) continue;

    if (/from\s+['"][^'"]*supabase\/admin['"]/.test(content)) offenders.push(file);
    if (/from\s+['"][^'"]*lib\/rbac['"]/.test(content)) offenders.push(file);
  }

  assert.deepEqual(offenders, []);
});

test('aucune variable secrète n\'est préfixée NEXT_PUBLIC_', () => {
  const offenders: string[] = [];

  for (const file of textFiles) {
    const content = readFileSync(resolve(process.cwd(), file), 'utf8');
    if (/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PASSWORD|TOKEN|PRIVATE)/.test(content)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});
