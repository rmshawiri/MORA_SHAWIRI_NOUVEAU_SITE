/**
 * Catalogue officiel MORA Shawiri — 14 services (source : 02_CONTENUS/02_SERVICES.md).
 * Aucune donnée inventée : prix, CTA, catégories, éligibilité affiliation et
 * correspondance d'images proviennent du document.
 *
 * En production, ces données seront lues depuis Supabase (table `services`).
 * Cette table sert de seed local / de référence tant que la base n'est pas branchée.
 */

export type PriceType = "fixed" | "quote" | "unit";

export interface Service {
  id: number;
  name: string;
  slug: string;
  category: string;
  summary: string;
  description: string;
  /** Prix en KMF, `null` si sur devis (c'est alors affiché "Sur devis"). */
  price: number | null;
  /** Unité de tarification (image, visuel, pack) ou `null`. */
  unit: string | null;
  priceType: PriceType;
  ctaPrimary: string;
  ctaSecondary: string;
  /** Le parcours principal est-il un achat direct (commande) ou un formulaire conversationnel ? */
  directPurchase: boolean;
  appointmentAvailable: boolean;
  affiliateEligible: boolean;
  /** Chemin de l'image officielle dans `/public` (via `03_IMAGES/01_IMG_SERVICES/`). */
  image: string;
}

/** Formate un prix KMF (ex: 30000 -> "30 000"). */
export function formatKmf(amount: number): string {
  return amount.toLocaleString("fr-FR").replace(/\u00a0/g, " ");
}

/** Étiquette tarifaire d'un service (prix, prix/unité, ou "Sur devis"). */
export function priceLabel(service: Pick<Service, "price" | "unit" | "priceType">): string {
  if (service.priceType === "quote" || service.price === null) {
    return "Sur devis";
  }
  return service.unit ? `${formatKmf(service.price)} KMF / ${service.unit}` : `${formatKmf(service.price)} KMF`;
}

