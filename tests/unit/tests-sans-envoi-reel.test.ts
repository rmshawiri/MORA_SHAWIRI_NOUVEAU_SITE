/**
 * Règle absolue (audit du 2 octobre 2026) : un contrôle automatisé n'envoie
 * jamais de vrai e-mail à une boîte réelle.
 *
 * L'incident : `verify-routes.mjs` soumettait l'identifiant réel d'un
 * administrateur au formulaire « mot de passe oublié ». Chaque exécution —
 * contre la production comme contre un serveur local, les deux parlant au même
 * Supabase Auth et au même SMTP — envoyait un vrai e-mail de réinitialisation.
 *
 * Ce test garde le banc de contrôle :
 *
 *   * aucun script ne soumet un identifiant écrit en dur (seulement des
 *     comptes jetables, créés puis supprimés par le contrôle lui-même) ;
 *   * aucune adresse d'un script n'appartient à un domaine réel, hormis
 *     l'identité publique de l'émetteur recopiée dans les pièces officielles ;
 *   * aucun script ni test ne mentionne une boîte Gmail.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const SCRIPTS = readdirSync(resolve(ROOT, 'scripts'))
  .filter((name) => /\.(mjs|ts)$/.test(name))
  .map((name) => ({ name: `scripts/${name}`, text: readFileSync(join(ROOT, 'scripts', name), 'utf8') }));
const UNIT = readdirSync(resolve(ROOT, 'tests/unit'))
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name: `tests/unit/${name}`, text: readFileSync(join(ROOT, 'tests/unit', name), 'utf8') }));

/** Domaines réservés ou fictifs : rien n'y est jamais remis. */
const SAFE_DOMAINS = /@(mora-shawiri\.test|test\.local|exemple\.km|cooperative-exemple\.km|exemple\.org|example\.com|identifiant\.invalid)$/;
/** L'identité publique de l'émetteur, recopiée dans les instantanés des pièces : jamais un destinataire. */
const ISSUER_IDENTITY = /email: 'contact@morashawiri\.com',/;

test('aucun contrôle ne soumet un identifiant écrit en dur aux formulaires d’authentification', () => {
  for (const { name, text } of SCRIPTS) {
    const literal = text.match(/identifiant:\s*'[^']+'/g) ?? [];
    assert.deepEqual(literal, [], `${name} soumet un identifiant en dur : ${literal.join(', ')}`);
  }
});

test('aucune adresse d’un script n’appartient à un domaine réel', () => {
  for (const { name, text } of SCRIPTS) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      for (const address of line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
        if (SAFE_DOMAINS.test(address)) continue;
        assert.ok(ISSUER_IDENTITY.test(line), `${name}:${index + 1} — adresse réelle « ${address} »`);
      }
    });
  }
});

test('aucun script ni test ne mentionne une boîte Gmail', () => {
  for (const { name, text } of [...SCRIPTS, ...UNIT]) {
    assert.doesNotMatch(text, /@gmail\.com/i, name);
  }
});

test('le contrôle des routes utilise un compte jetable pour « mot de passe oublié »', () => {
  const routes = SCRIPTS.find((file) => file.name === 'scripts/verify-routes.mjs')!.text;
  assert.match(routes, /test\.route\.reset\.\$\{randomUUID\(\)\.slice\(0, 8\)\}\$\{TEST_EMAIL_DOMAIN\}/);
  assert.match(routes, /deleteUser\(disposableId\)/);
});

test('la réinitialisation est plafonnée par heure et par jour, sans rien révéler', () => {
  const rules = readFileSync(resolve(ROOT, 'src/lib/auth/rate-limit.ts'), 'utf8');
  assert.match(rules, /passwordResetByIdentifierDaily: \{\s*bucket: 'auth\.reinitialisation\.identifiant\.jour',\s*limit: 5,\s*windowSeconds: 86400,/);
  assert.ok(!rules.includes('\u0000'), 'aucun octet nul dans le source');
  const action = readFileSync(resolve(ROOT, 'src/lib/auth/actions.ts'), 'utf8');
  const start = action.indexOf('export async function requestPasswordResetAction');
  const reset = action.slice(start, action.indexOf('export async function', start + 10));
  assert.match(reset, /byIdentifier\.allowed && dailyAllowed/);
  // Quelle que soit l'issue, la même réponse.
  assert.equal((reset.match(/return authOk\(/g) ?? []).length, 1);
  assert.match(reset, /return authOk\(AUTH_MESSAGES\.resetRequested\);/);
});
