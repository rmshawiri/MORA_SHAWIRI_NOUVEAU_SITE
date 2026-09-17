/**
 * Politique de mot de passe.
 *
 * Le test vérifie deux choses de natures différentes :
 *
 *   1. le comportement de la politique elle-même ;
 *   2. son **accord avec le script de provisionnement**. La longueur minimale
 *      existe à deux endroits — `src/lib/auth/passwords.ts` pour l'application,
 *      `scripts/provision-admins.mjs` pour la création des administrateurs. Deux
 *      valeurs qui se ressemblent finissent toujours par diverger ; le test
 *      relit le script et compare, comme le fait déjà
 *      `rbac-catalogue.test.ts` pour le catalogue des permissions.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessPassword,
  isPasswordAcceptable,
  passwordContext,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../src/lib/auth/passwords';

/* ------------------------------------------------------------- longueur --- */

test('un mot de passe trop court est refusé', () => {
  const reasons = assessPassword('Court1!');
  assert.ok(reasons.length > 0);
  assert.ok(reasons.some((reason) => reason.includes(String(PASSWORD_MIN_LENGTH))));
});

test('une phrase longue et variée est acceptée', () => {
  assert.equal(isPasswordAcceptable('Le port de Moroni, 1975 !'), true);
});

test('un mot de passe au-delà de la limite est refusé', () => {
  assert.equal(isPasswordAcceptable('A1'.repeat(PASSWORD_MAX_LENGTH)), false);
});

test('la longueur seule ne suffit pas : les minuscules seules sont refusées', () => {
  // C'est exactement le défaut relevé sur le mot de passe d'amorçage en 4A.
  const reasons = assessPassword('motdepassetreslongenminuscules');
  assert.ok(reasons.some((reason) => reason.toLowerCase().includes('majuscules')));
});

test('un caractère répété n’est pas un mot de passe', () => {
  assert.equal(isPasswordAcceptable('AAAAAAAAAAAAAAAA'), false);
});

/* --------------------------------------------------------- mots courants --- */

test('les mots de passe courants sont refusés quelle que soit la casse', () => {
  for (const value of ['motdepasse123', 'MotDePasse123', 'PASSWORD123', 'administrateur']) {
    assert.equal(isPasswordAcceptable(value), false, `accepté à tort : ${value}`);
  }
});

/* ------------------------------------------------------------- contexte --- */

test('un mot de passe contenant l’identifiant est refusé', () => {
  const reasons = assessPassword('Rachade-2026-Moroni', ['rachade']);
  assert.ok(reasons.some((reason) => reason.includes('identifiant')));
});

test('un mot de passe contenant la partie locale de l’adresse est refusé', () => {
  const context = passwordContext({ email: 'amina@morashawiri.com' });
  assert.ok(context.includes('amina'));
  assert.equal(isPasswordAcceptable('Amina-Comores-2026', context), false);
});

test('les fragments trop courts sont écartés, l’adresse complète est conservée', () => {
  // `ab` et la partie locale `x` sont trop courts : les interdire ferait
  // refuser des mots de passe parfaitement valides pour une coïncidence de deux
  // lettres. L'adresse entière, elle, reste interdite — la répéter dans son mot
  // de passe est un vrai défaut.
  const context = passwordContext({ username: 'ab', email: 'x@y.co' });

  assert.deepEqual(context, ['x@y.co']);
  assert.equal(isPasswordAcceptable('Voici-x@y.co-2026', context), false);
});

test('passwordContext ignore les valeurs absentes', () => {
  assert.deepEqual(passwordContext({}), []);
  assert.deepEqual(passwordContext({ username: null, email: null, fullName: null }), []);
});

/* ---------------------------------------------------------- non-fuite --- */

test('aucun motif de refus ne restitue le mot de passe examiné', () => {
  const secret = 'Zorglub-Secret-2026';
  const reasons = assessPassword(secret, ['zorglub']);

  for (const reason of reasons) {
    assert.ok(
      !reason.includes(secret),
      'un motif de refus ne doit jamais contenir la valeur examinée',
    );
  }
});

/* ------------------------------------ accord avec le script d’amorçage --- */

test('la longueur minimale est la même dans l’application et dans le script', () => {
  const scriptPath = resolve(process.cwd(), 'scripts', 'provision-admins.mjs');
  const source = readFileSync(scriptPath, 'utf8');

  const match = source.match(/password\.length\s*<\s*(\d+)/);
  assert.ok(match, 'le contrôle de longueur n’a pas été trouvé dans provision-admins.mjs');

  assert.equal(
    Number(match[1]),
    PASSWORD_MIN_LENGTH,
    'la longueur minimale du script et celle de l’application ont divergé',
  );
});
