/**
 * Reprise des contenus : de `src/content/*` vers la base — phase 4E-2.
 *
 *   node --import tsx scripts/seed-contenus.mjs --env shared
 *   node --import tsx scripts/seed-contenus.mjs --env shared --check
 *   node --import tsx scripts/seed-contenus.mjs --env shared --force
 *
 * ## Pourquoi ce script importe les fichiers TypeScript
 *
 * Même raison qu'en 4E-1, et elle mérite d'être redite parce qu'elle est la
 * condition de toute la démonstration de non-régression : recopier 45 questions
 * et 128 blocs d'article à la main dans du SQL suffirait à introduire une
 * apostrophe droite là où le site affiche une apostrophe typographique, ou une
 * espace insécable perdue. La comparaison « avant / après » ne prouverait alors
 * plus rien — elle comparerait deux saisies.
 *
 * Le script importe donc les modules que le site lit déjà et recopie leurs
 * valeurs **sans les toucher**. La seule transformation est structurelle : des
 * tableaux imbriqués deviennent des lignes reliées.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il n'écrase rien par défaut. Une ligne déjà présente est laissée telle quelle
 * et les écarts sont signalés : le jour où une réponse aura été corrigée depuis
 * l'administration, relancer la reprise ne doit pas ramener l'ancien texte.
 * `--force` réaligne explicitement, `--check` compare sans rien écrire.
 *
 * ## Ce qu'il ne reprend pas, et pourquoi
 *
 * **Les blocs de texte** (`content_blocks`) ne sont pas semés, et ce n'est pas
 * un oubli : leur valeur par défaut *est* le registre `src/content/blocks.ts`.
 * Semer la base avec ces mêmes valeurs créerait 48 lignes qui ne changeraient
 * rien au rendu, mais qui feraient croire que la base est la source — et
 * l'écart entre les deux deviendrait invisible. La table ne se remplit donc que
 * de ce que MORA Shawiri modifie réellement.
 *
 * **Les pages légales** ne sont pas reprises : décision D-21 = A, elles restent
 * en code.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import { PROJECT_ROOT, describeTarget, hasFlag, log, resolveTarget } from './lib/config.mjs';

const { faqCategories } = await import('../src/content/faq.ts');
const { homeFaq } = await import('../src/content/home.ts');
const { servicesFaq } = await import('../src/content/services.ts');
const { posts } = await import('../src/content/posts.ts');
const { articleBodies } = await import('../src/content/article-bodies.ts');

/**
 * Auteur des quatre articles.
 *
 * Le point 9 du cadrage demande de gérer l'auteur. Aucune signature ne figure
 * dans `posts.ts` : les articles sont publiés au nom de la structure, ce qui est
 * l'état réel. Inventer un nom d'auteur individuel violerait le § 134. La
 * colonne porte donc la valeur qui correspond à ce qui est publié aujourd'hui.
 */
const AUTHOR = 'MORA Shawiri';

/* ------------------------------------------------------------ projections --- */

/**
 * Catégories de FAQ, les trois surfaces réunies.
 *
 * Les neuf catégories de `/faq/` gardent leur identifiant et leur titre. Les
 * FAQ de l'accueil et des services n'en avaient pas : elles reçoivent une
 * catégorie unique par surface, dont le titre n'est **jamais affiché** (le
 * rendu de ces deux pages ne montre pas de titre de catégorie). Le nommer
 * sobrement évite d'inventer un intitulé public.
 */
function faqCategoryRows() {
  const rows = faqCategories.map((category, index) => ({
    slug: category.id,
    title: category.title,
    surface: 'FAQ',
    sort_order: (index + 1) * 10,
    is_active: true,
  }));

  rows.push({
    slug: 'accueil',
    title: 'Questions de la page d’accueil',
    surface: 'ACCUEIL',
    sort_order: 10,
    is_active: true,
  });

  rows.push({
    slug: 'services',
    title: 'Questions de la page Services',
    surface: 'SERVICES',
    sort_order: 10,
    is_active: true,
  });

  return rows;
}

