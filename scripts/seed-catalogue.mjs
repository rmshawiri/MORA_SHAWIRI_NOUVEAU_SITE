/**
 * Reprise du catalogue : de `src/content/offers.ts` vers la base.
 *
 *   node --import tsx scripts/seed-catalogue.mjs --env shared
 *   node --import tsx scripts/seed-catalogue.mjs --env shared --force
 *   node --import tsx scripts/seed-catalogue.mjs --env shared --check
 *
 * ## Pourquoi ce script lit le fichier TypeScript
 *
 * La consigne de la phase 4E est sans ambiguïté : « Lorsqu'une donnée validée
 * existe déjà dans le site actuel, ne l'invente pas et ne la réécris pas
 * arbitrairement. » Recopier les quatorze offres à la main dans un fichier SQL
 * aurait suffi à introduire une apostrophe différente, un espace insécable
 * perdu ou un prix mal retranscrit — et la comparaison de non-régression
 * n'aurait plus rien prouvé, puisqu'elle aurait comparé deux saisies.
 *
 * Le script importe donc `offers.ts`, le module que la Boutique lit
 * aujourd'hui, et recopie ses valeurs sans les retoucher. La seule
 * transformation est structurelle : un tableau d'objets devient des lignes
 * reliées à des catégories.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il n'écrase rien par défaut. Une offre déjà présente en base est laissée
 * telle quelle et les écarts sont signalés : le jour où MORA Shawiri aura
 * corrigé un prix depuis l'administration, relancer la reprise ne doit pas
 * ramener l'ancienne valeur. `--force` réaligne explicitement, `--check` se
 * contente de comparer sans rien écrire.
 */

import { createClient } from '@supabase/supabase-js';

import { describeTarget, hasFlag, log, resolveTarget } from './lib/config.mjs';

const { offerGroups, offers } = await import('../src/content/offers.ts');

/**
 * Les trois offres mises en avant sur la page d'accueil, dans leur ordre
 * d'affichage actuel. La liste est celle de `featuredOfferIds` ; elle est
 * redite ici parce que le module ne l'exporte pas.
 */
const FEATURED = ['site-vitrine', 'logo', 'audit'];

/**
 * Mode commercial des quatorze offres : toutes passent aujourd'hui par une
 * demande (formulaire de contact contextualisé, ou page dédiée pour la
 * formation). Aucune n'est achetable en ligne — le commerce est la phase 4G.
 * `quote` décrit donc l'état réel, et non une intention.
 */
const COMMERCIAL_MODE = 'quote';

/* ------------------------------------------------------------ projection --- */

function categoryRows() {
  return offerGroups.map((group, index) => ({
    slug: group.id,
    name: group.title,
    kind: 'SERVICE',
    sort_order: (index + 1) * 10,
    is_active: true,
  }));
}

function serviceRows(categoryIdBySlug) {
  return offers
    .filter((offer) => offer.family === 'service')
    .map((offer, index) => {
      const featuredIndex = FEATURED.indexOf(offer.id);

      return {
        slug: offer.id,
        category_id: categoryIdBySlug.get(offer.group),
        title: offer.title,
        tag: offer.tag,
        featured_tag: offer.featuredTag ?? null,
        short_description: offer.shortDescription,
        description: offer.description,
        benefits: [...offer.benefits],
        price_label: offer.price,
        price_note: offer.priceNote,
        price_amount: offer.priceAmount ?? null,
        currency: 'KMF',
        image_path: offer.image,
        // Le texte alternatif reste calculé par la carte
        // (« <titre> — MORA Shawiri ») : le stocker ici changerait le rendu
        // actuel sans qu'on l'ait demandé. Le champ existe pour le jour où un
        // administrateur voudra l'écrire lui-même.
        image_alt: null,
        cta_label: offer.ctaLabel,
        request_subject: offer.requestSubject,
        internal_href: offer.href ?? null,
        commercial_mode: COMMERCIAL_MODE,
        status: 'PUBLIE',
        // La page Services présente six pôles d'expertise, pas les offres :
        // aucune des quatorze n'y figure aujourd'hui.
        show_in_services: false,
        show_in_shop: true,
        is_featured: featuredIndex !== -1,
        featured_order: featuredIndex === -1 ? null : (featuredIndex + 1) * 10,
        // L'ordre du tableau source est celui qu'affiche la Boutique.
        sort_order: (index + 1) * 10,
        // Décision D-11 non tranchée : aucune offre n'est déclarée éligible et
        // aucun plafond n'est inventé.
        affiliate_eligible: false,
        affiliate_max_rate: null,
      };
    });
}

