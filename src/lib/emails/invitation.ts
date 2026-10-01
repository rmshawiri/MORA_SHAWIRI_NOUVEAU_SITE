/**
 * Contenu de l'e-mail d'invitation d'un administrateur (décision D-19).
 *
 * Séparé de `src/lib/admin/invitations.ts`, qui porte `server-only` : le
 * contenu peut ainsi être vérifié par les tests unitaires sans rien envoyer.
 * L'apparence vient du gabarit commun `layout.ts`.
 */

import { renderEmail, type RenderedEmail } from './layout';

export const INVITATION_SUBJECT = 'Votre accès à l’administration MORA Shawiri';

/** Contenu de l'invitation. Exporté pour être vérifié sans rien envoyer. */
export function renderInvitationEmail(input: {
  greeting: string;
  username: string;
  url: string;
  invitedBy: string;
  /** Durée de validité du lien, en heures. */
  ttlHours: number;
}): RenderedEmail {
  return renderEmail({
    preheader: `${input.invitedBy} vous a ouvert un accès à l’administration de MORA Shawiri.`,
    title: 'Votre accès à l’administration',
    blocks: [
      { kind: 'greeting', text: `Bonjour ${input.greeting},` },
      {
        kind: 'paragraph',
        text: `${input.invitedBy} vous a ouvert un accès à l’administration de MORA Shawiri.`,
      },
      { kind: 'rows', rows: [{ label: 'Votre identifiant de connexion', value: input.username }] },
      { kind: 'paragraph', text: 'Pour activer votre compte, choisissez votre mot de passe :' },
      { kind: 'cta', button: { label: 'Activer mon compte', href: input.url } },
      { kind: 'fallback', href: input.url },
      {
        kind: 'note',
        text:
          `Ce lien est valable ${input.ttlHours} heures et ne fonctionne qu’une seule fois. ` +
          'Une application d’authentification vous sera ensuite demandée : l’administration ' +
          'n’est accessible qu’avec un second facteur.',
      },
      {
        kind: 'paragraph',
        text: 'Si vous n’attendiez pas ce message, ignorez-le : aucun compte ne sera créé.',
      },
    ],
    reason: 'Vous recevez cet e-mail parce qu’un administrateur de MORA Shawiri vous a invité.',
  });
}
