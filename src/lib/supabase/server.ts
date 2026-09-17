import 'server-only';

/**
 * Client Supabase pour composants serveur, route handlers et actions serveur.
 *
 * Il s'appuie sur la session de l'utilisateur, transportée par cookies
 * `HttpOnly` (`04_AUTHENTIFICATION.md` § 43-46). C'est le client à utiliser par
 * défaut : les requêtes qu'il émet sont soumises à RLS, donc au même contrôle
 * que celles du navigateur. Le client à clé secrète (`admin.ts`) reste réservé
 * aux opérations qui ne peuvent pas être attribuées à un utilisateur.
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import { getSupabasePublicConfig } from './environment';
import type { Database } from './types';

type ServerClient = ReturnType<typeof createServerClient<Database>>;

/**
 * Client lié à la session courante, ou `null` si Supabase n'est pas configuré.
 */
export async function getServerSupabaseClient(): Promise<ServerClient | null> {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Appelé depuis un composant serveur en lecture seule : le
          // rafraîchissement de session est alors assuré par le middleware.
          // Ignorer est le comportement recommandé, pas un contournement.
        }
      },
    },
  });
}

export async function requireServerSupabaseClient(): Promise<ServerClient> {
  const client = await getServerSupabaseClient();
  if (!client) {
    throw new Error('Supabase n\'est pas configuré pour cet environnement.');
  }
  return client;
}

/**
 * Utilisateur authentifié, vérifié auprès du serveur d'authentification.
 *
 * `getUser()` et non `getSession()` : seule la première vérifie réellement le
 * jeton auprès de Supabase. Se fier au contenu d'un cookie reviendrait à faire
 * confiance au client, ce que le § 3 de l'authentification interdit.
 */
export async function getAuthenticatedUser() {
  const client = await getServerSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  return data.user;
}
