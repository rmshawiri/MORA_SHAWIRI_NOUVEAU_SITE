/**
 * Vérification des politiques de sécurité contre une base réelle.
 *
 *   node scripts/verify-security.mjs --env dev
 *   node scripts/verify-security.mjs --env dev --admin rachade
 *   node scripts/verify-security.mjs --env prod --i-know-this-is-production
 *
 * Ce script ne teste pas le code : il interroge la base comme le ferait un
 * attaquant, avec la clé publiable puis avec une session réelle, et vérifie que
 * les réponses correspondent à ce que les politiques RLS promettent.
 *
 * Trois familles de contrôles (`11_TESTS_ET_QUALITE/01_TESTS_SECURITE.md`,
 * `03_SECURITE.md` § 183) :
 *
 *   1. accès anonyme — aucune table privée ne doit livrer la moindre ligne ;
 *   2. accès horizontal — un compte ne voit pas les données d'un autre ;
 *   3. accès vertical — un compte ne s'accorde pas de droits supplémentaires.
 *
 * Sur `--env prod`, seuls les contrôles anonymes en lecture sont exécutés :
 * aucun compte de test n'y est jamais créé (`00_SUPABASE.md` § 114-115).
 *
 * Sur `--env shared`, les contrôles authentifiés s'exécutent, faute de base
 * jetable. Le compte temporaire porte un domaine réservé `@mora-shawiri.test`,
 * il est supprimé dans un bloc `finally`, et un balayage final vérifie qu'aucun
 * compte de test ne subsiste. La limite est réelle et documentée : elle
 * disparaîtra le jour où un second projet Supabase existera.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, log, readFlag, resolveTarget } from './lib/config.mjs';

const results = { passed: 0, failed: 0 };

function check(label, condition, detail = '') {
  if (condition) {
    results.passed += 1;
    log.ok(label);
  } else {
    results.failed += 1;
    log.fail(`${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Une lecture est bloquée si elle échoue, ou si elle ne renvoie aucune ligne. */
function isBlocked(result) {
  return Boolean(result.error) || (result.data ?? []).length === 0;
}

const PRIVATE_TABLES = [
  'profiles',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'audit_logs',
  'rate_limit_counters',
  'schema_migrations',
];

async function anonymousChecks(target) {
  log.step('1. Accès anonyme');

  const anon = createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const table of PRIVATE_TABLES) {
    const result = await anon.from(table).select('*').limit(1);
    check(`anon ne lit rien dans « ${table} »`, isBlocked(result));
  }

  const publicSettings = await anon.from('settings').select('key, scope');
  const rows = publicSettings.data ?? [];
  check(
    'anon lit les paramètres publics',
    !publicSettings.error && rows.length > 0,
    publicSettings.error?.message,
  );
  check(
    'anon ne lit aucun paramètre privé',
    rows.every((row) => row.scope === 'PUBLIC'),
  );

  const write = await anon
    .from('settings')
    .update({ value: '"Europe/Paris"' })
    .eq('key', 'site.timezone')
    .select();
  check("anon ne modifie aucun paramètre", Boolean(write.error) || (write.data ?? []).length === 0);

  const permission = await anon.rpc('has_permission', { p_permission: 'admin.full_access' });
  check('anon ne détient aucune permission', permission.data !== true);

  const audit = await anon.rpc('record_audit_event', { p_action: 'tentative.anonyme' });
  check("anon n'écrit pas dans le journal d'audit", Boolean(audit.error));
}

