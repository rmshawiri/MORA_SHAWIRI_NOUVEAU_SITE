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
