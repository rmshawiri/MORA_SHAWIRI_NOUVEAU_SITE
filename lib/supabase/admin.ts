import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase à PRIVILÈGES ÉLEVÉS (Service Role).
 * ⚠️ SECRET : uniquement côté serveur (Server Actions / Route Handlers / admin).
 * Ne JAMAIS importer ce module dans un composant exécuté côté navigateur.
 * Sert aux opérations privilégiées : provisioning admin, lecture/écriture avec
 * bypass RLS contrôlé, sauvegarde/restauration, traitement de webhooks, etc.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Configuration Supabase manquante : NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