export const services: Service[] = [
  {
    id: 1,
    name: "Assistance & Accompagnement Digital",
    slug: "accompagnement-digital",
    category: "Services Digitaux",
    summary:
      "Un accompagnement personnalisé pour résoudre un besoin numérique, choisir une solution adaptée ou avancer dans un projet.",
    description:
      "Vous avez un besoin numérique, mais vous ne savez pas comment le résoudre, quel outil utiliser ou comment avancer ? MORA Shawiri vous accompagne pour trouver et mettre en œuvre une solution adaptée à votre situation.",
    price: null,
    unit: null,
    priceType: "quote",
    ctaPrimary: "Demander un accompagnement",
    ctaSecondary: "Discuter sur WhatsApp",
    directPurchase: false,
    appointmentAvailable: true,
    affiliateEligible: true,
    image: "/services/accompagnement-digital.webp",
  },
  {
    id: 2,
    name: "Audit Stratégique Global",
    slug: "audit-strategique-global",
    category: "Audit & Accompagnement",
    summary:
      "Une analyse globale pour identifier les forces, faiblesses, blocages, opportunités et pistes d'amélioration d'une activité.",
    description:
      "Le client reçoit un diagnostic stratégique structuré accompagné de recommandations concrètes et priorisées.",
    price: 30000,
    unit: null,
    priceType: "fixed",
    ctaPrimary: "Commander mon audit",
    ctaSecondary: "Prendre rendez-vous",
    directPurchase: true,
    appointmentAvailable: true,
    affiliateEligible: true,
    image: "/services/audit-strategique-global.webp",
  },
  {
    id: 3,
    name: "Conception de Template",
    slug: "conception-de-template",
    category: "Design & Création Visuelle",
    summary:
      "Création de modèles personnalisés pour répondre à un besoin professionnel, administratif, commercial ou numérique.",
    description:
      "La prestation est adaptée au besoin réel du client : documents professionnels, fiches, présentations, supports commerciaux, modèles administratifs, supports de communication, templates numériques.",
    price: null,
    unit: null,
    priceType: "quote",
    ctaPrimary: "Demander un devis",
    ctaSecondary: "Discuter sur WhatsApp",
    directPurchase: false,
    appointmentAvailable: true,
    affiliateEligible: true,
    image: "/services/conception-de-template.webp",
  },
  {
    id: 4,
    name: "Création d'Application Mobile Professionnelle",
    slug: "creation-application-mobile",
    category: "Services Digitaux",
    summary:
      "Conception et développement d'une application mobile professionnelle adaptée aux besoins d'un projet.",
    description:
      "Analyse du besoin, définition des fonctionnalités, conception UX/UI, développement, base de données, authentification, espace utilisateur, notifications, intégrations, espace administrateur, tests, préparation au déploiement.",
    price: null,
    unit: null,
    priceType: "quote",
    ctaPrimary: "Présenter mon projet",
    ctaSecondary: "Prendre rendez-vous",
    directPurchase: false,
    appointmentAvailable: true,
    affiliateEligible: true,
    image: "/services/creation-application-mobile.webp",
  },
  {
    id: 5,
    name: "Création de Logo",
    slug: "creation-de-logo",
    category: "Design & Création Visuelle",
    summary:
      "Création d'un logo professionnel destiné à représenter l'activité, le projet ou la marque du client.",
    description:
      "Un logo professionnel conçu pour représenter votre activité, votre projet ou votre marque, avec un rendu adapté à vos usages.",
    price: 15000,
    unit: null,
    priceType: "fixed",
    ctaPrimary: "Commander mon logo",
    ctaSecondary: "Discuter sur WhatsApp",
    directPurchase: true,
    appointmentAvailable: false,
    affiliateEligible: true,
    image: "/services/creation-de-logo.webp",
  },
  {
    id: 6,
    name: "Création de SaaS Professionnel",
    slug: "creation-saas-professionnel",
    category: "Services Digitaux",
    summary:
      "Conception et développement d'une solution SaaS professionnelle, conçue pour évoluer avec l'activité.",
    description:
      "Analyse de l'idée, architecture, UX/UI, développement, gestion des utilisateurs, authentification, base de données, tableau de bord, espace administrateur, fonctionnalités métier, abonnements, paiements, notifications, intégrations, tests, déploiement.",
    price: null,
    unit: null,
    priceType: "quote",
    ctaPrimary: "Présenter mon projet",
    ctaSecondary: "Prendre rendez-vous",
    directPurchase: false,
    appointmentAvailable: true,
    affiliateEligible: true,
    image: "/services/creation-saas-professionnel.webp",
  },
  {
    id: 7,
    name: "Création de Site E-commerce",
    slug: "creation-site-ecommerce",
    category: "Services Digitaux",
    summary:
      "Création d'une boutique en ligne professionnelle pour présenter et commercialiser des produits ou des services.",
    description:
      "Conception de la boutique, catalogue, catégories, fiches produits, gestion des services, panier, commandes, paiement, gestion des clients, espace administrateur, SEO, responsive mobile, intégrations, mise en ligne.",
    price: null,
    unit: null,
    priceType: "quote",
    ctaPrimary: "Présenter mon projet",
    ctaSecondary: "Prendre rendez-vous",
    directPurchase: false,
    appointmentAvailable: true,
    affiliateEligible: true,
    image: "/services/creation-site-ecommerce.webp",
  },
  {
    id: 8,
    name: "Création de Site Vitrine",
    slug: "creation-site-vitrine",
    category: "Services Digitaux",
    summary:
      "Création d'un site professionnel pour présenter une activité, une entreprise, une marque ou un projet.",
    description:
      "Conception de la structure, design personnalisé, présentation de l'activité, des services, du fondateur ou de l'équipe, formulaire de contact, intégration WhatsApp, réseaux sociaux, responsive mobile, SEO de base, pages légales, mise en ligne.",
    price: null,
    unit: null,
    priceType: "quote",
    ctaPrimary: "Présenter mon projet",
    ctaSecondary: "Prendre rendez-vous",
    directPurchase: false,
    appointmentAvailable: true,
    affiliateEligible: true,
    image: "/services/creation-site-vitrine.webp",
  },
  {
    id: 9,
    name: "Formation — Maîtriser la Prospection et la Relation Client",
    slug: "formation-prospection-relation-client",
    category: "Formation",
    summary:
      "Formation pratique pour développer les compétences en prospection commerciale, communication professionnelle et relation client.",
    description:
      "Le prix est identique pour les deux formats (5 000 KMF). Programme : introduction, mentalité professionnelle, communication professionnelle avec les clients, développer la confiance et vaincre la peur de prospecter, techniques de prospection commerciale, WhatsApp et communication professionnelle digitale.",
    price: 5000,
    unit: null,
    priceType: "fixed",
    ctaPrimary: "S'inscrire à la formation",
    ctaSecondary: "Poser une question",
    directPurchase: true,
    appointmentAvailable: false,
    affiliateEligible: true,
    image: "/services/formation-prospection-relation-client.webp",
  },
  {
    id: 10,
    name: "Gestion Documentaire",
    slug: "gestion-documentaire",
    category: "Services Administratifs",
    summary:
      "Service destiné à aider les utilisateurs à organiser, structurer et gérer leurs documents selon leurs besoins.",
    description:
      "Classement de documents, organisation de fichiers, structuration de dossiers, saisie ou mise en forme de documents, organisation d'archives numériques, renommage et organisation de fichiers.",
    price: null,
    unit: null,
    priceType: "quote",
    ctaPrimary: "Demander un devis",
    ctaSecondary: "Discuter sur WhatsApp",
    directPurchase: false,
    appointmentAvailable: true,
    affiliateEligible: true,
    image: "/services/gestion-documentaire.webp",
  },
  {
    id: 11,
    name: "Offre Basique — Optimisation Image Produit",
    slug: "offre-basique-optimisation-image-produit",
    category: "Design & Création Visuelle",
    summary:
      "Prestation standardisée pour améliorer et optimiser une image de produit fournie, pour un usage professionnel ou commercial.",
    description:
      "250 KMF par image. Le client peut commander plusieurs images ; le système calcule automatiquement le montant selon la quantité.",
    price: 250,
    unit: "image",
    priceType: "unit",
    ctaPrimary: "Commander l'offre",
    ctaSecondary: "Discuter sur WhatsApp",
    directPurchase: true,
    appointmentAvailable: false,
    affiliateEligible: true,
    image: "/services/offre-basique-optimisation-image-produit.webp",
  },
  {
    id: 12,
    name: "Offre Premium — Pack Branding Marketplace",
    slug: "offre-premium-pack-branding-marketplace",
    category: "Design & Création Visuelle",
    summary:
      "Pack pour donner à une marque une présence visuelle professionnelle, cohérente et reconnaissable sur une marketplace.",
    description:
      "750 KMF par pack. 8 livrables principaux + harmonisation : 1 adaptation du logo, 1 visuel de profil, 1 bannière marketplace, 1 visuel de présentation de marque, 3 visuels produits, 1 mini-charte visuelle marketplace.",
    price: 750,
    unit: "pack",
    priceType: "unit",
    ctaPrimary: "Commander le pack",
    ctaSecondary: "Discuter sur WhatsApp",
    directPurchase: true,
    appointmentAvailable: false,
    affiliateEligible: true,
    image: "/services/offre-premium-pack-branding-marketplace.webp",
  },
  {
    id: 13,
    name: "Offre Pro — Création de Visuel Produit Marketing",
    slug: "offre-pro-creation-visuel-produit-marketing",
    category: "Design & Création Visuelle",
    summary:
      "Création d'un visuel marketing professionnel pour mettre en valeur un produit et améliorer sa présentation commerciale.",
    description:
      "500 KMF par visuel. Intégration du produit, composition graphique, mise en scène, arrière-plan adapté, éléments graphiques, mise en valeur du produit, texte commercial court, harmonisation, export pour le web.",
    price: 500,
    unit: "visuel",
    priceType: "unit",
    ctaPrimary: "Commander le visuel",
    ctaSecondary: "Discuter sur WhatsApp",
    directPurchase: true,
    appointmentAvailable: false,
    affiliateEligible: true,
    image: "/services/offre-pro-creation-visuel-produit-marketing.webp",
  },
  {
    id: 14,
    name: "Saisie de Données",
    slug: "saisie-de-donnees",
    category: "Services Administratifs",
    summary:
      "Prestation pour déléguer les tâches de saisie et de traitement de données et gagner du temps.",
    description:
      "Saisie de données, transcription dans des tableaux, transfert d'informations d'un support à un autre, classement, mise en forme, saisie dans Excel, traitement de listes, organisation de données fournies par le client.",
    price: null,
    unit: null,
    priceType: "quote",
    ctaPrimary: "Demander un devis",
    ctaSecondary: "Discuter sur WhatsApp",
    directPurchase: false,
    appointmentAvailable: true,
    affiliateEligible: true,
    image: "/services/saisie-de-donnees.webp",
  },
];

/** Retourne un service par slug. */
export function getServiceBySlug(slug: string): Service | undefined {
  return services.find((s) => s.slug === slug);
}

/** Services éligibles à une mise en avant (publiés et disponibles). */
export const featuredServices = services
  .filter((s) => s.directPurchase || s.priceType === "fixed")
  .slice(0, 4);

export const serviceCategories = Array.from(
  new Set(services.map((s) => s.category)),
);
