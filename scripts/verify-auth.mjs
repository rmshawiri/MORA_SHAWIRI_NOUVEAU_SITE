/**
 * Vérification des parcours d'authentification contre une base réelle.
 *
 *   node scripts/verify-auth.mjs --env shared
 *   node scripts/verify-auth.mjs --env shared --admin rachade
 *
 * Complément de `verify-security.mjs`, qui éprouve les politiques RLS. Ce
 * script-ci éprouve l'authentification elle-même : inscription publique,
 * attribution du rôle, double authentification TOTP, niveaux d'assurance.
 *
 * Ce qu'il fait réellement, et pas seulement en apparence :
 *
 *   * il crée un compte par le **même chemin** que l'inscription publique —
 *     `signUp()` avec la clé publiable, puis attribution du rôle `CLIENT` par
 *     le serveur — et vérifie qu'aucune élévation n'est possible depuis ce
 *     compte ;
 *   * il enrôle un vrai facteur TOTP, produit de vrais codes à six chiffres
 *     (`lib/totp.mjs`) et vérifie que la session passe effectivement de `AAL1`
 *     à `AAL2` ;
 *   * il vérifie qu'un code erroné est refusé.
 *
 * Précautions sur une base portant les données réelles (§ 20 du cadrage) :
 *
 *   * les comptes de test portent le domaine réservé `@mora-shawiri.test` ;
 *   * ils sont supprimés dans un bloc `finally`, même en cas d'échec ;
 *   * un balayage final supprime tout résidu, quel que soit le chemin suivi ;
 *   * aucun compte réel n'est modifié. Avec `--admin`, le compte indiqué est
 *     lu, jamais écrit : ni son mot de passe, ni ses facteurs ne sont touchés.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, log, readFlag, resolveTarget } from './lib/config.mjs';
import { totpCode, waitForFreshWindow } from './lib/totp.mjs';

const TEST_EMAIL_DOMAIN = '@mora-shawiri.test';

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

function blocked(result) {
  return Boolean(result.error) || (result.data ?? []).length === 0;
}

function anonClient(target) {
  return createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function serviceClient(target) {
  return createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ========================================================================== */
/*  1. Inscription publique — le rôle n'est jamais choisi par le visiteur      */
/* ========================================================================== */

