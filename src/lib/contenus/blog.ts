import 'server-only';

/**
 * Lecture publique du blog — base de données, avec repli statique.
 *
 * ## Le périmètre, et d'où il vient
 *
 * Le module `07_GESTION_CONTENUS.md` ne mentionne **jamais** le blog : zéro
 * occurrence dans ses 2 894 lignes. Ce volet est donc traité sur l'autorité du
 * plan de développement (« reprise des données de `src/content/*.ts` vers la
 * base ») et du point 9 du cadrage, qui en fixe précisément le contenu :
 * articles, statut, publication, slug, auteur, dates, contenu, SEO, médias.
 * Rien de plus n'est construit — ni commentaires, ni catégories administrables,
 * ni étiquettes.
 *
 * ## Pourquoi la forme `Post` est conservée
 *
 * `PostCard`, le fil et la page d'article consomment le type `Post` depuis le
 * début. La phase change la **source** de la donnée, pas son rendu : projeter
 * les lignes vers le type existant est ce qui rend l'égalité vérifiable par la
 * comparaison de HTML. C'est le même choix qu'en 4E-1 pour `Offer`.
 *
 * ## Le corps des articles, et la sécurité
 *
 * `body` est stocké en `jsonb`, au format déjà utilisé par
 * `src/content/article-bodies.ts` : une suite de blocs typés. Il est **validé à
 * la lecture** (`validateArticleBody`), et un corps invalide fait retomber
 * l'article sur celui du code plutôt que de rendre une page cassée.
 *
 * Aucune balise n'est jamais interprétée : `ArticleBody.tsx` construit `<h2>`,
 * `<p>`, `<ul>` et `<strong>` à partir de types connus, sans jamais appeler
 * `dangerouslySetInnerHTML`. **La surface XSS est donc nulle par construction,
 * et non par filtrage** — il n'y a pas d'assainisseur à maintenir, parce qu'il
 * n'y a rien à assainir.
 *
 * ## Les quatre situations de repli
 *
 * Identiques à celles du catalogue (4E-1) et de la FAQ, avec la même
 * distinction essentielle : une base **sans aucun article** est une reprise non
 * jouée, tandis qu'une base où **rien n'est publié** est un état légitime. Si
 * le repli se déclenchait aussi dans le second cas, dépublier un article
 * deviendrait impossible.
 */

import type { ArticleBlock } from '@/content/article-bodies';
import { articleBodies } from '@/content/article-bodies';
import { getPost as getStaticPost, posts as staticPosts, type Post } from '@/content/posts';
import { getPublicSupabaseClient } from '@/lib/supabase/public';
import { validateArticleBody } from '@/lib/contenus/validation';
import type { ContentPostRow } from '@/lib/supabase/types';

export type BlogSource = 'base' | 'statique';
export type BlogFallbackReason = 'configuration' | 'panne' | 'base-non-initialisee';

export type PublicBlog = {
  source: BlogSource;
  reason?: BlogFallbackReason;
  posts: readonly Post[];
};

/** Colonnes réellement lues : déclarer la ligne entière laisserait croire que
 *  la requête ramène des colonnes qu'elle ne demande pas. */
type PublicPostRow = Pick<
  ContentPostRow,
  | 'slug'
  | 'category'
  | 'title'
  | 'lead'
  | 'excerpt'
  | 'published_on'
  | 'date_label'
  | 'reading_time'
  | 'cover_path'
  | 'cover_width'
  | 'cover_height'
  | 'cta_title'
  | 'cta_text'
  | 'cta_label'
  | 'cta_href'
  | 'related'
  | 'sort_order'
>;

/* --------------------------------------------------------------- projection --- */

/**
 * Projette une ligne vers le type `Post`.
 *
 * Renvoie `null` si une valeur indispensable au rendu manque. La contrainte
 * `content_posts_publiable` l'interdit déjà en base, mais une garantie de
 * schéma et une garantie de type ne protègent pas de la même erreur : la
 * première tient pour les écritures futures, la seconde tient si la contrainte
 * venait à être assouplie.
 */
function toPost(row: PublicPostRow): Post | null {
  if (!row.cover_path || row.cover_width === null || row.cover_height === null) return null;
  if (!row.published_on || !row.date_label || !row.reading_time) return null;
  if (!row.cta_title || !row.cta_text || !row.cta_label || !row.cta_href) return null;

  return {
    slug: row.slug,
    category: row.category,
    title: row.title,
    lead: row.lead,
    excerpt: row.excerpt,
    date: row.published_on,
    dateLabel: row.date_label,
    readingTime: row.reading_time,
    cover: { src: row.cover_path, width: row.cover_width, height: row.cover_height },
    cta: {
      title: row.cta_title,
      text: row.cta_text,
      label: row.cta_label,
      href: row.cta_href,
    },
    related: row.related,
  };
}

const PUBLIC_COLUMNS =
  'slug, category, title, lead, excerpt, published_on, date_label, reading_time, cover_path, cover_width, cover_height, cta_title, cta_text, cta_label, cta_href, related, sort_order';

/* -------------------------------------------------------------------- repli --- */

function staticBlog(reason: BlogFallbackReason): PublicBlog {
  return { source: 'statique', reason, posts: staticPosts };
}

function reportFallback(reason: BlogFallbackReason, detail?: string) {
  if (reason === 'configuration') return;

  console.error(
    `[blog] Repli sur les données statiques — ${reason}${detail ? ` : ${detail}` : ''}`,
  );
}

