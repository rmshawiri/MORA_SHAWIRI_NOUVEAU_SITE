/**
 * Le catalogue TypeScript et le seed SQL décrivent les mêmes permissions.
 *
 * Deux listes qui se ressemblent finissent toujours par diverger. Ce test rend
 * la divergence impossible à ignorer : il relit le fichier de migration et
 * compare, code par code.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_ROLES,
  CRITICAL_PERMISSIONS,
  FULL_ACCESS,
  PERMISSIONS,
  ROLES,
  grants,
  isCriticalPermission,
  isPermission,
} from '../../src/lib/rbac/catalogue';

const SEED_PATH = resolve(
  process.cwd(),
  'supabase',
  'migrations',
  '20260917120200_seed_roles_et_permissions.sql',
);

const seedSql = readFileSync(SEED_PATH, 'utf8');

/** Extrait les lignes `('code', 'domaine', 'action', 'libellé', bool)`. */
function readSeededPermissions(): { code: string; critical: boolean }[] {
  const block = seedSql.slice(
    seedSql.indexOf('insert into public.permissions'),
    seedSql.indexOf('on conflict (code) do update'),
  );

  const pattern = /\(\s*'([a-z_]+\.[a-z_]+)'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'(?:[^']|'')*'\s*,\s*(true|false)\s*\)/g;

  return [...block.matchAll(pattern)].map((match) => ({
    code: match[1]!,
    critical: match[2] === 'true',
  }));
}

function readSeededRoles(): string[] {
  const start = seedSql.indexOf('insert into public.roles');
  const block = seedSql.slice(start, seedSql.indexOf('on conflict (code) do update', start));

  return [...block.matchAll(/\(\s*'([A-Z_]+)'\s*,/g)].map((match) => match[1]!);
}

test('le catalogue TypeScript couvre exactement les permissions du seed SQL', () => {
  const seeded = readSeededPermissions().map((entry) => entry.code);

  assert.ok(seeded.length > 0, 'aucune permission extraite du fichier SQL');
  assert.deepEqual([...PERMISSIONS].sort(), [...seeded].sort());
});

test('les permissions critiques sont identiques des deux côtés', () => {
  const seededCritical = readSeededPermissions()
    .filter((entry) => entry.critical)
    .map((entry) => entry.code);

  assert.deepEqual([...CRITICAL_PERMISSIONS].sort(), [...seededCritical].sort());
});

test('les rôles TypeScript couvrent exactement les rôles du seed SQL', () => {
  assert.deepEqual([...ROLES].sort(), [...readSeededRoles()].sort());
});

test('aucun code de permission n\'est dupliqué', () => {
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
});

test('tous les codes respectent la nomenclature domaine.action', () => {
  for (const code of PERMISSIONS) {
    assert.match(code, /^[a-z][a-z_]*\.[a-z][a-z_]*$/, `code invalide : ${code}`);
  }
});

test('le seed n\'accorde au rôle ADMIN aucune permission critique de gestion', () => {
  const block = seedSql.slice(seedSql.indexOf("where r.code = 'ADMIN'") - 3000);
  const forbidden = [
    'admins.create',
    'admins.update',
    'admins.disable',
    'admins.delete',
    'admins.permissions',
    'payments.verify',
    'payments.refund',
    'orders.refund',
    'commissions.manage',
    'commissions.validate',
    'payouts.manage',
    'settings.update',
    'audit.view',
    'users.delete',
    'admin.full_access',
  ];

  const granted = seedSql.slice(
    seedSql.indexOf("join public.permissions p on p.code in ("),
    seedSql.indexOf("where r.code = 'ADMIN'"),
  );

  for (const code of forbidden) {
    assert.ok(
      !granted.includes(`'${code}'`),
      `le rôle ADMIN ne doit pas recevoir ${code}`,
    );
  }

  assert.ok(block.length > 0);
});

test('refus par défaut : une permission non détenue n\'est jamais accordée', () => {
  assert.equal(grants([], 'orders.view'), false);
  assert.equal(grants(['orders.update'], 'orders.view'), false);
  assert.equal(grants(['orders.view'], 'orders.view'), true);
});

test('admin.full_access couvre l\'ensemble des permissions', () => {
  for (const permission of PERMISSIONS) {
    assert.equal(grants([FULL_ACCESS], permission), true);
  }
});

test('les rôles d\'administration sont un sous-ensemble des rôles connus', () => {
  for (const role of ADMIN_ROLES) {
    assert.ok((ROLES as readonly string[]).includes(role));
  }
  assert.ok(!(ADMIN_ROLES as readonly string[]).includes('CLIENT'));
  assert.ok(!(ADMIN_ROLES as readonly string[]).includes('AFFILIE'));
});

test('les gardes de type reconnaissent les codes valides et rejettent les autres', () => {
  assert.equal(isPermission('orders.view'), true);
  assert.equal(isPermission('orders.viwe'), false);
  assert.equal(isCriticalPermission('settings.update'), true);
  assert.equal(isCriticalPermission('settings.view'), false);
});
