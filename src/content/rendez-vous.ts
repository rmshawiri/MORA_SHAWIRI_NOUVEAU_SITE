/**
 * Configuration du questionnaire de prise de rendez-vous.
 * Reprise de `window.MORA_RDV` dans l'ébauche : une question à la fois, puis
 * envoi du récapitulatif sur WhatsApp.
 */

export type ChoiceStep = {
  name: string;
  label: string;
  question: string;
  hint?: string;
  options: readonly string[];
};

export type InputStep = {
  name: string;
  label: string;
  question: string;
  hint?: string;
  type: 'text' | 'tel' | 'email' | 'date' | 'textarea';
  placeholder?: string;
  autoComplete?: string;
  inputMode?: 'tel' | 'email' | 'text';
  optional?: boolean;
  /** Valeur inscrite au récapitulatif lorsque la question est passée. */
  emptyValue?: string;
};

export type RdvStep = ChoiceStep | InputStep;

export function isChoiceStep(step: RdvStep): step is ChoiceStep {
  return 'options' in step;
}

export const rdvIntro = 'Bonjour MORA Shawiri, je souhaite prendre rendez-vous.';
export const rdvOutro = 'Merci de me confirmer le créneau.';

export const rdvLabels = {
  next: 'Continuer',
  back: 'Retour',
  skip: 'Passer',
  edit: 'Modifier',
  restart: 'Tout recommencer',
  required: 'Merci de renseigner ce champ pour continuer.',
  invalidEmail: 'Cette adresse e-mail semble incorrecte.',
  invalidPhone: 'Ce numéro semble incomplet.',
  sendLabel: 'Envoyer ma demande sur WhatsApp',
  doneTitle: 'Votre demande de rendez-vous est prête',
  doneLead:
    'Vérifiez le récapitulatif ci-dessous, puis envoyez-le : la conversation WhatsApp s’ouvre avec votre message déjà rédigé.',
  doneNote:
    'Nous confirmons votre créneau sous 24 h ouvrées (Lun. – Sam., 08H – 17H, heure de Moroni).',
} as const;

export const rdvSteps: readonly RdvStep[] = [
  {
    name: 'sujet',
    label: 'Sujet du rendez-vous',
    question: 'Bonjour ! De quoi souhaitez-vous parler ?',
    hint: 'Choisissez le sujet le plus proche de votre besoin.',
    options: [
      'Création de site vitrine',
      'Boutique en ligne',
      'Identité visuelle & design',
      'Marketing digital & SEO',
      'Organisation & gestion des données',
      'Formation & accompagnement',
      'Autre sujet',
    ],
  },
  {
    name: 'format',
    label: 'Format souhaité',
    question: 'Comment préférez-vous échanger ?',
    options: ['Sur place, à Moroni', 'Appel téléphonique', 'Visioconférence', 'Discussion WhatsApp'],
  },
  {
    name: 'date',
    label: 'Date souhaitée',
    question: 'Quelle date vous conviendrait le mieux ?',
    hint: 'Nous vous proposerons l’alternative la plus proche si le créneau est pris.',
    type: 'date',
  },
  {
    name: 'creneau',
    label: 'Créneau préféré',
    question: 'Plutôt le matin ou l’après-midi ?',
    options: ['Matin (08H – 12H)', 'Après-midi (12H – 17H)', 'Je suis flexible'],
  },
  {
    name: 'nom',
    label: 'Nom complet',
    question: 'Comment devons-nous vous appeler ?',
    type: 'text',
    autoComplete: 'name',
    placeholder: 'Prénom et nom',
  },
  {
    name: 'organisation',
    label: 'Organisation',
    question: 'Représentez-vous une entreprise ou une organisation ?',
    hint: 'Facultatif — passez cette question si vous venez à titre personnel.',
    type: 'text',
    autoComplete: 'organization',
    placeholder: 'Nom de votre structure',
    optional: true,
    emptyValue: 'À titre personnel',
  },
  {
    name: 'telephone',
    label: 'Téléphone / WhatsApp',
    question: 'Sur quel numéro pouvons-nous vous joindre ?',
    type: 'tel',
    inputMode: 'tel',
    autoComplete: 'tel',
    placeholder: '+269 ...',
  },
  {
    name: 'email',
    label: 'E-mail',
    question: 'Souhaitez-vous recevoir la confirmation par e-mail ?',
    hint: 'Facultatif.',
    type: 'email',
    autoComplete: 'email',
    placeholder: 'vous@exemple.com',
    optional: true,
    emptyValue: 'Non communiqué',
  },
  {
    name: 'budget',
    label: 'Budget envisagé',
    question: 'Avez-vous une enveloppe budgétaire en tête ?',
    options: [
      'Moins de 100 000 KMF',
      '100 000 – 300 000 KMF',
      '300 000 – 700 000 KMF',
      'Plus de 700 000 KMF',
      'À définir ensemble',
    ],
  },
  {
    name: 'contexte',
    label: 'Précisions',
    question: 'Un mot sur votre projet avant l’échange ?',
    hint: 'Facultatif — deux ou trois phrases suffisent.',
    type: 'textarea',
    placeholder: 'Objectif, échéance, ce que vous avez déjà…',
    optional: true,
    emptyValue: 'À préciser pendant le rendez-vous',
  },
] as const;
