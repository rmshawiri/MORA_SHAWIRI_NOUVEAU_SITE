/**
 * Registre des blocs éditoriaux administrables — phase 4E-2, décision D-20 = A.
 *
 * ## Ce fichier est la source de vérité, pas une copie de secours
 *
 * Chaque entrée porte **la valeur réellement publiée aujourd'hui**. La base ne
 * contient que des *surcharges* : tant qu'aucune n'existe pour une clé, c'est
 * la valeur ci-dessous qui est rendue. L'ordre de priorité est donc, à la
 * lecture publique :
 *
 *   surcharge publiée en base  →  sinon  →  valeur de ce fichier
 *
 * Trois propriétés en découlent, et ce sont elles qui justifient la forme du
 * fichier :
 *
 *   1. **une base vide rend exactement le site d'avant la phase.** Le repli
 *      n'est pas un chemin de secours exceptionnel : c'est le cas de base,
 *      exercé à chaque build tant que rien n'a été modifié en administration ;
 *   2. **une panne Supabase est sans effet visible.** Il n'existe aucun état
 *      où une page s'affiche sans son titre ;
 *   3. **la non-régression est démontrable**, pas promise : il suffit de
 *      comparer le HTML servi base vide / base semée / base injoignable. Le
 *      § 7 du rapport le fait.
 *
 * ## Pourquoi la structure reste en code
 *
 * Le § 126 du module exige que « la modification d'un contenu ne doit pas
 * permettre de casser involontairement le design ou la structure d'une page ».
 * La décision D-20 = A en tire la conséquence : l'administration modifie les
 * **textes** d'une section, jamais la liste ni l'ordre des sections. Une clé
 * absente du registre est ignorée au rendu ; une clé du registre existe
 * toujours. Aucune saisie ne peut donc produire une page incomplète.
 *
 * ## Les titres et la mise en valeur
 *
 * Deux titres du site portent un mot en doré (`<span className="hl-gold">`).
 * Plutôt que d'accepter du balisage dans un champ de saisie — ce que le § 98
 * (sécurité du contenu) et le § 100 (JavaScript interdit) déconseillent — la
 * mise en valeur s'écrit `[[mot]]`. Le rendu la *découpe* et construit le
 * `<span>` lui-même : **rien n'est jamais interprété comme du HTML, donc la
 * surface XSS est nulle par construction et non par filtrage.** Un éditeur
 * reste ainsi un simple champ texte, comme le § 101 le demande.
 *
 * ## Ce qui n'est délibérément pas ici
 *
 *   * **les pages légales** (décision D-21 = A) — elles restent en code ;
 *   * **`/affiliation/`** — gelée, et ses mécanismes relèvent de 4H ;
 *   * **les sections « split » sur mesure** (accueil « Pourquoi », services
 *     « Pour qui ? », boutique « Besoin de plus ? », contact, blog). Leur
 *     balisage est propre à chacune — `<p className="lead">` ici, un `<p>` nu
 *     là, un style en ligne ailleurs. Les couler dans un bloc générique
 *     imposerait de réécrire leur structure, c'est-à-dire exactement ce que le
 *     § 126 et le gel du design interdisent. Elles sont signalées comme point
 *     différé dans le rapport de phase ;
 *   * **les coordonnées** (téléphone, courriel, adresse, horaires). Le § 89 les
 *     rattache aux Paramètres, et `src/lib/site.ts` les porte déjà : les
 *     dupliquer ici violerait le § 122 (non-duplication). Elles relèvent de la
 *     phase 4K.
 *
 * Référence : `09_ADMINISTRATION/07_GESTION_CONTENUS.md` § 10-14, § 80, § 98-101,
 * § 122, § 126.
 */

import {
  commitments,
  marqueeItems,
  method,
  serviceHighlights,
  whyPoints,
} from '@/content/home';
import { testimonials } from '@/content/testimonials';

/* ------------------------------------------------------------------ formes --- */

export type BlockKind = 'HERO' | 'PAGE_HERO' | 'SECTION' | 'CTA' | 'LIST';

