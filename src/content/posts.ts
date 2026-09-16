import { articleBodies, type ArticleBlock } from '@/content/article-bodies';

export type Post = {
  slug: string;
  category: string;
  title: string;
  /** Accroche affichée dans le fil d'Ariane et le hero de l'article. */
  lead: string;
  /** Résumé des cartes et de la balise description. */
  excerpt: string;
  date: string;
  dateLabel: string;
  readingTime: string;
  cover: { src: string; width: number; height: number };
  /** Bandeau d'appel à l'action en fin d'article. */
  cta: { title: string; text: string; label: string; href: string };
  /** Articles suggérés en fin de lecture, choisis éditorialement. */
  related: readonly string[];
};

/** Chemin public d'un article. */
export function postPath(post: Pick<Post, 'slug'>): string {
  return `/blog/${post.slug}/`;
}

/** Corps structuré d'un article. */
export function postBody(slug: string): ArticleBlock[] {
  return articleBodies[slug] ?? [];
}

const formationCta = {
  title: 'Structurer votre prospection avec un accompagnement',
  text: 'Formation en présentiel ou à distance : discours, prospection, suivi et relation client, avec des exercices appliqués à votre activité.',
  label: 'Découvrir la formation',
  href: '/formation-prospection-relation-client/',
};

export const posts: readonly Post[] = [
  {
    slug: 'echec-prospection-client',
    category: 'Prospection & vente',
    title:
      'Pourquoi beaucoup d’entrepreneurs échouent en prospection client et comment y remédier',
    lead: 'Peu d’entrepreneurs échouent par manque de travail. Ils échouent parce que leur prospection n’est pas un système : elle dépend de l’inspiration, de l’urgence et de la chance.',
    excerpt:
      'Les vraies causes de l’échec en prospection commerciale — cible floue, discours centré sur soi, relances absentes — et une méthode simple pour construire un système de prospection régulier.',
    date: '2026-06-08',
    dateLabel: '8 juin 2026',
    readingTime: '9 min de lecture',
    cover: { src: '/images/blog-prospection.webp', width: 1536, height: 864 },
    cta: formationCta,
    related: ['site-internet-entrepreneur', 'template-organisation'],
  },
  {
    slug: 'gestion-documentaire-entreprise',
    category: 'Organisation & données',
    title: 'Pourquoi la gestion documentaire est essentielle pour une entreprise',
    lead: 'Une entreprise ne perd presque jamais ses documents d’un coup. Elle les perd lentement : une version ici, un contrat là, un dossier resté sur le téléphone d’un collaborateur parti.',
    excerpt:
      'Contrats introuvables, versions multiples, données stockées dans un seul téléphone : ce que le désordre documentaire coûte réellement à une PME, et la méthode pour y remédier durablement.',
    date: '2026-06-24',
    dateLabel: '24 juin 2026',
    readingTime: '8 min de lecture',
    cover: { src: '/images/blog-gestion-documentaire.webp', width: 1672, height: 941 },
    cta: {
      title: 'Mettre de l’ordre dans vos documents',
      text: 'Nous structurons votre classement, numérisons vos pièces essentielles et formons votre équipe à la méthode.',
      label: 'Voir la prestation',
      href: '/services/#donnees',
    },
    related: ['template-organisation', 'echec-prospection-client'],
  },
  {
    slug: 'template-organisation',
    category: 'Organisation & productivité',
    title: 'C’est quoi un template et pourquoi il peut transformer votre organisation',
    lead: 'Un template n’est pas un raccourci esthétique. C’est une décision prise une fois, puis réutilisée — et c’est ce qui distingue une organisation qui tient d’une organisation qui improvise.',
    excerpt:
      'Définition claire du template, exemples utiles pour une PME (devis, facture, contrat, rapport, publications) et méthode pour en déployer une série en une semaine.',
    date: '2026-07-09',
    dateLabel: '9 juillet 2026',
    readingTime: '7 min de lecture',
    cover: { src: '/images/blog-template.webp', width: 1672, height: 941 },
    cta: {
      title: 'Des modèles à vos couleurs, prêts à l’emploi',
      text: 'Nous concevons vos templates professionnels — devis, factures, contrats, rapports, visuels — avec leurs fichiers sources.',
      label: 'Voir l’offre de conception',
      href: '/boutique/',
    },
    related: ['gestion-documentaire-entreprise', 'site-internet-entrepreneur'],
  },
  {
    slug: 'site-internet-entrepreneur',
    category: 'Stratégie digitale',
    title: 'Pourquoi chaque entrepreneur doit avoir un site internet',
    lead: 'La plupart des entrepreneurs sont déjà visibles. Ce qui leur manque, c’est d’être vérifiables — et c’est exactement le rôle d’un site internet.',
    excerpt:
      'Crédibilité, référencement local, contrôle de son image, vente en continu : ce qu’un site internet apporte à un entrepreneur, et le minimum viable pour bien démarrer.',
    date: '2026-07-20',
    dateLabel: '20 juillet 2026',
    readingTime: '8 min de lecture',
    cover: { src: '/images/blog-site-internet.webp', width: 1672, height: 941 },
    cta: {
      title: 'Votre site internet, conçu et mis en ligne',
      text: 'Site vitrine ou boutique en ligne : périmètre écrit, devis détaillé sous 48 h, formation à la prise en main incluse.',
      label: 'Demander un devis gratuit',
      href: '/contact/',
    },
    related: ['echec-prospection-client', 'gestion-documentaire-entreprise'],
  },
] as const;

export function getPost(slug: string): Post | undefined {
  return posts.find((post) => post.slug === slug);
}

/**
 * Articles suggérés en fin de lecture.
 * La sélection est éditoriale ; on complète si un identifiant devient obsolète.
 */
export function relatedPosts(slug: string, count = 2): Post[] {
  const post = getPost(slug);
  const picked = (post?.related ?? [])
    .map((relatedSlug) => getPost(relatedSlug))
    .filter((item): item is Post => item !== undefined);

  const fallback = posts.filter(
    (item) => item.slug !== slug && !picked.some((p) => p.slug === item.slug),
  );

  return [...picked, ...fallback].slice(0, count);
}
