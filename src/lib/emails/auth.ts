/**
 * Modèles des e-mails envoyés par Supabase Auth.
 *
 * ## Ce que ce fichier n'est pas
 *
 * Ces e-mails ne passent **pas** par le SMTP du site. Supabase les compose et
 * les envoie lui-même, à partir de modèles stockés dans la configuration du
 * projet — pas dans ce dépôt. Modifier ce fichier ne change donc rien tant que
 * les modèles n'ont pas été déposés chez Supabase :
 *
 *     npm run auth:emails -- --env shared --dry-run
 *     npm run auth:emails -- --env shared
 *
 * Le script (`scripts/configure-auth-emails.mjs`) produit les modèles à partir
 * d'ici, les envoie par l'API de gestion, puis les relit pour vérifier que ce
 * qui est en place est exactement ce qui a été produit. Ce fichier est ainsi la
 * source de vérité versionnée, et la configuration du projet sa copie.
 *
 * ## Les deux modèles réellement utilisés
 *
 * Le code du site ne déclenche que deux e-mails Supabase :
 *
 *   * `confirmation` — l'inscription d'un client (`signUpAction`) ;
 *   * `recovery` — la demande de réinitialisation du mot de passe
 *     (`requestPasswordResetAction`).
 *
 * Invitation, lien magique, changement d'adresse et réauthentification ne sont
 * appelés nulle part : l'invitation d'un administrateur passe par le SMTP du
 * site (décision D-19). Leurs modèles restent ceux de Supabase.
 *
 * ## Les variables
 *
 * `{{ .ConfirmationURL }}` est la seule variable employée. C'est le lien que
 * Supabase fabrique lui-même — jeton compris, puis redirection vers l'adresse
 * demandée par l'action (`/auth/callback/?suite=…`). Il est inséré tel quel :
 * le reconstruire à la main risquerait de casser le jeton ou la redirection.
 *
 * Le nom saisi à l'inscription n'est **volontairement pas** repris dans la
 * salutation. Il viendrait du formulaire public et partirait vers l'adresse
 * saisie dans le même formulaire : quelqu'un pourrait inscrire l'adresse d'un
 * tiers avec, pour « nom », une phrase de son choix — et la faire parvenir sous
 * l'identité de MORA Shawiri. « Bonjour, » ne transporte rien.
 */

import { renderEmail, type EmailContent } from './layout';

/** Variable Supabase du lien d'action. Insérée telle quelle, jamais réécrite. */
export const SUPABASE_CONFIRMATION_URL = '{{ .ConfirmationURL }}';

export type SupabaseAuthTemplateKey = 'confirmation' | 'recovery';

export type SupabaseAuthTemplate = {
  subject: string;
  html: string;
};

export type SupabaseAuthTemplateOptions = {
  /** Adresse publique du site, pour le logo, la signature et les liens. */
  siteUrl: string;
  /** Durée de validité des liens, lue dans la configuration (`mailer_otp_exp`). */
  linkLifetimeSeconds: number;
};

/** « une heure », « 30 minutes », « 2 heures » — la validité réelle, pas une promesse. */
export function describeLifetime(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? 'une heure' : `${hours} heures`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? 'une minute' : `${minutes} minutes`;
}

