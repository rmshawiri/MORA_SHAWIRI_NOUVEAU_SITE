import type { FaqItem } from '@/components/sections/Faq';
import type { Step } from '@/components/sections/Steps';

/** Contenus éditoriaux de la page d'accueil, repris de l'ébauche. */

export type ServiceHighlight = {
  id: string;
  icon:
    | 'globe'
    | 'cart'
    | 'palette'
    | 'chart'
    | 'folder'
    | 'graduation';
  title: string;
  text: string;
  href: string;
};

export const serviceHighlights: readonly ServiceHighlight[] = [
  {
    id: 'web',
    icon: 'globe',
    title: 'Sites vitrines & institutionnels',
    text: 'Un site rapide, crédible et pensé pour convertir : structure claire, contenus optimisés, mise en ligne accompagnée.',
    href: '/services/#web',
  },
  {
    id: 'ecommerce',
    icon: 'cart',
    title: 'Boutiques e-commerce',
    text: 'Vendez en ligne avec une boutique moderne : catalogue, paiement, suivi des commandes et formation de votre équipe.',
    href: '/services/#ecommerce',
  },
  {
    id: 'design',
    icon: 'palette',
    title: 'Identité visuelle & design',
    text: 'Logo, charte graphique et supports de communication qui installent votre crédibilité dès le premier regard.',
    href: '/services/#design',
  },
  {
    id: 'marketing',
    icon: 'chart',
    title: 'Marketing digital & SEO',
    text: 'Référencement, réseaux sociaux et campagnes ciblées pour être trouvé avant vos concurrents.',
    href: '/services/#marketing',
  },
  {
    id: 'donnees',
    icon: 'folder',
    title: 'Organisation & données',
    text: 'Gestion documentaire, saisie et structuration de vos données : vos informations deviennent exploitables.',
    href: '/services/#donnees',
  },
  {
    id: 'conseil',
    icon: 'graduation',
    title: 'Conseil & formations',
    text: 'Audit stratégique, accompagnement et formations professionnelles pour rendre vos équipes autonomes.',
    href: '/services/#conseil',
  },
] as const;

export type Commitment = {
  icon: 'shield' | 'compass' | 'handshake' | 'sparkles';
  title: string;
  text: string;
};

export const commitments: readonly Commitment[] = [
  {
    icon: 'shield',
    title: 'Un interlocuteur unique',
    text: 'Design, développement, contenus, référencement : tout est coordonné par la même équipe. Vous ne gérez pas cinq prestataires.',
  },
  {
    icon: 'compass',
    title: 'Livré avec formation',
    text: 'Chaque projet se termine par la prise en main. Vous restez maître de votre outil, sans dépendance technique.',
  },
  {
    icon: 'handshake',
    title: 'Transparence de bout en bout',
    text: 'Devis détaillé, périmètre écrit, points d’étape réguliers. Vous savez ce que vous payez et où en est le projet.',
  },
  {
    icon: 'sparkles',
    title: 'Présents après la mise en ligne',
    text: 'Maintenance, évolutions, conseils : nous restons joignables quand votre activité change de rythme.',
  },
] as const;

export const method: readonly Step[] = [
  {
    title: 'Écoute & diagnostic',
    text: 'Nous analysons votre activité, vos objectifs et votre présence actuelle. Gratuitement, sans engagement.',
  },
  {
    title: 'Stratégie & devis',
    text: 'Vous recevez une recommandation claire : solution, périmètre, planning et budget détaillé.',
  },
  {
    title: 'Conception & réalisation',
    text: 'Design, développement, contenus. Vous validez chaque étape clé et suivez l’avancement.',
  },
  {
    title: 'Lancement & croissance',
    text: 'Mise en ligne, formation de vos équipes, puis suivi des performances dans la durée.',
  },
] as const;

export const marqueeItems: readonly string[] = [
  'Sites vitrines',
  'Boutiques e-commerce',
  'Identité visuelle',
  'Marketing digital & SEO',
  'Audit stratégique',
  'Gestion documentaire',
  'Saisie de données',
  'Formations professionnelles',
] as const;

export const homeFaq: readonly FaqItem[] = [
  {
    question: 'Combien coûte un site web professionnel ?',
    answer:
      'Chaque projet est chiffré sur mesure : nombre de pages, fonctionnalités, e-commerce ou non, contenus à produire. Après un premier échange gratuit, vous recevez un devis détaillé sous 48 h, sans engagement.',
  },
  {
    question: 'Travaillez-vous uniquement aux Comores ?',
    answer:
      'Nous sommes basés à Moroni et intervenons sur les trois îles. Nous accompagnons également des clients à distance dans tout le monde francophone : échanges en visioconférence, suivi en ligne, livrables identiques.',
  },
  {
    question: 'En combien de temps mon projet est-il livré ?',
    answer:
      'Un site vitrine est généralement livré en 2 à 4 semaines, une boutique en ligne en 4 à 8 semaines. Le planning précis figure dans le devis et il est tenu grâce à des points d’étape réguliers.',
  },
  {
    question: 'Que se passe-t-il après la mise en ligne ?',
    answer:
      'Vous êtes formé à l’utilisation de votre outil, et nos formules de maintenance couvrent mises à jour, sauvegardes et sécurité. Nous restons votre interlocuteur dans la durée.',
  },
] as const;

export const whyPoints = [
  {
    strong: 'Expertise complète',
    text: '— du design au code, du référencement à l’organisation des données, tout est réalisé et coordonné en interne.',
  },
  {
    strong: 'Solutions accessibles',
    text: '— des offres calibrées pour les entrepreneurs, PME, écoles, cabinets et associations.',
  },
  {
    strong: 'Travail structuré',
    text: '— un périmètre écrit, des étapes validées, des livrables documentés.',
  },
  {
    strong: 'Proximité durable',
    text: '— nous restons à vos côtés après la livraison : maintenance, formation, évolution.',
  },
] as const;
