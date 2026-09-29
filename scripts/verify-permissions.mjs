/**
 * Vérification des permissions effectives contre une base réelle.
 *
 *   node scripts/verify-permissions.mjs --env shared
 *   node scripts/verify-permissions.mjs --env prod --i-know-this-is-production
 *
 * Ce script ne teste pas le code applicatif : il interroge PostgreSQL comme le
 * ferait une requête forgée, avec de vraies sessions, et vérifie que le moteur
 * de permissions de la phase 4C rend les verdicts promis.
 *
 * Quatre profils sont éprouvés, conformément aux tests exigés par le cadrage :
 *
 *   * **CLIENT**   — aucune permission, aucun accès administratif ;
 *   * **AFFILIE**  — idem, sur un rôle distinct ;
 *   * **ADMIN partiel** — exactement les permissions qui lui sont octroyées,
 *     et rien d'autre ; un retrait individuel lui reprend un droit ;
 *   * **SUPER_ADMIN** — `admin.full_access`, protégé comme dernier détenteur.
 *
 * Les contrôles les plus importants sont ceux de l'**élévation de privilèges** :
 * un compte qui tente de s'octroyer une permission, de s'attribuer un rôle, ou
 * d'en octroyer une à quelqu'un d'autre sans y être habilité.
 *
 * Sur `--env prod`, seuls les contrôles en lecture anonyme sont exécutés :
 * aucun compte de test n'y est créé. Sur `--env shared`, les comptes
 * temporaires portent le domaine réservé `@mora-shawiri.test`, ils sont
 * supprimés dans un bloc `finally`, et un balayage final vérifie qu'aucun
 * résidu ne subsiste.
 *
 * Références : `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 158-160, § 170 ;
 * `02_ROLES_ET_PERMISSIONS.md` § 21, § 96-97, § 106 ; décision D-18.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, hasFlag, log, resolveAccessToken, resolveTarget, runSql } from './lib/config.mjs';
import { totpCode, waitForFreshWindow } from './lib/totp.mjs';

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

/** Une écriture est refusée si elle lève, ou si elle n'a rien écrit. */
function isRefused(result) {
  return Boolean(result.error);
}

const TEST_DOMAIN = 'mora-shawiri.test';
const PASSWORD = `Verif-4C-${randomUUID()}`;

function newEmail(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;
}

function sessionClient(target) {
  return createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ========================================================================== */
/*  Préparation                                                               */
/* ========================================================================== */

/**
 * Réessaie un appel réseau deux fois avant d'abandonner.
 *
 * Le projet Supabase est sur une offre gratuite et sa passerelle coupe
 * occasionnellement — le rapport de phase 4B § 10.4 avait déjà relevé une
 * interruption de quelques secondes. Un `fetch failed` transitoire ne dit rien
 * de la sécurité du système : le confondre avec un échec de contrôle rendrait
 * ce script inexploitable comme preuve.
 */
async function withRetry(label, operation, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        log.skip(`${label} — tentative ${attempt} échouée, nouvel essai`);
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }

  throw lastError;
}

/**
 * Crée un compte, lui attribue un rôle et pose ses octrois individuels.
 *
 * Passe par la clé à privilèges : c'est du provisionnement de test, pas un
 * parcours utilisateur. Les contrôles, eux, se feront avec une vraie session.
 */
