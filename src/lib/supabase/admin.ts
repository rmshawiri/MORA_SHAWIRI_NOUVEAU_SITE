import 'server-only';

/**
 * Client Supabase à clé secrète — usage strictement encadré.
 *
 * Cette clé contourne RLS. Le rapport de phase 4 (§ 15) classe son usage
 * généralisé parmi les risques élevés : le socle précédent s'en servait pour
 * lire les rôles, ce qui privait la plateforme de sa dernière barrière de
 * sécurité. Elle est ici réservée à ce qui ne peut pas être fait autrement :
 *
 *   * provisionnement des comptes administrateurs initiaux ;
 *   * écriture des compteurs de limitation de fréquence ;
 *   * tâches serveur sans utilisateur (maintenance, import, sauvegarde).
 *
 * Tout ce qui s'exécute *pour le compte d'un utilisateur* passe par
 * `server.ts`, afin de rester soumis aux politiques RLS.
 *
 * Règle absolue (`00_SUPABASE.md` § 40) : cette clé ne franchit jamais la
 * frontière du serveur. `import 'server-only'` transforme cette règle en erreur
 * de compilation si un composant client tente de l'importer.
 */

import { createClient } from '@supabase/supabase-js';

import { getSupabasePublicConfig } from './environment';
import type { Database } from './types';

type AdminClient = ReturnType<typeof createClient<Database>>;

let cached: AdminClient | null = null;

/**
 * Client à privilèges, ou `null` si la clé secrète n'est pas configurée.
 *
 * Aucune valeur de clé n'est journalisée, ni incluse dans un message d'erreur.
 */
export function getAdminSupabaseClient(): AdminClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) return null;

  cached ??= createClient<Database>(config.url, secretKey, {
    auth: {
      // Aucune session : ce client ne représente aucun utilisateur.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return cached;
}

export function requireAdminSupabaseClient(): AdminClient {
  const client = getAdminSupabaseClient();
  if (!client) {
    throw new Error(
      'Le client Supabase à privilèges n\'est pas disponible : configuration serveur incomplète.',
    );
  }
  return client;
}
