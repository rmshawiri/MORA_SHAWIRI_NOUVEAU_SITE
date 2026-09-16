export type Testimonial = {
  initials: string;
  name: string;
  role: string;
  quote: string;
};

/**
 * Témoignages clients repris de l'ébauche. Aucun avis n'est ajouté ni reformulé :
 * seuls les retours réellement fournis dans les sources figurent ici.
 */
export const testimonials: readonly Testimonial[] = [
  {
    initials: 'AI',
    name: 'Amina Ibrahim',
    role: 'Entrepreneuse',
    quote:
      'J’ai trouvé chez MORA Shawiri un accompagnement sérieux et humain. On m’a aidé à mettre de l’ordre dans mon projet, avec des outils pratiques, un suivi et des solutions adaptées à mes difficultés.',
  },
  {
    initials: 'SN',
    name: 'Saïd Nourdine',
    role: 'Moniteur — AE. Irham',
    quote:
      'J’ai fait appel à MORA Shawiri pour la création de supports visuels professionnels. Le travail a été sérieux, créatif et très bien structuré. Les designs ont clairement amélioré mon image. Je recommande MORA Shawiri pour son professionnalisme et la qualité de son accompagnement.',
  },
  {
    initials: 'SM',
    name: 'Saïd Mohamed',
    role: 'Entrepreneur',
    quote:
      'Le logo réalisé correspond parfaitement à mon projet et à mon identité. Je recommande MORA Shawiri pour son écoute et la qualité de son travail.',
  },
] as const;
