import type { ReactNode } from 'react';
import { Check } from '@/components/ui/Icon';

type HeroProps = {
  eyebrow: string;
  title: ReactNode;
  lead: string;
  actions: ReactNode;
  /** Trois preuves affichées sous l'accroche. */
  proof: readonly string[];
  /** Composition visuelle de droite (image, duo de visuels…). */
  media: ReactNode;
};

/**
 * Héros pleine largeur des pages d'entrée (accueil, page de vente).
 *
 * Le bloc texte est animé à l'arrivée par `hero__enter` : ses enfants directs
 * entrent en cascade. L'ordre des éléments conditionne donc l'animation.
 */
export default function Hero({ eyebrow, title, lead, actions, proof, media }: HeroProps) {
  return (
    <section className="hero">
      <div className="hero__bg" aria-hidden="true">
        <span className="hero__glow hero__glow--gold" />
        <span className="hero__glow hero__glow--blue" />
      </div>
      <div className="container">
        <div className="hero__grid">
          <div className="hero__enter">
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p className="hero__lead">{lead}</p>
            <div className="btn-row">{actions}</div>
            <ul className="hero__proof">
              {proof.map((item) => (
                <li key={item}>
                  <Check />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="hero__media">{media}</div>
        </div>
      </div>
    </section>
  );
}