async function createAccount(admin, { roleCode, grants = [], revokes = [], prefix }) {
  const email = newEmail(prefix);

  const data = await withRetry(`création du compte ${prefix}`, async () => {
    const result = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });

    if (result.error || !result.data.user) {
      // Une coupure peut survenir APRÈS que le compte a été créé : la réponse
      // se perd, pas l'écriture. Réessayer sans vérifier laisserait un doublon
      // orphelin, que le balayage final signalerait comme un résidu.
      const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = existing.data?.users.find((user) => user.email === email);
      if (found) return { user: found };

      throw new Error(
        `création du compte ${prefix} impossible : ${result.error?.message ?? 'inconnue'}`,
      );
    }

    return result.data;
  });

  const userId = data.user.id;

  const { data: role } = await admin.from('roles').select('id').eq('code', roleCode).maybeSingle();
  if (!role) throw new Error(`rôle ${roleCode} introuvable`);

  await withRetry(`attribution du rôle ${roleCode}`, async () => {
    const result = await admin.from('user_roles').insert({ user_id: userId, role_id: role.id });
    if (result.error && !result.error.message.includes('duplicate')) throw new Error(result.error.message);
    return result;
  });

  const codes = [...grants, ...revokes];
  if (codes.length > 0) {
    await withRetry(`ajustements de ${prefix}`, async () => {
      const { data: permissions, error } = await admin
        .from('permissions')
        .select('id, code')
        .in('code', codes);

      if (error) throw new Error(error.message);

      const idByCode = new Map((permissions ?? []).map((row) => [row.code, row.id]));

      const rows = [
        ...grants.map((code) => ({
          user_id: userId,
          permission_id: idByCode.get(code),
          effect: 'OCTROI',
        })),
        ...revokes.map((code) => ({
          user_id: userId,
          permission_id: idByCode.get(code),
          effect: 'RETRAIT',
        })),
      ].filter((row) => row.permission_id);

      if (rows.length !== codes.length) {
        throw new Error(`catalogue incomplet pour ${prefix} : ${rows.length}/${codes.length}`);
      }

      const written = await admin
        .from('user_permissions')
        .upsert(rows, { onConflict: 'user_id,permission_id' });

      if (written.error) throw new Error(written.error.message);
      return written;
    });

    // Le décor est relu avant que le contrôle ne commence. Un test qui échoue
    // parce que sa préparation a silencieusement raté ne prouve rien — et
    // accuse le code à tort, ce qui est pire que de ne rien prouver.
    const { data: check } = await admin
      .from('user_permissions')
      .select('effect, permissions(code)')
      .eq('user_id', userId);

    const posed = new Set((check ?? []).map((row) => row.permissions?.code));
    for (const code of codes) {
      if (!posed.has(code)) {
        throw new Error(`préparation incomplète de ${prefix} : ${code} n’a pas été posée`);
      }
    }
  }

  return { userId, email };
}

async function signIn(target, email) {
  const client = sessionClient(target);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`connexion impossible pour ${email} : ${error.message}`);
  return client;
}

/* ========================================================================== */
/*  Les contrôles                                                             */
/* ========================================================================== */

/** Le moteur : ce que la base dit détenir, pour un compte donné. */
async function permissionsOf(client) {
  const { data } = await client.rpc('current_permissions');
  return Array.isArray(data) ? data : [];
}

async function hasPermission(client, permission) {
  const { data } = await client.rpc('has_permission', { p_permission: permission });
  return data === true;
}

async function checkDeniedProfile(target, label, account) {
  log.step(`${label} — aucun droit administratif`);

  const client = await signIn(target, account.email);

  const permissions = await permissionsOf(client);
  check(`${label} : aucune permission effective`, permissions.length === 0, permissions.join(', '));

  check(`${label} : has_permission refuse orders.view`, !(await hasPermission(client, 'orders.view')));
  check(`${label} : has_permission refuse admin.full_access`, !(await hasPermission(client, 'admin.full_access')));

  const { data: isAdmin } = await client.rpc('is_admin');
  check(`${label} : is_admin renvoie faux`, isAdmin !== true);

  // Lectures réservées à l'administration.
  for (const table of ['permissions', 'role_permissions', 'audit_logs', 'admin_invitations']) {
    const result = await client.from(table).select('*').limit(1);
    check(
      `${label} : ne lit rien dans « ${table} »`,
      Boolean(result.error) || (result.data ?? []).length === 0,
    );
  }

  // Élévation de privilèges — le cœur du contrôle.
  const { data: fullAccess } = await client
    .from('permissions')
    .select('id')
    .eq('code', 'admin.full_access')
    .maybeSingle();

  // Le catalogue lui est fermé : il ne connaît même pas l'identifiant visé.
  check(`${label} : ne peut pas lire l’identifiant de admin.full_access`, !fullAccess);

  const selfGrant = await client.from('user_permissions').insert({
    user_id: account.userId,
    permission_id: fullAccess?.id ?? randomUUID(),
    effect: 'OCTROI',
  });
  check(`${label} : ne peut pas s’octroyer une permission`, isRefused(selfGrant));

  const { data: superRole } = await client
    .from('roles')
    .select('id')
    .eq('code', 'SUPER_ADMIN')
    .maybeSingle();

  const selfRole = await client.from('user_roles').insert({
    user_id: account.userId,
    role_id: superRole?.id ?? randomUUID(),
  });
  check(`${label} : ne peut pas s’attribuer un rôle`, isRefused(selfRole));

  await client.auth.signOut();
}

