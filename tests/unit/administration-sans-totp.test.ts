/**
 * Administration sans code TOTP — décision du propriétaire du 1er octobre 2026.
 *
 * Ce qui doit être vrai, et que ce fichier vérifie à froid :
 *
 *   1. la migration ne change QUE le niveau d'assurance exigé : les fonctions
 *      recopiées sont identiques à leur dernière définition, à une condition
 *      près, et chaque politique garde sa permission ;
 *   2. le réglage D-12 vaut `false` partout où il est écrit (migration et
 *      script de configuration), et l'absence du réglage reste prudente ;
 *   3. une session par mot de passe entre dans l'administration ;
 *   4. les actions sensibles passent par une fenêtre de confirmation, qui ne
 *      se présente jamais comme une authentification.
 *
 * Les preuves avec de vraies sessions sont dans `scripts/verify-*.mjs`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { adminAccessObstacle } from '../../src/lib/auth/access';

const ROOT = process.cwd();
// Les fins de ligne dépendent de la copie de travail (CRLF sous Windows) : on
// compare des textes, pas des octets de fin de ligne.
const read = (...parts: string[]) =>
  readFileSync(resolve(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = read('supabase', 'migrations', '20261001130000_administration_sans_code_totp.sql');
const RELATION = read('supabase', 'migrations', '20260930150000_relation_client.sql');
const CODE = MIGRATION.replace(/--[^\n]*/g, '');

function block(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start !== -1, `${name} absente`);
  const end = sql.indexOf('\n$$;\n', start);
  return sql.slice(start, end + 5);
}

test('issue_document et confirm_appointment sont recopiées, une seule condition change', () => {
  for (const name of ['issue_document', 'confirm_appointment']) {
    const before = block(RELATION, name);
    const after = block(MIGRATION, name);
    assert.equal((before.match(/public\.session_is_aal2\(\)/g) ?? []).length, 1);
    assert.equal(
      after,
      before.replace('public.session_is_aal2()', 'public.session_assurance_satisfied()'),
      `${name} : le corps recopié diffère de sa dernière définition`,
    );
  }
});

test('la gouvernance garde sa permission, seul le niveau d’assurance change', () => {
  const policies = [...CODE.matchAll(/create policy ([a-z_]+)[\s\S]*?;/g)];
  assert.equal(policies.length, 5);
  for (const [policy, name] of policies) {
    assert.ok(!/session_is_aal2/.test(policy), `${name} exige encore l’AAL2`);
    const permission = name!.startsWith('user_permissions') ? 'admins.permissions' : 'admins.create';
    const clauses = policy.match(/\((public\.has_permission[^;]*)/g) ?? [];
    assert.ok(clauses.length > 0);
    for (const clause of clauses) {
      assert.ok(clause.includes(`public.has_permission('${permission}')`), `${name} perd sa permission`);
      assert.ok(clause.includes('public.session_assurance_satisfied()'));
    }
  }
});

test('aucune exigence AAL2 ne subsiste hors de la fonction qui la définit', () => {
  const uses = [...CODE.matchAll(/public\.session_is_aal2\(\)/g)].length;
  assert.equal(uses, 1, 'session_is_aal2() ne doit apparaître que dans session_assurance_satisfied()');
});

test('le réglage manquant vaut « code exigé » : le défaut reste prudent', () => {
  const fn = CODE.slice(CODE.indexOf('create or replace function public.session_assurance_satisfied'));
  assert.match(fn, /public\.session_is_aal2\(\)\s+or not coalesce\([\s\S]*?'auth\.admin_mfa_required'\),\s+true\s+\)/);
});

test('le réglage D-12 passe à false, et le script de configuration ne le rétablit pas', () => {
  assert.match(CODE, /update public\.settings\s+set value\s+= 'false'::jsonb,[\s\S]*?where key = 'auth\.admin_mfa_required';/);
  const script = read('scripts', 'configure-auth.mjs');
  const entry = script.slice(script.indexOf("key: 'auth.admin_mfa_required'"));
  assert.match(entry.slice(0, 400), /value: false/);
});

test('aucune permission n’est créée, retirée ni accordée par cette migration', () => {
  assert.ok(!/insert into public\.(permissions|role_permissions|user_permissions)/i.test(CODE));
  assert.ok(!/delete from public\./i.test(CODE));
  assert.ok(!/drop trigger/i.test(CODE), 'les garde-fous 4C restent en place');
});

test('une session par mot de passe ouvre l’administration quand le code n’est pas exigé', () => {
  const base = { isAdmin: true, mustChangePassword: false, adminMfaRequired: false };
  assert.equal(adminAccessObstacle({ ...base, assuranceLevel: 'aal1', totpFactorCount: 1 }), null);
  assert.equal(adminAccessObstacle({ ...base, assuranceLevel: 'aal1', totpFactorCount: 0 }), null);
  // Le rôle reste exigé, et le mot de passe d'amorçage doit toujours être changé.
  assert.equal(adminAccessObstacle({ ...base, isAdmin: false, assuranceLevel: 'aal1', totpFactorCount: 0 }), 'role-insuffisant');
  assert.equal(
    adminAccessObstacle({ ...base, mustChangePassword: true, assuranceLevel: 'aal1', totpFactorCount: 0 }),
    'mot-de-passe-a-changer',
  );
});

test('les actions sensibles passent par la fenêtre de confirmation', () => {
  assert.match(read('src', 'components', 'admin', 'ConfirmForm.tsx'), /<ConfirmDialog/);
  const grid = read('src', 'components', 'admin', 'PermissionGrid.tsx');
  assert.match(grid, /title="Confirmer la modification des permissions"/);
  assert.ok(!/type="submit"/.test(grid), 'la grille ne s’envoie plus sans confirmation');
  const invite = read('src', 'components', 'admin', 'InviteForm.tsx');
  assert.match(invite, /title="Confirmer l’invitation de cet administrateur \?"/);
  assert.ok(!/type="submit"/.test(invite));
  assert.match(
    read('src', 'app', '(pilotage)', 'administration', 'commandes', '[reference]', 'page.tsx'),
    /title="Confirmer l’émission de cette facture \?"/,
  );
});

test('la fenêtre ne se présente jamais comme une authentification', () => {
  const dialog = read('src', 'components', 'admin', 'ConfirmDialog.tsx');
  const visible = dialog.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/code|TOTP|mot de passe|authentifi/i.test(visible), 'aucun champ ni mot d’authentification');
  assert.ok(!/<input/.test(visible), 'aucune saisie');
  assert.match(visible, /Annuler/);
  assert.match(visible, /autoFocus/, 'le focus initial est sur Annuler');
  assert.match(visible, /disabled=\{pending\}/, 'double envoi impossible');
  assert.match(dialog, /n'est \*\*pas\*\* une seconde authentification/);
});
