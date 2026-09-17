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
  /**
   * Chemin de la page courante. Renseigné, il active la garde qui empêche le
   * bandeau de proposer la page déjà affichée (`06_CONTACT.md` § 47 : un CTA ne
   * doit pas mentir sur sa destination).
   */
  currentPath?: string;
};

/**
 * Bandeau d'appel à l'action présent en fin de chaque page :
 * rendez-vous, action principale, WhatsApp.
 *
 * Deux gardes techniques : aucun bouton ne pointe vers la page courante, et le
 * bouton « Prendre rendez-vous » s'efface lorsque l'action principale mène déjà
 * au même endroit — pour ne jamais afficher deux fois la même destination.
 */
export default function CtaBand({
  title,
  text,
  primaryLabel,
  primaryHref = '/contact/',
  whatsappMessage,
  currentPath,
}: CtaBandProps) {
  const candidates = [
    { key: 'rdv', label: 'Prendre rendez-vous', href: '/rendez-vous/', primary: false },
    { key: 'primary', label: primaryLabel, href: primaryHref, primary: true },
  ];

  const links = candidates.filter((item) => {
    if (item.href === currentPath) return false;
    if (!item.primary && item.href === primaryHref) return false;
    return true;
  });

  return (
    <section className="section">
      <div className="container">
        <div className="cta-band reveal">
          <div className="cta-band__body">
            <h2>{title}</h2>
            <p>{text}</p>
          </div>
          <div className="btn-row">
            {links.map((item) =>
              item.primary ? (
                <Link className="btn btn--gold btn--lg" href={item.href} key={item.key}>
                  {item.label} <ArrowRight />
                </Link>
              ) : (
                <Link className="btn btn--light btn--lg" href={item.href} key={item.key}>
                  {item.label}
                </Link>
              ),
            )}
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
