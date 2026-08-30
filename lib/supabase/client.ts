import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Supabase destiné au NAVIGATEUR.
 * Il utilise les clés PUBLIQUES (anon) et ne contient aucun secret.
 * Les fonctionnalités qui exigent des droits privilégiés doivent passer
 * par le serveur (Server Actions / route handlers) — jamais ici.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