async function authenticatedChecks(target, adminUsername) {
  const service = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------------------------------------------------------------------------
  log.step('2. Accès horizontal et vertical — compte client temporaire');

  const suffix = randomUUID().slice(0, 8);
  const testEmail = `test.rls.${suffix}${TEST_EMAIL_DOMAIN}`;
  const testPassword = `Tst-${randomUUID()}`;
  let testUserId = null;

  try {
    const created = await service.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { username: `test_rls_${suffix}`, full_name: 'Compte de test RLS' },
    });

    if (created.error) throw new Error(created.error.message);
    testUserId = created.data.user.id;

    const clientRole = await service.from('roles').select('id').eq('code', 'CLIENT').single();
    if (clientRole.error) throw new Error(clientRole.error.message);

    await service.from('user_roles').insert({ user_id: testUserId, role_id: clientRole.data.id });

    const session = createClient(target.url, target.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const signIn = await session.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });
    check('un compte client se connecte', !signIn.error, signIn.error?.message);

    const ownProfile = await session.from('profiles').select('*').eq('id', testUserId);
    check('il lit son propre profil', !ownProfile.error && (ownProfile.data ?? []).length === 1);

    const allProfiles = await session.from('profiles').select('id');
    check(
      "il ne voit que son profil, jamais celui d'un autre",
      (allProfiles.data ?? []).length <= 1,
      `${(allProfiles.data ?? []).length} profil(s) visible(s)`,
    );

    for (const table of ['permissions', 'role_permissions', 'audit_logs']) {
      const result = await session.from(table).select('*').limit(1);
      check(`il ne lit rien dans « ${table} »`, isBlocked(result));
    }

    const visibleRoles = await session.from('roles').select('code');
    check(
      'il ne voit que le rôle qu\'il porte, pas le catalogue',
      (visibleRoles.data ?? []).length === 1 && visibleRoles.data[0]?.code === 'CLIENT',
      `${(visibleRoles.data ?? []).length} rôle(s) visible(s)`,
    );

    const superAdminRole = await service
      .from('roles')
      .select('id')
      .eq('code', 'SUPER_ADMIN')
      .single();

    const elevation = await session
      .from('user_roles')
      .insert({ user_id: testUserId, role_id: superAdminRole.data.id })
      .select();
    check(
      'il ne peut pas s\'attribuer le rôle SUPER_ADMIN',
      Boolean(elevation.error) || (elevation.data ?? []).length === 0,
    );

    const statusChange = await session
      .from('profiles')
      .update({ status: 'SUSPENDU' })
      .eq('id', testUserId)
      .select();
    check(
      'il ne peut pas modifier le statut de son compte',
      Boolean(statusChange.error) || (statusChange.data ?? []).length === 0,
    );

    const nameChange = await session
      .from('profiles')
      .update({ full_name: 'Nom corrigé' })
      .eq('id', testUserId)
      .select();
    check('il peut corriger son nom', !nameChange.error && (nameChange.data ?? []).length === 1);

    const auditAttempt = await session
      .from('audit_logs')
      .insert({ action: 'faux.evenement' })
      .select();
    check(
      "il n'écrit pas directement dans le journal d'audit",
      Boolean(auditAttempt.error) || (auditAttempt.data ?? []).length === 0,
    );

    await session.auth.signOut();
  } finally {
    if (testUserId) {
      await service.from('user_roles').delete().eq('user_id', testUserId);
      await service.auth.admin.deleteUser(testUserId);
      log.skip('compte de test supprimé');
    }
  }

  // ---------------------------------------------------------------------------
  if (!adminUsername) {
    log.step('3. Compte administrateur — ignoré (--admin non fourni)');
    return;
  }

  log.step(`3. Compte administrateur « ${adminUsername} »`);

  const key = adminUsername.toUpperCase().replace(/[.-]/g, '_');
  const adminPassword = process.env[`ADMIN_SEED_${key}_PASSWORD`];
  const domain = process.env.ADMIN_SEED_EMAIL_DOMAIN?.trim() || 'morashawiri.com';
  const adminEmail = (
    process.env[`ADMIN_SEED_${key}_EMAIL`]?.trim() || `${adminUsername}@${domain}`
  ).toLowerCase();

  if (!adminPassword) {
    log.skip(`ADMIN_SEED_${key}_PASSWORD absente — contrôles administrateur ignorés`);
    return;
  }

  const adminSession = createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signIn = await adminSession.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  check(`« ${adminUsername} » se connecte`, !signIn.error, signIn.error?.message);
  if (signIn.error) return;

  const fullAccess = await adminSession.rpc('has_permission', {
    p_permission: 'admin.full_access',
  });
  check('il détient admin.full_access', fullAccess.data === true);

  const isAdminResult = await adminSession.rpc('is_admin');
  check("il est reconnu comme administrateur", isAdminResult.data === true);

  const permissions = await adminSession.rpc('current_permissions');
  check(
    'ses permissions effectives sont lisibles',
    Array.isArray(permissions.data) && permissions.data.includes('admin.full_access'),
  );

  const auditRead = await adminSession.from('audit_logs').select('id').limit(1);
  check("il accède au journal d'audit", !auditRead.error, auditRead.error?.message);

  const privateSettings = await adminSession.from('settings').select('key, scope');
  check(
    'il accède aux paramètres privés',
    (privateSettings.data ?? []).some((row) => row.scope === 'PRIVE'),
  );

  const profile = await adminSession
    .from('profiles')
    .select('must_change_password')
    .eq('id', signIn.data.user.id)
    .single();
  check(
    'son compte exige un changement de mot de passe initial',
    profile.data?.must_change_password === true,
  );

  // Protection du dernier détenteur de `admin.full_access` : le compte ne doit
  // pas pouvoir se retirer lui-même la capacité d'administrer la plateforme.
  const superAdminRole = await adminSession
    .from('roles')
    .select('id')
    .eq('code', 'SUPER_ADMIN')
    .single();

  if (superAdminRole.data) {
    const removal = await adminSession
      .from('user_roles')
      .delete()
      .eq('user_id', signIn.data.user.id)
      .eq('role_id', superAdminRole.data.id)
      .select();

    const stillThere = await adminSession.rpc('has_permission', {
      p_permission: 'admin.full_access',
    });

    check(
      'le dernier détenteur de admin.full_access est protégé',
      (Boolean(removal.error) || (removal.data ?? []).length === 0) && stillThere.data === true,
    );
  }

  await adminSession.auth.signOut();
}

