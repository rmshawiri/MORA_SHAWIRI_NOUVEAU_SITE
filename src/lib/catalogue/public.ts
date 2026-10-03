import 'server-only';

/**
 * Lecture publique du catalogue — base de données, avec repli statique.
 *
 * ## Le contrat que ce module doit tenir
 *
 * Avant la phase 4E, la Boutique lisait `src/content/offers.ts`, un tableau
 * figé au build : indisponible jamais, incorrect jamais. En le remplaçant par
 * une lecture réseau, on introduit deux échecs qui n'existaient pas — la base
 * peut être injoignable, et elle peut répondre vide. Le point 18 du cadrage de
 * la phase l'énonce : « Une indisponibilité temporaire de Supabase ne doit pas
 * transformer inutilement une page publique valide en page cassée. »
 *
 * D'où ce module, et d'où sa forme : il renvoie **toujours** un catalogue
 * exploitable, et dit d'où il vient.
 *
 * ## Quatre situations, quatre traitements
 *
 * Le point 18 demande expressément de ne pas les confondre :
 *
 *   * **configuration absente** — pas d'URL Supabase. C'est le cas d'un build
 *     sans secrets. Repli statique, sans bruit : ce n'est pas une panne.
 *   * **panne technique** — la requête échoue. Repli statique, et trace
 *     serveur : quelqu'un doit le savoir, mais pas le visiteur.
 *   * **base non initialisée** — la requête réussit et ne renvoie rien du tout,
 *     pas même une catégorie. Une base vide n'est pas un catalogue vide, c'est
 *     une migration non jouée. Repli statique, et trace serveur.
 *   * **catalogue réellement vide** — des catégories existent, aucune offre
 *     n'est publiée. C'est un état légitime : MORA Shawiri a tout dépublié.
 *     Le vide est alors renvoyé tel quel, sans repli. Masquer ce cas
 *     empêcherait pour toujours de retirer une offre du site.
 *
 * La quatrième situation est la raison d'être des trois autres : un repli qui
 * se déclenche aussi quand tout va bien n'est plus un repli, c'est un gel.
 *
 * ## Pourquoi la forme `Offer` est conservée
 *
 * `OfferCard`, la page d'accueil et la Boutique consomment le type `Offer`
 * depuis le début. La phase 4E change la **source** de la donnée, pas son
 * rendu : le point 11 du cadrage gèle le design, et le point 17 exige un HTML
 * identique. Projeter les lignes de la base vers le type existant est ce qui
 * rend cette égalité vérifiable — et non un raccourci.
 */

import {
  offerGroups as staticGroups,
  offers as staticOffers,
  type Offer,
  type OfferGroupId,
} from '@/content/offers';
import { getPublicSupabaseClient } from '@/lib/supabase/public';
import type { CategoryRow, ServiceRow } from '@/lib/supabase/types';

/** D'où vient le catalogue effectivement rendu. */
export type CatalogueSource = 'base' | 'statique';

/** Pourquoi le repli statique s'est déclenché, lorsqu'il l'a été. */
export type FallbackReason = 'configuration' | 'panne' | 'base-non-initialisee';

export type CatalogueGroup = {
  id: OfferGroupId;
  title: string;
  items: readonly Offer[];
};

export type PublicCatalogue = {
  source: CatalogueSource;
  reason?: FallbackReason;
  offers: readonly Offer[];
  groups: readonly CatalogueGroup[];
  featured: readonly Offer[];
};

/**
 * Identifiants des offres mises en avant sur l'accueil, dans le repli
 * statique. La base porte l'information dans `is_featured` / `featured_order` ;
 * cette liste ne sert que lorsque la base n'a pas répondu.
 */
const STATIC_FEATURED_IDS = ['site-vitrine', 'logo', 'audit'] as const;

/* --------------------------------------------------------------- projection --- */

/**
 * Colonnes réellement lues pour le rendu public. Le type est restreint
 * volontairement : déclarer `ServiceRow` entier laisserait croire que la
 * requête ramène des colonnes qu'elle ne demande pas.
 */
type PublicServiceRow = Pick<
  ServiceRow,
  | 'slug'
  | 'category_id'
  | 'title'
  | 'tag'
  | 'featured_tag'
  | 'short_description'
  | 'description'
  | 'benefits'
  | 'price_label'
  | 'price_note'
  | 'price_amount'
  | 'image_path'
  | 'cta_label'
  | 'request_subject'
  | 'internal_href'
  | 'is_featured'
  | 'featured_order'
  | 'sort_order'
>;

function toOffer(row: PublicServiceRow, categorySlug: string): Offer {
  return {
    id: row.slug,
    family: 'service',
    group: categorySlug as OfferGroupId,
    tag: row.tag,
    ...(row.featured_tag ? { featuredTag: row.featured_tag } : {}),
    title: row.title,
    description: row.description,
    shortDescription: row.short_description,
    benefits: row.benefits,
    price: row.price_label,
    priceNote: row.price_note,
    // `numeric` arrive en chaîne. `undefined` et non `null` : le type `Offer`
    // rend le champ facultatif, et les données structurées testent sa présence.
    ...(row.price_amount !== null ? { priceAmount: Number(row.price_amount) } : {}),
    image: row.image_path,
    ctaLabel: row.cta_label,
    requestSubject: row.request_subject,
    ...(row.internal_href ? { href: row.internal_href } : {}),
  };
}

/* ------------------------------------------------------------------ repli --- */

