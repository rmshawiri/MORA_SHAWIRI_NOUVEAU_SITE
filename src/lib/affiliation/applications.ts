/**
 * Candidature au programme d'affiliation — module pur, partagé par le
 * formulaire public, la route serveur et l'administration.
 *
 * Une seule définition des profils, des questions conditionnelles, des champs
 * de versement et de la validation : le navigateur s'en sert pour guider, le
 * serveur pour refuser, et la base revérifie de son côté. Trois lectures de la
 * même règle, aucune divergence possible entre les deux premières.
 *
 * ## Ce que le public ne voit jamais
 *
 * Les catégories internes — Équipe MORA Shawiri, Recruté MORA Shawiri — ne
 * figurent pas parmi les profils proposés : elles sont attribuées par
 * l'administration seule (`05_FONCTIONNALITES/01` § 94). Le profil déclaré est
 * une indication ; la catégorie réelle se choisit à l'acceptation.
 *
 * ## Ce que ce module ne promet pas
 *
 * Aucun taux, aucun délai, aucun montant : les textes du parcours ne disent
 * que ce qui est vrai pour toute candidature.
 */

export const CONSENT_VERSION = 'affiliation-candidature-1';

export type RequestedProfile =
  | 'PARTICULIER'
  | 'INFLUENCEUR'
  | 'COMMUNAUTE'
  | 'APPORTEUR'
  | 'PROFESSIONNEL'
  | 'AUTRE';

export const PROFILE_OPTIONS: readonly {
  value: RequestedProfile;
  label: string;
  description: string;
  /** Catégorie proposée par défaut à l'acceptation. Une suggestion, pas une règle. */
  suggestedCategory: string;
}[] = [
  {
    value: 'PARTICULIER',
    label: 'Particulier',
    description: 'Vous recommandez MORA Shawiri autour de vous : famille, amis, collègues.',
    suggestedCategory: 'STANDARD',
  },
  {
    value: 'INFLUENCEUR',
    label: 'Influenceur ou créateur de contenu',
    description: 'Vous animez une audience sur les réseaux sociaux ou un média en ligne.',
    suggestedCategory: 'INFLUENCEUR',
  },
  {
    value: 'COMMUNAUTE',
    label: 'Communauté ou association',
    description: 'Vous représentez un réseau, une association ou un groupement.',
    suggestedCategory: 'COMMUNAUTE',
  },
  {
    value: 'APPORTEUR',
    label: 'Apporteur d’affaires',
    description: 'Vous identifiez des entreprises ou des organisations qui ont des projets numériques.',
    suggestedCategory: 'APPORTEUR',
  },
  {
    value: 'PROFESSIONNEL',
    label: 'Professionnel ou entreprise',
    description: 'Votre structure souhaite orienter ses clients ou partenaires vers MORA Shawiri.',
    suggestedCategory: 'PARTENAIRE',
  },
  {
    value: 'AUTRE',
    label: 'Autre situation',
    description: 'Votre cas ne correspond à aucun de ces profils : dites-nous lequel.',
    suggestedCategory: 'STANDARD',
  },
];

