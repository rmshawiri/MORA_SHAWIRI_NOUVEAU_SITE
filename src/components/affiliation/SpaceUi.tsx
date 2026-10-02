import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Briques de présentation de l'espace affilié (phase 4H-8).
 *
 * Elles ne portent que la forme, dans le vocabulaire des espaces privés
 * (`auth-card`, `auth-meta`, jetons de `espace.css`) — jamais une classe de
 * l'administration. Les listes sont des cartes empilées plutôt que des
 * tableaux : elles se lisent de la même façon sur un ordinateur et sur un
 * téléphone, sans défilement horizontal.
 */

export function SpaceCard({
  title,
  intro,
  action,
  children,
  id,
}: {
  title: string;
  intro?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="auth-card" id={id}>
      <div className="auth-card__head aff-card-head">
        <div>
          <h2>{title}</h2>
          {intro ? <p className="aff-card-intro">{intro}</p> : null}
        </div>
        {action ? <div className="aff-card-action">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** État vide : ce qui manque, pourquoi, et ce qui le fera apparaître. */
export function SpaceEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="aff-empty">
      <p className="aff-empty__title">{title}</p>
      {children ? <p className="aff-empty__text">{children}</p> : null}
    </div>
  );
}

export type Kpi = { label: string; value: string; hint?: string; tone?: 'gold' | 'green' };

export function SpaceKpis({ items, label }: { items: readonly Kpi[]; label: string }) {
  return (
    <dl className="aff-kpis" aria-label={label}>
      {items.map((item) => (
        <div key={item.label} className={item.tone ? `aff-kpi aff-kpi--${item.tone}` : 'aff-kpi'}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.hint ? <dd className="aff-kpi__hint">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** Une ligne de liste : référence, montant, statut, puis des détails. */
export function SpaceItem({
  title,
  amount,
  status,
  tone = 'todo',
  meta,
  children,
}: {
  title: ReactNode;
  amount?: string | null;
  status?: string | null;
  tone?: 'ok' | 'todo' | 'muted' | 'warn';
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="aff-item">
      <div className="aff-item__top">
        <span className="aff-item__title">{title}</span>
        {amount ? <span className="aff-item__amount">{amount}</span> : null}
      </div>
      {status || meta ? (
        <div className="aff-item__meta">
          {status ? <span className={`aff-pill aff-pill--${tone}`}>{status}</span> : null}
          {meta ? <span className="aff-item__info">{meta}</span> : null}
        </div>
      ) : null}
      {children ? <div className="aff-item__body">{children}</div> : null}
    </li>
  );
}

export function SpaceList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul className="aff-items" aria-label={label}>
      {children}
    </ul>
  );
}

export function SpaceMore({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="aff-more">
      <Link href={href}>{children}</Link>
    </p>
  );
}
