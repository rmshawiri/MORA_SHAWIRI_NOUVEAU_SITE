import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Check } from '@/components/ui/Icon';
import type { Offer } from '@/content/offers';
import { whatsappLink } from '@/lib/site';

type OfferCardProps = {
  offer: Offer;
  /** Carte détaillée (page Boutique) ou carte courte (aperçu en page d'accueil). */
  variant?: 'full' | 'compact';
};

/** Carte d'offre de la boutique. */
export default function OfferCard({ offer, variant = 'full' }: OfferCardProps) {
  const compact = variant === 'compact';

  return (
    <article className="card offer">
      <div className="offer__media">
        <span className="badge offer__tag">
          {compact ? (offer.featuredTag ?? offer.tag) : offer.tag}
        </span>
        <Image
          src={offer.image}
          alt={`${offer.title} — MORA Shawiri`}
          width={1024}
          height={1024}
          sizes="(max-width: 767px) 100vw, (max-width: 1080px) 50vw, 33vw"
          loading="lazy"
        />
      </div>
      <div className="offer__body">
        <h3>{offer.title}</h3>
        <p>{compact ? offer.shortDescription : offer.description}</p>

        {!compact && (
          <ul className="offer__benefits">
            {offer.benefits.map((benefit) => (
              <li key={benefit}>
                <Check size={14} strokeWidth={3} />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="offer__foot">
          <p className="offer__price">
            {offer.price}
            <small>{offer.priceNote}</small>
          </p>

          {compact ? (
            <Link className="arrow-link" href="/boutique/">
              Voir l’offre <ArrowRight />
            </Link>
          ) : offer.href ? (
            <Link className="btn btn--primary" href={offer.href}>
              {offer.ctaLabel}
            </Link>
          ) : (
            <a
              className="btn btn--primary"
              href={whatsappLink(
                `Bonjour MORA Shawiri, je souhaite un devis pour l’offre « ${offer.title} ».`,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              {offer.ctaLabel}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
