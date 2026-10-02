'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Navigation de l'espace client (phase 4I).
 *
 * Même patron que l'espace affilié, et mêmes classes d'`espace.css` : une
 * colonne latérale sur ordinateur, un menu replié (`<details>`, sans
 * JavaScript) sur tablette et téléphone.
 *
 * Seules les rubriques réellement construites y figurent : une rubrique
 * annoncée avant d'exister serait une fonction présentée comme active
 * (§ 148). Les suivantes s'ajoutent lot par lot.
 *
 * L'espace affilié reste un espace distinct (§ 141-143) : pour un compte qui
 * porte aussi le rôle AFFILIE, un lien séparé y conduit, sous la liste.
 */

export const CLIENT_SPACE_SECTIONS = [
  { href: '/espace-client/', label: 'Tableau de bord' },
  { href: '/espace-client/profil/', label: 'Mon profil' },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return href === '/espace-client/' ? path === href : path.startsWith(href);
}

export default function ClientSpaceNav({ affiliate }: { affiliate: boolean }) {
  const pathname = usePathname() ?? '/espace-client/';
  const current = CLIENT_SPACE_SECTIONS.find((section) => isCurrent(pathname, section.href));

  const links = (
    <ul className="aff-nav__list">
      {CLIENT_SPACE_SECTIONS.map((section) => {
        const active = isCurrent(pathname, section.href);
        return (
          <li key={section.href}>
            <Link
              href={section.href}
              className={`aff-nav__link${active ? ' is-current' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}
            >
              {section.label}
            </Link>
          </li>
        );
      })}
      {affiliate ? (
        <li>
          <Link href="/espace-affilie/" className="aff-nav__link">
            Mon espace affilié →
          </Link>
        </li>
      ) : null}
    </ul>
  );

  return (
    <>
      <nav className="aff-nav aff-nav--side" aria-label="Espace client">
        {links}
      </nav>
      <details className="aff-nav aff-nav--menu">
        <summary>
          <span className="aff-nav__caption">Rubrique</span>
          <span className="aff-nav__current">{current?.label ?? 'Espace client'}</span>
        </summary>
        <nav aria-label="Espace client">{links}</nav>
      </details>
    </>
  );
}