/* ------------------------------------------------------------------ lecture --- */

/**
 * Le fil du blog : les articles publiés, du plus récent au plus ancien.
 *
 * L'ordre reprend celui du fichier source — `sort_order` croissant — et non la
 * date, afin que le fil reste rigoureusement identique à celui d'avant la
 * phase. La date sert de second critère pour un article ajouté plus tard.
 */
export async function getPublicBlog(): Promise<PublicBlog> {
  const supabase = getPublicSupabaseClient();

  if (!supabase) {
    reportFallback('configuration');
    return staticBlog('configuration');
  }

  try {
    const { data, error } = await supabase
      .from('content_posts')
      .select(PUBLIC_COLUMNS)
      // RLS ne renvoie déjà que les articles publiés au rôle anonyme. Le filtre
      // est répété parce qu'une lecture publique ne doit pas dépendre d'une
      // seule barrière.
      .eq('status', 'PUBLIE')
      .order('sort_order', { ascending: true });

    if (error) throw new Error(error.message);

    const rows: PublicPostRow[] = data ?? [];

    // Aucun article publié. Une limite doit être énoncée franchement ici : la
    // FAQ distingue « base non migrée » de « FAQ vidée » grâce aux catégories,
    // qui survivent à la dépublication de leurs questions. Le blog n'a pas
    // d'équivalent — et une session anonyme, soumise à RLS, ne voit de toute
    // façon **que** les articles publiés. Compter les lignes ne renseignerait
    // donc pas : le décompte vaudrait zéro dans les deux cas.
    //
    // Conséquence assumée : dépublier **un** article fonctionne (il disparaît
    // du fil), mais dépublier **les quatre** fait revenir ceux du code au lieu
    // de vider le fil. Le compromis est retenu dans ce sens parce qu'un fil
    // vide sous un titre « Derniers articles » ressemble à une panne, et que
    // vider entièrement le blog n'a été demandé par aucun document.
    if (rows.length === 0) {
      reportFallback('base-non-initialisee');
      return staticBlog('base-non-initialisee');
    }

    const posts = rows.flatMap((row) => {
      const post = toPost(row);
      if (!post) {
        console.error(`[blog] Article « ${row.slug} » écarté : champs de rendu incomplets.`);
        return [];
      }
      return [post];
    });

    return { source: 'base', posts };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'cause inconnue';
    reportFallback('panne', detail);
    return staticBlog('panne');
  }
}

/* ------------------------------------------------------------ un article --- */

export type PublicArticle = {
  post: Post;
  body: readonly ArticleBlock[];
  source: BlogSource;
};

/**
 * Un article publié, corps compris — ou `null` s'il n'existe pas.
 *
 * `null` est important : c'est ce qui produit le 404. Le point 14 du cadrage
 * l'exige — « un contenu non publié ne doit jamais devenir public simplement
 * parce que son slug est connu ». Ici, ce n'est pas un masquage : RLS ne renvoie
 * pas la ligne, donc l'article **n'existe pas** pour cette session.
 *
 * En cas de panne, le repli rend l'article du code : une indisponibilité de la
 * base ne doit pas transformer quatre pages indexées en 404.
 */
export async function getPublicArticle(slug: string): Promise<PublicArticle | null> {
  const supabase = getPublicSupabaseClient();

  const fromCode = (): PublicArticle | null => {
    const post = getStaticPost(slug);
    if (!post) return null;
    return { post, body: articleBodies[slug] ?? [], source: 'statique' };
  };

  if (!supabase) return fromCode();

  try {
    const { data, error } = await supabase
      .from('content_posts')
      .select(`${PUBLIC_COLUMNS}, body`)
      .eq('status', 'PUBLIE')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new Error(error.message);

    // La base a répondu et ne connaît pas cet article publié : c'est un 404
    // légitime, pas une panne. Replier ici republierait un article dépublié.
    if (!data) return null;

    const post = toPost(data);
    if (!post) {
      console.error(`[blog] Article « ${slug} » écarté : champs de rendu incomplets.`);
      return fromCode();
    }

    const body = validateArticleBody(data.body);
    if (body === null) {
      console.error(`[blog] Corps de « ${slug} » invalide : le contenu du code est rendu.`);
      return { post, body: articleBodies[slug] ?? [], source: 'base' };
    }

    return { post, body: body as readonly ArticleBlock[], source: 'base' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'cause inconnue';
    reportFallback('panne', detail);
    return fromCode();
  }
}

/**
 * Articles suggérés en fin de lecture.
 *
 * Reprend exactement l'algorithme de `src/content/posts.ts` : la sélection
 * éditoriale d'abord, complétée par les autres articles si un identifiant est
 * devenu obsolète. Le dupliquer serait une faute ; il est donc appliqué ici à
 * la liste issue de la base, et le comportement reste celui d'avant la phase.
 */
export function relatedFrom(
  posts: readonly Post[],
  slug: string,
  count = 2,
): readonly Post[] {
  const current = posts.find((post) => post.slug === slug);

  const picked = (current?.related ?? []).flatMap((relatedSlug) => {
    const post = posts.find((candidate) => candidate.slug === relatedSlug);
    return post ? [post] : [];
  });

  const fallback = posts.filter(
    (item) => item.slug !== slug && !picked.some((p) => p.slug === item.slug),
  );

  return [...picked, ...fallback].slice(0, count);
}
