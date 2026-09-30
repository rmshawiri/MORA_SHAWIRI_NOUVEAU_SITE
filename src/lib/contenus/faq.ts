import 'server-only';

/**
 * Lecture publique de la FAQ — base de données, avec repli statique.
 *
 * ## Pourquoi la FAQ ne suit pas le modèle des blocs de texte
 *
 * Les blocs (`src/lib/contenus/public.ts`) portent une valeur par clé, connue
 * du code : le repli y est total et gratuit. La FAQ, elle, est une
 * **collection** : le nombre de questions n'est pas connu du code, et c'est
 * précisément ce qui doit devenir administrable (§ 40-46). Le repli ne peut
 * donc pas être « la valeur de cette clé » ; il est « la FAQ d'avant la
 * phase », c'est-à-dire `src/content/faq.ts`.
 *
 * D'où la même prudence qu'en 4E-1 pour le catalogue, et pour la même raison :
 * un repli qui se déclenche aussi quand tout va bien n'est plus un repli, c'est
 * un gel. Les quatre situations du point 22 du cadrage sont donc distinguées.
 *
 *   * **configuration absente** — build sans secrets. Repli, sans bruit.
 *   * **panne technique** — la requête échoue. Repli, et trace serveur.
 *   * **base non initialisée** — aucune catégorie, pas même une. Ce n'est pas
 *     une FAQ vide, c'est une reprise non jouée. Repli, et trace serveur.
 *   * **FAQ volontairement vidée** — des catégories existent, rien n'est
 *     publié. État légitime : MORA Shawiri a retiré ses questions. Le vide est
 *     rendu tel quel. Masquer ce cas rendrait **impossible** de retirer une
 *     question du site, ce qui viderait la phase de son objet.
 *
 * La distinction est faite sur la présence de **catégories**, non de questions :
 * une catégorie survit à la dépublication de toutes ses questions, alors qu'une
 * base non migrée n'en a aucune.
 *
 * ## Les trois surfaces
 *
 * Le § 47 demande une « FAQ par page ». Le site sert trois jeux **distincts**,
 * et non un jeu unique découpé : les neuf catégories de `/faq/`, les quatre
 * questions de l'accueil, les cinq de `/services/`. `surface` les sépare en
 * base ; ce module les rend sous la forme que chaque page consomme déjà.
 */

import { faqCategories as staticFaqCategories, type FaqCategory } from '@/content/faq';
import { homeFaq as staticHomeFaq } from '@/content/home';
import { servicesFaq as staticServicesFaq } from '@/content/services';
import type { FaqItem } from '@/components/sections/Faq';
import { getPublicSupabaseClient } from '@/lib/supabase/public';

export type FaqSource = 'base' | 'statique';
export type FaqFallbackReason = 'configuration' | 'panne' | 'base-non-initialisee';

export type PublicFaq = {
  source: FaqSource;
  reason?: FaqFallbackReason;
  /** Les catégories de `/faq/`, dans l'ordre, avec leurs questions publiées. */
  categories: readonly FaqCategory[];
  /** Questions de l'accueil. */
  accueil: readonly FaqItem[];
  /** Questions de la page Services. */
  services: readonly FaqItem[];
  /** Toutes les questions de `/faq/` à plat — alimente les données structurées. */
  all: readonly FaqItem[];
};

function flatten(categories: readonly FaqCategory[]): FaqItem[] {
  return categories.flatMap((category) => category.items);
}

function staticFaq(reason: FaqFallbackReason): PublicFaq {
  return {
    source: 'statique',
    reason,
    categories: staticFaqCategories,
    accueil: staticHomeFaq,
    services: staticServicesFaq,
    all: flatten(staticFaqCategories),
  };
}

function reportFallback(reason: FaqFallbackReason, detail?: string) {
  if (reason === 'configuration') return;

  console.error(`[faq] Repli sur les données statiques — ${reason}${detail ? ` : ${detail}` : ''}`);
}

/**
 * FAQ publique : les questions publiées, dans leurs catégories actives.
 *
 * Deux requêtes, sans jointure imbriquée : le regroupement se fait en mémoire
 * sur quelques dizaines de lignes, ce qui évite le N+1 qu'une jointure
 * imbriquée invite. Même choix qu'en 4E-1 pour le catalogue.
 */
export async function getPublicFaq(): Promise<PublicFaq> {
  const supabase = getPublicSupabaseClient();

  if (!supabase) {
    reportFallback('configuration');
    return staticFaq('configuration');
  }

  try {
    const [categoriesResult, itemsResult] = await Promise.all([
      supabase
        .from('faq_categories')
        .select('id, slug, title, surface, sort_order')
        .order('sort_order', { ascending: true }),
      supabase
        .from('faq_items')
        .select('category_id, question, answer, sort_order')
        // RLS ne renvoie déjà que les questions publiées des catégories
        // actives. Le filtre est répété parce qu'une lecture publique ne doit
        // pas dépendre d'une seule barrière.
        .eq('status', 'PUBLIE')
        .order('sort_order', { ascending: true }),
    ]);

    if (categoriesResult.error) throw new Error(categoriesResult.error.message);
    if (itemsResult.error) throw new Error(itemsResult.error.message);

    const categories = categoriesResult.data ?? [];
    const items = itemsResult.data ?? [];

    // Aucune catégorie : la reprise n'a pas été jouée. Distinct d'une FAQ
    // vidée volontairement, qui conserverait ses catégories.
    if (categories.length === 0) {
      reportFallback('base-non-initialisee');
      return staticFaq('base-non-initialisee');
    }

    const itemsByCategory = new Map<string, FaqItem[]>();
    for (const item of items) {
      const bucket = itemsByCategory.get(item.category_id);
      const entry: FaqItem = { question: item.question, answer: item.answer };
      if (bucket) bucket.push(entry);
      else itemsByCategory.set(item.category_id, [entry]);
    }

    const bySurface = (surface: string): FaqCategory[] =>
      categories
        .filter((category) => category.surface === surface)
        .map((category) => ({
          id: category.slug,
          title: category.title,
          items: itemsByCategory.get(category.id) ?? [],
        }))
        // Une catégorie sans question publiée n'est pas affichée : son titre
        // seul, suivi du vide, ressemblerait à un défaut d'affichage.
        .filter((category) => category.items.length > 0);

    const pageCategories = bySurface('FAQ');

    return {
      source: 'base',
      categories: pageCategories,
      accueil: flatten(bySurface('ACCUEIL')),
      services: flatten(bySurface('SERVICES')),
      all: flatten(pageCategories),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'cause inconnue';
    reportFallback('panne', detail);
    return staticFaq('panne');
  }
}