/* ----------------------------------------------------------- comparaison --- */

/** Colonnes que la reprise possède ; les autres appartiennent à la base. */
const COMPARED = [
  'category_id', 'title', 'tag', 'featured_tag', 'short_description', 'description',
  'benefits', 'price_label', 'price_note', 'price_amount', 'currency', 'image_path',
  'cta_label', 'request_subject', 'internal_href', 'commercial_mode', 'status',
  'show_in_services', 'show_in_shop', 'is_featured', 'featured_order', 'sort_order',
  'affiliate_eligible', 'affiliate_max_rate',
];

function normalise(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  // `numeric` revient en chaîne depuis PostgREST : « 15000.00 » doit être
  // reconnu égal à 15000.
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return String(Number(value));
  if (typeof value === 'number') return String(value);
  return value === null || value === undefined ? null : String(value);
}

function differences(expected, actual) {
  return COMPARED.filter((column) => normalise(expected[column]) !== normalise(actual[column]));
}

/* ------------------------------------------------------------------ main --- */

async function main() {
  const target = resolveTarget();
  const force = hasFlag('force');
  const checkOnly = hasFlag('check');

  log.step(
    `Reprise du catalogue — ${describeTarget(target)}` +
      `${checkOnly ? ' (contrôle seul)' : ''}${force ? ' (réalignement forcé)' : ''}`,
  );

  const supabase = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /* --- catégories --- */

  const categories = categoryRows();
  const categoryIdBySlug = new Map();

  for (const category of categories) {
    const { data: existing, error: readError } = await supabase
      .from('categories')
      .select('id, name, kind, sort_order, is_active')
      .eq('slug', category.slug)
      .maybeSingle();

    if (readError) throw new Error(`Lecture de la catégorie ${category.slug} : ${readError.message}`);

    if (existing) {
      categoryIdBySlug.set(category.slug, existing.id);
      log.skip(`catégorie ${category.slug} — déjà présente`);
      continue;
    }

    if (checkOnly) {
      log.warn(`catégorie ${category.slug} — absente`);
      continue;
    }

    const { data: created, error } = await supabase
      .from('categories')
      .insert(category)
      .select('id')
      .single();

    if (error) throw new Error(`Création de la catégorie ${category.slug} : ${error.message}`);

    categoryIdBySlug.set(category.slug, created.id);
    log.ok(`catégorie ${category.slug} — créée`);
  }

  if (checkOnly && categoryIdBySlug.size < categories.length) {
    log.warn('Catégories incomplètes : le contrôle des services est ignoré.');
    return;
  }

  /* --- services --- */

  const services = serviceRows(categoryIdBySlug);
  let created = 0;
  let aligned = 0;
  let drifted = 0;

  for (const service of services) {
    const { data: existing, error: readError } = await supabase
      .from('services')
      .select('*')
      .eq('slug', service.slug)
      .maybeSingle();

    if (readError) throw new Error(`Lecture du service ${service.slug} : ${readError.message}`);

    if (!existing) {
      if (checkOnly) {
        log.warn(`${service.slug} — absent de la base`);
        continue;
      }

      const { error } = await supabase.from('services').insert(service);
      if (error) throw new Error(`Création du service ${service.slug} : ${error.message}`);

      created += 1;
      log.ok(`${service.slug} — repris`);
      continue;
    }

    const ecarts = differences(service, existing);

    if (ecarts.length === 0) {
      log.skip(`${service.slug} — conforme`);
      continue;
    }

    drifted += 1;

    if (!force) {
      log.warn(`${service.slug} — écart sur : ${ecarts.join(', ')} (conservé tel quel)`);
      continue;
    }

    const { error } = await supabase.from('services').update(service).eq('slug', service.slug);
    if (error) throw new Error(`Réalignement du service ${service.slug} : ${error.message}`);

    aligned += 1;
    log.ok(`${service.slug} — réaligné sur le fichier source`);
  }

  log.step(
    `${services.length} offres attendues · ${created} reprise(s) · ` +
      `${aligned} réalignée(s) · ${drifted} écart(s) constaté(s)`,
  );

  if (drifted > 0 && !force) {
    log.warn('Des écarts subsistent. Relancez avec --force pour réaligner sur le fichier source.');
  }
}

main().catch((error) => {
  log.fail(error.message);
  process.exitCode = 1;
});
