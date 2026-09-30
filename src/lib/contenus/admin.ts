import 'server-only';

/**
 * Lectures du module Contenus.
 *
 * Toutes passent par le **client de session**, donc sous RLS. C'est le patron
 * posé en 4C et repris en 4E-1 : si un administrateur perdait `content.view`
 * entre l'ouverture du menu et l'affichage de la liste, la base lui renverrait
 * une liste vide plutôt que des lignes que le garde applicatif aurait laissé
 * passer par inadvertance.
 *
 * Le client à clé secrète n'est **pas** utilisé. Il contournerait RLS, et
 * l'administration deviendrait le seul endroit du système où la troisième
 * barrière ne s'applique pas.
 */

import {
  LIST_BLOCKS,
  TEXT_BLOCKS,
  type ContentPageSlug,
  type ListBlockKey,
  type TextBlockKey,
} from '@/content/blocks';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type {
  ContentBlockRow,
  ContentPostRow,
  FaqCategoryRow,
  FaqItemRow,
  MediaAssetRow,
} from '@/lib/supabase/types';

/* ------------------------------------------------------------------ blocs --- */

/**
 * État d'un bloc, **déduit** et non stocké.
 *
 * La migration § 2 explique pourquoi : une colonne `status` pourrait
 * contredire la donnée (« publié » sans valeur, « brouillon » avec une valeur
 * déjà servie). Le déduire de la présence des deux colonnes rend la
 * contradiction impossible.
 */
export type BlockState = 'CODE' | 'EN_LIGNE' | 'BROUILLON' | 'EN_LIGNE_ET_BROUILLON';

export type BlockEntry = {
  key: string;
  kind: string;
  page: ContentPageSlug;
  label: string;
  state: BlockState;
  /** Valeurs du registre — ce que le site affiche en l'absence de surcharge. */
  defaults: unknown;
  published: unknown;
  draft: unknown;
  updatedAt: string | null;
  publishedAt: string | null;
  /** Forme des éléments, pour une liste seulement. */
  shape?: string;
};

function stateOf(row: Pick<ContentBlockRow, 'published_fields' | 'draft_fields'> | undefined) {
  if (!row) return 'CODE' as BlockState;
  const online = row.published_fields !== null;
  const draft = row.draft_fields !== null;
  if (online && draft) return 'EN_LIGNE_ET_BROUILLON' as BlockState;
  if (online) return 'EN_LIGNE' as BlockState;
  if (draft) return 'BROUILLON' as BlockState;
  return 'CODE' as BlockState;
}

/**
 * Tous les blocs du registre, enrichis de leur surcharge éventuelle.
 *
 * Le registre mène, la base suit — et non l'inverse. C'est ce qui garantit que
 * l'administration présente **la totalité** de ce qui est modifiable, y compris
 * les blocs que personne n'a encore touchés. Lister la table aurait montré une
 * page vide au premier usage, ce qui aurait donné à penser qu'il n'y a rien à
 * modifier.
 */
export async function listBlocks(): Promise<BlockEntry[]> {
  const supabase = await getServerSupabaseClient();

  const rows = new Map<string, ContentBlockRow>();

  if (supabase) {
    const { data, error } = await supabase
      .from('content_blocks')
      .select('id, key, kind, page_slug, published_fields, draft_fields, published_at, created_at, updated_at');

    if (!error) {
      for (const row of data ?? []) rows.set(row.key, row as ContentBlockRow);
    }
  }

  const entries: BlockEntry[] = [];

  for (const [key, definition] of Object.entries(TEXT_BLOCKS)) {
    const row = rows.get(key);
    entries.push({
      key,
      kind: definition.kind,
      page: definition.page,
      label: definition.label,
      state: stateOf(row),
      defaults: definition.defaults,
      published: row?.published_fields ?? null,
      draft: row?.draft_fields ?? null,
      updatedAt: row?.updated_at ?? null,
      publishedAt: row?.published_at ?? null,
    });
  }

  for (const [key, definition] of Object.entries(LIST_BLOCKS)) {
    const row = rows.get(key);
    entries.push({
      key,
      kind: definition.kind,
      page: definition.page,
      label: definition.label,
      state: stateOf(row),
      defaults: definition.defaults,
      published: row?.published_fields ?? null,
      draft: row?.draft_fields ?? null,
      updatedAt: row?.updated_at ?? null,
      publishedAt: row?.published_at ?? null,
      shape: definition.shape,
    });
  }

  return entries;
}

