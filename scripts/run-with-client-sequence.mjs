/**
 * Lance un contrôle en protégeant la suite des références client (phase 4I).
 *
 *   node scripts/run-with-client-sequence.mjs [--tsx] <script.mjs> --env shared [arguments…]
 *
 * 1. relève la suite `MORA-CLI` ;
 * 2. lance le contrôle tel quel, dans un processus fils (aucun contrôle
 *    existant n'a été modifié pour cela) ;
 * 3. une fois ses comptes de contrôle démontés, restitue la suite et prouve
 *    qu'elle est revenue à l'identique.
 *
 * Le relevé est aussi écrit sur disque : si ce lanceur est interrompu, la
 * commande `--restaurer` le relit et restitue la suite.
 *
 * Code de sortie : celui du contrôle, ou 1 si la suite n'a pas pu être
 * restituée à l'identique.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { readClientSequence, restoreClientSequence } from './lib/client-sequence.mjs';
import { PROJECT_ROOT, log, resolveAccessToken, resolveTarget, runSql } from './lib/config.mjs';

const SNAPSHOT_FILE = resolve(tmpdir(), 'mora-shawiri-client-sequence.json');

async function withRetry(task) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((done) => setTimeout(done, 1500 * attempt));
    }
  }
}

async function restore(target, accessToken, snapshot) {
  const result = await withRetry(() => restoreClientSequence(runSql, target, accessToken, snapshot));
  const show = (value) => (value ? `${value.series}/${value.last_number}/${value.allocated_count}` : 'aucune');
  if (result.identical) {
    log.ok(`Suite MORA-CLI restituée à l'identique (${show(result.before)}) — aucun numéro réel consommé.`);
  } else if (result.restored) {
    log.warn(`Suite MORA-CLI : ${result.note}. Avant ${show(result.before)}, après ${show(result.after)}.`);
  } else {
    log.fail(`Suite MORA-CLI non restituée : avant ${show(result.before)}, après ${show(result.after)}.`);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const target = resolveTarget();
  const accessToken = resolveAccessToken();

  if (args.includes('--restaurer')) {
    if (!existsSync(SNAPSHOT_FILE)) {
      log.fail('Aucun relevé en attente : rien à restituer.');
      process.exitCode = 1;
      return;
    }
    const { snapshot } = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));
    const result = await restore(target, accessToken, snapshot);
    if (result.restored) rmSync(SNAPSHOT_FILE, { force: true });
    process.exitCode = result.identical ? 0 : 1;
    return;
  }

  const tsx = args[0] === '--tsx';
  const rest = tsx ? args.slice(1) : args;
  const [script, ...scriptArgs] = rest;
  if (!script) throw new Error('Usage : run-with-client-sequence.mjs [--tsx] <script.mjs> --env <cible> [arguments…]');

  if (existsSync(SNAPSHOT_FILE)) {
    throw new Error(
      `Un relevé de la suite MORA-CLI attend d'être restitué (${SNAPSHOT_FILE}) : ` +
        'un contrôle précédent a été interrompu. Lancez d\'abord `--restaurer`.',
    );
  }

  const snapshot = await withRetry(() => readClientSequence(runSql, target, accessToken));
  writeFileSync(SNAPSHOT_FILE, JSON.stringify({ snapshot, script, at: new Date().toISOString() }));

  const nodeArgs = [...(tsx ? ['--import', 'tsx'] : []), script, ...scriptArgs];
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, nodeArgs, { cwd: PROJECT_ROOT, stdio: 'inherit' });
    child.on('exit', (value, signal) => done(value ?? (signal ? 1 : 0)));
  });

  const result = await restore(target, accessToken, snapshot);
  if (result.restored) rmSync(SNAPSHOT_FILE, { force: true });

  process.exitCode = code !== 0 ? code : result.identical ? 0 : 1;
}

main().catch((error) => {
  log.fail(error.message);
  process.exitCode = 1;
});
