'use client';

/**
 * Client Supabase destiné au navigateur.
 *
 * Il n'utilise que la clé publiable, conçue pour être exposée. Elle ne constitue
 * jamais une autorisation : tout ce qu'elle permet est encadré par les
 * politiques RLS (`10_DEPLOIEMENT/00_SUPABASE.md` § 41).
 *
 * Aucune page publique n'en dépend aujourd'hui. Ce module existe pour les
 * espaces privés des phases suivantes.
 */

import { createBrowserClient } from '@supabase/ssr';

import { getSupabasePublicConfig } from './environment';
import type { Database } from './types';

type BrowserClient = ReturnType<typeof createBrowserClient<Database>>;

let cached: BrowserClient | null = null;

/**
 * Renvoie le client navigateur, ou `null` lorsque Supabase n'est pas configuré.
 * L'appelant doit traiter ce cas : le site vitrine fonctionne sans base.
 */
export function getBrowserSupabaseClient(): BrowserClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  cached ??= createBrowserClient<Database>(config.url, config.publishableKey);
  return cached;
}

/**
 * Variante stricte, pour les écrans privés qui n'ont aucun sens sans base.
 */
export function requireBrowserSupabaseClient(): BrowserClient {
  const client = getBrowserSupabaseClient();
  if (!client) {
    throw new Error('Supabase n\'est pas configuré pour cet environnement.');
  }
  return client;
}