/** Un bloc précis, ou `undefined` si la clé n'est pas au registre. */
export async function findBlock(key: string): Promise<BlockEntry | undefined> {
  if (!(key in TEXT_BLOCKS) && !(key in LIST_BLOCKS)) return undefined;
  const entries = await listBlocks();
  return entries.find((entry) => entry.key === key);
}

/** Vrai si la clé désigne une liste plutôt qu'un bloc de texte. */
export function isListKey(key: string): key is ListBlockKey {
  return key in LIST_BLOCKS;
}

export function isTextKey(key: string): key is TextBlockKey {
  return key in TEXT_BLOCKS;
}

/* -------------------------------------------------------------------- FAQ --- */

export type FaqCategoryEntry = Pick<
  FaqCategoryRow,
  'id' | 'slug' | 'title' | 'surface' | 'sort_order' | 'is_active'
> & { published: number; total: number };

export type FaqItemEntry = Pick<
  FaqItemRow,
  'id' | 'category_id' | 'question' | 'answer' | 'sort_order' | 'status' | 'published_at'
>;

/**
 * Catégories de FAQ avec leurs décomptes réels.
 *
 * Les inactives sont incluses : l'administration montre **ce qui existe**, pas
 * ce qui est publié. Les chiffres sont comptés, jamais estimés — le § 171 du
 * tableau de bord interdit de simuler une donnée.
 */
export async function listFaq(): Promise<{
  categories: FaqCategoryEntry[];
  items: FaqItemEntry[];
}> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return { categories: [], items: [] };

  const [categoriesResult, itemsResult] = await Promise.all([
    supabase
      .from('faq_categories')
      .select('id, slug, title, surface, sort_order, is_active')
      .order('surface', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase
      .from('faq_items')
      .select('id, category_id, question, answer, sort_order, status, published_at')
      .order('sort_order', { ascending: true }),
  ]);

  const items = (itemsResult.data ?? []) as FaqItemEntry[];

  const categories = ((categoriesResult.data ?? []) as Omit<
    FaqCategoryEntry,
    'published' | 'total'
  >[]).map((category) => {
    const own = items.filter((item) => item.category_id === category.id);
    return {
      ...category,
      total: own.length,
      published: own.filter((item) => item.status === 'PUBLIE').length,
    };
  });

  return { categories, items };
}

/* --------------------------------------------------------------- articles --- */

export type PostEntry = Pick<
  ContentPostRow,
  | 'id'
  | 'slug'
  | 'category'
  | 'title'
  | 'author'
  | 'published_on'
  | 'status'
  | 'sort_order'
  | 'published_at'
  | 'updated_at'
>;

export async function listPosts(): Promise<PostEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('content_posts')
    .select(
      'id, slug, category, title, author, published_on, status, sort_order, published_at, updated_at',
    )
    .order('sort_order', { ascending: true });

  if (error) return [];
  return (data ?? []) as PostEntry[];
}

/** Un article dans son intégralité, pour sa fiche d'édition. */
export async function findPost(slug: string): Promise<ContentPostRow | undefined> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return undefined;

  const { data, error } = await supabase
    .from('content_posts')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) return undefined;
  return data as ContentPostRow;
}

/* ------------------------------------------------------------ médiathèque --- */

export type MediaEntry = Pick<
  MediaAssetRow,
  | 'id'
  | 'kind'
  | 'bucket'
  | 'path'
  | 'title'
  | 'alt_text'
  | 'category'
  | 'mime_type'
  | 'byte_size'
  | 'width'
  | 'height'
  | 'is_decorative'
  | 'created_at'
>;

export async function listMedias(): Promise<MediaEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('media_assets')
    .select(
      'id, kind, bucket, path, title, alt_text, category, mime_type, byte_size, width, height, is_decorative, created_at',
    )
    .order('kind', { ascending: true })
    .order('title', { ascending: true });

  if (error) return [];
  return (data ?? []) as MediaEntry[];
}
