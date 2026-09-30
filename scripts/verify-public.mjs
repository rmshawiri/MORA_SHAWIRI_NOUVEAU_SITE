/**
 * Non-régression du site public — capture et comparaison du rendu réel.
 *
 *   node scripts/verify-public.mjs --base http://localhost:3100 --snapshot avant
 *   node scripts/verify-public.mjs --base http://localhost:3100 --snapshot apres
 *   node scripts/verify-public.mjs --compare avant apres
 *
 * La phase 4E fait basculer des contenus publics d'un fichier TypeScript vers
 * la base. Le plan de développement pose la mesure de protection : contrôle des
 * routes publiques avant validation. Une relecture du code ne suffit pas à
 * établir qu'un rendu est identique ; seul le HTML réellement servi le prouve.
 * Ce script interroge donc le site comme un visiteur, enregistre ce qu'il
 * reçoit, et compare deux campagnes.
 *
 * ## Ce qui est comparé, et ce qui est volontairement ignoré
 *
 * Le HTML brut de Next.js contient des éléments qui changent à chaque build
 * sans que le visiteur voie quoi que ce soit : empreintes de fichiers statiques,
 * identifiants de flux React, ordre des préchargements. Les comparer ferait
 * échouer le contrôle sur du bruit — et pire, habituerait à ignorer ses échecs.
 *
 * Trois signatures sont donc calculées :
 *
 *   * `http`      — code de statut et type de contenu ;
 *   * `texte`     — le texte visible, balises retirées : c'est ce que lit le
 *                   visiteur, prix et descriptions compris ;
 *   * `structure` — la suite des balises et de leurs classes, sans le texte :
 *                   c'est la mise en page, donc le design gelé.
 *
 * Un écart sur `texte` signale un changement de contenu. Un écart sur
 * `structure` signale un changement de rendu. Les deux sont des régressions
 * tant que la phase ne les a pas explicitement prévus.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PROJECT_ROOT, log, readFlag } from './lib/config.mjs';

const SNAPSHOT_DIR = resolve(PROJECT_ROOT, '.snapshots');

/**
 * Les routes publiques du site, plus les fichiers de référencement et le
 * comportement 404. L'ordre est celui de la navigation.
 */
const ROUTES = [
  '/',
  '/services/',
  '/boutique/',
  '/affiliation/',
  '/formation-prospection-relation-client/',
  '/qui-sommes-nous/',
  '/blog/',
  '/blog/echec-prospection-client/',
  '/blog/gestion-documentaire-entreprise/',
  '/blog/template-organisation/',
  '/blog/site-internet-entrepreneur/',
  '/faq/',
  '/contact/',
  '/rendez-vous/',
  '/mentions-legales/',
  '/conditions-generales/',
  '/politique-de-confidentialite/',
  '/politique-de-cookies/',
  '/sitemap.xml',
  '/robots.txt',
  // Contexte d'offre transmis par une carte de la Boutique : le formulaire doit
  // présélectionner le besoin sans que le visiteur le ressaisisse.
  '/contact/?offre=logo',
  '/contact/?offre=audit',
  // Une adresse inexistante doit rendre la page 404 du site, pas une erreur.
  '/cette-adresse-n-existe-pas/',
];

/* ------------------------------------------------------------- extraction --- */

/** Texte visible : scripts, styles et balises retirés, espaces normalisés. */
function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Balises qui ne rendent rien de visible et dont le nombre varie d'un build à
 * l'autre sans qu'aucun pixel ne bouge.
 *
 * `script` mérite un mot, parce que l'écarter pourrait passer pour une
 * commodité. Next.js termine chaque page par une série de balises
 * `<script>self.__next_f.push(…)</script>` qui transportent les données du
 * rendu serveur vers React. Leur **nombre dépend de la taille de ces données**,
 * donc du découpage du flux — rendre une liste depuis la base plutôt que
 * depuis un tableau figé en ajoute deux ou trois, à rendu rigoureusement
 * identique. Les compter reviendrait à déclarer une régression chaque fois
 * qu'une donnée change de source, c'est-à-dire précisément ce que la phase 4E
 * fait, et à rendre le contrôle inutile.
 *
 * Ce qu'ils transportent n'échappe pas au contrôle pour autant : c'est le
 * texte visible, que la signature `texte` compare intégralement.
 *
 * `link` et `meta` sont écartés pour la même raison : empreintes de fichiers
 * et ordre des préchargements changent à chaque build.
 */
const VOLATILE_TAGS = new Set(['script', 'link', 'meta']);

