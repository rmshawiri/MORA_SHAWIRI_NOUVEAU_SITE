import SectionHead from '@/components/sections/SectionHead';
import { testimonials } from '@/content/testimonials';

/**
 * Section « Témoignages ».
 *
 * Les témoignages sont des retours clients réels fournis dans les sources.
 * Aucun chiffre ni avis n'est inventé (cf. exigences SEO du projet).
 */
export default function Testimonials({
  eyebrow = 'Témoignages',
  title,
  titleId,
}: {
  eyebrow?: string;
  title: string;
  titleId: string;
}) {
  return (
    <section className="section" aria-labelledby={titleId}>
      <div className="container">
        <SectionHead eyebrow={eyebrow} title={title} titleId={titleId} center />
        <div className="grid grid--3 reveal-group">
          {testimonials.map((item) => (
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
