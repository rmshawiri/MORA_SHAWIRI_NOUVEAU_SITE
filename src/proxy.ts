/**
 * Proxy — niveau 1 de l'architecture de sécurité.
 *
 * Next.js 16 a renommé la convention `middleware` en `proxy`. Le nom est plus
 * juste que l'ancien, et il dit exactement ce que le § 7 du cadrage rappelle :
 * ce fichier aiguille le trafic, il ne l'autorise pas.
 *
 * ## Ce qu'il fait
 *
 * 1. **Rafraîchit la session.** Les jetons Supabase expirent au bout d'une
 *    heure. Sans rafraîchissement, une session parfaitement valide paraîtrait
 *    expirée au premier rendu serveur, et la personne serait déconnectée en
 *    pleine navigation. C'est la seule raison réellement indispensable
 *    d'exister de ce fichier.
 *
 * 2. **Évite les écrans vides.** Un visiteur non connecté qui ouvre
 *    `/espace-client/` est conduit à la connexion plutôt qu'à une page qui
 *    n'aurait rien à lui montrer, et la page demandée est mémorisée pour qu'il
 *    y revienne ensuite.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il ne protège rien. `04_AUTHENTIFICATION.md` § 107 et le § 7 du cadrage de
 * la phase 4B sont explicites : « Le middleware ne doit jamais être considéré
 * comme la seule barrière de sécurité. » Une requête peut l'ignorer, et il ne
 * connaît ni les rôles, ni le niveau d'assurance de la session — les lire ici
 * imposerait une requête en base à chaque fichier servi.
 *
 * La vraie barrière est le garde appelé par chaque page privée
 * (`src/lib/auth/guards.ts`), doublé des politiques RLS. Supprimer ce fichier
 * dégraderait l'expérience ; cela n'ouvrirait aucun accès.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { PRIVATE_PREFIXES, matchesPrefix, signInUrlFor } from '@/lib/auth/routes';
import { refreshSupabaseSession } from '@/lib/supabase/middleware';

export default async function proxy(request: NextRequest) {
  const { response, user } = await refreshSupabaseSession(request);

  const { pathname } = request.nextUrl;

  if (!user && matchesPrefix(pathname, PRIVATE_PREFIXES)) {
    const destination = new URL(signInUrlFor(pathname), request.url);

    // Les en-têtes de la réponse portent les cookies rafraîchis : les recopier
    // évite de perdre une rotation de jeton au moment même de la redirection.
    const redirectResponse = NextResponse.redirect(destination);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
  }

  return response;
}

export const config = {
  /**
   * Le proxy s'exécute partout, sauf sur ce qui ne porte jamais de session :
   * fichiers produits par Next.js, images, et les quelques fichiers racine
   * servis tels quels. Élargir inutilement le champ coûterait une invocation
   * par image chargée.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.png|logo-circle.png|logo-rect.png|images/|robots.txt|sitemap.xml|manifest.webmanifest).*)',
  ],
};
