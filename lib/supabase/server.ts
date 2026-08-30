import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Client Supabase côté SERVEUR (Server Components / Server Actions / Route Handlers).
 * Il utilise le cookie de session pour résoudre l'utilisateur authentifié.
 * Ne contient aucun secret ; utilise la clé publique anon + la session.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // En Server Component, la modification de cookies n'est pas autorisée :
            // à faire dans une Server Action ou un Route Handler. On ignore ici.
          }
        },
      },
    },
  );
}

/** Récupère l'utilisateur courant (null si non connecté). */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
