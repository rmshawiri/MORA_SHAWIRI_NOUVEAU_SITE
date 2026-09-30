import SectionHead from '@/components/sections/SectionHead';
import type { Testimonial } from '@/content/testimonials';

/**
 * Section « Témoignages ».
 *
 * Les témoignages sont des retours clients réels fournis dans les sources.
 * Aucun chiffre ni avis n'est inventé (cf. exigences SEO du projet).
 *
 * Depuis la phase 4E-2, les avis sont **reçus en propriété** plutôt que lus
 * directement : la page appelante les tient de `getContenus()`, qui applique la
 * surcharge administrable s'il en existe une. Le § 134 reste vrai — la
 * validation exige qu'un témoignage soit attribué (initiales, nom, rôle) et
 * aucun avis n'est fabriqué.
 */
export default function Testimonials({
  eyebrow = 'Témoignages',
  title,
  titleId,
  items,
}: {
  eyebrow?: string;
  title: string;
  titleId: string;
  items: readonly Testimonial[];
}) {
  return (
    <section className="section" aria-labelledby={titleId}>
      <div className="container">
        <SectionHead eyebrow={eyebrow} title={title} titleId={titleId} center />
        <div className="grid grid--3 reveal-group">
          {items.map((item) => (
            <figure className="quote" key={item.name}>
              <p className="quote__mark" aria-hidden="true">
                &ldquo;
              </p>
              <blockquote>{item.quote}</blockquote>
              <figcaption>
                <span className="quote__avatar" aria-hidden="true">
                  {item.initials}
                </span>
                <span>
                  <span className="quote__name">{item.name}</span>
                  <span className="quote__role">{item.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