/** Bandeau d'ouverture de la page d'accueil et de la page Formation. */
export type HeroFields = {
  eyebrow: string;
  /** `[[mot]]` met le mot en valeur. Voir l'en-tête du fichier. */
  title: string;
  lead: string;
  /** Les trois preuves affichées sous les boutons. */
  proof: readonly string[];
};

/** Bandeau d'ouverture des pages intérieures. */
export type PageHeroFields = {
  eyebrow: string;
  title: string;
  lead: string;
};

/** En-tête d'une section. `lead` est facultatif : plusieurs n'en ont pas. */
export type SectionFields = {
  eyebrow: string;
  title: string;
  lead?: string;
};

/** Bandeau d'appel à l'action de fin de page. */
export type CtaFields = {
  title: string;
  text: string;
  primaryLabel: string;
  whatsappMessage: string;
};

export type TextFields = HeroFields | PageHeroFields | SectionFields | CtaFields;

/* ------------------------------------------------------------------ pages --- */

/**
 * Pages présentées en administration. Le libellé et l'adresse servent
 * uniquement à regrouper les blocs de façon lisible (§ 109).
 */
export const CONTENT_PAGES = [
  { slug: 'accueil', label: 'Accueil', href: '/' },
  { slug: 'services', label: 'Services', href: '/services/' },
  { slug: 'boutique', label: 'Boutique', href: '/boutique/' },
  { slug: 'qui-sommes-nous', label: 'Qui sommes-nous', href: '/qui-sommes-nous/' },
  { slug: 'blog', label: 'Blog', href: '/blog/' },
  { slug: 'faq', label: 'FAQ', href: '/faq/' },
  { slug: 'contact', label: 'Contact', href: '/contact/' },
  { slug: 'rendez-vous', label: 'Rendez-vous', href: '/rendez-vous/' },
  {
    slug: 'formation',
    label: 'Formation prospection',
    href: '/formation-prospection-relation-client/',
  },
  { slug: 'transversal', label: 'Éléments transversaux', href: '/' },
] as const;

export type ContentPageSlug = (typeof CONTENT_PAGES)[number]['slug'];

/* ------------------------------------------------------- blocs de texte --- */

type TextBlockDefinition<F extends TextFields> = {
  readonly kind: BlockKind;
  readonly page: ContentPageSlug;
  /** Intitulé affiché en administration. */
  readonly label: string;
  readonly defaults: F;
};

/**
 * Les valeurs ci-dessous sont celles du site au commit `22c3be1`, reprises sans
 * aucune retouche — ni correction, ni reformulation (§ 134, et point 8 du
 * cadrage de la phase).
 *
 * Deux détails invisibles à la lecture mais essentiels au rendu : « Pour qui ? »
 * s'écrivait `Pour qui&nbsp;?` en JSX, entité que JSX décode. L'espace
 * insécable est donc écrite ici en ` `, sans quoi le HTML servi
 * changerait.
 */
