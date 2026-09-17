/**
 * Catalogue de la Boutique.
 *
 * Source de vérité : `01 Documents de référence/02_CONTENUS/02_SERVICES.md`
 * (§ 66 tableau récapitulatif officiel, § 67 prix officiels) et
 * `08_BOUTIQUE.md` (§ 7 deux univers, § 12 prix, § 14 CTA différenciés).
 *
 * Les quatorze services du catalogue officiel y figurent. Six d'entre eux ont
 * un prix public validé ; les autres restent sur devis parce que leur périmètre
 * dépend du projet. Aucun prix n'est inventé.
 */

/** Familles d'offres de la Boutique (`08_BOUTIQUE.md` § 7). */
export type OfferFamily = 'service' | 'produit';

/** Regroupement de lecture à l'intérieur de l'univers « Services ». */
export type OfferGroupId = 'presence' | 'identite' | 'organisation' | 'conseil';

export type Offer = {
  id: string;
  family: OfferFamily;
  group: OfferGroupId;
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
  /** Montant en KMF lorsqu’un prix public est validé — alimente les données structurées. */
  priceAmount?: number;
  image: string;
  ctaLabel: string;
  /**
   * Valeur transmise au champ « Votre besoin » du formulaire de contact.
   * Elle doit correspondre exactement à une option de `CONTACT_SUBJECTS`.
   */
  requestSubject: string;
  /** Lien interne éventuel ; sans lien, le CTA mène au formulaire contextualisé. */
  href?: string;
};

export const offerGroups: readonly { id: OfferGroupId; title: string }[] = [
  { id: 'presence', title: 'Présence en ligne' },
  { id: 'identite', title: 'Identité & visuels' },
  { id: 'organisation', title: 'Organisation & données' },
  { id: 'conseil', title: 'Conseil & formation' },
] as const;