async function checkPartialAdmin(target, account, otherAccount) {
  log.step('ADMIN partiel — exactement ce qui lui est accordé');

  const client = await signIn(target, account.email);

  const permissions = await permissionsOf(client);
  const held = new Set(permissions);

  // Accordées individuellement.
  for (const code of ['orders.view', 'orders.update', 'quotes.view']) {
    check(`ADMIN : détient ${code} (octroi individuel)`, held.has(code));
    check(`ADMIN : has_permission confirme ${code}`, await hasPermission(client, code));
  }

  // Jamais accordées.
  for (const code of ['payments.verify', 'settings.update', 'audit.view', 'admins.permissions']) {
    check(`ADMIN : ne détient pas ${code}`, !held.has(code));
    check(`ADMIN : has_permission refuse ${code}`, !(await hasPermission(client, code)));
  }

  // Retirée nominativement bien que le rôle l'ait donnée — ici le rôle ADMIN
  // ne donne plus rien, on vérifie donc surtout que le retrait tient.
  check('ADMIN : ne détient pas content.view (retrait individuel)', !held.has('content.view'));
  check(
    'ADMIN : has_permission refuse content.view malgré son octroi annulé',
    !(await hasPermission(client, 'content.view')),
  );

  check('ADMIN : ne détient pas admin.full_access', !held.has('admin.full_access'));

  const { data: isAdmin } = await client.rpc('is_admin');
  check('ADMIN : is_admin renvoie vrai', isAdmin === true);

  // Le rôle ADMIN n'accorde plus rien par lui-même (décision D-18).
  const { data: fromRoles } = await client.rpc('account_permissions', {
    p_user_id: account.userId,
  });
  const byRole = (fromRoles ?? []).filter((row) => row.from_role);
  check('ADMIN : le rôle n’accorde aucune permission par lui-même', byRole.length === 0,
    byRole.map((row) => row.code).join(', '));

  /* --- Élévation de privilèges -------------------------------------------- */

  // Le catalogue des permissions est volontairement lisible par tout rôle
  // d'administration (politique `permissions_select_admin`, phase 4A) : c'est
  // une liste de noms de capacités, pas une donnée. Ce qui compte, et qui est
  // vérifié juste après, c'est qu'en connaître les identifiants ne permette
  // d'en accorder aucune.
  const { data: catalogue } = await client.from('permissions').select('id, code');
  check(
    'ADMIN : lit le catalogue des permissions, sans pouvoir en accorder',
    Array.isArray(catalogue) && catalogue.length > 0,
  );

  const knownId = catalogue?.find((row) => row.code === 'admin.full_access')?.id;
  const escalate = await client.from('user_permissions').insert({
    user_id: account.userId,
    permission_id: knownId ?? randomUUID(),
    effect: 'OCTROI',
  });
  check(
    'ADMIN : connaître l’identifiant de admin.full_access ne suffit pas à se l’octroyer',
    isRefused(escalate),
  );

  const selfGrant = await client.from('user_permissions').insert({
    user_id: account.userId,
    permission_id: randomUUID(),
    effect: 'OCTROI',
  });
  check('ADMIN : ne peut pas s’octroyer une permission', isRefused(selfGrant));

  const otherGrant = await client.from('user_permissions').insert({
    user_id: otherAccount.userId,
    permission_id: randomUUID(),
    effect: 'OCTROI',
  });
  check(
    'ADMIN : ne peut pas octroyer une permission à autrui sans admins.permissions',
    isRefused(otherGrant),
  );

  const removeOwnRevoke = await client
    .from('user_permissions')
    .delete()
    .eq('user_id', account.userId)
    .eq('effect', 'RETRAIT');
  const stillRevoked = await hasPermission(client, 'content.view');
  check(
    'ADMIN : ne peut pas supprimer son propre retrait',
    isRefused(removeOwnRevoke) || !stillRevoked,
  );

  // Lectures administratives refusées faute de permission.
  for (const table of ['audit_logs', 'admin_invitations']) {
    const result = await client.from(table).select('*').limit(1);
    check(
      `ADMIN : ne lit rien dans « ${table} »`,
      Boolean(result.error) || (result.data ?? []).length === 0,
    );
  }

  // Il ne voit pas le profil d'un autre compte : ni users.view, ni admins.view.
  const otherProfile = await client
    .from('profiles')
    .select('id')
    .eq('id', otherAccount.userId)
    .maybeSingle();
  check('ADMIN : ne lit pas le profil d’un autre compte', !otherProfile.data);

  await client.auth.signOut();
}