function staticCatalogue(reason: FallbackReason): PublicCatalogue {
  const services = staticOffers.filter((offer) => offer.family === 'service');

  const groups = staticGroups
    .map((group) => ({
      id: group.id,
      title: group.title,
      items: services.filter((offer) => offer.group === group.id),
    }))
    .filter((group) => group.items.length > 0);

  const featured = STATIC_FEATURED_IDS.flatMap((id) => {
    const offer = staticOffers.find((candidate) => candidate.id === id);
    return offer ? [offer] : [];
  });

  return { source: 'statique', reason, offers: services, groups, featured };
}

/**
 * Journalisation serveur d'un repli. Le § 18 demande de tracer sans rien
 * révéler au visiteur : le message part dans les journaux de la plateforme, la
 * page, elle, ne change pas d'apparence.
 */
function reportFallback(reason: FallbackReason, detail?: string) {
  if (reason === 'configuration') return;

  console.error(
    `[catalogue] Repli sur les données statiques — ${reason}${detail ? ` : ${detail}` : ''}`,
  );
}

/* ------------------------------------------------------------------ lecture --- */

/**
 * Catalogue public : les offres publiées, regroupées par catégorie active.
 *
 * Une seule requête par table, et uniquement les colonnes rendues — le § 19
 * interdit de dégrader les pages publiques par des lectures inutiles. Le
 * regroupement se fait en mémoire sur quelques dizaines de lignes, ce qui
 * évite la jointure imbriquée et le N+1 qu'elle invite.
 */
export async function getPublicCatalogue(): Promise<PublicCatalogue> {
  const supabase = getPublicSupabaseClient();

  if (!supabase) {
    const fallback = staticCatalogue('configuration');
    reportFallback('configuration');
    return fallback;
  }

  try {
    const [categoriesResult, servicesResult] = await Promise.all([
      supabase
        .from('categories')
        .select('id, slug, name, sort_order')
        .eq('kind', 'SERVICE')
        .order('sort_order', { ascending: true }),
      supabase
        .from('services')
        // Littéral d'un seul tenant : PostgREST déduit le type du résultat de
        // la chaîne elle-même. La couper en morceaux concaténés lui ferait
        // perdre cette déduction, et le typage retomberait sur une assertion.
        // prettier-ignore
        .select('slug, category_id, title, tag, featured_tag, short_description, description, benefits, price_label, price_note, price_amount, image_path, cta_label, request_subject, internal_href, is_featured, featured_order, sort_order')
        // RLS ne renvoie déjà que les lignes PUBLIE au rôle anonyme. Le filtre
        // est répété ici parce qu'une lecture publique ne doit pas dépendre
        // d'une seule barrière : si une politique venait à être élargie, la
        // requête, elle, resterait juste.
        .eq('status', 'PUBLIE')
        .eq('show_in_shop', true)
        .order('sort_order', { ascending: true }),
    ]);

    if (categoriesResult.error) throw new Error(categoriesResult.error.message);
    if (servicesResult.error) throw new Error(servicesResult.error.message);

    const categories: Pick<CategoryRow, 'id' | 'slug' | 'name' | 'sort_order'>[] =
      categoriesResult.data ?? [];
    const rows: PublicServiceRow[] = servicesResult.data ?? [];

    // Base non initialisée : ni catégorie, ni offre. Distinct d'un catalogue
    // vidé volontairement, qui conserverait ses catégories.
    if (categories.length === 0 && rows.length === 0) {
      const fallback = staticCatalogue('base-non-initialisee');
      reportFallback('base-non-initialisee');
      return fallback;
    }

    const categorySlugById = new Map(categories.map((category) => [category.id, category.slug]));

    // Une offre dont la catégorie n'est pas lisible (désactivée entre les deux
    // requêtes) est écartée plutôt que rendue sans regroupement.
    const offers = rows.flatMap((row) => {
      const slug = categorySlugById.get(row.category_id);
      return slug ? [{ row, offer: toOffer(row, slug) }] : [];
    });

    const groups: CatalogueGroup[] = categories
      .map((category) => ({
        id: category.slug as OfferGroupId,
        title: category.name,
        items: offers
          .filter(({ row }) => row.category_id === category.id)
          .map(({ offer }) => offer),
      }))
      .filter((group) => group.items.length > 0);

    const featured = offers
      .filter(({ row }) => row.is_featured)
      .sort((left, right) => (left.row.featured_order ?? 0) - (right.row.featured_order ?? 0))
      .map(({ offer }) => offer);

    return {
      source: 'base',
      offers: offers.map(({ offer }) => offer),
      groups,
      featured,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'cause inconnue';
    const fallback = staticCatalogue('panne');
    reportFallback('panne', detail);
    return fallback;
  }
}

/**
 * Contexte d'offre transmis au formulaire de contact.
 *
 * Le formulaire est un composant client : lui passer le catalogue entier
 * enverrait au navigateur des descriptions qu'il n'affiche pas. Seules les
 * trois valeurs qu'il utilise réellement traversent.
 */
export type OfferContext = {
  id: string;
  title: string;
  requestSubject: string;
  /** Remarques 01 : prix public défini (KMF), ou `null` pour une offre sur devis. */
  priceAmount: number | null;
  priceLabel: string;
  priceNote: string;
};

export function toOfferContexts(offers: readonly Offer[]): OfferContext[] {
  return offers.map((offer) => ({
    id: offer.id,
    title: offer.title,
    requestSubject: offer.requestSubject,
    priceAmount: offer.priceAmount ?? null,
    priceLabel: offer.price,
    priceNote: offer.priceNote,
  }));
}