export const offers: readonly Offer[] = [
  {
    id: 'site-vitrine',
    family: 'service',
    group: 'presence',
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
    priceNote: 'Selon le périmètre du projet',
    image: '/images/offre-site-vitrine.webp',
    ctaLabel: 'Présenter mon projet',
    requestSubject: 'Site vitrine',
  },
  {
    id: 'ecommerce',
    family: 'service',
    group: 'presence',
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
    priceNote: 'Selon le périmètre du projet',
    image: '/images/offre-ecommerce.webp',
    ctaLabel: 'Présenter mon projet',
    requestSubject: 'Boutique e-commerce',
  },
  {
    id: 'application-mobile',
    family: 'service',
    group: 'presence',
    tag: 'Développement',
    title: 'Création d’application mobile professionnelle',
    description:
      'Conception et développement d’une application mobile professionnelle adaptée aux besoins de votre projet. Le périmètre exact est défini avec vous avant de commencer.',
    shortDescription:
      'Conception et développement d’une application mobile adaptée aux besoins de votre projet.',
    benefits: [
      'Analyse du besoin et conception UX/UI',
      'Développement, base de données et authentification',
      'Espace utilisateur, notifications et intégrations',
    ],
    price: 'Sur devis',
    priceNote: 'Selon le périmètre du projet',
    image: '/images/offre-app-mobile.webp',
    ctaLabel: 'Présenter mon projet',
    requestSubject: 'Application mobile',
  },
  {
    id: 'saas',
    family: 'service',
    group: 'presence',
    tag: 'Développement',
    title: 'Création de SaaS professionnel',
    description:
      'Conception et développement d’une solution SaaS professionnelle destinée à répondre aux besoins de votre projet et à évoluer avec votre activité.',
    shortDescription:
      'Une solution SaaS conçue pour répondre à votre besoin et évoluer avec votre activité.',
    benefits: [
      'Architecture, UX/UI et développement',
      'Gestion des utilisateurs et tableau de bord',
      'Espace administrateur et fonctionnalités métier',
    ],
    price: 'Sur devis',
    priceNote: 'Selon le périmètre du projet',
    image: '/images/offre-saas.webp',
    ctaLabel: 'Présenter mon projet',
    requestSubject: 'Logiciel / SaaS',
  },
  {
    id: 'logo',
    family: 'service',
    group: 'identite',
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
    price: '15 000 KMF',
    priceAmount: 15000,
    priceNote: 'Tarif fixe',
    image: '/images/offre-logo.webp',
    ctaLabel: 'Demander cette offre',
    requestSubject: 'Identité visuelle / logo',
  },
  {
    id: 'templates',
    family: 'service',
    group: 'identite',
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
    priceNote: 'Selon le périmètre du projet',
    image: '/images/offre-templates.webp',
    ctaLabel: 'Demander un devis',
    requestSubject: 'Templates et supports',
  },
  {
    id: 'visuel-basique',
    family: 'service',
    group: 'identite',
    tag: 'Visuels produits',
    title: 'Offre Basique — Optimisation d’images produits',
    description:
      'Transformez vos photos produits en visuels professionnels : fond propre, lumière optimisée, format marketplace.',
    shortDescription:
      'Transformez vos photos produits en visuels professionnels, prêts pour les marketplaces.',
    benefits: [
      'Détourage et fond professionnel',
      'Retouche lumière et couleurs',
      '5 images : 1 250 KMF · 10 images : 2 500 KMF',
    ],
    price: '250 KMF',
    priceAmount: 250,
    priceNote: 'par image',
    image: '/images/offre-visuel-basique.webp',
    ctaLabel: 'Demander cette offre',
    requestSubject: 'Visuels produits',
  },
  {
    id: 'visuel-pro',
    family: 'service',
    group: 'identite',
    tag: 'Visuels produits',
    title: 'Offre Pro — Création de visuels produits marketing',
    description:
      'Des visuels conçus pour attirer l’attention et déclencher l’achat sur vos fiches et vos réseaux sociaux.',
    shortDescription:
      'Des visuels conçus pour attirer l’attention et déclencher l’achat sur vos fiches produits.',
    benefits: [
      'Design marketing premium',
      'Mise en valeur du produit',
      '3 visuels : 1 500 KMF · 5 visuels : 2 500 KMF',
    ],
    price: '500 KMF',
    priceAmount: 500,
    priceNote: 'par visuel',
    image: '/images/offre-visuel-pro.webp',
    ctaLabel: 'Demander cette offre',
    requestSubject: 'Visuels produits',
  },
  {
    id: 'visuel-premium',
    family: 'service',
    group: 'identite',
    tag: 'Visuels produits',
    title: 'Offre Premium — Pack branding marketplace',
    description:
      'Une identité vendeur complète : adaptation du logo, visuel de profil, bannière, visuel de marque, 3 visuels produits et mini-charte marketplace.',
    shortDescription:
      'Une identité vendeur complète : visuels, bannières, descriptions et branding de boutique.',
    benefits: [
      'Logo adapté, visuel de profil et bannière',
      '3 visuels produits et visuel de marque',
      'Mini-charte visuelle marketplace',
    ],
    price: '750 KMF',
    priceAmount: 750,
    priceNote: 'par pack',
    image: '/images/offre-visuel-premium.webp',
    ctaLabel: 'Demander cette offre',
    requestSubject: 'Visuels produits',
  },
  {
    id: 'gestion-documentaire',
    family: 'service',
    group: 'organisation',
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
    priceNote: 'Selon le périmètre du projet',
    image: '/images/offre-gestion-documentaire.webp',
    ctaLabel: 'Demander un devis',
    requestSubject: 'Gestion documentaire / données',
  },
  {
    id: 'saisie-donnees',
    family: 'service',
    group: 'organisation',
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
    priceNote: 'Selon le périmètre du projet',
    image: '/images/offre-saisie-donnees.webp',
    ctaLabel: 'Demander un devis',
    requestSubject: 'Gestion documentaire / données',
  },
  {
    id: 'audit',
    family: 'service',
    group: 'conseil',
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
    price: '30 000 KMF',
    priceAmount: 30000,
    priceNote: 'Tarif fixe',
    image: '/images/offre-audit.webp',
    ctaLabel: 'Demander cette offre',
    requestSubject: 'Audit stratégique',
  },
  {
    id: 'assistance',
    family: 'service',
    group: 'conseil',
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
    priceNote: 'Selon le périmètre du projet',
    image: '/images/offre-assistance.webp',
    ctaLabel: 'Demander un accompagnement',
    requestSubject: 'Assistance et accompagnement',
  },
  {
    id: 'formation-prospection',
    family: 'service',
    group: 'conseil',
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
    priceAmount: 5000,
    priceNote: 'En ligne ou en présentiel',
    image: '/images/offre-formation-prospection.webp',
    ctaLabel: 'Voir la formation',
    requestSubject: 'Formation',
    href: '/formation-prospection-relation-client/',
  },
] as const;

/** Les trois offres mises en avant sur la page d'accueil. */
const featuredOfferIds = ['site-vitrine', 'logo', 'audit'] as const;

export const featuredOffers = featuredOfferIds
  .map((id) => offers.find((offer) => offer.id === id))
  .filter((offer): offer is Offer => offer !== undefined);

/** Offres de l'univers « Services », regroupées dans l'ordre de `offerGroups`. */
export const serviceGroups = offerGroups
  .map((group) => ({
    ...group,
    items: offers.filter((offer) => offer.family === 'service' && offer.group === group.id),
  }))
  .filter((group) => group.items.length > 0);

/** Retrouve une offre à partir de l'identifiant transmis dans une URL. */
export function findOffer(id: string | null | undefined): Offer | undefined {
  if (!id) return undefined;
  return offers.find((offer) => offer.id === id);
}
