import Link from 'next/link';
import { ArrowRight } from '@/components/ui/Icon';
import { whatsappLink } from '@/lib/site';

type CtaBandProps = {
  title: string;
  text: string;
  /** Libellé du bouton or (action principale). */
  primaryLabel: string;
  primaryHref?: string;
  /** Message pré-rempli du bouton WhatsApp. */
  whatsappMessage: string;
};

/**
 * Bandeau d'appel à l'action présent en fin de chaque page :
 * rendez-vous, devis, WhatsApp.
 */
export default function CtaBand({
  title,
  text,
  primaryLabel,
  primaryHref = '/contact/',
  whatsappMessage,
}: CtaBandProps) {
  return (
    <section className="section">
      <div className="container">
        <div className="cta-band reveal">
          <div className="cta-band__body">
            <h2>{title}</h2>
            <p>{text}</p>
          </div>
          <div className="btn-row">
            <Link className="btn btn--light btn--lg" href="/rendez-vous/">
              Prendre rendez-vous
            </Link>
            <Link className="btn btn--gold btn--lg" href={primaryHref}>
              {primaryLabel} <ArrowRight />
            </Link>
            <a
              className="btn btn--light btn--lg"
              href={whatsappLink(whatsappMessage)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Parler sur WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
