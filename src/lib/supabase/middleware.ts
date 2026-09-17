/**
 * Rafraîchissement de session pour le middleware Next.js.
 *
 * Les jetons Supabase expirent ; sans rafraîchissement, une session valide
 * paraîtrait expirée au premier rendu serveur. Ce module fournit la fonction
 * qui s'en charge et renvoie l'utilisateur vérifié.
 *
 * Point de vigilance repris du § 107 de `04_AUTHENTIFICATION.md` : un
 * middleware est un confort de navigation, **jamais** une protection. La
 * barrière réelle est le contrôle de permission côté serveur, doublé de RLS.
 * Aucune décision d'autorisation ne doit donc reposer sur ce fichier seul.
 *
 * Le `middleware.ts` racine n'est pas créé à ce stade : il relève de la phase
 * 4B, avec les pages d'authentification. Poser le fichier ici sans page de
 * connexion n'apporterait rien et toucherait au routage du site public.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { getSupabasePublicConfigSafe } from './environment';
import type { Database } from './types';
import type { User } from '@supabase/supabase-js';

export type SessionRefreshResult = {
  response: NextResponse;
  user: User | null;
};

/**
 * Rafraîchit la session portée par la requête et recopie les cookies mis à jour
 * sur la réponse.
 *
 * Lorsque Supabase n'est pas configuré, la requête poursuit son chemin sans
 * modification : le site vitrine reste pleinement fonctionnel.
 */
export async function refreshSupabaseSession(request: NextRequest): Promise<SessionRefreshResult> {
  let response = NextResponse.next({ request });

  const config = getSupabasePublicConfigSafe();
  if (!config) return { response, user: null };

  const supabase = createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // `getUser()` vérifie le jeton auprès de Supabase ; `getSession()` se
  // contenterait de relire le cookie.
  const { data, error } = await supabase.auth.getUser();

  return { response, user: error ? null : data.user };
}
