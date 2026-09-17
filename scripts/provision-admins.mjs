/**
 * Provisionnement sécurisé des comptes administrateurs.
 *
 *   node scripts/provision-admins.mjs --env dev --dry-run
 *   node scripts/provision-admins.mjs --env dev
 *   node scripts/provision-admins.mjs --env prod --i-know-this-is-production
 *
 * Règles tenues (`02_ROLES_ET_PERMISSIONS.md` § 86-87, § 122 ;
 * `04_AUTHENTIFICATION.md` § 8-12 ; `00_SUPABASE.md` § 51) :
 *
 *   * aucun compte n'est codé en dur : la liste vient de l'environnement ;
 *   * aucun mot de passe n'apparaît dans le code, dans Git ni dans une
 *     migration versionnée ;
 *   * aucun mot de passe n'est affiché, ni en clair ni tronqué ;
 *   * le hachage est assuré par Supabase Auth — aucune table applicative ne
 *     stocke de mot de passe ;
 *   * aucune limite au nombre d'administrateurs ;
 *   * un compte déjà présent n'a jamais son mot de passe réécrit
 *     silencieusement.
 *
 * Contrat d'environnement, à placer dans `.env.local` (jamais versionné) :
 *
 *   ADMIN_SEED_USERNAMES=rachade,amina,nizaati
 *   ADMIN_SEED_EMAIL_DOMAIN=morashawiri.com
 *   ADMIN_SEED_RACHADE_PASSWORD=…
 *   ADMIN_SEED_RACHADE_ROLE=SUPER_ADMIN
 *   ADMIN_SEED_RACHADE_FULL_NAME=…        (facultatif)
 *   ADMIN_SEED_RACHADE_EMAIL=…            (facultatif : sinon <identifiant>@<domaine>)
 *
 * Un identifiant listé sans mot de passe est ignoré, avec un message. C'est
 * ainsi que l'on provisionne un compte à la fois sans toucher au script.
 */

import { createClient } from '@supabase/supabase-js';

import { describeTarget, hasFlag, log, resolveTarget } from './lib/config.mjs';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Mots de passe manifestement inacceptables (§ 27 de l'authentification). */
const COMMON_PASSWORDS = new Set([
  'password', 'motdepasse', '12345678', '123456789', 'azertyuiop',
  'qwertyuiop', 'admin1234', 'administrateur', 'changeme', 'motdepasse1',
]);

/**
 * Évalue la robustesse sans jamais restituer la valeur examinée.
 * Renvoie la liste des motifs de refus, vide si le mot de passe convient.
 */
function assessPassword(password, username) {
  const reasons = [];

  if (password.length < 12) reasons.push('moins de 12 caractères');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) reasons.push('mot de passe courant');
  if (password.toLowerCase().includes(username.toLowerCase())) {
    reasons.push('contient l\'identifiant');
  }
  if (/^[a-z]+$/.test(password)) reasons.push('lettres minuscules uniquement');

  return reasons;
}

function readAdminDefinitions() {
  const raw = process.env.ADMIN_SEED_USERNAMES?.trim();
  if (!raw) {
    throw new Error(
      'ADMIN_SEED_USERNAMES est absente. Exemple : ADMIN_SEED_USERNAMES=rachade',
    );
  }

  const domain = process.env.ADMIN_SEED_EMAIL_DOMAIN?.trim() || 'morashawiri.com';

  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((username) => {
      if (!USERNAME_PATTERN.test(username)) {
        throw new Error(`Identifiant invalide : « ${username} ».`);
      }

      const key = username.toUpperCase().replace(/[.-]/g, '_');

      return {
        username,
        password: process.env[`ADMIN_SEED_${key}_PASSWORD`] ?? null,
        role: (process.env[`ADMIN_SEED_${key}_ROLE`] ?? 'ADMIN').trim().toUpperCase(),
        fullName: process.env[`ADMIN_SEED_${key}_FULL_NAME`]?.trim() || null,
        email: (process.env[`ADMIN_SEED_${key}_EMAIL`]?.trim() || `${username}@${domain}`)
          .toLowerCase(),
      };
    });
}