export const TEXT_BLOCKS = {
  /* ------------------------------------------------------------- accueil --- */

  'accueil.hero': {
    kind: 'HERO',
    page: 'accueil',
    label: 'Bandeau d’ouverture',
    defaults: {
      eyebrow: 'Agence digitale — Moroni, Union des Comores',
      title: 'Le Choix Optimal pour votre [[Performance]]',
      lead: 'Sites web, boutiques en ligne, identité visuelle, organisation des données et formations : MORA Shawiri conçoit les outils numériques qui rendent votre organisation visible, crédible et efficace.',
      proof: [
        'Première réponse sous 24 h',
        'Sur place à Moroni et à distance',
        'Devis gratuit, sans engagement',
      ],
    },
  } satisfies TextBlockDefinition<HeroFields>,

  'accueil.expertises': {
    kind: 'SECTION',
    page: 'accueil',
    label: 'Section « Nos expertises »',
    defaults: {
      eyebrow: 'Nos expertises',
      title: 'Des solutions digitales qui font grandir votre organisation',
      lead: 'Un seul partenaire pour concevoir, lancer et faire performer votre présence numérique — du premier logo à la formation de vos équipes.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'accueil.engagements': {
    kind: 'SECTION',
    page: 'accueil',
    label: 'Section « Nos engagements »',
    defaults: {
      eyebrow: 'Nos engagements',
      title: 'Ce que vous obtenez en travaillant avec nous',
      lead: 'Pas de promesses chiffrées invérifiables : des engagements de méthode, tenus sur chaque projet.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'accueil.methode': {
    kind: 'SECTION',
    page: 'accueil',
    label: 'Section « Notre méthode »',
    defaults: {
      eyebrow: 'Notre méthode',
      title: 'Du premier échange aux premiers résultats',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'accueil.boutique': {
    kind: 'SECTION',
    page: 'accueil',
    label: 'Section « Boutique »',
    defaults: {
      eyebrow: 'Boutique',
      title: 'Nos offres les plus demandées',
      lead: 'Quatorze prestations prêtes à démarrer, de la création de logo au développement d’applications. Les prix définis sont affichés ; les projets sur mesure sont chiffrés selon votre besoin réel.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'accueil.temoignages': {
    kind: 'SECTION',
    page: 'accueil',
    label: 'Section « Témoignages »',
    defaults: {
      eyebrow: 'Témoignages',
      title: 'Ils nous font confiance pour leur croissance',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'accueil.faq': {
    kind: 'SECTION',
    page: 'accueil',
    label: 'Section « Questions fréquentes »',
    defaults: {
      eyebrow: 'Questions fréquentes',
      title: 'Vos questions, nos réponses directes',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'accueil.cta': {
    kind: 'CTA',
    page: 'accueil',
    label: 'Bandeau d’appel à l’action',
    defaults: {
      title: 'Prêt à passer au niveau supérieur ?',
      text: 'Décrivez-nous votre projet : vous recevez un diagnostic et un devis gratuit sous 48 h.',
      primaryLabel: 'Demander un devis gratuit',
      whatsappMessage: 'Bonjour MORA Shawiri, je souhaite un devis pour mon projet digital.',
    },
  } satisfies TextBlockDefinition<CtaFields>,

  /* ------------------------------------------------------------ services --- */

  'services.hero': {
    kind: 'PAGE_HERO',
    page: 'services',
    label: 'Bandeau d’ouverture',
    defaults: {
      eyebrow: 'Nos services',
      title: 'Toutes les expertises numériques, un seul partenaire',
      lead: 'Du premier logo à l’organisation de vos données, MORA Shawiri couvre l’ensemble de vos besoins numériques. Vous gagnez du temps, de la cohérence et de la performance.',
    },
  } satisfies TextBlockDefinition<PageHeroFields>,

  'services.poles': {
    kind: 'SECTION',
    page: 'services',
    label: 'Section « Six pôles d’expertise »',
    defaults: {
      eyebrow: 'Six pôles d’expertise',
      title: 'Ce que nous faisons, concrètement',
      lead: 'Chaque pôle peut être mobilisé seul ou combiné aux autres dans un accompagnement global.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'services.formules': {
    kind: 'SECTION',
    page: 'services',
    label: 'Section « Tableau comparatif »',
    defaults: {
      eyebrow: 'Tableau comparatif',
      title: 'Trois niveaux d’accompagnement, un objectif : votre performance',
      lead: 'Des formules lisibles pour choisir en connaissance de cause. Chaque formule est ajustée sur devis selon votre projet.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'services.faq': {
    kind: 'SECTION',
    page: 'services',
    label: 'Section « FAQ services »',
    defaults: {
      eyebrow: 'FAQ services',
      title: 'Avant de démarrer, ce qu’il faut savoir',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'services.cta': {
    kind: 'CTA',
    page: 'services',
    label: 'Bandeau d’appel à l’action',
    defaults: {
      title: 'Quel service correspond à votre projet ?',
      text: 'Décrivez-nous votre besoin : nous recommandons la solution la plus rentable, devis gratuit à l’appui.',
      primaryLabel: 'Demander un devis gratuit',
      whatsappMessage:
        'Bonjour MORA Shawiri, je souhaite être conseillé sur le service adapté à mon projet.',
    },
  } satisfies TextBlockDefinition<CtaFields>,

  /* ------------------------------------------------------------ boutique --- */

  'boutique.hero': {
    kind: 'PAGE_HERO',
    page: 'boutique',
    label: 'Bandeau d’ouverture',
    defaults: {
      eyebrow: 'Boutique',
      title: 'Quatorze prestations prêtes à démarrer',
      lead: 'Site web, application mobile, SaaS, identité visuelle, visuels produits, organisation, conseil et formation : choisissez la prestation qui débloque votre prochaine étape. Les prix définis sont affichés ; les projets sur mesure sont chiffrés selon votre besoin réel.',
    },
  } satisfies TextBlockDefinition<PageHeroFields>,

  'boutique.services': {
    kind: 'SECTION',
    page: 'boutique',
    label: 'Section « Nos services »',
    defaults: {
      eyebrow: 'Nos services',
      title: 'Les prestations actuellement disponibles',
      lead: 'Retrouvez les prestations MORA Shawiri actuellement disponibles à la commande ou à la demande, regroupées par famille de besoin.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'boutique.produits': {
    kind: 'SECTION',
    page: 'boutique',
    label: 'Section « Nos produits »',
    defaults: {
      eyebrow: 'Nos produits',
      title: 'De nouveaux produits arrivent bientôt',
      lead: 'Les produits MORA Shawiri ne sont pas encore disponibles. La boutique sera progressivement enrichie avec de nouvelles ressources et offres.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'boutique.commander': {
    kind: 'SECTION',
    page: 'boutique',
    label: 'Section « Comment commander »',
    defaults: {
      eyebrow: 'Comment commander',
      title: 'Votre prestation lancée en quatre étapes simples',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'boutique.cta': {
    kind: 'CTA',
    page: 'boutique',
    label: 'Bandeau d’appel à l’action',
    defaults: {
      title: 'Une question sur une offre ?',
      text: 'Nous vous aidons à choisir la prestation adaptée à votre situation, sans frais et sans engagement.',
      primaryLabel: 'Nous contacter',
      whatsappMessage: 'Bonjour MORA Shawiri, j’ai une question sur une offre de votre boutique.',
    },
  } satisfies TextBlockDefinition<CtaFields>,

  /* ----------------------------------------------------- qui-sommes-nous --- */

  'qui-sommes-nous.hero': {
    kind: 'PAGE_HERO',
    page: 'qui-sommes-nous',
    label: 'Bandeau d’ouverture',
    defaults: {
      eyebrow: 'Qui sommes-nous',
      title: 'Une équipe comorienne, des standards internationaux',
      lead: 'MORA Shawiri est née d’une conviction : les organisations des Comores méritent des outils numériques du même niveau que les meilleures agences internationales — conçus ici, pour votre réalité.',
    },
  } satisfies TextBlockDefinition<PageHeroFields>,

  'qui-sommes-nous.valeurs': {
    kind: 'SECTION',
    page: 'qui-sommes-nous',
    label: 'Section « Nos valeurs »',
    defaults: {
      eyebrow: 'Nos valeurs',
      title: 'Ce qui guide chacune de nos décisions',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'qui-sommes-nous.temoignages': {
    kind: 'SECTION',
    page: 'qui-sommes-nous',
    label: 'Section « Ils témoignent »',
    defaults: {
      eyebrow: 'Ils témoignent',
      title: 'La parole à nos clients',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'qui-sommes-nous.cta': {
    kind: 'CTA',
    page: 'qui-sommes-nous',
    label: 'Bandeau d’appel à l’action',
    defaults: {
      title: 'Faisons connaissance',
      text: 'Racontez-nous votre projet lors d’un premier échange gratuit, à Moroni ou en visioconférence.',
      primaryLabel: 'Demander un devis gratuit',
      whatsappMessage: 'Bonjour MORA Shawiri, j’aimerais en savoir plus sur votre accompagnement.',
    },
  } satisfies TextBlockDefinition<CtaFields>,

  /* ---------------------------------------------------------------- blog --- */

  'blog.hero': {
    kind: 'PAGE_HERO',
    page: 'blog',
    label: 'Bandeau d’ouverture',
    defaults: {
      eyebrow: 'Blog & conseils',
      title: 'Des conseils applicables, pas des théories',
      lead: 'Nous partageons ce que nous observons sur le terrain auprès des entrepreneurs et PME des Comores : ce qui fonctionne, ce qui coûte cher, et par quoi commencer.',
    },
  } satisfies TextBlockDefinition<PageHeroFields>,

  'blog.articles': {
    kind: 'SECTION',
    page: 'blog',
    label: 'Section « Derniers articles »',
    defaults: {
      eyebrow: 'Derniers articles',
      title: 'À lire en ce moment',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'blog.cta': {
    kind: 'CTA',
    page: 'blog',
    label: 'Bandeau d’appel à l’action',
    defaults: {
      title: 'Passer de la lecture à l’action',
      text: 'Un diagnostic gratuit permet d’identifier les deux ou trois chantiers les plus rentables pour votre organisation.',
      primaryLabel: 'Demander un devis gratuit',
      whatsappMessage: 'Bonjour MORA Shawiri, je souhaite un diagnostic pour mon organisation.',
    },
  } satisfies TextBlockDefinition<CtaFields>,

  /* ----------------------------------------------------------------- faq --- */

  'faq.hero': {
    kind: 'PAGE_HERO',
    page: 'faq',
    label: 'Bandeau d’ouverture',
    defaults: {
      eyebrow: 'Questions fréquentes',
      title: 'Vos questions, nos réponses',
      lead: 'Tarifs, demandes de devis, rendez-vous, formation, offres visuelles, affiliation : voici les réponses aux questions qui nous sont le plus souvent posées. Si la vôtre n’y figure pas, écrivez-nous — nous y répondrons directement.',
    },
  } satisfies TextBlockDefinition<PageHeroFields>,

  'faq.principale': {
    kind: 'SECTION',
    page: 'faq',
    label: 'Section « FAQ »',
    defaults: {
      eyebrow: 'FAQ',
      title: 'Tout ce qu’il faut savoir avant de nous solliciter',
      lead: 'Les réponses ci-dessous reprennent les informations officielles de MORA Shawiri. Elles sont mises à jour dès qu’une offre, un tarif ou un parcours évolue.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'faq.suite': {
    kind: 'SECTION',
    page: 'faq',
    label: 'Section « Vous ne trouvez pas votre réponse ? »',
    defaults: {
      eyebrow: 'Vous ne trouvez pas votre réponse ?',
      title: 'Nous répondons directement',
      lead: 'Une question précise, une situation particulière, un doute sur l’offre à choisir : expliquez-nous simplement votre besoin.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'faq.cta': {
    kind: 'CTA',
    page: 'faq',
    label: 'Bandeau d’appel à l’action',
    defaults: {
      title: 'Un projet, une question, un doute ?',
      text: 'Le premier échange est gratuit et sans engagement. Il éclaire souvent la décision à lui seul.',
      primaryLabel: 'Demander un devis gratuit',
      whatsappMessage: 'Bonjour MORA Shawiri, j’ai une question après avoir consulté votre FAQ.',
    },
  } satisfies TextBlockDefinition<CtaFields>,

  /* ------------------------------------------------------------- contact --- */

  'contact.hero': {
    kind: 'PAGE_HERO',
    page: 'contact',
    label: 'Bandeau d’ouverture',
    defaults: {
      eyebrow: 'Contact',
      title: 'Parlons de votre projet',
      lead: 'Décrivez votre besoin en quelques lignes. Nous répondons sous 24 h et vous recevez un devis détaillé sous 48 h — gratuitement et sans engagement.',
    },
  } satisfies TextBlockDefinition<PageHeroFields>,

  'contact.reseaux': {
    kind: 'SECTION',
    page: 'contact',
    label: 'Section « Nos réseaux »',
    defaults: {
      eyebrow: 'Nos réseaux',
      title: 'Suivez notre travail au quotidien',
      lead: 'Réalisations, conseils et coulisses de nos projets, publiés régulièrement.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'contact.cta': {
    kind: 'CTA',
    page: 'contact',
    label: 'Bandeau d’appel à l’action',
    defaults: {
      title: 'Vous préférez un échange de vive voix ?',
      text: 'Le premier échange est gratuit et sans engagement. Il éclaire souvent la décision à lui seul.',
      primaryLabel: 'Prendre rendez-vous',
      whatsappMessage: 'Bonjour MORA Shawiri, j’ai une question sur vos prestations.',
    },
  } satisfies TextBlockDefinition<CtaFields>,

  /* --------------------------------------------------------- rendez-vous --- */

  'rendez-vous.hero': {
    kind: 'PAGE_HERO',
    page: 'rendez-vous',
    label: 'Bandeau d’ouverture',
    defaults: {
      eyebrow: 'Rendez-vous',
      title: 'Réservez votre échange en moins de deux minutes',
      lead: 'Répondez à quelques questions, une à la fois. À la fin, votre demande nous est transmise et vous recevez un accusé de réception par e-mail — nous confirmons le créneau sous 24 h ouvrées.',
    },
  } satisfies TextBlockDefinition<PageHeroFields>,

  'rendez-vous.section': {
    kind: 'SECTION',
    page: 'rendez-vous',
    label: 'Section « Prise de rendez-vous »',
    defaults: {
      eyebrow: 'Prise de rendez-vous',
      title: 'Dites-nous l’essentiel, nous préparons l’échange',
      lead: 'Aucune inscription, aucun formulaire interminable : une conversation guidée, et vous gardez la main sur chaque réponse.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  /* ----------------------------------------------------------- formation --- */

  'formation.hero': {
    kind: 'HERO',
    page: 'formation',
    label: 'Bandeau d’ouverture',
    defaults: {
      eyebrow: 'Formation professionnelle · Présentiel ou à distance',
      title: 'Maîtriser la [[Prospection]] et la Relation Client',
      lead: 'Apprenez à aborder un prospect sans hésiter, à conduire l’échange avec assurance, à convaincre sans brader vos prix — et à transformer un premier accord en relation client durable.',
      proof: [
        'Manuel de formation remis',
        'Exercices et mises en situation',
        'Certificat de participation',
      ],
    },
  } satisfies TextBlockDefinition<HeroFields>,

  'formation.problemes': {
    kind: 'SECTION',
    page: 'formation',
    label: 'Section « Les blocages »',
    defaults: {
      eyebrow: 'Les blocages que nous entendons chaque semaine',
      title: 'Si vous vous reconnaissez ici, cette formation est faite pour vous',
      lead: 'Ces situations n’ont rien à voir avec un manque de sérieux. Elles viennent d’un manque de méthode — et la méthode, cela s’apprend.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'formation.benefices': {
    kind: 'SECTION',
    page: 'formation',
    label: 'Section « Ce que vous en retirez »',
    defaults: {
      eyebrow: 'Ce que vous en retirez',
      title: 'Des bénéfices concrets, mesurables sur votre activité',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'formation.competences': {
    kind: 'SECTION',
    page: 'formation',
    label: 'Section « Compétences acquises »',
    defaults: {
      eyebrow: 'Compétences acquises',
      title: 'Six compétences travaillées pendant la formation',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'formation.programme': {
    kind: 'SECTION',
    page: 'formation',
    label: 'Section « Programme détaillé »',
    defaults: {
      eyebrow: 'Programme détaillé',
      title: 'Six modules, du premier contact à la fidélisation',
      lead: 'Chaque module associe apports méthodologiques, modèles réutilisables et mise en pratique immédiate.',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'formation.public': {
    kind: 'SECTION',
    page: 'formation',
    label: 'Section « Pour qui ? »',
    defaults: {
      // `Pour qui&nbsp;?` en JSX : l'espace insécable est conservée telle quelle.
      eyebrow: 'Pour qui ?',
      title: 'Une formation utile à tous ceux qui doivent convaincre',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'formation.modalites': {
    kind: 'SECTION',
    page: 'formation',
    label: 'Section « Modalités de participation »',
    defaults: {
      eyebrow: 'Modalités de participation',
      title: 'Deux façons de suivre la formation',
    },
  } satisfies TextBlockDefinition<SectionFields>,

  'formation.faq': {
    kind: 'SECTION',
    page: 'formation',
    label: 'Section « Questions fréquentes »',
    defaults: {
      eyebrow: 'Questions fréquentes',
      title: 'Ce que les participants demandent avant de s’inscrire',
    },
  } satisfies TextBlockDefinition<SectionFields>,
} as const;

export type TextBlockKey = keyof typeof TEXT_BLOCKS;

/* ------------------------------------------------------------------ listes --- */

/**
 * Listes administrables.
 *
 * Les valeurs par défaut ne sont **pas recopiées** : elles pointent vers les
 * modules que le site lit déjà (`home.ts`, `testimonials.ts`). Une recopie
 * aurait introduit le risque exact que le § 5 du rapport 4E-1 décrit — une
 * apostrophe ou un espace insécable différent — et la comparaison de
 * non-régression n'aurait alors plus rien prouvé.
 *
 * `icon` et `href` sont des champs **contraints**, pas libres : l'icône est
 * choisie dans un jeu fermé rendu par le code (aucun fichier n'est chargé
 * depuis une saisie), et le lien doit être interne. Le § 18 du module autorise
 * les liens externes, mais aucune de ces listes n'en porte aujourd'hui, et en
 * ouvrir la possibilité ici créerait une surface (`javascript:`, `data:`) sans
 * besoin réel. Voir `src/lib/contenus/validation.ts`.
 */
export const LIST_BLOCKS = {
  'accueil.liste-expertises': {
    kind: 'LIST',
    page: 'accueil',
    label: 'Cartes « Nos expertises »',
    shape: 'EXPERTISE',
    defaults: serviceHighlights,
  },
  'accueil.liste-engagements': {
    kind: 'LIST',
    page: 'accueil',
    label: 'Cartes « Nos engagements »',
    shape: 'ENGAGEMENT',
    defaults: commitments,
  },
  'accueil.liste-methode': {
    kind: 'LIST',
    page: 'accueil',
    label: 'Étapes « Notre méthode »',
    shape: 'ETAPE',
    defaults: method,
  },
  'accueil.liste-bandeau': {
    kind: 'LIST',
    page: 'accueil',
    label: 'Bandeau défilant',
    shape: 'TEXTE',
    defaults: marqueeItems,
  },
  'accueil.liste-pourquoi': {
    kind: 'LIST',
    page: 'accueil',
    label: 'Points « Pourquoi MORA Shawiri »',
    shape: 'POURQUOI',
    defaults: whyPoints,
  },
  'transversal.temoignages': {
    kind: 'LIST',
    page: 'transversal',
    label: 'Témoignages clients',
    shape: 'TEMOIGNAGE',
    defaults: testimonials,
  },
} as const;

export type ListBlockKey = keyof typeof LIST_BLOCKS;
export type ListShape = (typeof LIST_BLOCKS)[ListBlockKey]['shape'];

/** Toutes les clés du registre, l'ordre étant celui de l'administration. */
export const ALL_BLOCK_KEYS: readonly string[] = [
  ...Object.keys(TEXT_BLOCKS),
  ...Object.keys(LIST_BLOCKS),
];

/** Vrai si la clé est déclarée au registre. Une clé inconnue est ignorée. */
export function isKnownBlockKey(key: string): boolean {
  return key in TEXT_BLOCKS || key in LIST_BLOCKS;
}
