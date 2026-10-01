/**
 * E-mails du programme d'affiliation — phase 4H.
 *
 * Contenu seul : l'apparence vient du gabarit commun (`layout.ts`), l'envoi de
 * `send.ts`. Séparé de l'envoi pour être vérifié par les tests unitaires sans
 * rien expédier.
 *
 * ## Ce que ces e-mails ne disent jamais
 *
 * Aucun taux, aucun montant promis, aucun délai de réponse : rien de cela
 * n'est arrêté pour une candidature, et les documents de référence
 * interdisent d'en inventer. Aucune coordonnée financière non plus — un
 * e-mail traverse des serveurs que MORA Shawiri ne maîtrise pas. Le motif
 * interne d'un refus reste interne : seul le message rédigé pour le candidat
 * lui est adressé.
 */

import { renderEmail, type EmailBlock, type MailRow, type RenderedEmail } from './layout';
import { formatReceivedAt } from './templates';

export type AffiliationEmail = { subject: string; rendered: RenderedEmail };

const SIGNATURE_REASON =
  'Vous recevez cet e-mail parce que vous avez déposé une candidature au programme d’affiliation de MORA Shawiri.';

export type ApplicationSummary = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  profileLabel: string;
  payoutLabel: string;
  answers: readonly MailRow[];
  motivation: string;
  idea: string | null;
  submittedAt: Date;
};

/** Accusé de réception adressé au candidat. */
export function renderApplicationReceived(summary: ApplicationSummary): AffiliationEmail {
  return {
    subject: 'Nous avons bien reçu votre candidature — MORA Shawiri',
    rendered: renderEmail({
      preheader: 'Votre candidature au programme d’affiliation est enregistrée.',
      title: 'Candidature bien reçue',
      blocks: [
        { kind: 'greeting', text: `Bonjour ${summary.firstName},` },
        {
          kind: 'paragraph',
          text:
            'Merci pour votre intérêt pour le programme d’affiliation de MORA Shawiri. Votre candidature ' +
            'est enregistrée : notre équipe va l’étudier, et vous serez informé par e-mail à chaque étape.',
        },
        {
          kind: 'rows',
          rows: [
            { label: 'Profil indiqué', value: summary.profileLabel },
            { label: 'Versements souhaités', value: summary.payoutLabel },
            { label: 'Reçue le', value: formatReceivedAt(summary.submittedAt) },
          ],
        },
        {
          kind: 'note',
          text:
            'Une candidature ne vaut pas inscription : votre accès à l’espace affilié vous sera ouvert ' +
            'après étude et validation. Le moyen de versement indiqué sera vérifié avec vous avant tout versement.',
        },
        {
          kind: 'paragraph',
          text: 'Une question en attendant ? Répondez simplement à cet e-mail.',
        },
      ],
      reason: SIGNATURE_REASON,
    }),
  };
}