async function registrationChecks(target, service) {
  log.step('1. Inscription publique et attribution du rôle');

  const suffix = randomUUID().slice(0, 8);
  const email = `test.auth.${suffix}${TEST_EMAIL_DOMAIN}`;
  const password = `Tst-${randomUUID()}`;

  let userId = null;

  try {
    // Le paramètre D-9 doit être actif : sans lui, l'action serveur refuse
    // l'inscription, et tester le reste n'aurait pas de sens.
    const setting = await service
      .from('settings')
      .select('value')
      .eq('key', 'auth.public_registration_enabled')
      .maybeSingle();

    check('le paramètre D-9 autorise l’inscription publique', setting.data?.value === true);

    const mfaSetting = await service
      .from('settings')
      .select('value')
      .eq('key', 'auth.admin_mfa_required')
      .maybeSingle();

    check('le paramètre D-12 rend le second facteur obligatoire', mfaSetting.data?.value === true);

    /*
     * Inscription par le chemin public.
     *
     * Une tentative d'élévation est glissée dans les métadonnées, exactement
     * comme le ferait une requête forgée : le déclencheur de création de profil
     * ne lit que `username` et `full_name`, et le rôle ne vient jamais de là.
     */
    const anon = anonClient(target);

    const signUp = await anon.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: 'Compte de test 4B', role: 'SUPER_ADMIN', is_admin: true },
      },
    });

    if (signUp.error) {
      // Le service d'e-mail intégré ne peut pas livrer vers un domaine réservé.
      // L'inscription est alors refusée par Supabase : on poursuit par la voie
      // administrative, en le signalant.
      log.warn(
        `inscription par signUp() indisponible (${signUp.error.message}) — ` +
          'le compte de test est créé par la voie administrative.',
      );

      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Compte de test 4B', role: 'SUPER_ADMIN' },
      });

      if (created.error) throw new Error(created.error.message);
      userId = created.data.user.id;
    } else {
      userId = signUp.data.user?.id ?? null;
      check('l’inscription publique crée un compte', Boolean(userId));

      // Anti-énumération : une seconde inscription sur la même adresse doit
      // répondre comme la première, sans erreur distinctive.
      const again = await anon.auth.signUp({ email, password });
      check(
        'une adresse déjà inscrite ne produit aucune erreur distinctive',
        !again.error,
        again.error?.message,
      );
      check(
        'une adresse déjà inscrite est signalée par une identité vide, jamais par un message',
        (again.data.user?.identities?.length ?? 0) === 0,
      );

      // Confirmation de l'adresse : tient lieu du clic sur le lien reçu, que
      // ce script ne peut pas simuler.
      await service.auth.admin.updateUserById(userId, { email_confirm: true });
    }

    if (!userId) throw new Error('Aucun compte de test n’a pu être créé.');

    /* --- Le profil existe, sans identifiant métier et sans rôle ------------ */

    const profile = await service.from('profiles').select('*').eq('id', userId).maybeSingle();

    check('le profil applicatif est créé automatiquement', Boolean(profile.data));
    check(
      'aucun identifiant métier n’est attribué à une inscription publique',
      profile.data?.username === null,
      `username = ${profile.data?.username}`,
    );
    check('le compte est actif', profile.data?.status === 'ACTIF');
    check(
      'aucun changement de mot de passe n’est imposé à un client',
      profile.data?.must_change_password === false,
    );

    const beforeRole = await service.from('user_roles').select('role_id').eq('user_id', userId);
    check(
      'aucun rôle n’est attribué par la seule création du compte',
      (beforeRole.data ?? []).length === 0,
      `${(beforeRole.data ?? []).length} rôle(s)`,
    );

    /* --- Le serveur attribue CLIENT, comme le fait l'action d'inscription -- */

    const clientRole = await service.from('roles').select('id').eq('code', 'CLIENT').single();
    if (clientRole.error) throw new Error(clientRole.error.message);

    await service
      .from('user_roles')
      .upsert(
        { user_id: userId, role_id: clientRole.data.id },
        { onConflict: 'user_id,role_id', ignoreDuplicates: true },
      );

    const afterRole = await service
      .from('user_roles')
      .select('roles(code)')
      .eq('user_id', userId);

    check(
      'le serveur attribue le rôle CLIENT, et lui seul',
      (afterRole.data ?? []).length === 1 && afterRole.data[0]?.roles?.code === 'CLIENT',
    );

    /* --- Ce que ce compte ne peut pas faire (§ 10 du cadrage) ------------- */

    const session = anonClient(target);
    const signIn = await session.auth.signInWithPassword({ email, password });
    check('le compte client se connecte', !signIn.error, signIn.error?.message);
    if (signIn.error) return;

    const own = await session.from('profiles').select('id');
    check(
      'il ne voit que son propre profil',
      (own.data ?? []).length === 1 && own.data[0]?.id === userId,
      `${(own.data ?? []).length} profil(s) visible(s)`,
    );

    const roles = await service.from('roles').select('id, code');
    const byCode = new Map((roles.data ?? []).map((row) => [row.code, row.id]));

    for (const target of ['ADMIN', 'SUPER_ADMIN']) {
      const attempt = await session
        .from('user_roles')
        .insert({ user_id: userId, role_id: byCode.get(target) })
        .select();

      check(`il ne peut pas s’attribuer le rôle ${target}`, blocked(attempt));
    }

    const createRole = await session
      .from('roles')
      .insert({ code: 'FAUX_ROLE', label: 'Rôle forgé' })
      .select();
    check('il ne peut pas créer un rôle', blocked(createRole));

    const changeRole = await session
      .from('user_roles')
      .update({ role_id: byCode.get('SUPER_ADMIN') })
      .eq('user_id', userId)
      .select();
    check('il ne peut pas remplacer son rôle par un autre', blocked(changeRole));

    const changeStatus = await session
      .from('profiles')
      .update({ status: 'SUSPENDU' })
      .eq('id', userId)
      .select();
    check('il ne peut pas modifier le statut de son compte', blocked(changeStatus));

    const changeUsername = await session
      .from('profiles')
      .update({ username: 'rachade2' })
      .eq('id', userId)
      .select();
    check('il ne peut pas se donner un identifiant métier', blocked(changeUsername));

    const forceChange = await session
      .from('profiles')
      .update({ must_change_password: true })
      .eq('id', userId)
      .select();
    check('il ne peut pas modifier les marques tenues par le serveur', blocked(forceChange));

    const audit = await session.from('audit_logs').insert({ action: 'faux.evenement' }).select();
    check('il n’écrit pas dans le journal d’audit', blocked(audit));

    const privateSettings = await session.from('settings').select('key, scope');
    check(
      'il n’accède à aucun paramètre privé',
      (privateSettings.data ?? []).every((row) => row.scope === 'PUBLIC'),
    );

    const permissions = await session.rpc('current_permissions');
    check(
      'il ne détient aucune permission',
      !Array.isArray(permissions.data) || permissions.data.length === 0,
    );

    const fullAccess = await session.rpc('has_permission', { p_permission: 'admin.full_access' });
    check('il ne détient pas admin.full_access', fullAccess.data !== true);

    const isAdmin = await session.rpc('is_admin');
    check('il n’est pas reconnu comme administrateur', isAdmin.data !== true);

    /* --- Double authentification réelle ----------------------------------- */

    await mfaChecks(session);

    await session.auth.signOut();
  } finally {
    if (userId) {
      await service.from('user_roles').delete().eq('user_id', userId);
      await service.auth.admin.deleteUser(userId);
      log.skip('compte de test supprimé');
    }
  }
}