/**
 * Invariants du moteur, lus en SQL direct.
 *
 * Volontairement hors PostgREST : la clé secrète ne porte aucune session, donc
 * `auth.uid()` y est nul et `account_permissions()` — qui filtre sur l'identité
 * de l'appelant — ne renverrait rien. Ce n'est pas un défaut, c'est le filtre
 * qui fonctionne. Les invariants de schéma se vérifient donc là où ils vivent.
 */
async function checkEngineInvariants(target, accessToken, account) {
  log.step('Le moteur, vu de la base');

  // Première vérification, et elle est de sécurité : sans session, la fonction
  // de lecture ne rend rien. `account_permissions` filtre sur l'identité de
  // l'appelant ; la clé de gestion n'en a aucune, donc elle ne voit rien.
  // C'est le filtre qui fonctionne, pas une panne.
  const unauthenticated = await runSql(
    target,
    accessToken,
    `select count(*)::int as total
       from public.account_permissions('${account.userId}'::uuid)`,
  );

  check(
    'account_permissions ne rend rien à un appelant sans identité',
    unauthenticated?.[0]?.total === 0,
    String(unauthenticated?.[0]?.total),
  );

  // Le contenu se vérifie donc sur les fonctions de calcul, qui ne filtrent
  // pas — et dont l'exécution est justement réservée au serveur.
  const rows = await runSql(
    target,
    accessToken,
    `select p.code,
            exists (select 1 from public.role_permissions_of('${account.userId}'::uuid) rc where rc = p.code) as from_role,
            up.effect,
            exists (select 1 from public.effective_permissions('${account.userId}'::uuid) ec where ec = p.code) as effective
       from public.permissions p
       left join public.user_permissions up
         on up.permission_id = p.id and up.user_id = '${account.userId}'::uuid`,
  );

  const byCode = new Map((rows ?? []).map((row) => [row.code, row]));

  check(
    'le calcul couvre tout le catalogue',
    (rows ?? []).length >= 64,
    `${(rows ?? []).length} lignes`,
  );

  check(
    'un octroi est marqué OCTROI et effectif',
    byCode.get('orders.view')?.effect === 'OCTROI' && byCode.get('orders.view')?.effective === true,
  );

  check(
    'un retrait est marqué RETRAIT et non effectif',
    byCode.get('content.view')?.effect === 'RETRAIT' &&
      byCode.get('content.view')?.effective === false,
  );

  check(
    'une permission jamais accordée n’a ni origine ni effet',
    byCode.get('payments.refund')?.effect === null &&
      byCode.get('payments.refund')?.effective === false,
  );

  const counts = await runSql(
    target,
    accessToken,
    `select public.count_active_holders('orders.view')     as orders,
            public.count_active_holders('admin.full_access') as global`,
  );

  check(
    'count_active_holders compte les octrois individuels',
    (counts?.[0]?.orders ?? 0) >= 1,
    String(counts?.[0]?.orders),
  );

  check(
    'admin.full_access est détenu par au moins un compte actif',
    (counts?.[0]?.global ?? 0) >= 1,
    String(counts?.[0]?.global),
  );

  const roleGrants = await runSql(
    target,
    accessToken,
    `select r.code, count(rp.permission_id)::int as total
       from public.roles r
       left join public.role_permissions rp on rp.role_id = r.id
      where r.code in ('ADMIN', 'SUPER_ADMIN')
      group by r.code`,
  );

  const totals = new Map((roleGrants ?? []).map((row) => [row.code, row.total]));

  check(
    'le rôle ADMIN n’accorde plus aucune permission',
    totals.get('ADMIN') === 0,
    `${totals.get('ADMIN')} permission(s) restante(s)`,
  );

  const superGlobal = await runSql(
    target,
    accessToken,
    `select exists (
       select 1
         from public.roles r
         join public.role_permissions rp on rp.role_id = r.id
         join public.permissions p on p.id = rp.permission_id
        where r.code = 'SUPER_ADMIN' and p.code = 'admin.full_access'
     ) as ok`,
  );

  check('le rôle SUPER_ADMIN conserve admin.full_access', superGlobal?.[0]?.ok === true);

  /* --- Les garde-fous, éprouvés en SQL ------------------------------------ */

  const lastHolder = await runSql(
    target,
    accessToken,
    `select public.count_active_holders('admin.full_access') as holders`,
  );

  check(
    'le dernier détenteur de admin.full_access est identifiable',
    (lastHolder?.[0]?.holders ?? 0) >= 1,
  );
}

