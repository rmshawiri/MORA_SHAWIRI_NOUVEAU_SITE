import 'server-only';

/**
 * Lectures du module Catalogue.
 *
 * Toutes passent par le client de session, donc sous RLS. C'est délibéré et
 * c'est le patron posé en phase 4C : si un administrateur perdait
 * `services.view` entre l'ouverture du menu et l'affichage de la liste, la
 * base lui renverrait une liste vide plutôt que des lignes que le garde
 * applicatif aurait laissé passer par inadvertance.
 *
 * Le client à clé secrète n'est pas utilisé ici. Il contournerait RLS, et
 * l'administration deviendrait alors le seul endroit du système où la
 * troisième barrière ne s'applique pas — exactement le défaut que la phase 4C
 * a corrigé.
 */

import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { CategoryRow, ProductRow, ServiceRow } from '@/lib/supabase/types';

/** Ligne de la liste : assez pour décider, pas assez pour tout charger. */
export type CatalogueListEntry = Pick<
  ServiceRow,
  | 'id'
  | 'slug'
  | 'title'
  | 'category_id'
  | 'price_label'
  | 'price_amount'
  | 'status'
  | 'show_in_shop'
  | 'is_featured'
  | 'sort_order'
  | 'affiliate_eligible'
  | 'published_at'
  | 'created_at'
  | 'updated_at'
>;

export type CatalogueCategory = Pick<
  CategoryRow,
  'id' | 'slug' | 'name' | 'kind' | 'sort_order' | 'is_active'
>;

/**
 * Catégories, tous univers confondus et états compris.
 *
 * Les inactives sont incluses : l'administration doit montrer ce qui existe,
 * pas ce qui est publié. C'est ce que la politique `categories_select_admin`
 * autorise, et rien de plus.
 */
export async function listCategories(): Promise<CatalogueCategory[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, name, kind, sort_order, is_active')
    .order('kind', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) {
    console.error(`[catalogue] Lecture des catégories impossible : ${error.message}`);
    return [];
  }

  return data ?? [];
}

/** Services, brouillons et archives compris — sous réserve de `services.view`. */
export async function listServices(): Promise<CatalogueListEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('services')
    // prettier-ignore
    .select('id, slug, title, category_id, price_label, price_amount, status, show_in_shop, is_featured, sort_order, affiliate_eligible, published_at, created_at, updated_at')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error(`[catalogue] Lecture des services impossible : ${error.message}`);
    return [];
  }

  return data ?? [];
}

/** Fiche complète d'un service, par son slug. */
export async function findService(slug: string): Promise<ServiceRow | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    console.error(`[catalogue] Lecture du service ${slug} impossible : ${error.message}`);
    return null;
  }

  return data;
}

/**
 * Produits. La table est vide au lancement ; la fonction existe pour que
 * l'écran dise « aucun produit » en le sachant, et non en le supposant.
 */
export async function listProducts(): Promise<Pick<ProductRow, 'id' | 'slug' | 'title' | 'status'>[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('products')
    .select('id, slug, title, status')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error(`[catalogue] Lecture des produits impossible : ${error.message}`);
    return [];
  }

  return data ?? [];
}

/* -------------------------------------------------------------- affichage --- */

export const STATUS_LABELS = {
  BROUILLON: 'Brouillon',
  PUBLIE: 'Publié',
  NON_PUBLIE: 'Non publié',
  ARCHIVE: 'Archivé',
} as const;

/**
 * Compte par statut. Aucun chiffre n'est fabriqué : ce sont les lignes que la
 * session a le droit de lire, comptées telles quelles. Le § 171 du tableau de
 * bord interdit de simuler une donnée absente ; il n'interdit pas de compter
 * une donnée présente.
 */
export function countByStatus(entries: readonly CatalogueListEntry[]) {
  return {
    BROUILLON: entries.filter((entry) => entry.status === 'BROUILLON').length,
    PUBLIE: entries.filter((entry) => entry.status === 'PUBLIE').length,
    NON_PUBLIE: entries.filter((entry) => entry.status === 'NON_PUBLIE').length,
    ARCHIVE: entries.filter((entry) => entry.status === 'ARCHIVE').length,
  };
}