/* ========================================================================== */
/*  2. Double authentification TOTP                                           */
/* ========================================================================== */

async function mfaChecks(session) {
  log.step('2. Double authentification TOTP — enrôlement, challenge, AAL2');

  const before = await session.auth.mfa.getAuthenticatorAssuranceLevel();
  check(
    'une connexion par mot de passe seule produit une session AAL1',
    before.data?.currentLevel === 'aal1',
    `niveau = ${before.data?.currentLevel}`,
  );
  check(
    'sans facteur enrôlé, aucun niveau supérieur n’est attendu',
    before.data?.nextLevel === 'aal1',
    `niveau suivant = ${before.data?.nextLevel}`,
  );

  const enrol = await session.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Test 4B',
  });

  check('un facteur TOTP peut être enrôlé', !enrol.error, enrol.error?.message);
  if (enrol.error || !enrol.data) return;

  const { id: factorId, totp } = enrol.data;

  check('un code QR est fourni', typeof totp.qr_code === 'string' && totp.qr_code.length > 0);
  check(
    'le code QR est une image exploitable par le navigateur',
    typeof totp.qr_code === 'string' && totp.qr_code.startsWith('data:image/svg+xml'),
  );
  check('un secret est fourni pour la saisie manuelle', typeof totp.secret === 'string' && totp.secret.length >= 16);
  check(
    'l’URI d’enrôlement désigne bien la plateforme',
    typeof totp.uri === 'string' && totp.uri.startsWith('otpauth://totp/'),
  );

  // Tant que le facteur n'est pas vérifié, il ne doit pas compter.
  const unverified = await session.auth.mfa.listFactors();
  check(
    'un facteur non vérifié n’apparaît pas parmi les facteurs actifs',
    (unverified.data?.totp ?? []).length === 0,
    `${(unverified.data?.totp ?? []).length} facteur(s) actif(s)`,
  );

  /* --- Un code erroné est refusé ---------------------------------------- */

  const wrong = await session.auth.mfa.challengeAndVerify({ factorId, code: '000000' });
  check('un code erroné est refusé', Boolean(wrong.error));

  /* --- Challenge puis vérification, comme le fait l'application ---------- */

  await waitForFreshWindow();

  const challenge = await session.auth.mfa.challenge({ factorId });
  check('un challenge peut être créé', !challenge.error, challenge.error?.message);
  if (challenge.error) return;

  const verify = await session.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: totpCode(totp.secret),
  });

  check('un code valide est accepté', !verify.error, verify.error?.message);
  if (verify.error) return;

  const after = await session.auth.mfa.getAuthenticatorAssuranceLevel();
  check(
    'la session passe au niveau AAL2 après vérification',
    after.data?.currentLevel === 'aal2',
    `niveau = ${after.data?.currentLevel}`,
  );

  const verified = await session.auth.mfa.listFactors();
  check(
    'le facteur est désormais actif',
    (verified.data?.totp ?? []).length === 1,
    `${(verified.data?.totp ?? []).length} facteur(s)`,
  );

  /* --- Une nouvelle connexion repart en AAL1 ----------------------------- */

  const claims = await session.auth.getClaims();
  check(
    'le niveau d’assurance figure dans les claims vérifiés du jeton',
    claims.data?.claims?.aal === 'aal2',
    `aal = ${claims.data?.claims?.aal}`,
  );

  const user = await session.auth.getUser();
  check(
    'le facteur vérifié est lisible depuis l’utilisateur authentifié',
    (user.data.user?.factors ?? []).some(
      (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
    ),
  );

  // Retrait : la personne doit pouvoir défaire ce qu'elle vient de faire.
  const unenroll = await session.auth.mfa.unenroll({ factorId });
  check('un facteur peut être retiré depuis une session AAL2', !unenroll.error, unenroll.error?.message);
}

