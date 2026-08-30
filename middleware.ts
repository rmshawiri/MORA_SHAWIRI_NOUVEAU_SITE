import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Middleware global :
 *  - rafraîchit la session Supabase à chaque requête ;
 *  - protège les routes privées (espace-client, espace-affilie, admin) :
 *    redirige vers /connexion si non connecté.
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Exclut les assets statiques et fichiers ; protège les routes privées.
     * On exécute le middleware sur toutes les routes sauf les ressources statiques.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:svg|png|jpe?g|webp|ico)$).*)",
  ],
};
