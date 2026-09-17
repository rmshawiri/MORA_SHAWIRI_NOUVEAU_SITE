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
  sendLabel: 'Envoyer ma demande',
  sendingLabel: 'Envoi en cours…',
  retryLabel: 'Réessayer l’envoi',
  whatsappCopyLabel: 'Envoyer une copie sur WhatsApp',
  whatsappFallbackLabel: 'Nous écrire sur WhatsApp',
  doneTitle: 'Votre demande de rendez-vous est prête',
  doneLead:
    'Vérifiez le récapitulatif ci-dessous, puis envoyez-le : votre demande nous parvient directement et vous en recevez un accusé de réception par e-mail.',
  doneNote:
    'Vous pouvez modifier chaque réponse avant l’envoi : rien n’est transmis tant que vous n’avez pas cliqué.',
  sentTitle: 'Votre demande de rendez-vous a bien été envoyée',
  sentLead:
    'Elle vient d’arriver chez MORA Shawiri, et un accusé de réception part vers votre adresse e-mail. Notre équipe revient vers vous pour confirmer le créneau.',
  sentAsk: 'Souhaitez-vous aussi en envoyer une copie sur WhatsApp ?',
  sentNote:
    'Ce n’est pas obligatoire : votre demande nous est déjà parvenue.',
  errorTitle: 'Votre demande n’a pas été envoyée.',
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
    // L'adresse est requise : sans elle, aucun accusé de réception n'est possible
    // et la demande ne pourrait pas être confirmée (`08_EMAILS` § 15).
    name: 'email',
    label: 'E-mail',
    question: 'À quelle adresse devons-nous vous confirmer le rendez-vous ?',
    hint: 'Elle sert uniquement à vous envoyer la confirmation de votre demande.',
    type: 'email',
    autoComplete: 'email',
    placeholder: 'vous@exemple.com',
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