const TEST_EMAIL_DOMAIN = '@mora-shawiri.test';

/**
 * Balayage final : aucun compte de test ne doit subsister, quel que soit le
 * chemin emprunté par le script.
 */
async function assertNoLeftoverTestAccounts(target) {
  log.step('4. Absence de résidu');

  const service = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) {
    check('les comptes sont lisibles pour le balayage', false, error.message);
    return;
  }

  const leftovers = data.users.filter((user) => user.email?.endsWith(TEST_EMAIL_DOMAIN));

  for (const user of leftovers) {
    await service.auth.admin.deleteUser(user.id);
    log.warn('compte de test résiduel supprimé');
  }

  check('aucun compte de test ne subsiste', leftovers.length === 0, `${leftovers.length} trouvé(s)`);
}

async function main() {
  const target = resolveTarget();

  log.step(`Vérifications de sécurité — ${describeTarget(target)}`);

  if (target.isLiveData) {
    log.warn(
      'Base portant les données réelles : le compte de test créé est temporaire, ' +
        'isolé par un domaine réservé, et supprimé en fin d\'exécution.',
    );
  }

  await anonymousChecks(target);

  if (target.isProduction) {
    log.step('Contrôles authentifiés ignorés : aucun compte de test n\'est créé en production.');
  } else {
    await authenticatedChecks(target, readFlag('admin'));
    await assertNoLeftoverTestAccounts(target);
  }

  log.step(`Résultat : ${results.passed} contrôle(s) réussi(s), ${results.failed} échec(s).`);

  if (results.failed > 0) process.exit(1);
}

main().catch((error) => {
  log.fail(error.message);
  process.exit(1);
});