/** Notification adressée à l'équipe MORA Shawiri. Sans coordonnée financière. */
export function renderApplicationTeam(summary: ApplicationSummary, adminUrl: string): AffiliationEmail {
  const digits = summary.phone.replace(/\D/g, '');
  const blocks: EmailBlock[] = [
    { kind: 'paragraph', text: 'Une nouvelle candidature au programme d’affiliation vient d’être déposée sur le site.' },
    { kind: 'cta', button: { label: 'Traiter la candidature', href: adminUrl, variant: 'blue' } },
    { kind: 'heading', text: 'Candidat' },
    {
      kind: 'rows',
      rows: [
        { label: 'Nom', value: `${summary.firstName} ${summary.lastName}` },
        { label: 'E-mail', value: summary.email, href: `mailto:${summary.email}` },
        {
          label: 'WhatsApp / téléphone',
          value: summary.phone,
          ...(digits.length >= 6 ? { href: `tel:${summary.phone.replace(/\s/g, '')}` } : {}),
        },
        { label: 'Lieu', value: `${summary.city}, ${summary.country}` },
        { label: 'Profil indiqué', value: summary.profileLabel },
      ],
    },
  ];
  if (summary.answers.length > 0) {
    blocks.push({ kind: 'heading', text: 'Potentiel' }, { kind: 'rows', rows: summary.answers });
  }
  blocks.push({ kind: 'heading', text: 'Motivation' }, { kind: 'message', text: summary.motivation });
  if (summary.idea) {
    blocks.push({ kind: 'heading', text: 'Idée de collaboration' }, { kind: 'message', text: summary.idea });
  }
  blocks.push(
    { kind: 'rows', rows: [{ label: 'Versements souhaités', value: summary.payoutLabel }] },
    {
      kind: 'note',
      text: 'Les coordonnées de versement ne figurent pas dans cet e-mail : elles se consultent dans l’administration, sous la permission payouts.view.',
    },
    { kind: 'fallback', href: adminUrl },
  );

  return {
    subject: `[Site] Affiliation — candidature de ${summary.firstName} ${summary.lastName}`,
    rendered: renderEmail({
      preheader: `${summary.firstName} ${summary.lastName} — ${summary.profileLabel}`,
      title: 'Nouvelle candidature affilié',
      blocks,
      reason: 'Notification interne du site MORA Shawiri.',
      footer: 'internal',
    }),
  };
}

export type ApplicationStatusEmail = 'EN_ETUDE' | 'INFOS_REQUISES' | 'ACCEPTEE' | 'REFUSEE';

/** E-mail adressé au candidat lorsqu'un statut pertinent change. */
export function renderApplicationStatus(
  status: ApplicationStatusEmail,
  input: { firstName: string; message?: string | null },
): AffiliationEmail {
  const message = input.message?.trim() || null;
  const greeting: EmailBlock = { kind: 'greeting', text: `Bonjour ${input.firstName},` };

  switch (status) {
    case 'EN_ETUDE':
      return {
        subject: 'Votre candidature est à l’étude — MORA Shawiri',
        rendered: renderEmail({
          preheader: 'L’examen de votre candidature a commencé.',
          title: 'Votre candidature est à l’étude',
          blocks: [
            greeting,
            {
              kind: 'paragraph',
              text:
                'L’examen de votre candidature au programme d’affiliation a commencé. Nous reviendrons ' +
                'vers vous par e-mail dès qu’une décision sera prise, ou si une précision nous est utile.',
            },
          ],
          reason: SIGNATURE_REASON,
        }),
      };
    case 'INFOS_REQUISES':
      return {
        subject: 'Quelques précisions pour votre candidature — MORA Shawiri',
        rendered: renderEmail({
          preheader: 'Nous avons besoin de quelques informations complémentaires.',
          title: 'Quelques précisions, s’il vous plaît',
          blocks: [
            greeting,
            {
              kind: 'paragraph',
              text: 'Pour poursuivre l’étude de votre candidature, nous avons besoin des informations suivantes :',
            },
            { kind: 'message', text: message ?? '—' },
            {
              kind: 'paragraph',
              text: 'Répondez simplement à cet e-mail, ou écrivez-nous sur WhatsApp en rappelant votre nom.',
            },
          ],
          reason: SIGNATURE_REASON,
        }),
      };
    case 'ACCEPTEE': {
      const blocks: EmailBlock[] = [
        greeting,
        {
          kind: 'paragraph',
          text:
            'Bonne nouvelle : votre candidature au programme d’affiliation de MORA Shawiri est acceptée. ' +
            'Nous préparons maintenant votre fiche d’affilié et la configuration de votre programme.',
        },
      ];
      if (message) blocks.push({ kind: 'message', text: message });
      blocks.push({
        kind: 'paragraph',
        text:
          'Vous recevrez un second e-mail lors de l’activation : il vous donnera accès à votre espace affilié, ' +
          'à votre lien personnel et à vos conditions.',
      });
      return {
        subject: 'Votre candidature est acceptée — MORA Shawiri',
        rendered: renderEmail({
          preheader: 'Votre candidature au programme d’affiliation est acceptée.',
          title: 'Bienvenue dans le programme',
          blocks,
          reason: SIGNATURE_REASON,
        }),
      };
    }
    case 'REFUSEE': {
      const blocks: EmailBlock[] = [
        greeting,
        {
          kind: 'paragraph',
          text:
            'Nous vous remercions de l’intérêt que vous portez à MORA Shawiri. Après étude, nous ne ' +
            'sommes pas en mesure de donner une suite favorable à votre candidature au programme d’affiliation.',
        },
      ];
      if (message) blocks.push({ kind: 'message', text: message });
      blocks.push({
        kind: 'paragraph',
        text: 'Cette décision ne remet pas en cause nos échanges futurs : nous restons à votre disposition.',
      });
      return {
        subject: 'Votre candidature au programme d’affiliation — MORA Shawiri',
        rendered: renderEmail({
          preheader: 'Réponse à votre candidature au programme d’affiliation.',
          title: 'Réponse à votre candidature',
          blocks,
          reason: SIGNATURE_REASON,
        }),
      };
    }
  }
}