/**
 * Les deux garde-fous propres à la phase 4C, éprouvés avec une session réelle
 * qui détient vraiment le droit d'agir.
 *
 * Les contrôles précédents montrent qu'un compte sans `admins.permissions` ne
 * peut rien écrire — c'est RLS qui refuse. Ceux-ci vont plus loin : ils
 * s'exercent sur un compte **habilité**, pour lequel RLS ouvre la porte, et
 * vérifient que les déclencheurs la referment là où ils doivent.
 *
 * Une session `AAL2` est indispensable : les politiques d'écriture de la
 * migration 0004 l'exigent, en plus de la permission. Le second facteur est
 * donc réellement enrôlé et présenté.
 */
async function checkGuards(target, admin, granter, holder, spare) {
  log.step('Garde-fous — auto-modification et dernier détenteur');

  const client = sessionClient(target);

  const signedIn = await client.auth.signInWithPassword({
    email: granter.email,
    password: PASSWORD,
  });
  if (signedIn.error) throw new Error(signedIn.error.message);

  const permissionId = async (code) => {
    const { data } = await admin.from('permissions').select('id').eq('code', code).maybeSingle();
    return data?.id;
  };

  const adminsPermissionsId = await permissionId('admins.permissions');
  const paymentsVerifyId = await permissionId('payments.verify');

  /* --- Sans second facteur, la permission ne suffit pas ------------------- */

  const beforeMfa = await client.from('user_permissions').insert({
    user_id: spare.userId,
    permission_id: paymentsVerifyId,
    effect: 'OCTROI',
  });
  check(
    'en AAL1, même admins.permissions n’autorise aucune écriture',
    isRefused(beforeMfa),
    beforeMfa.error?.message,
  );

  /* --- Enrôlement du second facteur -------------------------------------- */

  const enrol = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Verif 4C' });
  if (enrol.error) throw new Error(enrol.error.message);

  await waitForFreshWindow();

  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: enrol.data.id,
    code: totpCode(enrol.data.totp.secret),
  });
  if (verified.error) throw new Error(verified.error.message);

  const { data: claims } = await client.auth.getClaims();
  check('la session est passée en AAL2', claims?.claims?.aal === 'aal2');

  /* --- Auto-modification : interdite, quelle que soit la permission ------- */

  const selfGrant = await client.from('user_permissions').insert({
    user_id: granter.userId,
    permission_id: paymentsVerifyId,
    effect: 'OCTROI',
  });
  check(
    'un compte habilité ne peut pas s’octroyer une permission',
    isRefused(selfGrant),
    selfGrant.error?.message,
  );

  const selfRevoke = await client
    .from('user_permissions')
    .delete()
    .eq('user_id', granter.userId)
    .eq('permission_id', adminsPermissionsId);
  const stillHabilited = await hasPermission(client, 'admins.permissions');
  check(
    'un compte habilité ne peut pas non plus se retirer un droit lui-même',
    isRefused(selfRevoke) || stillHabilited,
    selfRevoke.error?.message,
  );

  /* --- Il peut en revanche agir sur autrui -------------------------------- */

  const grantToOther = await client.from('user_permissions').insert({
    user_id: spare.userId,
    permission_id: paymentsVerifyId,
    effect: 'OCTROI',
  });
  check(
    'un compte habilité octroie une permission à autrui',
    !isRefused(grantToOther),
    grantToOther.error?.message,
  );

  /* --- Dernier détenteur d'une permission critique ------------------------ */

  // Précondition explicite : deux comptes détiennent payments.verify. Sans
  // cette vérification, un décor incomplet ferait échouer le contrôle suivant
  // en accusant le garde-fou plutôt que la préparation.
  const holders = await runSql(
    target,
    resolveAccessToken(),
    `select public.count_active_holders('payments.verify') as total`,
  );
  check(
    'deux comptes détiennent la permission critique avant le contrôle',
    holders?.[0]?.total === 2,
    `${holders?.[0]?.total} détenteur(s)`,
  );

  // Retirer à l'un des deux est donc permis.
  const removeOne = await client
    .from('user_permissions')
    .delete()
    .eq('user_id', spare.userId)
    .eq('permission_id', paymentsVerifyId);
  check(
    'retirer une permission critique est permis tant qu’un autre la détient',
    !isRefused(removeOne),
    removeOne.error?.message,
  );

  // `holder` est maintenant seul. Le garde-fou doit refuser.
  const removeLast = await client
    .from('user_permissions')
    .delete()
    .eq('user_id', holder.userId)
    .eq('permission_id', paymentsVerifyId);

  const holderKeeps = await runSql(
    target,
    resolveAccessToken(),
    `select public.user_holds_permission('${holder.userId}'::uuid, 'payments.verify') as ok`,
  );

  check(
    'le dernier détenteur d’une permission critique est protégé',
    isRefused(removeLast) || holderKeeps?.[0]?.ok === true,
    removeLast.error?.message ?? 'la permission a été retirée',
  );

  // Et le même retrait redevient possible dès qu'un second détenteur existe.
  await client.from('user_permissions').insert({
    user_id: spare.userId,
    permission_id: paymentsVerifyId,
    effect: 'OCTROI',
  });

  const removeAgain = await client
    .from('user_permissions')
    .delete()
    .eq('user_id', holder.userId)
    .eq('permission_id', paymentsVerifyId);

  check(
    'le retrait redevient possible dès qu’un second détenteur existe',
    !isRefused(removeAgain),
    removeAgain.error?.message,
  );

  await client.auth.signOut();
}