export const PROFILE_LABELS: Record<RequestedProfile, string> = Object.fromEntries(
  PROFILE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<RequestedProfile, string>;

export function isRequestedProfile(value: unknown): value is RequestedProfile {
  return PROFILE_OPTIONS.some((option) => option.value === value);
}

/** Une question de l'étape « Votre potentiel ». */
export type ProfileQuestion = {
  key: string;
  label: string;
  hint?: string;
  type: 'text' | 'textarea' | 'url' | 'choice';
  options?: readonly string[];
  optional?: boolean;
  placeholder?: string;
};

const AUDIENCE_RANGES = [
  'Moins de 1 000 personnes',
  '1 000 à 10 000 personnes',
  '10 000 à 50 000 personnes',
  'Plus de 50 000 personnes',
] as const;

/**
 * Questions conditionnelles. Chacune existe parce qu'elle aide à étudier la
 * candidature — aucune n'est posée « au cas où ».
 */
export const PROFILE_QUESTIONS: Record<RequestedProfile, readonly ProfileQuestion[]> = {
  PARTICULIER: [
    {
      key: 'reseau',
      label: 'Qui pourriez-vous orienter vers MORA Shawiri ?',
      hint: 'Par exemple : des commerçants de votre quartier, votre employeur, une association.',
      type: 'textarea',
    },
  ],
  INFLUENCEUR: [
    {
      key: 'reseaux',
      label: 'Sur quels réseaux publiez-vous ?',
      placeholder: 'Facebook, Instagram, TikTok…',
      type: 'text',
    },
    {
      key: 'liens',
      label: 'Liens vers vos comptes ou votre média',
      hint: 'Un lien par ligne. Ils servent uniquement à étudier votre candidature.',
      type: 'textarea',
    },
    {
      key: 'audience',
      label: 'Quelle est votre audience approximative ?',
      type: 'choice',
      options: AUDIENCE_RANGES,
    },
  ],
  COMMUNAUTE: [
    { key: 'nom_communaute', label: 'Nom de la communauté ou de l’association', type: 'text' },
    { key: 'activite', label: 'Son activité', type: 'text' },
    {
      key: 'membres',
      label: 'Combien de membres ou de personnes touchez-vous, environ ?',
      type: 'choice',
      options: AUDIENCE_RANGES,
    },
  ],
  APPORTEUR: [
    {
      key: 'secteurs',
      label: 'Dans quels secteurs évoluez-vous ?',
      placeholder: 'Commerce, éducation, santé, tourisme…',
      type: 'text',
    },
    {
      key: 'clientele',
      label: 'Quel type de clientèle pourriez-vous nous présenter ?',
      type: 'textarea',
    },
    {
      key: 'experience',
      label: 'Avez-vous déjà apporté des affaires à d’autres prestataires ?',
      type: 'textarea',
      optional: true,
    },
  ],
  PROFESSIONNEL: [
    { key: 'entreprise', label: 'Nom de votre entreprise', type: 'text' },
    { key: 'activite', label: 'Son activité', type: 'text' },
    {
      key: 'site',
      label: 'Site internet ou page professionnelle',
      type: 'url',
      optional: true,
      placeholder: 'https://',
    },
  ],
  AUTRE: [
    {
      key: 'precision',
      label: 'Décrivez votre situation en quelques mots',
      type: 'textarea',
    },
  ],
};

/** Champs de versement par famille de moyen — miroir de `affiliate_payout_details_valid`. */
export type PayoutKind = 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'ONLINE' | 'CHEQUE' | 'CASH';

export const PAYOUT_FIELDS: Record<
  PayoutKind,
  readonly { key: string; label: string; type: 'text' | 'tel' | 'email'; autoComplete?: string; hint?: string }[]
> = {
  MOBILE_MONEY: [
    { key: 'numero', label: 'Numéro du compte', type: 'tel', autoComplete: 'tel' },
    { key: 'titulaire', label: 'Nom du titulaire du compte', type: 'text', autoComplete: 'name' },
  ],
  BANK_TRANSFER: [
    { key: 'banque', label: 'Banque', type: 'text' },
    { key: 'titulaire', label: 'Titulaire du compte', type: 'text', autoComplete: 'name' },
    {
      key: 'compte',
      label: 'Numéro de compte ou RIB',
      type: 'text',
      hint: 'Tel qu’il figure sur votre relevé d’identité bancaire.',
    },
  ],
  ONLINE: [{ key: 'email', label: 'Adresse e-mail du compte', type: 'email', autoComplete: 'email' }],
  CHEQUE: [{ key: 'ordre', label: 'Nom à l’ordre duquel établir le chèque', type: 'text', autoComplete: 'name' }],
  CASH: [],
};

export function isPayoutKind(value: unknown): value is PayoutKind {
  return typeof value === 'string' && value in PAYOUT_FIELDS;
}

export type PayoutMethodOption = { code: string; label: string; kind: PayoutKind };

/** Le formulaire tel qu'il circule entre le navigateur et le serveur. */
export type ApplicationDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  profile: RequestedProfile | '';
  answers: Record<string, string>;
  motivation: string;
  idea: string;
  payoutMethod: string;
  payoutDetails: Record<string, string>;
  consent: boolean;
};