// -----------------------------------------------------------------------------
// Affilié — activation et statuts (lot 4H-3)
// -----------------------------------------------------------------------------

const AFFILIATE_REASON =
  'Vous recevez cet e-mail parce que vous participez au programme d’affiliation de MORA Shawiri.';

export type ActivationEmailInput = {
  firstName: string;
  reference: string;
  link: string;
  spaceUrl: string;
  /** Compte créé à l'activation : la personne choisit son mot de passe. */
  newAccount: boolean;
  passwordUrl: string;
  email: string;
};

/** Activation : accès à l'espace, référence, lien personnel. */
export function renderAffiliateActivated(input: ActivationEmailInput): AffiliationEmail {
  const blocks: EmailBlock[] = [
    { kind: 'greeting', text: `Bonjour ${input.firstName},` },
    {
      kind: 'paragraph',
      text:
        'Votre affiliation au programme de MORA Shawiri est active. Votre espace affilié vous attend : ' +
        'vous y retrouvez votre lien personnel, vos conditions, vos prospects, vos commissions et vos versements.',
    },
    {
      kind: 'rows',
      rows: [
        { label: 'Référence affilié', value: input.reference },
        { label: 'Votre lien personnel', value: input.link, href: input.link },
      ],
    },
  ];
  if (input.newAccount) {
    blocks.push(
      {
        kind: 'paragraph',
        text:
          `Un compte a été ouvert à votre adresse (${input.email}). Pour votre première connexion, choisissez ` +
          'votre mot de passe : saisissez votre adresse sur la page ci-dessous, un lien sécurisé vous sera envoyé.',
      },
      { kind: 'cta', button: { label: 'Choisir mon mot de passe', href: input.passwordUrl } },
      { kind: 'fallback', href: input.passwordUrl },
    );
  } else {
    blocks.push(
      {
        kind: 'paragraph',
        text: `Connectez-vous avec votre compte habituel (${input.email}) : l’espace affilié s’y ajoute.`,
      },
      { kind: 'cta', button: { label: 'Ouvrir mon espace affilié', href: input.spaceUrl } },
      { kind: 'fallback', href: input.spaceUrl },
    );
  }
  blocks.push({
    kind: 'note',
    text: 'Votre lien et vos conditions sont personnels. Ne communiquez jamais votre mot de passe : MORA Shawiri ne vous le demandera pas.',
  });
  return {
    subject: 'Votre espace affilié est ouvert — MORA Shawiri',
    rendered: renderEmail({
      preheader: `Votre affiliation ${input.reference} est active.`,
      title: 'Votre affiliation est active',
      blocks,
      reason: AFFILIATE_REASON,
    }),
  };
}

export type AffiliateStatusEmail = 'SUSPENDU' | 'REACTIVE' | 'TERMINE';

