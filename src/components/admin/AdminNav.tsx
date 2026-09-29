'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  MODULE_GROUP_LABELS,
  MODULE_GROUP_ORDER,
  type AdminModule,
  type ModuleGroup,
} from '@/lib/rbac/modules';

/**
 * Barre latérale de l'administration.
 *
 * Composant client pour une seule raison : marquer l'entrée courante d'après
 * l'URL. Tout le reste — quels modules apparaissent — a été décidé côté
 * serveur et lui est transmis déjà filtré.
 *
 * ## Ce que ce composant ne fait pas
 *
 * Il ne protège rien. Un module absent de cette liste reste atteignable en
 * tapant son adresse ; c'est le garde de la page qui répond, et il répond 404.
 * Masquer une entrée évite de proposer une porte fermée, rien de plus — le
 * § 102 du tableau de bord demande la discrétion, pas la dissimulation.
 *
 * ## Pourquoi les modules à venir figurent quand même
 *
 * Le § 171 interdit de simuler une fonctionnalité absente, pas de dire qu'elle
 * viendra. Les afficher marqués « à venir » donne à l'administration sa forme
 * définitive dès maintenant : les phases suivantes remplissent des écrans
 * annoncés plutôt que de déplacer le menu à chaque livraison.
 */
export default function AdminNav({ modules }: { modules: readonly AdminModule[] }) {
  const pathname = usePathname();

  const groups = MODULE_GROUP_ORDER.map((group) => ({
    group,
    entries: modules.filter((module) => module.group === group),
  })).filter((entry) => entry.entries.length > 0);

  return (
    <nav className="admin-nav" aria-label="Sections de l’administration">
      {groups.map(({ group, entries }) => (
        <div className="admin-nav__group" key={group}>
          <p className="admin-nav__title">{MODULE_GROUP_LABELS[group as ModuleGroup]}</p>

          <ul>
            {entries.map((module) => (
              <li key={module.href}>
                <Link
                  className="admin-nav__link"
                  href={module.href}
                  aria-current={isCurrent(pathname, module.href) ? 'page' : undefined}
                >
                  <span>{module.label}</span>
                  {module.status === 'A_VENIR' ? (
                    <span className="admin-nav__soon">à venir</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Le tableau de bord est la racine : sans l'égalité stricte, il serait marqué
 * courant sur toutes les pages, puisque toutes commencent par son chemin.
 */
function isCurrent(pathname: string | null, href: string): boolean {
  if (!pathname) return false;

  const current = pathname.endsWith('/') ? pathname : `${pathname}/`;
  if (href === '/administration/') return current === href;

  return current === href || current.startsWith(href);
}