/** Questions, dans l'ordre exact où le site les affiche aujourd'hui. */
function faqItemRows(categoryIdByKey) {
  const rows = [];

  for (const category of faqCategories) {
    category.items.forEach((item, index) => {
      rows.push({
        category_id: categoryIdByKey.get(`FAQ:${category.id}`),
        question: item.question,
        answer: item.answer,
        sort_order: (index + 1) * 10,
        status: 'PUBLIE',
      });
    });
  }

  homeFaq.forEach((item, index) => {
    rows.push({
      category_id: categoryIdByKey.get('ACCUEIL:accueil'),
      question: item.question,
      answer: item.answer,
      sort_order: (index + 1) * 10,
      status: 'PUBLIE',
    });
  });

  servicesFaq.forEach((item, index) => {
    rows.push({
      category_id: categoryIdByKey.get('SERVICES:services'),
      question: item.question,
      answer: item.answer,
      sort_order: (index + 1) * 10,
      status: 'PUBLIE',
    });
  });

  return rows;
}

/** Articles, corps compris. */
function postRows() {
  return posts.map((post, index) => ({
    slug: post.slug,
    category: post.category,
    title: post.title,
    lead: post.lead,
    excerpt: post.excerpt,
    author: AUTHOR,
    published_on: post.date,
    date_label: post.dateLabel,
    reading_time: post.readingTime,
    cover_path: post.cover.src,
    cover_width: post.cover.width,
    cover_height: post.cover.height,
    cta_title: post.cta.title,
    cta_text: post.cta.text,
    cta_label: post.cta.label,
    cta_href: post.cta.href,
    related: [...post.related],
    body: articleBodies[post.slug] ?? [],
    // Le résumé sert déjà de `description` dans les métadonnées de la page :
    // `seo_description` reste vide pour que le comportement actuel demeure la
    // valeur par défaut, et que le champ existe pour être renseigné plus tard.
    seo_title: null,
    seo_description: null,
    sort_order: (index + 1) * 10,
    status: 'PUBLIE',
  }));
}

/* ------------------------------------------------------------ médiathèque --- */

const IMAGES_DIR = resolve(PROJECT_ROOT, 'public', 'images');

