/**
 * Configuration de l'authentification — décisions D-9 et D-12, URLs de retour.
 *
 *   node scripts/configure-auth.mjs --env shared --dry-run
 *   node scripts/configure-auth.mjs --env shared
 *   node scripts/configure-auth.mjs --env shared --redirect-urls
 *
 * Deux natures d'opération, volontairement séparées par un drapeau.
 *
 * **Les paramètres applicatifs** (`--env` seul) écrivent dans la table
 * `settings`, avec la clé secrète. Ce sont des décisions métier que
 * l'administration pourra rebasculer sans déploiement dès la phase 4C :
 *
 *   * `auth.public_registration_enabled` — décision D-9 ;
 *   * `auth.admin_mfa_required`          — décision D-12.
 *
 * **Les URLs de retour** (`--redirect-urls`) touchent à la configuration du
 * projet Supabase, et exigent donc un jeton d'accès personnel. C'est une
 * opération distincte, jamais implicite : sans le drapeau, ce script ne
 * demande aucun jeton et ne modifie rien du projet.
 *
 * Pourquoi ces URLs doivent être déclarées : Supabase refuse de renvoyer un
 * visiteur vers une adresse qui ne figure pas dans sa liste, et retombe alors
 * sur l'accueil du site. Un lien de réinitialisation ramènerait la personne à
 * la page d'accueil, sans moyen de définir son mot de passe.
 *
 * Aucun secret n'est affiché, ni en clair ni tronqué.
 */

import { createClient } from '@supabase/supabase-js';

import { describeTarget, hasFlag, log, resolveAccessToken, resolveTarget } from './lib/config.mjs';

/** Décisions arbitrées par le propriétaire, appliquées telles quelles. */
const DECISIONS = [
  {
    key: 'auth.public_registration_enabled',
    value: true,
    reference: 'D-9',
    label: 'Inscription publique des clients',
    description:
      'Décision D-9 validée : un visiteur peut créer son compte. Le rôle CLIENT est attribué ' +
      'côté serveur ; aucun rôle ne peut être choisi depuis le navigateur.',
  },
  {
    key: 'auth.admin_mfa_required',
    value: true,
    reference: 'D-12',
    label: 'Double authentification obligatoire pour les administrateurs',
    description:
      'Décision D-12 validée : SUPER_ADMIN et ADMIN doivent présenter un facteur TOTP. ' +
      'Une session AAL1 n’ouvre pas l’administration.',
  },
];

/** Chemins vers lesquels Supabase doit pouvoir renvoyer après un lien e-mail. */
function redirectPatternsFor(siteUrl) {
  const origins = [siteUrl, 'http://localhost:3000'];
  const paths = ['/auth/callback/', '/reinitialiser-mot-de-passe/'];

  const patterns = [siteUrl];

  for (const origin of origins) {
    for (const path of paths) {
      // La forme exacte et la forme générique : la seconde couvre la chaîne de
      // requête (`?suite=…`), que Supabase compare avec le reste de l'URL.
      patterns.push(`${origin}${path}`);
      patterns.push(`${origin}${path}**`);
    }
  }

  return [...new Set(patterns)];
}

async function applyDecisions(target, dryRun) {
  log.step(`Paramètres d'authentification — ${describeTarget(target)}${dryRun ? ' (simulation)' : ''}`);

  const client = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const decision of DECISIONS) {
    const { data: current, error: readError } = await client
      .from('settings')
      .select('value')
      .eq('key', decision.key)
      .maybeSingle();

    if (readError) {
      log.fail(`${decision.key} — lecture impossible : ${readError.message}`);
      process.exitCode = 1;
      continue;
    }

    if (!current) {
      log.fail(
        `${decision.key} — paramètre absent. Appliquez d'abord les migrations ` +
          '(scripts/apply-migrations.mjs).',
      );
      process.exitCode = 1;
      continue;
    }

    if (current.value === decision.value) {
      log.skip(`${decision.key} — déjà à « ${decision.value} » (${decision.reference})`);
      continue;
    }

    if (dryRun) {
      log.ok(
        `${decision.key} — passerait de « ${current.value} » à « ${decision.value} » ` +
          `(${decision.reference})`,
      );
      continue;
    }

    const { error } = await client
      .from('settings')
      .update({
        value: decision.value,
        label: decision.label,
        description: decision.description,
      })
      .eq('key', decision.key);

    if (error) {
      log.fail(`${decision.key} — écriture refusée : ${error.message}`);
      process.exitCode = 1;
      continue;
    }

    log.ok(`${decision.key} = ${decision.value} (${decision.reference})`);
  }
}

async function applyRedirectUrls(target, dryRun) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!siteUrl) {
    throw new Error('NEXT_PUBLIC_SITE_URL est absente : impossible de construire les URLs de retour.');
  }

  const token = resolveAccessToken();
  const patterns = redirectPatternsFor(new URL(siteUrl).origin);

  log.step(`URLs de retour Supabase${dryRun ? ' (simulation)' : ''}`);

  const endpoint = `https://api.supabase.com/v1/projects/${target.projectRef}/config/auth`;

  const read = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  if (!read.ok) {
    throw new Error(`Lecture de la configuration refusée (HTTP ${read.status}).`);
  }

  const config = await read.json();
  const existing = String(config.uri_allow_list ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  for (const pattern of patterns) {
    log.ok(`${existing.includes(pattern) ? 'déjà présente' : 'à ajouter   '}  ${pattern}`);
  }

  // Les entrées héritées du socle abandonné désignent une route qui n'existe
  // plus. Les conserver élargirait la liste sans rien autoriser d'utile.
  const obsolete = existing.filter(
    (value) => value.includes('/mot-de-passe-reinitialise') && !patterns.includes(value),
  );

  for (const value of obsolete) {
    log.warn(`à retirer (route inexistante)  ${value}`);
  }

  const next = [...new Set([...existing.filter((value) => !obsolete.includes(value)), ...patterns])];

  if (next.length === existing.length && obsolete.length === 0) {
    log.skip('Liste déjà conforme, aucune écriture.');
    return;
  }

  if (dryRun) {
    log.skip('Simulation : aucune écriture.');
    return;
  }

  const write = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uri_allow_list: next.join(',') }),
  });

  if (!write.ok) {
    throw new Error(`Écriture de la configuration refusée (HTTP ${write.status}).`);
  }

  log.ok(`${next.length} URL(s) autorisée(s).`);
  log.warn(
    'Le jeton d\'accès personnel n\'est plus nécessaire tant qu\'aucune migration ni ' +
      'configuration de projet n\'est prévue : il peut être révoqué.',
  );
}

async function main() {
  const target = resolveTarget();
  const dryRun = hasFlag('dry-run');

  await applyDecisions(target, dryRun);

  if (hasFlag('redirect-urls')) {
    await applyRedirectUrls(target, dryRun);
  } else {
    log.skip('URLs de retour non touchées (ajoutez --redirect-urls pour les configurer).');
  }
}

main().catch((error) => {
  log.fail(error.message);
  process.exit(1);
});
