import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Check } from '@/components/ui/Icon';
import type { Offer } from '@/content/offers';

type OfferCardProps = {
  offer: Offer;
  /** Carte détaillée (page Boutique) ou carte courte (aperçu en page d'accueil). */
  variant?: 'full' | 'compact';
};

/**
 * Carte d'offre de la boutique.
 *
 * Le bouton transmet l'offre consultée au formulaire de demande
 * (`?offre=<identifiant>`) : le visiteur n'a pas à resaisir une information que
 * le site connaît déjà (`03_COMPOSANTS.md` § 126). La demande passe donc par la
 * route serveur et laisse une trace e-mail, ce qui n'était pas le cas du lien
 * WhatsApp direct.
 */
export default function OfferCard({ offer, variant = 'full' }: OfferCardProps) {
  const compact = variant === 'compact';
  const requestHref = offer.href ?? `/contact/?offre=${offer.id}`;

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
          sizes="(max-width: 767px) 90vw, (max-width: 1080px) 46vw, (max-width: 1400px) 31vw, 440px"
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
          ) : (
            <Link className="btn btn--primary" href={requestHref}>
              {offer.ctaLabel}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