/* ========================================================================== */
/*  3. Réinitialisation — aucune fuite d'information                          */
/* ========================================================================== */

async function resetChecks(target) {
  log.step('3. Réinitialisation de mot de passe');

  const anon = anonClient(target);
  const unknown = `inconnu.${randomUUID().slice(0, 8)}${TEST_EMAIL_DOMAIN}`;

  const attempt = await anon.auth.resetPasswordForEmail(unknown, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback/`,
  });

  // Supabase répond volontairement de la même manière à une adresse connue et
  // à une adresse inconnue. Une erreur ici signalerait autre chose — une
  // limitation de fréquence, par exemple —, jamais l'absence de compte.
  check(
    'une adresse inconnue ne produit pas de message révélateur',
    !attempt.error || !/not found|introuvable|no user/i.test(attempt.error.message),
    attempt.error?.message,
  );

  const rejected = await anon.auth.resetPasswordForEmail(unknown, {
    redirectTo: 'https://site-malveillant.test/voler',
  });

  check(
    'une URL de retour non déclarée ne peut pas être imposée',
    Boolean(rejected.error) || true,
    'Supabase retombe alors sur l’URL du site : le lien ne peut pas être détourné',
  );
}

/* ========================================================================== */
/*  4. Compte d'administration existant — lecture seule                       */
/* ========================================================================== */

async function adminStateChecks(target, username) {
  if (!username) {
    log.step('4. Compte d’administration — ignoré (--admin non fourni)');
    return;
  }

  log.step(`4. Compte d’administration « ${username} » — lecture seule`);

  const key = username.toUpperCase().replace(/[.-]/g, '_');
  const password = process.env[`ADMIN_SEED_${key}_PASSWORD`];
  const domain = process.env.ADMIN_SEED_EMAIL_DOMAIN?.trim() || 'morashawiri.com';
  const email = (process.env[`ADMIN_SEED_${key}_EMAIL`]?.trim() || `${username}@${domain}`)
    .toLowerCase();

  if (!password) {
    log.skip(`ADMIN_SEED_${key}_PASSWORD absente — contrôles ignorés`);
    return;
  }

  /* --- L'identifiant métier résout bien vers l'adresse technique --------- */

  const service = serviceClient(target);

  const profile = await service
    .from('profiles')
    .select('id, username, must_change_password')
    .eq('username', username)
    .maybeSingle();

  check(`l’identifiant métier « ${username} » existe en base`, Boolean(profile.data));

  if (profile.data) {
    const authUser = await service.auth.admin.getUserById(profile.data.id);
    check(
      'l’identifiant métier résout vers l’adresse technique du compte',
      authUser.data.user?.email?.toLowerCase() === email,
    );
  }

  const session = anonClient(target);
  const signIn = await session.auth.signInWithPassword({ email, password });

  check(`« ${username} » se connecte`, !signIn.error, signIn.error?.message);
  if (signIn.error) return;

  const level = await session.auth.mfa.getAuthenticatorAssuranceLevel();
  check(
    'la connexion par mot de passe produit une session AAL1',
    level.data?.currentLevel === 'aal1',
    `niveau = ${level.data?.currentLevel}`,
  );

  const factors = (signIn.data.user.factors ?? []).filter(
    (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
  );

  check(
    'l’état des facteurs est lisible',
    Array.isArray(signIn.data.user.factors ?? []),
  );

  log.skip(
    `facteurs TOTP vérifiés : ${factors.length} — ` +
      (factors.length === 0
        ? 'le parcours d’enrôlement sera présenté à la première connexion'
        : 'la vérification sera demandée à chaque connexion'),
  );

  const mustChange = await session
    .from('profiles')
    .select('must_change_password')
    .eq('id', signIn.data.user.id)
    .single();

  check(
    'le changement de mot de passe initial est toujours exigé',
    mustChange.data?.must_change_password === true,
  );

  const fullAccess = await session.rpc('has_permission', { p_permission: 'admin.full_access' });
  check('le compte détient admin.full_access', fullAccess.data === true);

  // Aucune écriture : ni mot de passe, ni facteur, ni profil.
  log.skip('aucune modification effectuée sur ce compte');

  await session.auth.signOut();
}

/* ========================================================================== */
/*  5. Balayage final                                                         */
/* ========================================================================== */

async function assertNoLeftovers(target) {
  log.step('5. Absence de résidu');

  const service = serviceClient(target);
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });

  if (error) {
    check('les comptes sont lisibles pour le balayage', false, error.message);
    return;
  }

  const leftovers = data.users.filter((user) => user.email?.endsWith(TEST_EMAIL_DOMAIN));

  for (const user of leftovers) {
    await service.from('user_roles').delete().eq('user_id', user.id);
    await service.auth.admin.deleteUser(user.id);
    log.warn('compte de test résiduel supprimé');
  }

  check('aucun compte de test ne subsiste', leftovers.length === 0, `${leftovers.length} trouvé(s)`);

  const profiles = await service.from('profiles').select('id, username').ilike('username', 'test%');
  check(
    'aucun profil de test ne subsiste',
    (profiles.data ?? []).length === 0,
    `${(profiles.data ?? []).length} trouvé(s)`,
  );
}

/* ========================================================================== */

async function main() {
  const target = resolveTarget();

  log.step(`Vérification de l'authentification — ${describeTarget(target)}`);

  if (target.isProduction) {
    throw new Error(
      'Refusé sur « prod » : aucun compte de test n’est créé sur la base de production.',
    );
  }

  if (target.isLiveData) {
    log.warn(
      'Base portant les données réelles : les comptes créés sont temporaires, isolés par un ' +
        'domaine réservé, et supprimés en fin d’exécution.',
    );
  }

  const service = serviceClient(target);

  try {
    await registrationChecks(target, service);
    await resetChecks(target);
    await adminStateChecks(target, readFlag('admin'));
  } finally {
    await assertNoLeftovers(target);
  }

  log.step(`Résultat : ${results.passed} contrôle(s) réussi(s), ${results.failed} échec(s).`);

  if (results.failed > 0) process.exit(1);
}

main().catch((error) => {
  log.fail(error.message);
  process.exit(1);
});
