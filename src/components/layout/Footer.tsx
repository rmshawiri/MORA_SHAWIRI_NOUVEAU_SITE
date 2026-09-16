import Image from 'next/image';
import Link from 'next/link';
import LegalLinks from '@/components/layout/LegalLinks';
import { Clock, Mail, MapPin, Phone, socialIcons } from '@/components/ui/Icon';
import { site, socials } from '@/lib/site';

const navigateLinks = [
  { href: '/', label: 'Accueil' },
  { href: '/qui-sommes-nous/', label: 'Qui sommes-nous' },
  { href: '/services/', label: 'Services' },
  { href: '/boutique/', label: 'Boutique' },
];

const resourceLinks = [
  { href: '/rendez-vous/', label: 'Prendre rendez-vous' },
  { href: '/affiliation/', label: 'Programme d’affiliation' },
  { href: '/formation-prospection-relation-client/', label: 'Formation prospection' },
  { href: '/blog/', label: 'Blog & conseils' },
  { href: '/contact/', label: 'Nous contacter' },
  { href: '/contact/', label: 'Demander un devis' },
];

/** Pied de page commun à toutes les pages du site. */
export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Link className="brand" href="/">
              <Image src="/logo-circle.png" alt="Logo MORA Shawiri" width={46} height={46} sizes="46px" />
              <span className="brand__name">
                MORA Shawiri<small>{site.slogan}</small>
              </span>
            </Link>
            <p className="footer-about">{site.footerAbout}</p>
            <div className="social">
              {socials.map((network) => {
                const IconComponent = socialIcons[network.id];
                return (
                  <a
                    key={network.id}
                    href={network.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${network.label} de MORA Shawiri`}
                  >
                    {IconComponent ? <IconComponent /> : null}
                  </a>
                );
              })}
            </div>
          </div>

          <nav aria-label="Navigation du pied de page">
            <h2 className="footer-heading">Naviguer</h2>
            <ul className="footer-links">
              {navigateLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Ressources">
            <h2 className="footer-heading">Ressources</h2>
            <ul className="footer-links">
              {resourceLinks.map((link) => (
                <li key={link.label}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="footer-heading">Contact</h2>
            <ul className="footer-contact">
              <li>
                <MapPin />
                <span>{site.addressLabel}</span>
              </li>
              <li>
                <Phone />
                <a href={site.phoneHref}>{site.phone}</a>
              </li>
              <li>
                <Mail />
                <a href={site.emailHref}>{site.email}</a>
              </li>
              <li>
                <Clock />
                <span>{site.openingHours}</span>
              </li>
            </ul>
            <div className="footer-cta">
              <Link className="btn btn--gold" href="/rendez-vous/">
                Prendre rendez-vous
              </Link>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} MORA Shawiri — Tous droits réservés.</p>
          <LegalLinks />
        </div>
      </div>
    </footer>
  );
}
