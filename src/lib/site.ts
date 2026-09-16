/**
 * Configuration publique de MORA Shawiri.
 *
 * Source : `01 Documents de référence/04_RESEAUX_ET_CONTACTS/Coordonnées.txt`
 * et l'ébauche à reproduire. Ces informations sont publiques par nature
 * (§ 116 du document des variables d'environnement) : elles n'ont pas
 * vocation à être placées dans des variables secrètes.
 */

export const site = {
  name: 'MORA Shawiri',
  slogan: 'Le Choix Optimal pour votre Performance',
  legalName: 'MORA Shawiri',
  locality: 'Moroni',
  region: 'Grande Comore',
  country: 'KM',
  addressLabel: 'Moroni — Union des Comores',
  openingHours: 'Lun. – Sam. · 08H - 17H (Heure de Moroni)',
  phone: '+269 430 63 06',
  phoneHref: 'tel:+2694306306',
  email: 'contact@morashawiri.com',
  emailHref: 'mailto:contact@morashawiri.com',
  whatsappNumber: '2694306306',
  whatsappBase: 'https://wa.me/2694306306',
  description:
    'Agence digitale à Moroni (Comores) : création de sites web et boutiques en ligne, identité visuelle, marketing digital, gestion documentaire et formations. Devis gratuit sous 48 h.',
  footerAbout:
    'Agence digitale basée à Moroni. Nous concevons des sites, des identités visuelles et des solutions numériques pour les entrepreneurs, PME, institutions et associations des Comores et du monde francophone.',
} as const;

export type SocialNetwork = {
  id: string;
  label: string;
  href: string;
};

export const socials: readonly SocialNetwork[] = [
  { id: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/morashawiri' },
  { id: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/in/morashawiri' },
  { id: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/shawiridigital/' },
  { id: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@morashawiri' },
  { id: 'tiktok', label: 'TikTok', href: 'https://www.tiktok.com/@morashawiri' },
  { id: 'telegram', label: 'Telegram', href: 'https://t.me/morashawiri' },
  { id: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/2694306306' },
] as const;

export type NavItem = { href: string; label: string };

export const mainNav: readonly NavItem[] = [
  { href: '/', label: 'Accueil' },
  { href: '/qui-sommes-nous/', label: 'Qui sommes-nous' },
  { href: '/services/', label: 'Services' },
  { href: '/formation-prospection-relation-client/', label: 'Formation' },
  { href: '/boutique/', label: 'Boutique' },
  { href: '/affiliation/', label: 'Affiliation' },
  { href: '/blog/', label: 'Blog' },
  { href: '/contact/', label: 'Contact' },
] as const;

/** Compose un lien WhatsApp avec un message pré-rempli. */
export function whatsappLink(message: string): string {
  return `${site.whatsappBase}?text=${encodeURIComponent(message)}`;
}