export const EMPTY_DRAFT: ApplicationDraft = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  country: '',
  city: '',
  profile: '',
  answers: {},
  motivation: '',
  idea: '',
  payoutMethod: '',
  payoutDetails: {},
  consent: false,
};

export const LIMITS = {
  name: 60,
  email: 160,
  phone: 40,
  place: 80,
  answer: 500,
  motivation: 2000,
  idea: 2000,
  payout: 120,
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type StepKey = 'identite' | 'profil' | 'potentiel' | 'motivation' | 'paiement' | 'recapitulatif';

export const STEPS: readonly { key: StepKey; title: string; lead: string }[] = [
  { key: 'identite', title: 'Faisons connaissance', lead: 'Comment vous joindre, et où vous trouver.' },
  { key: 'profil', title: 'Votre profil', lead: 'Celui qui vous ressemble le plus.' },
  { key: 'potentiel', title: 'Votre potentiel', lead: 'Quelques précisions pour étudier votre candidature.' },
  { key: 'motivation', title: 'Votre motivation', lead: 'Comment imaginez-vous recommander MORA Shawiri ?' },
  { key: 'paiement', title: 'Vos versements', lead: 'Comment souhaitez-vous recevoir vos commissions ?' },
  { key: 'recapitulatif', title: 'Récapitulatif', lead: 'Relisez, corrigez si besoin, puis envoyez.' },
];

export type FieldErrors = Record<string, string>;

/**
 * Erreurs d'une étape. Une clé par champ fautif, un message par clé, en
 * français. Vide : l'étape est complète.
 */
export function validateStep(
  step: StepKey,
  draft: ApplicationDraft,
  methods: readonly PayoutMethodOption[],
): FieldErrors {
  const errors: FieldErrors = {};
  const required = (key: string, value: string, label: string, max: number) => {
    const text = value.trim();
    if (!text) errors[key] = `${label} : ce champ est requis.`;
    else if (text.length > max) errors[key] = `${label} : ${max} caractères au plus.`;
  };

  switch (step) {
    case 'identite':
      required('firstName', draft.firstName, 'Prénom', LIMITS.name);
      required('lastName', draft.lastName, 'Nom', LIMITS.name);
      required('email', draft.email, 'Adresse e-mail', LIMITS.email);
      if (!errors.email && !EMAIL_PATTERN.test(draft.email.trim())) {
        errors.email = 'Adresse e-mail : le format n’est pas reconnu.';
      }
      required('phone', draft.phone, 'WhatsApp ou téléphone', LIMITS.phone);
      if (!errors.phone && draft.phone.replace(/\D/g, '').length < 6) {
        errors.phone = 'WhatsApp ou téléphone : le numéro semble incomplet.';
      }
      required('country', draft.country, 'Pays', LIMITS.place);
      required('city', draft.city, 'Ville', LIMITS.place);
      break;
    case 'profil':
      if (!isRequestedProfile(draft.profile)) errors.profile = 'Choisissez le profil qui vous correspond.';
      break;
    case 'potentiel': {
      if (!isRequestedProfile(draft.profile)) {
        errors.profile = 'Choisissez d’abord votre profil.';
        break;
      }
      for (const question of PROFILE_QUESTIONS[draft.profile]) {
        const value = (draft.answers[question.key] ?? '').trim();
        if (!value) {
          if (!question.optional) errors[`answers.${question.key}`] = 'Ce champ est requis.';
          continue;
        }
        if (value.length > LIMITS.answer) {
          errors[`answers.${question.key}`] = `${LIMITS.answer} caractères au plus.`;
        }
        if (question.type === 'choice' && !question.options?.includes(value)) {
          errors[`answers.${question.key}`] = 'Choisissez une des réponses proposées.';
        }
      }
      break;
    }
    case 'motivation':
      required('motivation', draft.motivation, 'Votre façon de recommander MORA Shawiri', LIMITS.motivation);
      if (draft.idea.trim().length > LIMITS.idea) errors.idea = `${LIMITS.idea} caractères au plus.`;
      break;
    case 'paiement': {
      const method = methods.find((entry) => entry.code === draft.payoutMethod);
      if (!method) {
        errors.payoutMethod = 'Choisissez un moyen de versement.';
        break;
      }
      for (const fieldDef of PAYOUT_FIELDS[method.kind]) {
        const value = (draft.payoutDetails[fieldDef.key] ?? '').trim();
        if (!value) errors[`payout.${fieldDef.key}`] = `${fieldDef.label} : ce champ est requis.`;
        else if (value.length > LIMITS.payout) errors[`payout.${fieldDef.key}`] = `${LIMITS.payout} caractères au plus.`;
        else if (fieldDef.type === 'email' && !EMAIL_PATTERN.test(value)) {
          errors[`payout.${fieldDef.key}`] = 'Le format de l’adresse n’est pas reconnu.';
        } else if (fieldDef.type === 'tel' && value.replace(/\D/g, '').length < 6) {
          errors[`payout.${fieldDef.key}`] = 'Le numéro semble incomplet.';
        }
      }
      break;
    }
    case 'recapitulatif':
      if (!draft.consent) errors.consent = 'Votre accord est nécessaire pour envoyer la candidature.';
      break;
  }
  return errors;
}

/** Toutes les étapes, dans l'ordre : ce que le serveur exécute avant d'écrire. */
export function validateDraft(
  draft: ApplicationDraft,
  methods: readonly PayoutMethodOption[],
): { step: StepKey; errors: FieldErrors } | null {
  for (const { key } of STEPS) {
    const errors = validateStep(key, draft, methods);
    if (Object.keys(errors).length > 0) return { step: key, errors };
  }
  return null;
}

/** Ne garde que les réponses du profil choisi, nettoyées. */
export function profileAnswersFor(draft: ApplicationDraft): Record<string, string> {
  if (!isRequestedProfile(draft.profile)) return {};
  const answers: Record<string, string> = {};
  for (const question of PROFILE_QUESTIONS[draft.profile]) {
    const value = (draft.answers[question.key] ?? '').trim();
    if (value) answers[question.key] = value.slice(0, LIMITS.answer);
  }
  return answers;
}

/** Ne garde que les champs de versement de la famille choisie, nettoyés. */
export function payoutDetailsFor(kind: PayoutKind, details: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const fieldDef of PAYOUT_FIELDS[kind]) {
    const value = (details[fieldDef.key] ?? '').trim();
    if (value) clean[fieldDef.key] = value.slice(0, LIMITS.payout);
  }
  return clean;
}

