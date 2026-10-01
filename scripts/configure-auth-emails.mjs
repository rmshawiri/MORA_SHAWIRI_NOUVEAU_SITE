/**
 * Modèles des e-mails Supabase Auth — production, dépôt et vérification.
 *
 *   npm run auth:emails -- --env shared --dry-run
 *   npm run auth:emails -- --env shared --dry-run --preview <dossier>
 *   npm run auth:emails -- --env shared --backup <fichier.json>
 *   npm run auth:emails -- --env shared
 *
 * ## Pourquoi un script, et pas le tableau de bord
 *
 * Supabase compose lui-même ses e-mails d'authentification, à partir de
 * modèles stockés dans la configuration du projet. Les saisir à la main dans
 * le tableau de bord les ferait vivre hors du dépôt : impossible à relire, à
 * comparer, à reproduire sur un second projet. Ici, la source est
 * `src/lib/emails/auth.ts`, rendue par le gabarit commun des e-mails du site ;
 * ce script la dépose par l'API de gestion, puis **relit** la configuration
 * pour établir que ce qui est en place est exactement ce qui a été produit.
 *
 * ## Ce que le script touche, et rien d'autre
 *
 * Quatre champs : objet et contenu des modèles `confirmation` et `recovery`,
 * les deux seuls que le site déclenche. Ni l'expéditeur, ni le SMTP, ni les
 * URLs de retour, ni la durée de validité des liens — celle-ci est seulement
 * **lue** (`mailer_otp_exp`), pour que le texte annonce la validité réelle.
 *
 * `--backup` enregistre d'abord les valeurs en place : c'est le chemin de
 * retour arrière. `--preview` écrit les modèles dans un dossier, le lien
 * d'action remplacé par une adresse d'exemple, pour les ouvrir au navigateur.
 *
 * Exige `SUPABASE_ACCESS_TOKEN` (jeton personnel, API de gestion) et
 * `NEXT_PUBLIC_SITE_URL`. Aucun secret n'est affiché.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describeTarget, hasFlag, log, readFlag, resolveAccessToken, resolveTarget } from './lib/config.mjs';

// Le gabarit est écrit en TypeScript : ce script est lancé avec `--import tsx`
// (voir `package.json`), comme les tests unitaires.
const { renderSupabaseAuthTemplates, SUPABASE_TEMPLATE_FIELDS, SUPABASE_CONFIRMATION_URL } =
  await import('../src/lib/emails/auth.ts');

const SAMPLE_URL =
  'https://exemple.supabase.co/auth/v1/verify?token=EXEMPLE-DE-JETON-TRES-LONG-0123456789abcdef&type=signup&redirect_to=https://mora-shawiri-nouveau-site.vercel.app/auth/callback/?suite=%2Fespace-client%2F';

async function main() {
  const target = resolveTarget();
  const dryRun = hasFlag('dry-run');
  const token = resolveAccessToken();

  const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!rawSiteUrl) throw new Error('NEXT_PUBLIC_SITE_URL est absente : le logo et les liens du site seraient faux.');
  const siteUrl = new URL(rawSiteUrl).origin;

  log.step(`Modèles e-mail Supabase Auth — ${describeTarget(target)}${dryRun ? ' (simulation)' : ''}`);

  const endpoint = `https://api.supabase.com/v1/projects/${target.projectRef}/config/auth`;
  const headers = { Authorization: `Bearer ${token}` };

  const read = await fetch(endpoint, { headers });
  if (!read.ok) throw new Error(`Lecture de la configuration refusée (HTTP ${read.status}).`);
  const config = await read.json();

  const lifetime = Number(config.mailer_otp_exp);
  if (!Number.isInteger(lifetime) || lifetime <= 0) {
    throw new Error('Durée de validité des liens (mailer_otp_exp) illisible : rien n’est écrit.');
  }

  // Information, pas modification : l'expéditeur dépend du SMTP du projet.
  log.skip(
    config.smtp_host
      ? 'Envoi : SMTP personnalisé configuré dans Supabase.'
      : 'Envoi : service intégré de Supabase (aucun SMTP personnalisé) — expéditeur imposé par Supabase.',
  );
  log.skip(`Validité des liens lue dans la configuration : ${lifetime} s.`);

  if (!config.smtp_host) {
    // Constaté le 1er octobre 2026 : sur le plan Free, Supabase refuse toute
    // modification de modèle tant que le service intégré assure l'envoi
    // (HTTP 400, « Email template modification is not available for free
    // tier projects using the default email provider »). L'écriture est tout
    // de même tentée — un plan payant l'accepterait —, mais l'échec est
    // annoncé d'avance pour qu'il ne passe pas pour un défaut du script.
    log.warn(
      'Sans SMTP personnalisé, un projet sur le plan Free refuse la modification des modèles : ' +
        'configurer d’abord le SMTP du projet (décision du propriétaire).',
    );
  }

  const templates = renderSupabaseAuthTemplates({ siteUrl, linkLifetimeSeconds: lifetime });

  const backupPath = readFlag('backup');
  if (backupPath) {
    const previous = {};
    for (const fields of Object.values(SUPABASE_TEMPLATE_FIELDS)) {
      previous[fields.subject] = config[fields.subject] ?? null;
      previous[fields.content] = config[fields.content] ?? null;
    }
    writeFileSync(resolve(backupPath), JSON.stringify(previous, null, 2));
    log.ok(`Valeurs en place sauvegardées : ${backupPath}`);
  }

  const previewDir = readFlag('preview');
  if (previewDir) {
    mkdirSync(resolve(previewDir), { recursive: true });
    for (const [key, template] of Object.entries(templates)) {
      const html = template.html.split(SUPABASE_CONFIRMATION_URL).join(SAMPLE_URL);
      writeFileSync(resolve(previewDir, `supabase-${key}.html`), html);
    }
    log.ok(`Aperçus écrits dans ${previewDir}`);
  }

  const patch = {};
  for (const [key, template] of Object.entries(templates)) {
    const fields = SUPABASE_TEMPLATE_FIELDS[key];

    if (!template.html.includes(SUPABASE_CONFIRMATION_URL)) {
      throw new Error(`Le modèle « ${key} » ne contient pas le lien d'action : rien n'est écrit.`);
    }

    const sameSubject = config[fields.subject] === template.subject;
    const sameContent = config[fields.content] === template.html;

    log.ok(
      `${key.padEnd(12)} objet ${sameSubject ? 'conforme' : 'à mettre à jour'} · ` +
        `contenu ${sameContent ? 'conforme' : `à mettre à jour (${template.html.length} caractères)`}`,
    );

    if (!sameSubject) patch[fields.subject] = template.subject;
    if (!sameContent) patch[fields.content] = template.html;
  }

  if (Object.keys(patch).length === 0) {
    log.skip('Modèles déjà conformes, aucune écriture.');
    return;
  }

  if (dryRun) {
    log.skip(`Simulation : ${Object.keys(patch).length} champ(s) seraient écrits.`);
    return;
  }

  const write = await fetch(endpoint, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

  if (!write.ok) {
    // Le corps de la réponse ne contient que le motif du refus — jamais de
    // valeur de configuration — et il est indispensable pour comprendre.
    const reason = (await write.text()).slice(0, 400);
    throw new Error(`Écriture refusée (HTTP ${write.status}) : ${reason}`);
  }

  // Relecture : ce qui est en place doit être, au caractère près, ce qui a été produit.
  const check = await fetch(endpoint, { headers });
  if (!check.ok) throw new Error(`Relecture refusée (HTTP ${check.status}).`);
  const after = await check.json();

  let mismatches = 0;
  for (const [key, template] of Object.entries(templates)) {
    const fields = SUPABASE_TEMPLATE_FIELDS[key];
    const ok = after[fields.subject] === template.subject && after[fields.content] === template.html;
    if (ok) log.ok(`${key} — en place et identique à la source`);
    else {
      mismatches += 1;
      log.fail(`${key} — la configuration relue diffère de la source`);
    }
  }

  if (mismatches > 0) process.exitCode = 1;
}

main().catch((error) => {
  log.fail(error.message);
  process.exitCode = 1;
});
