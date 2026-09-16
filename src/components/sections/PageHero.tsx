import Link from 'next/link';
import type { ReactNode } from 'react';

export type Crumb = { label: string; href?: string };

type PageHeroProps = {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  breadcrumb: readonly Crumb[];
  children?: ReactNode;
};

/**
 * En-tête des pages intérieures : fil d'Ariane, sur-titre, titre et accroche,
 * posés sur le fond bleu profond de la marque.
 */
export default function PageHero({ eyebrow, title, lead, breadcrumb, children }: PageHeroProps) {
  return (
    <section className="page-hero">
      <div className="page-hero__bg" aria-hidden="true" />
      <div className="container">
        <ol className="breadcrumb">
          {breadcrumb.map((crumb) => (
            <li key={crumb.label}>
              {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : crumb.label}
            </li>
          ))}
        </ol>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}