const MIME_BY_EXTENSION = {
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/**
 * Dimensions réelles d'une image, lues dans son en-tête.
 *
 * Écrit à la main plutôt qu'ajouté en dépendance : deux formats suffisent ici
 * (WebP et PNG), et le § 29 demande de connaître les dimensions. Renvoyer
 * `null` en cas de format non reconnu est préférable à une valeur supposée —
 * le § 134 interdit d'inventer une donnée, y compris technique.
 */
function imageSize(buffer) {
  // PNG : signature 8 octets, puis IHDR (largeur et hauteur en gros-boutien).
  if (buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // WebP : conteneur RIFF, trois variantes de bloc.
  if (
    buffer.length > 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = buffer.toString('ascii', 12, 16);

    if (chunk === 'VP8X') {
      // Canevas sur 24 bits, moins un, en petit-boutien.
      return {
        width: (buffer.readUIntLE(24, 3) & 0xffffff) + 1,
        height: (buffer.readUIntLE(27, 3) & 0xffffff) + 1,
      };
    }

    if (chunk === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }

    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }

  return { width: null, height: null };
}

/**
 * Classement d'un visuel, déduit de son nom de fichier.
 *
 * Le § 34 demande une catégorisation. Elle est **lue** dans la convention de
 * nommage réellement en place (`offre-`, `blog-`, `section-`, `formation-`,
 * `hero-`) plutôt que décidée : c'est un constat, pas une invention. Un fichier
 * hors convention reste sans catégorie plutôt que d'être rangé de force.
 */
function mediaCategory(name) {
  if (name.startsWith('offre-')) return 'Offres';
  if (name.startsWith('blog-')) return 'Blog';
  if (name.startsWith('section-')) return 'Sections';
  if (name.startsWith('formation-')) return 'Formation';
  if (name.startsWith('hero-')) return 'Bandeaux';
  if (name.startsWith('fondateur')) return 'Portraits';
  return null;
}

/**
 * Inventaire des visuels servis localement (décision D-22 = A).
 *
 * Les fichiers ne sont **pas déplacés** : leur adresse publique reste
 * `/images/…`, servie par Next.js comme avant. L'inventaire existe pour qu'ils
 * soient nommés, décrits et référençables depuis l'administration.
 *
 * `title` porte le nom du fichier, et `alt_text` reste vide. Ce n'est pas une
 * paresse : les pages calculent déjà leur texte alternatif, et en écrire un ici
 * **changerait le rendu actuel** sans que personne l'ait demandé. C'est le même
 * raisonnement qu'en 4E-1 pour `image_alt` des offres.
 */
function mediaRows() {
  return readdirSync(IMAGES_DIR)
    .filter((name) => MIME_BY_EXTENSION[extname(name).toLowerCase()])
    .sort()
    .map((name) => {
      const absolute = resolve(IMAGES_DIR, name);
      const { width, height } = imageSize(readFileSync(absolute));

      return {
        kind: 'LOCAL',
        bucket: null,
        path: `/images/${name}`,
        title: name,
        alt_text: null,
        description: null,
        category: mediaCategory(name),
        mime_type: MIME_BY_EXTENSION[extname(name).toLowerCase()],
        byte_size: statSync(absolute).size,
        width,
        height,
        is_decorative: false,
      };
    });
}

/* ----------------------------------------------------------- comparaison --- */

const FAQ_ITEM_COMPARED = ['category_id', 'question', 'answer', 'sort_order', 'status'];

const MEDIA_COMPARED = ['bucket', 'mime_type', 'byte_size', 'width', 'height'];

const POST_COMPARED = [
  'category', 'title', 'lead', 'excerpt', 'author', 'published_on', 'date_label',
  'reading_time', 'cover_path', 'cover_width', 'cover_height', 'cta_title', 'cta_text',
  'cta_label', 'cta_href', 'related', 'body', 'sort_order', 'status',
];

/**
 * Représentation canonique d'une valeur JSON, clés triées en profondeur.
 *
 * Indispensable pour `body`, et la raison en vaut d'être notée : Postgres
 * **réordonne** les clés d'un `jsonb` (par longueur, puis par octets). Un bloc
 * écrit `{"type":"h2","text":"…"}` revient donc `{"text":"…","type":"h2"}`.
 * Comparer les deux chaînes telles quelles signalerait un écart sur les quatre
 * articles à chaque contrôle — et `--force` réécrirait une donnée identique,
 * en polluant le journal d'audit à chaque passage.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = canonical(value[key]);
        return accumulator;
      }, {});
  }
  return value;
}

function normalise(value) {
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
    return JSON.stringify(canonical(value));
  }
  if (typeof value === 'number') return String(value);
  return value === null || value === undefined ? null : String(value);
}

function differences(columns, expected, actual) {
  return columns.filter((column) => normalise(expected[column]) !== normalise(actual[column]));
}

/* ------------------------------------------------------------------ main --- */

async function main() {
  const target = resolveTarget();
  const force = hasFlag('force');
  const checkOnly = hasFlag('check');

  log.step(
    `Reprise des contenus — ${describeTarget(target)}` +
      `${checkOnly ? ' (contrôle seul)' : ''}${force ? ' (réalignement forcé)' : ''}`,
  );

  const supabase = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /* ------------------------------------------------ catégories de FAQ --- */

  const categories = faqCategoryRows();
  const categoryIdByKey = new Map();

  for (const category of categories) {
    const key = `${category.surface}:${category.slug}`;

    const { data: existing, error: readError } = await supabase
      .from('faq_categories')
      .select('id, title, sort_order, is_active')
      .eq('surface', category.surface)
      .eq('slug', category.slug)
      .maybeSingle();

    if (readError) throw new Error(`Lecture de la catégorie ${key} : ${readError.message}`);

    if (existing) {
      categoryIdByKey.set(key, existing.id);
      log.skip(`catégorie ${key} — déjà présente`);
      continue;
    }

    if (checkOnly) {
      log.warn(`catégorie ${key} — absente`);
      continue;
    }

    const { data: created, error } = await supabase
      .from('faq_categories')
      .insert(category)
      .select('id')
      .single();

    if (error) throw new Error(`Création de la catégorie ${key} : ${error.message}`);

    categoryIdByKey.set(key, created.id);
    log.ok(`catégorie ${key} — créée`);
  }

  if (checkOnly && categoryIdByKey.size < categories.length) {
    log.warn('Catégories incomplètes : le contrôle des questions est ignoré.');
  }

  /* ----------------------------------------------------------- questions --- */

  let faqCreated = 0;
  let faqAligned = 0;
  let faqDrifted = 0;

  if (categoryIdByKey.size === categories.length) {
    for (const item of faqItemRows(categoryIdByKey)) {
      // La question fait office de clé naturelle : la table n'a pas de slug,
      // et deux questions identiques dans une même catégorie n'auraient aucun
      // sens éditorial.
      const { data: existing, error: readError } = await supabase
        .from('faq_items')
        .select('*')
        .eq('category_id', item.category_id)
        .eq('question', item.question)
        .maybeSingle();

      if (readError) throw new Error(`Lecture d'une question : ${readError.message}`);

      if (!existing) {
        if (checkOnly) {
          log.warn(`question absente — ${item.question.slice(0, 60)}`);
          continue;
        }

        const { error } = await supabase.from('faq_items').insert(item);
        if (error) throw new Error(`Création d'une question : ${error.message}`);

        faqCreated += 1;
        continue;
      }

      const ecarts = differences(FAQ_ITEM_COMPARED, item, existing);

      if (ecarts.length === 0) continue;

      faqDrifted += 1;

      if (!force) {
        log.warn(`question modifiée en base (${ecarts.join(', ')}) — ${item.question.slice(0, 50)}`);
        continue;
      }

      if (checkOnly) continue;

      const { error } = await supabase.from('faq_items').update(item).eq('id', existing.id);
      if (error) throw new Error(`Réalignement d'une question : ${error.message}`);

      faqAligned += 1;
    }

    log.ok(
      `questions — ${faqCreated} reprise(s), ${faqAligned} réalignée(s), ${faqDrifted} écart(s) constaté(s)`,
    );
  }

  /* ------------------------------------------------------------ articles --- */

  let postCreated = 0;
  let postAligned = 0;
  let postDrifted = 0;

  for (const post of postRows()) {
    const { data: existing, error: readError } = await supabase
      .from('content_posts')
      .select('*')
      .eq('slug', post.slug)
      .maybeSingle();

    if (readError) throw new Error(`Lecture de l'article ${post.slug} : ${readError.message}`);

    if (!existing) {
      if (checkOnly) {
        log.warn(`${post.slug} — absent de la base`);
        continue;
      }

      const { error } = await supabase.from('content_posts').insert(post);
      if (error) throw new Error(`Création de l'article ${post.slug} : ${error.message}`);

      postCreated += 1;
      log.ok(`${post.slug} — repris`);
      continue;
    }

    const ecarts = differences(POST_COMPARED, post, existing);

    if (ecarts.length === 0) {
      log.skip(`${post.slug} — conforme`);
      continue;
    }

    postDrifted += 1;

    if (!force) {
      log.warn(`${post.slug} — modifié en base (${ecarts.join(', ')}), laissé tel quel`);
      continue;
    }

    if (checkOnly) continue;

    const { error } = await supabase.from('content_posts').update(post).eq('id', existing.id);
    if (error) throw new Error(`Réalignement de l'article ${post.slug} : ${error.message}`);

    postAligned += 1;
    log.ok(`${post.slug} — réaligné`);
  }

  /* --------------------------------------------------------- médiathèque --- */

  let mediaCreated = 0;
  let mediaDrifted = 0;

  for (const media of mediaRows()) {
    const { data: existing, error: readError } = await supabase
      .from('media_assets')
      .select('*')
      .eq('kind', 'LOCAL')
      .eq('path', media.path)
      .maybeSingle();

    if (readError) throw new Error(`Lecture du média ${media.path} : ${readError.message}`);

    if (!existing) {
      if (checkOnly) {
        log.warn(`${media.path} — absent de l'inventaire`);
        continue;
      }

      const { error } = await supabase.from('media_assets').insert(media);
      if (error) throw new Error(`Inventaire de ${media.path} : ${error.message}`);

      mediaCreated += 1;
      continue;
    }

    // `title`, `alt_text`, `description` et `category` sont volontairement hors
    // comparaison : ils appartiennent à MORA Shawiri dès qu'ils ont été
    // renseignés en administration. Seules les données **techniques** du
    // fichier sont contrôlées, puisqu'elles décrivent le fichier réel.
    const ecarts = differences(MEDIA_COMPARED, media, existing);

    if (ecarts.length === 0) continue;

    mediaDrifted += 1;

    if (!force) {
      log.warn(`${media.path} — écart technique (${ecarts.join(', ')})`);
      continue;
    }

    if (checkOnly) continue;

    const { error } = await supabase
      .from('media_assets')
      .update({
        mime_type: media.mime_type,
        byte_size: media.byte_size,
        width: media.width,
        height: media.height,
      })
      .eq('id', existing.id);

    if (error) throw new Error(`Réalignement de ${media.path} : ${error.message}`);
  }

  log.ok(`médias — ${mediaCreated} inventorié(s), ${mediaDrifted} écart(s) technique(s)`);

  log.step(
    `Terminé — questions : ${faqCreated} reprises · articles : ${postCreated} repris, ` +
      `${postAligned} réalignés, ${postDrifted} écart(s) · médias : ${mediaCreated} inventoriés`,
  );
}

await main();