async function findAuthUserByEmail(admin, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Lecture des comptes impossible : ${error.message}`);

    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;

    if (data.users.length < 200) return null;
  }

  return null;
}

async function main() {
  const target = resolveTarget();
  const dryRun = hasFlag('dry-run');
  const allowWeak = hasFlag('allow-weak-password');

  log.step(
    `Provisionnement des administrateurs — ${describeTarget(target)}${dryRun ? ' (simulation)' : ''}`,
  );

  const admin = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: roles, error: rolesError } = await admin
    .from('roles')
    .select('id, code, is_admin_role');

  if (rolesError) {
    throw new Error(
      `Les rôles ne sont pas lisibles : ${rolesError.message}. ` +
        'Appliquez d\'abord les migrations (scripts/apply-migrations.mjs).',
    );
  }

  const roleByCode = new Map(roles.map((role) => [role.code, role]));
  const definitions = readAdminDefinitions();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const definition of definitions) {
    const { username, password, role, fullName, email } = definition;

    if (!password) {
      log.skip(`${username} — aucun mot de passe fourni, compte ignoré`);
      skipped += 1;
      continue;
    }

    const targetRole = roleByCode.get(role);
    if (!targetRole) {
      log.fail(`${username} — rôle « ${role} » inconnu`);
      process.exitCode = 1;
      continue;
    }

    const weaknesses = assessPassword(password, username);
    if (weaknesses.length > 0) {
      const summary = weaknesses.join(', ');
      if (!allowWeak) {
        log.fail(
          `${username} — mot de passe refusé (${summary}). ` +
            'Corrigez la variable, ou passez --allow-weak-password pour provisionner malgré tout.',
        );
        process.exitCode = 1;
        continue;
      }
      log.warn(
        `${username} — mot de passe accepté malgré sa faiblesse (${summary}). ` +
          'Le compte devra le changer à la première connexion.',
      );
    }

    if (dryRun) {
      log.ok(`${username} — serait provisionné avec le rôle ${role}`);
      continue;
    }

    let authUser = await findAuthUserByEmail(admin, email);

    if (authUser) {
      log.skip(`${username} — compte déjà présent, mot de passe inchangé`);
      updated += 1;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, full_name: fullName },
      });

      if (error) {
        log.fail(`${username} — création refusée : ${error.message}`);
        process.exitCode = 1;
        continue;
      }

      authUser = data.user;
      created += 1;
      log.ok(`${username} — compte créé`);
    }

    // Le déclencheur `on_auth_user_created` a posé le profil ; on complète les
    // champs applicatifs et on impose le changement de mot de passe initial.
    const { error: profileError } = await admin
      .from('profiles')
      .upsert(
        {
          id: authUser.id,
          username,
          full_name: fullName,
          status: 'ACTIF',
          must_change_password: true,
        },
        { onConflict: 'id' },
      );

    if (profileError) {
      log.fail(`${username} — profil non écrit : ${profileError.message}`);
      process.exitCode = 1;
      continue;
    }

    const { error: roleError } = await admin
      .from('user_roles')
      .upsert(
        { user_id: authUser.id, role_id: targetRole.id },
        { onConflict: 'user_id,role_id', ignoreDuplicates: true },
      );

    if (roleError) {
      log.fail(`${username} — rôle non attribué : ${roleError.message}`);
      process.exitCode = 1;
      continue;
    }

    log.ok(`${username} — rôle ${role} attribué, changement de mot de passe exigé`);
  }

  log.step(
    `${created} compte(s) créé(s), ${updated} déjà présent(s), ${skipped} ignoré(s) faute de mot de passe.`,
  );
  log.warn('Aucun mot de passe n\'a été affiché ni journalisé par ce script.');
}

main().catch((error) => {
  log.fail(error.message);
  process.exit(1);
});
