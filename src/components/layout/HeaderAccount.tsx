'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { UserCircle } from '@/components/ui/Icon';
import { AUTH_ROUTES } from '@/lib/auth/routes';

/**
 * Accès au compte depuis le site public.
 *
 * ## Pourquoi ce composant existe
 *
 * L'authentification et l'inscription client sont livrées depuis la phase 4B,
 * mais aucune porte ne les désignait : `/connexion/` et `/inscription/`
 * n'étaient atteignables qu'en tapant l'adresse, ou après une redirection du
 * proxy. Une fonctionnalité que personne ne trouve n'existe pas.
 *
 * Ce composant **n'ajoute aucune logique d'authentification**. Il ne fait que
 * pointer vers les routes existantes d'`AUTH_ROUTES`, et lire l'état de
 * session pour éviter de proposer « Créer un compte » à quelqu'un qui est déjà
 * connecté.
 *
 * ## Pourquoi la session est lue dans le navigateur
 *
 * L'en-tête est rendu par le gabarit du groupe `(site)`, et les pages
 * publiques sont pré-rendues à la construction (`○ Static` au journal de
 * build). Lire la session côté serveur dans l'en-tête ferait basculer
 * **toutes** les pages publiques en rendu à la demande : chaque visiteur
 * paierait un aller-retour serveur pour afficher l'accueil. Le prix serait
 * sans rapport avec le bénéfice — remplacer deux libellés.
 *
 * Le HTML servi reste donc identique pour tout le monde, donc pré-rendable et
 * cachable, et l'état réel s'affiche après hydratation.
 *
 * ## Pourquoi un cookie plutôt que le client Supabase
 *
 * Parce que le client Supabase du navigateur ne fonctionne pas. Sa
 * configuration passe par `readOptional()`, qui lit `process.env[nom]` avec
 * une clé **calculée** : Next.js ne remplace alors pas la variable par sa
 * valeur dans le paquet envoyé au navigateur, et `getBrowserSupabaseClient()`
 * y renvoie toujours `null`. Le commentaire de `src/lib/supabase/client.ts`
 * en portait déjà la trace — « aucune page publique n'en dépend aujourd'hui ».
 * Corriger cela reviendrait à toucher la lecture des variables
 * d'environnement, c'est-à-dire un module de la phase 4A : hors du périmètre
 * d'un correctif d'interface.
 *
 * `@supabase/ssr` pose son cookie de session avec `httpOnly: false` — c'est
 * son réglage par défaut, et il est délibéré : sa propre bibliothèque
 * navigateur doit pouvoir le lire. Constater la **présence** de ce cookie
 * suffit à choisir entre deux libellés, sans requête réseau et sans
 * configuration.
 *
 * ## Ce que cette lecture n'est pas
 *
 * Elle n'est pas une autorisation, et elle n'en tient pas lieu. Elle ne lit
 * pas le contenu du cookie, n'en vérifie pas la signature, ignore les rôles et
 * ignore le niveau d'assurance. Un cookie périmé ferait afficher « Mon
 * espace » ; le lien mène alors à `/espace-client/`, où le proxy reconduit à
 * la connexion. L'autorisation reste ce qu'elle était en phase 4B : le garde
 * serveur de chaque page privée, doublé de RLS.
 *
 * ## Deux formes, un seul composant
 *
 * `variant="desktop"` — la barre d'en-tête n'a plus un pixel de large : le
 * contrôle est un bouton d'icône qui déplie les deux liens.
 *
 * `variant="mobile"` — dans le tiroir de navigation, la place ne manque pas :
 * les liens sont écrits en toutes lettres, pleine largeur.
 */
export default function HeaderAccount({ variant }: { variant: 'desktop' | 'mobile' }) {
  const connected = useSessionCookie();

  return variant === 'mobile' ? (
    <MobileAccount connected={connected} />
  ) : (
    <DesktopAccount connected={connected} />
  );
}

/* ------------------------------------------------------------------ état --- */

