'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Navigation de l'espace affilié (phase 4H-8).
 *
 * Deux présentations d'une même liste, choisies par la feuille de style :
 *
 *   * **ordinateur** — une colonne latérale, toujours visible ;
 *   * **tablette et téléphone** — un menu replié qui annonce la rubrique en
 *     cours et s'ouvre d'un toucher : la liste ne repousse pas le contenu
 *     sous la ligne de flottaison et ne déborde jamais horizontalement.
 *
 * `<details>` fonctionne sans JavaScript ; chaque lien referme le menu.
 */

export const AFFILIATE_SPACE_SECTIONS = [
  { href: '/espace-affilie/', label: 'Tableau de bord' },
  { href: '/espace-affilie/affiliation/', label: 'Mon affiliation' },
  { href: '/espace-affilie/liens/', label: 'Liens & campagnes' },
  { href: '/espace-affilie/codes/', label: 'Codes partenaires' },
  { href: '/espace-affilie/prospects/', label: 'Prospects' },
  { href: '/espace-affilie/conversions/', label: 'Conversions' },
  { href: '/espace-affilie/commissions/', label: 'Commissions' },
  { href: '/espace-affilie/versements/', label: 'Versements' },
  { href: '/espace-affilie/documents/', label: 'Documents' },
  { href: '/espace-affilie/profil/', label: 'Profil & paiement' },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return href === '/espace-affilie/' ? path === href : path.startsWith(href);
}

/**
 * `clientSpace` (phase 4I-2) : pour un compte qui porte aussi le rôle CLIENT,
 * un lien de retour vers son espace client, sous la liste. Un affilié seul ne
 * le voit pas.
 */
export default function AffiliateSpaceNav({ clientSpace = false }: { clientSpace?: boolean }) {
  const pathname = usePathname() ?? '/espace-affilie/';
  const current = AFFILIATE_SPACE_SECTIONS.find((section) => isCurrent(pathname, section.href));

  const links = (
    <ul className="aff-nav__list">
      {AFFILIATE_SPACE_SECTIONS.map((section) => {
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
      {clientSpace ? (
        <li>
          <Link href="/espace-client/" className="aff-nav__link">
            Mon espace client →
          </Link>
        </li>
      ) : null}
    </ul>
  );

  return (
    <>
      <nav className="aff-nav aff-nav--side" aria-label="Espace affilié">
        {links}
      </nav>
      <details className="aff-nav aff-nav--menu">
        <summary>
          <span className="aff-nav__caption">Rubrique</span>
          <span className="aff-nav__current">{current?.label ?? 'Espace affilié'}</span>
        </summary>
        <nav aria-label="Espace affilié">{links}</nav>
      </details>
    </>
  );
}
