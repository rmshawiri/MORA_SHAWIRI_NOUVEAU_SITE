export type Offer = {
  id: string;
  tag: string;
  /** Étiquette raccourcie utilisée dans l'aperçu de la page d'accueil. */
  featuredTag?: string;
  title: string;
  /** Description complète (page Boutique). */
  description: string;
  /** Description courte (aperçu en page d'accueil). */
  shortDescription: string;
  benefits: readonly string[];
  price: string;
  priceNote: string;
  image: string;
  ctaLabel: string;
  /** Lien interne éventuel ; sans lien, le bouton ouvre WhatsApp. */
  href?: string;
};

/**
 * Les douze offres de la boutique, reprises de l'ébauche.
 * Les tarifs restent « sur devis » à l'exception de la formation, seule
 * prestation dont le prix est publié dans les sources (5 000 KMF).
 */
export const offers: readonly Offer[] = [
  {
    id: 'site-vitrine',
    tag: 'Site web',
    featuredTag: 'Site vitrine',
    title: 'Création de site vitrine professionnel',
    description:
      'Présentez votre activité avec un site moderne qui inspire confiance : structure claire, contenus soignés, chargement rapide.',
    shortDescription:
      'Présentez votre activité avec un site moderne, responsive et optimisé pour le référencement.',
    benefits: [
      'Design responsive et optimisé SEO',
      'Rédaction et intégration des contenus',
      'Formation à la mise à jour incluse',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-site-vitrine.webp',
    ctaLabel: 'Demander un devis',
  },
  {
    id: 'ecommerce',
    tag: 'Site web',
    title: 'Création de site e-commerce',
    description:
      'Vendez vos produits en ligne avec une boutique claire, rassurante et simple à administrer au quotidien.',
    shortDescription:
      'Vendez en ligne avec une boutique moderne : catalogue, paiement et suivi des commandes.',
    benefits: [
      'Catalogue, fiches produits et stocks',
      'Paiement sécurisé et suivi des commandes',
      'Tableau de bord des ventes',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-ecommerce.webp',
    ctaLabel: 'Demander un devis',
  },
  {
    id: 'logo',
    tag: 'Identité visuelle',
    featuredTag: 'Identité',
    title: 'Création de logo professionnel',
    description:
      'Un logo original et mémorable qui installe votre crédibilité et se décline sur tous vos supports.',
    shortDescription:
      'Un logo original, mémorable et déclinable sur tous vos supports, livré avec ses fichiers sources.',
    benefits: [
      'Plusieurs propositions créatives',
      'Déclinaisons couleur, mono et favicon',
      'Fichiers sources livrés',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-logo.webp',
    ctaLabel: 'Demander un devis',
  },
  {
    id: 'templates',
    tag: 'Supports',
    title: 'Conception de templates professionnels',
    description:
      'Des modèles prêts à l’emploi, personnalisés à votre identité : CV, factures, présentations, publications, flyers.',
    shortDescription:
      'Des modèles prêts à l’emploi, personnalisés à votre identité et faciles à modifier.',
    benefits: [
      'Modèles conçus selon votre charte',
      'Formats Canva, PPTX, DOCX, XLSX, PDF',
      'Faciles à modifier vous-même',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-templates.webp',
    ctaLabel: 'Demander un devis',
  },
  {
    id: 'gestion-documentaire',
    tag: 'Organisation',
    title: 'Gestion documentaire professionnelle',
    description:
      'Organisez, classez et sécurisez vos documents : vous retrouvez la bonne information en quelques secondes.',
    shortDescription:
      'Organisez, classez et sécurisez vos documents pour retrouver l’information en quelques secondes.',
    benefits: [
      'Arborescence de classement sur mesure',
      'Archivage sécurisé et sauvegardes',
      'Procédures de partage et d’accès',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-gestion-documentaire.webp',
    ctaLabel: 'Demander un devis',
  },
  {
    id: 'saisie-donnees',
    tag: 'Organisation',
    title: 'Service de saisie de données',
    description:
      'Confiez-nous vos tâches de saisie : un travail précis, rapide et confidentiel, livré dans les délais convenus.',
    shortDescription:
      'Un travail de saisie précis, rapide et confidentiel, livré dans les délais convenus.',
    benefits: [
      'Saisie vérifiée et contrôlée',
      'Données structurées et exploitables',
      'Confidentialité garantie',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-saisie-donnees.webp',
    ctaLabel: 'Demander un devis',
  },
  {
    id: 'audit',
    tag: 'Conseil',
    title: 'Audit stratégique global',
    description:
      'Analyse complète de vos activités, processus et organisation, avec des recommandations opérationnelles concrètes.',
    shortDescription:
      'Analyse complète de vos activités, processus et organisation, avec des recommandations concrètes.',
    benefits: [
      'Forces, faiblesses et opportunités',
      'Optimisation des processus',
      'Plan d’action priorisé',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-audit.webp',
    ctaLabel: 'Demander un devis',
  },
  {
    id: 'assistance',
    tag: 'Conseil',
    title: 'Assistance & accompagnement digital',
    description:
      'Un accompagnement pratique sur vos outils et vos tâches numériques, aussi longtemps que nécessaire.',
    shortDescription:
      'Un accompagnement pratique sur vos outils numériques, aussi longtemps que nécessaire.',
    benefits: [
      'Support technique personnalisé',
      'Création d’affiches et de visuels',
      'Prise en main de vos outils',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-assistance.webp',
    ctaLabel: 'Demander un devis',
  },
  {
    id: 'formation-prospection',
    tag: 'Formation',
    title: 'Maîtriser la prospection et la relation client',
    description:
      'Formation professionnelle en communication commerciale : trouvez des clients et fidélisez-les durablement.',
    shortDescription:
      'Formation professionnelle en communication commerciale : trouvez des clients et fidélisez-les.',
    benefits: [
      'Prospection et relation client',
      'WhatsApp professionnel et scripts',
      'Support, exercices et certificat',
    ],
    price: '5 000 KMF',
    priceNote: 'Présentiel ou à distance',
    image: '/images/offre-formation-prospection.webp',
    ctaLabel: 'Voir la formation',
    href: '/formation-prospection-relation-client/',
  },
  {
    id: 'visuel-basique',
    tag: 'Visuels produits',
    title: 'Offre Basique — Optimisation d’images produits',
    description:
      'Transformez vos photos produits en visuels professionnels : fond propre, lumière optimisée, format marketplace.',
    shortDescription:
      'Transformez vos photos produits en visuels professionnels, prêts pour les marketplaces.',
    benefits: [
      'Détourage et fond professionnel',
      'Retouche lumière et couleurs',
      'Formats adaptés aux marketplaces',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-visuel-basique.webp',
    ctaLabel: 'Demander un devis',
  },
  {
    id: 'visuel-pro',
    tag: 'Visuels produits',
    title: 'Offre Pro — Création de visuels produits marketing',
    description:
      'Des visuels conçus pour attirer l’attention et déclencher l’achat sur vos fiches et vos réseaux sociaux.',
    shortDescription:
      'Des visuels conçus pour attirer l’attention et déclencher l’achat sur vos fiches produits.',
    benefits: [
      'Design marketing premium',
      'Mise en valeur du produit',
      'Optimisé pour la conversion',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-visuel-pro.webp',
    ctaLabel: 'Demander un devis',
  },
  {
    id: 'visuel-premium',
    tag: 'Visuels produits',
    title: 'Offre Premium — Pack branding marketplace',
    description:
      'Une identité vendeur complète : visuels produits, bannières, descriptions et branding de boutique.',
    shortDescription:
      'Une identité vendeur complète : visuels, bannières, descriptions et branding de boutique.',
    benefits: [
      'Images produits premium',
      'Bannières et branding boutique',
      'Descriptions vendeuses rédigées',
    ],
    price: 'Sur devis',
    priceNote: 'Réponse sous 48 h',
    image: '/images/offre-visuel-premium.webp',
    ctaLabel: 'Demander un devis',
  },
] as const;

/** Les trois offres mises en avant sur la page d'accueil. */
const featuredOfferIds = ['site-vitrine', 'logo', 'audit'] as const;

export const featuredOffers = featuredOfferIds
  .map((id) => offers.find((offer) => offer.id === id))
  .filter((offer): offer is Offer => offer !== undefined);
