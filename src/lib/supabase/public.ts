import 'server-only';

/**
 * Client Supabase pour les pages publiques — sans session, sans cookies.
 *
 * ## Pourquoi il ne peut pas s'agir du client de `server.ts`
 *
 * `getServerSupabaseClient()` lit `cookies()`. Next.js en déduit, à juste
 * titre, que la page dépend de la requête : elle cesse d'être pré-rendue et
 * devient rendue à la demande. Appliqué à la Boutique et à l'accueil, cela
 * transformerait deux pages servies en HTML statique en deux pages recalculées
 * à chaque visite — une régression de performance que la phase 4E n'a pas
 * demandée, et que le § 19 de son cadrage interdit explicitement.
 *
 * Ce client-ci n'ouvre aucun cookie. Les pages qui l'utilisent restent donc
 * pré-rendues au build, puis régénérées à intervalle (`revalidate`). Le
 * visiteur reçoit du HTML statique ; l'administrateur voit ses modifications
 * apparaître au cycle suivant.
 *
 * ## Ce qu'il donne le droit de lire
 *
 * Rien de plus que le rôle anonyme. La clé publiable est faite pour être
 * exposée, et n'est jamais une autorisation : seule RLS décide. Un brouillon
 * n'est pas lisible par ce client, quand bien même on connaîtrait son slug —
 * la politique `services_select_public` ne renvoie que les lignes PUBLIE.
 *
 * Référence : `10_DEPLOIEMENT/00_SUPABASE.md` § 41 ; plan de développement,
 * phase 4E, points 18 et 19 du cadrage.
 */

import { createClient } from '@supabase/supabase-js';

import { CATALOGUE_REVALIDATE_SECONDS } from '@/lib/catalogue/revalidation';

import { getSupabasePublicConfig } from './environment';
import type { Database } from './types';

type PublicClient = ReturnType<typeof createClient<Database>>;


let cached: PublicClient | null = null;

/**
 * Renvoie le client anonyme, ou `null` si Supabase n'est pas configuré.
 *
 * Le `null` n'est pas un détail : le site vitrine doit pouvoir être construit
 * sans base — c'est ce qui rend le repli statique possible plutôt que
 * théorique.
 */
export function getPublicSupabaseClient(): PublicClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  cached ??= createClient<Database>(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { 'x-application': 'mora-shawiri-public' },
      // Next.js met en cache les `fetch` d'une page pré-rendue. Sans consigne,
      // il applique une heuristique : le comportement dépend alors de détails
      // de version plutôt que d'une décision. On la donne donc explicitement,
      // et avec la même durée que le `revalidate` des pages.
      //
      // Effet de bord assumé : ce cache survit à un build. Deux constructions
      // à moins de cinq minutes d'intervalle peuvent servir la même réponse.
      // C'est sans conséquence — le serveur régénère de toute façon la page
      // au terme du même délai.
      fetch: (input, init) =>
        fetch(input, { ...init, next: { revalidate: CATALOGUE_REVALIDATE_SECONDS } }),
    },
  });

  return cached;
}