/**
 * Nom du cookie de session posé par `@supabase/ssr` : `sb-<projet>-auth-token`,
 * suivi d'un `.0`, `.1`… lorsque la session dépasse la taille d'un cookie.
 * La référence du projet n'est pas connue du navigateur — elle n'a pas à
 * l'être : la forme du nom suffit, et aucune autre bibliothèque n'écrit de
 * cookie qui lui ressemble.
 */
const COOKIE_DE_SESSION = /(?:^|;\s*)sb-[^\s=;]+-auth-token(?:\.\d+)?=/;

/** Le cookie de session est-il présent ? Lu à chaque rendu, jamais conservé. */
function lireCookie(): boolean {
  try {
    return COOKIE_DE_SESSION.test(document.cookie);
  } catch {
    // `document.cookie` peut lever quand le stockage du site est bloqué.
    return false;
  }
}

/**
 * Le serveur répond toujours « visiteur ».
 *
 * C'est délibéré : le HTML pré-rendu est le même pour tout le monde, donc
 * cachable. React l'utilise pour l'hydratation, puis lit l'état réel du
 * navigateur — une personne connectée voit donc brièvement « Connexion »
 * avant « Mon espace ». Le défaut est sans conséquence : ces liens ne
 * décident de rien.
 */
function etatServeur(): boolean {
  return false;
}

/**
 * Pas d'abonnement.
 *
 * Une connexion ou une déconnexion s'accompagne toujours d'une navigation, et
 * une navigation provoque un rendu, qui relit le cookie. Écouter `focus` ou
 * `visibilitychange` ne gagnerait rien et contreviendrait au § 45-48 du
 * prompt maître, qui interdit les rafraîchissements déclenchés par le retour
 * sur l'onglet.
 */
function sansAbonnement(): () => void {
  return () => {};
}

function useSessionCookie(): boolean {
  return useSyncExternalStore(sansAbonnement, lireCookie, etatServeur);
}

/* --------------------------------------------------------------- tiroir --- */

function MobileAccount({ connected }: { connected: boolean }) {
  if (connected) {
    return (
      <Link className="btn btn--light" href={AUTH_ROUTES.clientArea}>
        Mon espace
      </Link>
    );
  }

  return (
    <>
      <Link className="btn btn--light" href={AUTH_ROUTES.signIn}>
        Connexion
      </Link>
      <Link className="btn btn--light" href={AUTH_ROUTES.signUp}>
        Créer un compte
      </Link>
    </>
  );
}

/* -------------------------------------------------------------- bureau --- */

/**
 * Menu déroulant du compte.
 *
 * Un `<button>` et un panneau, pas un `<details>` : le panneau doit se fermer
 * au clic extérieur et à la touche Échap, ce qu'un `details` ne fait pas seul.
 */
function DesktopAccount({ connected }: { connected: boolean }) {
  const pathname = usePathname();

  /**
   * Le menu mémorise la page où il a été ouvert plutôt qu'un simple booléen.
   * Une navigation change `pathname`, donc referme le menu **au rendu** : pas
   * d'effet, pas de rendu en cascade, et jamais de menu resté ouvert
   * par-dessus la page suivante.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpenedOn(null), []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      buttonRef.current?.focus();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const label = connected ? 'Mon compte' : 'Connexion ou création de compte';

  return (
    <div className="header-account" ref={rootRef}>
      <button
        className="header-account__toggle"
        type="button"
        ref={buttonRef}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="header-account-menu"
        onClick={() => setOpenedOn(open ? null : pathname)}
      >
        <UserCircle />
      </button>

      <div
        className="header-account__menu"
        id="header-account-menu"
        role="menu"
        hidden={!open}
        onClick={close}
      >
        {connected ? (
          <Link className="header-account__item" href={AUTH_ROUTES.clientArea} role="menuitem">
            Mon espace
          </Link>
        ) : (
          <>
            <Link className="header-account__item" href={AUTH_ROUTES.signIn} role="menuitem">
              Se connecter
            </Link>
            <Link className="header-account__item" href={AUTH_ROUTES.signUp} role="menuitem">
              Créer un compte
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
