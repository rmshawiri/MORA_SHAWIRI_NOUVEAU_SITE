'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import AdminNav from '@/components/admin/AdminNav';
import SignOutButton from '@/components/auth/SignOutButton';
import type { AdminModule } from '@/lib/rbac/modules';

/**
 * Coquille visuelle de l'espace de pilotage.
 *
 * ## Ce qu'elle change, et ce qu'elle ne change pas
 *
 * Elle ne décide rien. Les modules lui arrivent déjà filtrés par le gabarit,
 * qui les tient lui-même de `visibleModules` : ni l'ordre, ni les groupes, ni
 * les mentions « à venir », ni les permissions ne passent par ici. `AdminNav`
 * est repris tel quel, sans une ligne de différence.
 *
 * Elle ne fait que poser la structure de l'application : une barre latérale à
 * gauche, le contenu à droite, et — **uniquement sous 1080 pixels** — une
 * barre supérieure portant le bouton du menu.
 *
 * ## Pourquoi un tiroir sur petit écran
 *
 * La barre latérale de bureau mesure un quart de la largeur. Sur un téléphone,
 * elle ne laissait au contenu que quelques centimètres, ou s'empilait au-dessus
 * de lui sur une dizaine de lignes qu'il fallait faire défiler avant d'arriver
 * à la page demandée. Le propriétaire doit pouvoir piloter depuis son
 * téléphone : le menu se replie donc derrière un bouton, et le contenu prend
 * toute la largeur.
 *
 * Ce n'est pas une seconde navigation : c'est la même, dans un tiroir. Elle se
 * referme après le choix d'un module, ce que l'effet sur `pathname` assure.
 */
export default function AdminShell({
  modules,
  children,
}: {
  modules: readonly AdminModule[];
  children: ReactNode;
}) {
  const pathname = usePathname();

  /**
   * Le tiroir retient la page où il a été ouvert plutôt qu'un simple booléen :
   * changer de module change `pathname`, donc le referme au rendu suivant.
   * C'est le « fermeture après sélection d'un module » demandé, obtenu sans
   * effet et sans rendu en cascade.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const menuOpen = openedOn !== null && openedOn === pathname;

  const toggleRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpenedOn(null), []);

  // Le fond ne défile pas sous un tiroir ouvert (règle `body.admin-menu-open`
  // d'`admin.css`, donc jamais chargée par une page publique).
  useEffect(() => {
    document.body.classList.toggle('admin-menu-open', menuOpen);
    return () => document.body.classList.remove('admin-menu-open');
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      toggleRef.current?.focus();
    };

    // Repasser en bureau alors que le tiroir est ouvert laisserait un voile
    // inutile par-dessus la page.
    const media = window.matchMedia('(min-width: 1081px)');
    const onBreakpoint = (event: MediaQueryListEvent) => {
      if (event.matches) close();
    };

    document.addEventListener('keydown', onKeyDown);
    media.addEventListener('change', onBreakpoint);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      media.removeEventListener('change', onBreakpoint);
    };
  }, [menuOpen, close]);

  return (
    <div className={`admin${menuOpen ? ' admin--menu' : ''}`}>
      {/* Barre supérieure : masquée en CSS au-delà de 1080 pixels, où la barre
          latérale est visible en permanence et n'a pas besoin d'être appelée. */}
      <header className="admin-topbar">
        <button
          className="admin-topbar__toggle"
          type="button"
          ref={toggleRef}
          aria-expanded={menuOpen}
          aria-controls="admin-aside"
          aria-label={menuOpen ? 'Fermer le menu d’administration' : 'Ouvrir le menu d’administration'}
          onClick={() => setOpenedOn(menuOpen ? null : pathname)}
        >
          <span />
        </button>

        <p className="admin-topbar__title">Espace de pilotage</p>
      </header>

      <div className="admin__grid">
        {/* Tout clic sur un lien du tiroir le referme — y compris le lien du
            module déjà ouvert, que le changement de `pathname` ne couvrirait
            pas. Même geste que le tiroir de navigation du site public. */}
        <div
          className="admin__aside"
          id="admin-aside"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) close();
          }}
        >
          <div className="admin-brand">
            <Link className="admin-brand__mark" href="/" aria-label="MORA Shawiri — voir le site">
              <Image src="/logo-circle.png" alt="" width={32} height={32} sizes="32px" />
            </Link>
            <span className="admin-brand__text">
              MORA Shawiri
              <small>Pilotage</small>
            </span>
          </div>

          <AdminNav modules={modules} />

          {/* Remarques 01 : la déconnexion à portée de main, sous le menu —
              en permanence sur ordinateur, dans le tiroir sur téléphone. La
              même action que partout : toute la session est révoquée. */}
          <div className="admin-aside__foot">
            <SignOutButton label="Me déconnecter" variant="admin" />
          </div>
        </div>

        {/* Cible du lien d'évitement posé par le gabarit racine. Le site
            public a le sien dans `SiteChrome` ; les deux coquilles nomment
            leur contenu principal de la même manière. */}
        <main className="admin__main" id="main" data-page-transition>
          {children}
        </main>
      </div>

      {/* Voile du tiroir. Un bouton et non un `div` : il se ferme au clavier
          comme à la souris, et les lecteurs d'écran l'annoncent. */}
      <button
        className="admin__scrim"
        type="button"
        tabIndex={menuOpen ? 0 : -1}
        aria-label="Fermer le menu d’administration"
        onClick={close}
      />
    </div>
  );
}