/**
 * Structure : suite des balises visibles avec leurs classes. `class` est
 * conservé, puisque c'est lui qui porte le design gelé.
 */
function structure(html) {
  const tags = html.match(/<[a-zA-Z][^>]*>/g) ?? [];
  return tags
    .flatMap((tag) => {
      const name = tag.match(/^<([a-zA-Z0-9-]+)/)?.[1]?.toLowerCase() ?? '';
      if (VOLATILE_TAGS.has(name)) return [];
      const className = tag.match(/\sclass="([^"]*)"/)?.[1] ?? '';
      return [className ? `${name}.${className}` : name];
    })
    .join('|');
}

/**
 * Le sitemap horodate chaque URL à l'instant du build. Comparer ces dates
 * ferait échouer le contrôle après n'importe quelle reconstruction, y compris
 * une reconstruction sans le moindre changement.
 */
function stripVolatileXml(xml) {
  return xml.replace(/<lastmod>[^<]*<\/lastmod>/g, '<lastmod/>');
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

/* ---------------------------------------------------------------- capture --- */

async function capture(base, route) {
  const response = await fetch(new URL(route, base), { redirect: 'follow' });
  const body = await response.text();

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0];
  const isHtml = contentType.includes('text/html');
  const stable = contentType.includes('xml') ? stripVolatileXml(body) : body;
  const text = isHtml ? visibleText(stable) : stable.trim();

  return {
    route,
    status: response.status,
    contentType,
    length: body.length,
    texte: digest(text),
    structure: isHtml ? digest(structure(body)) : digest(stable),
    // Conservé en clair : un écart doit pouvoir être lu, pas seulement constaté.
    extrait: text.slice(0, 400),
  };
}

async function runCapture(base, name) {
  log.step(`Capture « ${name} » — ${base}`);
  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const pages = [];
  for (const route of ROUTES) {
    const page = await capture(base, route);
    pages.push(page);
    log.skip(`${page.status} ${route}`);
  }

  const payload = { base, capturedAt: new Date().toISOString(), pages };
  writeFileSync(resolve(SNAPSHOT_DIR, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  log.ok(`${pages.length} routes enregistrées dans .snapshots/${name}.json`);
}

/* ------------------------------------------------------------ comparaison --- */

function load(name) {
  const file = resolve(SNAPSHOT_DIR, `${name}.json`);
  if (!existsSync(file)) throw new Error(`Capture introuvable : .snapshots/${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function runCompare(leftName, rightName) {
  log.step(`Comparaison « ${leftName} » → « ${rightName} »`);

  const left = load(leftName);
  const right = load(rightName);
  const rightByRoute = new Map(right.pages.map((page) => [page.route, page]));

  let differences = 0;

  for (const before of left.pages) {
    const after = rightByRoute.get(before.route);

    if (!after) {
      differences += 1;
      log.fail(`${before.route} — absente de la capture « ${rightName} »`);
      continue;
    }

    const ecarts = [];
    if (before.status !== after.status) ecarts.push(`HTTP ${before.status} → ${after.status}`);
    if (before.contentType !== after.contentType) {
      ecarts.push(`type ${before.contentType} → ${after.contentType}`);
    }
    if (before.texte !== after.texte) ecarts.push('contenu visible');
    if (before.structure !== after.structure) ecarts.push('structure du rendu');

    if (ecarts.length === 0) {
      log.ok(`${before.route} — identique`);
    } else {
      differences += 1;
      log.fail(`${before.route} — ${ecarts.join(', ')}`);
    }
  }

  if (differences === 0) {
    log.ok(`Aucun écart sur ${left.pages.length} routes.`);
    return 0;
  }

  log.fail(`${differences} route(s) présentent un écart.`);
  return 1;
}

/* ------------------------------------------------------------------- main --- */

async function main() {
  const compare = readFlag('compare');

  if (compare) {
    // `--compare avant apres` : le second nom suit immédiatement le premier.
    const argv = process.argv.slice(2);
    const other = argv[argv.indexOf('--compare') + 2];
    if (!other) throw new Error('Usage : --compare <avant> <apres>');
    process.exitCode = runCompare(compare, other);
    return;
  }

  const base = readFlag('base');
  const snapshot = readFlag('snapshot');

  if (!base || !snapshot) {
    throw new Error('Usage : --base <url> --snapshot <nom>  |  --compare <avant> <apres>');
  }

  await runCapture(base, snapshot);
}

main().catch((error) => {
  log.fail(error.message);
  process.exitCode = 1;
});