function confirmation({ siteUrl, linkLifetimeSeconds }: SupabaseAuthTemplateOptions): EmailContent {
  return {
    preheader: 'Une dernière étape pour activer votre compte MORA Shawiri.',
    title: 'Confirmez votre adresse e-mail',
    blocks: [
      { kind: 'greeting', text: 'Bonjour,' },
      {
        kind: 'paragraph',
        text: 'Vous venez de créer votre compte client sur le site de MORA Shawiri. Merci de votre confiance.',
      },
      {
        kind: 'paragraph',
        text: 'Pour l’activer, il reste une étape : confirmer que cette adresse e-mail est bien la vôtre. Une fois la confirmation faite, vous accédez directement à votre espace client.',
      },
      {
        kind: 'cta',
        button: { label: 'Confirmer mon adresse e-mail', href: SUPABASE_CONFIRMATION_URL },
      },
      { kind: 'fallback', href: SUPABASE_CONFIRMATION_URL },
      {
        kind: 'note',
        text: `Ce lien est valable ${describeLifetime(linkLifetimeSeconds)} et ne sert qu’une seule fois. Vous n’êtes pas à l’origine de cette inscription ? Ignorez simplement ce message : sans confirmation, le compte n’est pas activé.`,
      },
    ],
    reason: `Vous recevez cet e-mail parce qu’une inscription a été demandée avec cette adresse sur ${siteUrl.replace(/^https?:\/\//, '')}.`,
  };
}

function recovery({ siteUrl, linkLifetimeSeconds }: SupabaseAuthTemplateOptions): EmailContent {
  return {
    preheader: 'Choisissez un nouveau mot de passe pour votre compte MORA Shawiri.',
    title: 'Réinitialisez votre mot de passe',
    blocks: [
      { kind: 'greeting', text: 'Bonjour,' },
      {
        kind: 'paragraph',
        text: 'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte MORA Shawiri.',
      },
      {
        kind: 'paragraph',
        text: 'Pour choisir un nouveau mot de passe, utilisez le bouton ci-dessous.',
      },
      {
        kind: 'cta',
        button: { label: 'Réinitialiser mon mot de passe', href: SUPABASE_CONFIRMATION_URL },
      },
      { kind: 'fallback', href: SUPABASE_CONFIRMATION_URL },
      {
        kind: 'note',
        text: `Ce lien est valable ${describeLifetime(linkLifetimeSeconds)} et ne sert qu’une seule fois. Vous n’avez rien demandé ? Ignorez ce message : votre mot de passe actuel reste inchangé.`,
      },
      {
        kind: 'paragraph',
        text: 'Pour votre sécurité, MORA Shawiri ne vous demandera jamais votre mot de passe, ni par e-mail, ni par téléphone.',
      },
    ],
    reason: `Vous recevez cet e-mail parce qu’une réinitialisation du mot de passe a été demandée pour cette adresse sur ${siteUrl.replace(/^https?:\/\//, '')}.`,
  };
}

const SUBJECTS: Record<SupabaseAuthTemplateKey, string> = {
  confirmation: 'Confirmez votre adresse e-mail — MORA Shawiri',
  recovery: 'Réinitialisation de votre mot de passe — MORA Shawiri',
};

const CONTENTS: Record<SupabaseAuthTemplateKey, (options: SupabaseAuthTemplateOptions) => EmailContent> = {
  confirmation,
  recovery,
};

/**
 * Produit les modèles à déposer chez Supabase.
 *
 * Supabase n'envoie que la partie HTML de ses modèles : la version texte de
 * `renderEmail()` n'est donc pas transmise ici.
 */
export function renderSupabaseAuthTemplates(
  options: SupabaseAuthTemplateOptions,
): Record<SupabaseAuthTemplateKey, SupabaseAuthTemplate> {
  const keys = Object.keys(CONTENTS) as SupabaseAuthTemplateKey[];

  return Object.fromEntries(
    keys.map((key) => [
      key,
      { subject: SUBJECTS[key], html: renderEmail(CONTENTS[key](options), options.siteUrl).html },
    ]),
  ) as Record<SupabaseAuthTemplateKey, SupabaseAuthTemplate>;
}

/** Champs de l'API de gestion Supabase correspondant à chaque modèle. */
export const SUPABASE_TEMPLATE_FIELDS: Record<
  SupabaseAuthTemplateKey,
  { subject: string; content: string }
> = {
  confirmation: {
    subject: 'mailer_subjects_confirmation',
    content: 'mailer_templates_confirmation_content',
  },
  recovery: {
    subject: 'mailer_subjects_recovery',
    content: 'mailer_templates_recovery_content',
  },
};
