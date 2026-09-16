import type { FaqItem } from '@/components/sections/Faq';

export type ServicePole = {
  id: string;
  icon: 'globe' | 'cart' | 'palette' | 'chart' | 'database' | 'graduation';
  title: string;
  /** Description reprise également dans les données structurées. */
  description: string;
  points: readonly string[];
};

/** Les six pôles d'expertise détaillés sur la page Services. */
export const servicePoles: readonly ServicePole[] = [
  {
    id: 'web',
    icon: 'globe',
    title: 'Sites vitrines & institutionnels',
    description:
      'Votre site devient votre meilleur commercial : disponible en permanence, crédible, et construit pour transformer une visite en prise de contact.',
    points: [
      'Architecture et arborescence pensées pour la conversion',
      'Rédaction et optimisation des contenus',
      'Responsive vérifié du petit smartphone au grand écran',
      'Référencement technique de départ inclus',
    ],
  },
  {
    id: 'ecommerce',
    icon: 'cart',
    title: 'Boutiques en ligne',
    description:
      'Vendez au-delà de votre quartier avec une boutique claire, rassurante et simple à administrer au quotidien.',
    points: [
      'Catalogue, fiches produits et gestion des stocks',
      'Moyens de paiement adaptés au contexte local',
      'Suivi des commandes et notifications clients',
      'Formation à la gestion autonome de la boutique',
    ],
  },
  {
    id: 'design',
    icon: 'palette',
    title: 'Identité visuelle & design graphique',
    description:
      'Une identité cohérente qui inspire confiance dès le premier regard, sur vos supports imprimés comme numériques.',
    points: [
      'Création de logo et déclinaisons',
      'Charte graphique : couleurs, typographies, usages',
      'Visuels produits et bannières marketplace',
      'Templates : CV, factures, présentations, flyers',
    ],
  },
  {
    id: 'marketing',
    icon: 'chart',
    title: 'Marketing digital & référencement',
    description:
      'Soyez visible là où vos clients cherchent : sur Google, sur les réseaux sociaux, dans leur messagerie.',
    points: [
      'Référencement naturel (SEO) local et thématique',
      'Community management et calendrier éditorial',
      'Campagnes ciblées et mesure des résultats',
      'Optimisation des fiches et profils professionnels',
    ],
  },
  {
    id: 'donnees',
    icon: 'database',
    title: 'Gestion documentaire & données',
    description:
      'Vos informations cessent d’être un fouillis : elles deviennent classées, sécurisées et exploitables.',
    points: [
      'Classement et archivage sécurisé des documents',
      'Saisie et structuration de données fiables',
      'Tableaux de suivi et indicateurs simples',
      'Procédures de sauvegarde et de partage',
    ],
  },
  {
    id: 'conseil',
    icon: 'graduation',
    title: 'Conseil, audit & formations',
    description:
      'Prenez les bonnes décisions numériques et rendez vos équipes autonomes grâce à un accompagnement sur mesure.',
    points: [
      'Audit stratégique global de votre organisation',
      'Recommandations opérationnelles priorisées',
      'Formation à la prospection et à la relation client',
      'Assistance et accompagnement digital continu',
    ],
  },
] as const;

/** Tableau comparatif des trois formules d'accompagnement. */
export const formulaRows: readonly { label: string; cells: readonly string[] }[] = [
  {
    label: 'Objectif',
    cells: [
      'Lancer une présence crédible',
      'Développer la visibilité et les ventes',
      'Structurer et piloter durablement',
    ],
  },
  {
    label: 'Site & développement',
    cells: [
      'Site vitrine 3 à 5 pages',
      'Site vitrine ou boutique en ligne',
      'Site ou boutique sur mesure',
    ],
  },
  {
    label: 'Identité visuelle',
    cells: [
      'Identité de base ou logo',
      'Identité visuelle complète',
      'Identité visuelle complète',
    ],
  },
  {
    label: 'Visibilité en ligne',
    cells: [
      'Référencement technique de départ',
      'SEO local + réseaux sociaux',
      'SEO, campagnes et contenus',
    ],
  },
  {
    label: 'Formation',
    cells: [
      'Formation de prise en main',
      'Formation équipe',
      'Formation & accompagnement continu',
    ],
  },
  {
    label: 'Supports marketing',
    cells: ['—', 'Visuels produits & bannières', 'Visuels & templates illimités'],
  },
  {
    label: 'Conseil & organisation',
    cells: ['—', '—', 'Audit stratégique + gestion des données'],
  },
  {
    label: 'Budget',
    cells: ['Sur devis', 'Sur devis', 'Sur devis'],
  },
] as const;

/** Cellules affichées en gras dans le tableau (objectif et budget). */
export const emphasizedRows = new Set(['Objectif', 'Budget']);

export const audiences: readonly string[] = [
  'Entrepreneurs et indépendants',
  'PME et commerces',
  'Écoles et centres de formation',
  'Cabinets médicaux et dentaires',
  'Associations et ONG',
  'Administrations et collectivités',
  'Vendeurs marketplace',
  'Artisans et prestataires',
] as const;

export const servicesFaq: readonly FaqItem[] = [
  {
    question: 'Puis-je commencer petit puis faire évoluer mon site ?',
    answer:
      'Oui, et c’est la démarche que nous recommandons. Chaque projet est conçu pour grandir : un site vitrine peut devenir une boutique, puis intégrer des automatisations, sans repartir de zéro.',
  },
  {
    question: 'Proposez-vous des facilités de paiement ?',
    answer:
      'Oui. Les projets sont généralement réglés en plusieurs échéances liées aux étapes de livraison. Les modalités précises figurent dans chaque devis.',
  },
  {
    question: 'Qui rédige les contenus de mon site ?',
    answer:
      'Vous pouvez fournir vos textes ou nous confier la rédaction. Nos contenus sont optimisés pour le référencement et adaptés à votre audience. Les deux approches se combinent très bien.',
  },
  {
    question: 'Pourquoi vos tarifs sont-ils « sur devis » ?',
    answer:
      'Parce qu’un prix affiché à l’avance ne veut rien dire sans périmètre. Nous chiffrons ce dont vous avez réellement besoin : cela évite de payer des fonctionnalités inutiles et garantit un budget tenu.',
  },
  {
    question: 'Travaillez-vous avec des clients hors des Comores ?',
    answer:
      'Oui. L’accompagnement à distance est structuré : visioconférences, espace de suivi partagé, validations en ligne. Les livrables sont identiques.',
  },
] as const;