/** Masque une coordonnée financière pour l'affichage : `•••• 6306`. */
export function maskPayoutValue(value: string): string {
  const compact = value.replace(/\s+/g, '');
  if (compact.length <= 4) return '••••';
  return `•••• ${compact.slice(-4)}`;
}

// -----------------------------------------------------------------------------
// Statuts — miroir de `affiliate_application_transition_ok` (migration 4H-2)
// -----------------------------------------------------------------------------

export type ApplicationStatus = 'NOUVELLE' | 'EN_ETUDE' | 'INFOS_REQUISES' | 'ACCEPTEE' | 'REFUSEE';

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  NOUVELLE: 'Nouvelle',
  EN_ETUDE: 'En étude',
  INFOS_REQUISES: 'Informations requises',
  ACCEPTEE: 'Acceptée',
  REFUSEE: 'Refusée',
};

export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  NOUVELLE: ['EN_ETUDE', 'INFOS_REQUISES', 'ACCEPTEE', 'REFUSEE'],
  EN_ETUDE: ['INFOS_REQUISES', 'ACCEPTEE', 'REFUSEE'],
  INFOS_REQUISES: ['EN_ETUDE', 'ACCEPTEE', 'REFUSEE'],
  ACCEPTEE: [],
  REFUSEE: [],
};

export function canTransitionApplication(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

export const OPEN_APPLICATION_STATUSES: readonly ApplicationStatus[] = ['NOUVELLE', 'EN_ETUDE', 'INFOS_REQUISES'];
