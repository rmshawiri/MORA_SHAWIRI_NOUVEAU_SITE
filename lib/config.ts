/**
 * MORA Shawiri — Configuration publique centralisée
 * -------------------------------------------------
 * Source unique de vérité pour les données PUBLIQUES / NON SECRÈTES du site.
 * Aucun secret ici : les secrets vivent dans les variables d'environnement
 * (voir `.env.example`).
 *
 * Le domaine n'est JAMAIS codé en dur : il provient de `NEXT_PUBLIC_SITE_URL`.
 * C'est ce qui permet de passer à `shawiri.com` (ou autre) sans modifier le code.
 */

/** Domaine public officiel du site (ex: https://shawiri.com), jamais codé en dur. */
function readSiteUrl(): string {
  const value = process.env.NEXT_PUBLIC_SITE_URL;
  if (value && value.trim()) {
    if (!/^https?:\/\/.+/.test(value)) {
      throw new Error(
        "Configuration MORA Shawiri invalide : NEXT_PUBLIC_SITE_URL doit être une URL absolue (https://...).",
      );
    }
    return value.replace(/\/$/, "");
  }
  // Valeur de repli locale ; en production, NEXT_PUBLIC_SITE_URL est requis.
  return "http://localhost:3000";
}

function siteUrl(): string {
  return readSiteUrl();
}

export const siteConfig = {
  /** SITE_URL canonique (sans slash final). Configuré via NEXT_PUBLIC_SITE_URL. */
  url: siteUrl(),

  // --- Identité de marque ---
  name: "MORA Shawiri",
  slogan: "Le Choix Optimal pour votre performance",
  tagline: "Services numériques et solutions digitales aux Comores",
  description:
    "MORA Shawiri est une structure digitale indépendante basée à Moroni, Union des Comores, proposant des services numériques, administratifs, du design, des templates professionnels, des formations et des solutions digitales.",
  locale: "fr_FR",
  language: "fr",

  // --- Coordonnées publiques ---
  contact: {
    email: "contact@morashawiri.com",
    phoneDisplay: "+269 430 63 06",
    phoneE164: "+2694306306",
    whatsappNumber: "2694306306",
    whatsappUrl: "https://wa.me/2694306306",
    address: "Moroni, Magoudjou, en face de MAG Market",
    city: "Moroni",
    country: "Union des Comores",
  },

  // --- Réseaux sociaux (publics) ---
  social: {
    facebook: "https://www.facebook.com/morashawiri",
    youtube: "https://www.youtube.com/@morashawiri",
    whatsapp: "https://wa.me/2694306306",
    linkedin: "https://www.linkedin.com/in/morashawiri",
    telegram: "https://t.me/@morashawiri",
    instagram: "https://www.instagram.com/shawiridigital/",
    tiktok: "https://www.tiktok.com/@morashawiri",
  },

  // --- Navigation principale ---
  nav: [
    { label: "Accueil", href: "/" },
    { label: "Services", href: "/services" },
    { label: "Boutique", href: "/boutique" },
    { label: "Qui sommes-nous", href: "/qui-sommes-nous" },
    { label: "Affiliation", href: "/affiliation" },
    { label: "Contact", href: "/contact" },
    { label: "FAQ", href: "/faq" },
  ],

  // --- Identifiants logiques d'images administrables (placeholders) ---
  imageIds: {
    homeHero: "HOME_HERO_IMAGE",
    servicesHero: "SERVICES_HERO_IMAGE",
    boutiqueHero: "BOUTIQUE_HERO_IMAGE",
    contact: "CONTACT_IMAGE",
  },
} as const;

export type SiteConfig = typeof siteConfig;

/** URL absolue d'une page publique (ex: `${siteConfig.url}/services`). */
export function absoluteUrl(path = "/"): string {
  return `${siteConfig.url}${path.startsWith("/") ? path : `/${path}`}`;
}