async function checkAnonymous(target) {
  log.step('Accès anonyme aux tables de la phase 4C');

  const anon = sessionClient(target);

  for (const table of ['user_permissions', 'admin_invitations']) {
    const result = await anon.from(table).select('*').limit(1);
    check(
      `anon ne lit rien dans « ${table} »`,
      Boolean(result.error) || (result.data ?? []).length === 0,
    );

    const write = await anon.from(table).insert({});
    check(`anon n’écrit rien dans « ${table} »`, isRefused(write));
  }

  const { data: permissions } = await anon.rpc('current_permissions');
  check('anon ne détient aucune permission', (permissions ?? []).length === 0);

  const { data: aal } = await anon.rpc('session_is_aal2');
  check('anon n’est pas au niveau AAL2', aal !== true);

  // Les fonctions de calcul ne sont pas exécutables sans privilège.
  const effective = await anon.rpc('effective_permissions', { p_user_id: randomUUID() });
  check('anon ne peut pas exécuter effective_permissions', Boolean(effective.error));

  const roleOf = await anon.rpc('role_permissions_of', { p_user_id: randomUUID() });
  check('anon ne peut pas exécuter role_permissions_of', Boolean(roleOf.error));
}

/* ========================================================================== */

async function main() {
  const target = resolveTarget();
  log.step(`Permissions effectives — ${describeTarget(target)}`);

  await checkAnonymous(target);

  if (target.env === 'prod' && !hasFlag('i-know-this-is-production')) {
    log.step('Contrôles authentifiés — ignorés en production');
    return;
  }

  const accessToken = resolveAccessToken();

  const admin = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const created = [];

  try {
    const client = await createAccount(admin, { roleCode: 'CLIENT', prefix: 'client' });
    created.push(client.userId);

    const affiliate = await createAccount(admin, { roleCode: 'AFFILIE', prefix: 'affilie' });
    created.push(affiliate.userId);

    const partialAdmin = await createAccount(admin, {
      roleCode: 'ADMIN',
      prefix: 'admin',
      grants: ['orders.view', 'orders.update', 'quotes.view'],
      revokes: ['content.view'],
    });
    created.push(partialAdmin.userId);

    const granter = await createAccount(admin, {
      roleCode: 'ADMIN',
      prefix: 'habilite',
      grants: ['admins.permissions', 'users.view'],
    });
    created.push(granter.userId);

    const holder = await createAccount(admin, {
      roleCode: 'ADMIN',
      prefix: 'detenteur',
      grants: ['payments.verify'],
    });
    created.push(holder.userId);

    const spare = await createAccount(admin, { roleCode: 'ADMIN', prefix: 'appoint' });
    created.push(spare.userId);

    await checkDeniedProfile(target, 'CLIENT', client);
    await checkDeniedProfile(target, 'AFFILIE', affiliate);
    await checkPartialAdmin(target, partialAdmin, client);
    await checkEngineInvariants(target, accessToken, partialAdmin);
    await checkGuards(target, admin, granter, holder, spare);
  } finally {
    for (const userId of created) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }

    log.step('Absence de résidu');

    // Le balayage porte sur l'ADRESSE, pas sur l'identifiant : les comptes
    // créés ici n'en ont aucun, et un filtre sur `username` serait vide par
    // construction — donc toujours vert, donc inutile.
    const { data: users, error: listError } = await withRetry('balayage des comptes', () =>
      admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    ).catch((error) => ({ data: null, error }));

    if (listError || !users) {
      check('les comptes sont lisibles pour le balayage', false, listError?.message);
    } else {
      const leftovers = users.users.filter((user) => user.email?.endsWith(`@${TEST_DOMAIN}`));

      for (const user of leftovers) {
        await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
        log.warn('compte de test résiduel supprimé');
      }

      check(
        'aucun compte de test ne subsiste',
        leftovers.length === 0,
        `${leftovers.length} trouvé(s)`,
      );
    }

    const { data: orphans } = await admin.from('user_permissions').select('user_id');
    const { data: profiles } = await admin.from('profiles').select('id');
    const known = new Set((profiles ?? []).map((row) => row.id));

    check(
      'aucun ajustement de permission orphelin',
      (orphans ?? []).every((row) => known.has(row.user_id)),
    );
  }
}

main()
  .then(() => {
    log.step(
      `Résultat : ${results.passed} contrôle(s) réussi(s), ${results.failed} échec(s).`,
    );
    if (results.failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    log.fail(error.message);
    process.exitCode = 1;
  });