export function renderAffiliateStatus(
  status: AffiliateStatusEmail,
  input: { firstName: string; message?: string | null; spaceUrl: string },
): AffiliationEmail {
  const message = input.message?.trim() || null;
  const greeting: EmailBlock = { kind: 'greeting', text: `Bonjour ${input.firstName},` };
  const extra: EmailBlock[] = message ? [{ kind: 'message', text: message }] : [];
  const contact: EmailBlock = {
    kind: 'paragraph',
    text: 'Une question ? Répondez simplement à cet e-mail.',
  };

  if (status === 'SUSPENDU') {
    return {
      subject: 'Votre affiliation est suspendue — MORA Shawiri',
      rendered: renderEmail({
        preheader: 'Votre affiliation est momentanément suspendue.',
        title: 'Affiliation suspendue',
        blocks: [
          greeting,
          {
            kind: 'paragraph',
            text:
              'Votre affiliation au programme de MORA Shawiri est momentanément suspendue. Pendant la suspension, ' +
              'vos liens et vos codes n’attribuent pas de nouvelles affaires. Votre historique et vos commissions ' +
              'déjà enregistrées sont conservés.',
          },
          ...extra,
          contact,
        ],
        reason: AFFILIATE_REASON,
      }),
    };
  }
  if (status === 'REACTIVE') {
    return {
      subject: 'Votre affiliation est réactivée — MORA Shawiri',
      rendered: renderEmail({
        preheader: 'Votre affiliation est de nouveau active.',
        title: 'Affiliation réactivée',
        blocks: [
          greeting,
          {
            kind: 'paragraph',
            text: 'Votre affiliation au programme de MORA Shawiri est de nouveau active : vos liens et vos codes fonctionnent à nouveau.',
          },
          ...extra,
          { kind: 'cta', button: { label: 'Ouvrir mon espace affilié', href: input.spaceUrl } },
        ],
        reason: AFFILIATE_REASON,
      }),
    };
  }
  return {
    subject: 'Fin de votre affiliation — MORA Shawiri',
    rendered: renderEmail({
      preheader: 'Votre affiliation au programme a pris fin.',
      title: 'Fin de votre affiliation',
      blocks: [
        greeting,
        {
          kind: 'paragraph',
          text:
            'Votre affiliation au programme de MORA Shawiri a pris fin. Vos liens et vos codes n’attribuent plus ' +
            'de nouvelles affaires. Les commissions déjà acquises restent dues selon les conditions applicables, ' +
            'et votre historique reste consultable dans votre espace.',
        },
        ...extra,
        { kind: 'paragraph', text: 'Merci pour votre contribution.' },
      ],
      reason: AFFILIATE_REASON,
    }),
  };
}

/** Décision sur une demande de coordonnées de versement (décision J). */
export function renderPayoutAccountReviewed(
  approved: boolean,
  input: { firstName: string; methodLabel: string; note?: string | null },
): AffiliationEmail {
  const blocks: EmailBlock[] = [
    { kind: 'greeting', text: `Bonjour ${input.firstName},` },
    {
      kind: 'paragraph',
      text: approved
        ? `Vos coordonnées de versement (${input.methodLabel}) sont validées : elles serviront aux prochains versements.`
        : `Votre demande de coordonnées de versement (${input.methodLabel}) n’a pas été validée. Vos coordonnées précédentes restent en vigueur.`,
    },
  ];
  if (input.note?.trim()) blocks.push({ kind: 'message', text: input.note.trim() });
  return {
    subject: approved
      ? 'Vos coordonnées de versement sont validées — MORA Shawiri'
      : 'Vos coordonnées de versement — MORA Shawiri',
    rendered: renderEmail({
      preheader: approved ? 'Vos coordonnées de versement sont validées.' : 'Réponse à votre demande.',
      title: approved ? 'Coordonnées validées' : 'Coordonnées non validées',
      blocks,
      reason: AFFILIATE_REASON,
    }),
  };
}
