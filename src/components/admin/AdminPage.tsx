import type { ReactNode } from 'react';

import RefreshBar from './RefreshBar';

/**
 * En-tête commun à toutes les pages d'administration.
 *
 * Composant serveur : il calcule l'horodatage au moment du rendu, ce qui rend
 * la mention « Dernière actualisation » exacte par construction plutôt que par
 * convention. Seul le bouton est client.
 *
 * Un module qui n'affiche aucune donnée datée passe `refreshable={false}` :
 * proposer d'actualiser une page statique serait une promesse vide.
 */
export default function AdminPage({
  eyebrow,
  title,
  lead,
  refreshable = true,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  refreshable?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <header className="admin-head">
        <div className="admin-head__top">
          <div>
            {eyebrow ? <p className="admin-head__eyebrow">{eyebrow}</p> : null}
            <h1>{title}</h1>
          </div>

          {refreshable ? <RefreshBar stamp={formatStamp()} /> : null}
        </div>

        {lead ? <p className="admin-head__lead">{lead}</p> : null}
        {actions ? <div className="admin-actions">{actions}</div> : null}
      </header>

      {children}
    </>
  );
}

/**
 * Heure locale de Moroni.
 *
 * Le serveur Vercel tourne en UTC ; afficher son heure brute indiquerait
 * 11:00 à quelqu'un dont la montre marque 14:00. Le fuseau des Comores est
 * fixe (UTC+3, sans heure d'été), ce qui rend la conversion sûre.
 */
export function formatStamp(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Indian/Comoro',
  }).format(date);
}
