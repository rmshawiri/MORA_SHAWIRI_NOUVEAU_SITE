/**
 * E-mail « votre devis est disponible » — corrections post-4I.
 *
 * Contenu seul : l'apparence vient du gabarit commun (`layout.ts`), l'envoi de
 * `send.ts` (journal `email_outbox`, renvoi possible). Séparé de l'envoi pour
 * être vérifié par les tests unitaires sans rien expédier.
 *
 * ## Ce que cet e-mail ne contient jamais
 *
 * Aucun lien vers le PDF, ni public ni signé : le devis se consulte et se
 * télécharge depuis l'espace client, après connexion, par la route
 * authentifiée qui vérifie que le compte en est le titulaire. Aucune pièce
 * jointe non plus. Aucun délai, aucune condition qui ne figure pas sur le
 * devis lui-même.
 */

import { renderEmail, type EmailBlock, type MailRow, type RenderedEmail } from './layout';

export type QuoteEmail = { subject: string; rendered: RenderedEmail };

export type QuoteEmailInput = {
  /** Nom tel qu'il figure sur le devis. */
  name: string;
  reference: string;
  subject: string;
  /** Montant déjà mis en forme : `150 000 KMF`. */
  total: string;
  /** Date de validité déjà mise en forme, ou `null`. */
  validUntil: string | null;
  /** Version précédente remplacée, le cas échéant. */
  replaces: string | null;
  /** La demande est-elle rattachée à un compte client ? */
  hasAccount: boolean;
  /** Adresse absolue du site (`https://…`), sans barre finale. */
  siteUrl: string;
};

/** L'objet du devis, ramené à une ligne lisible dans un e-mail. */
function shorten(value: string, max = 160): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function renderQuoteAvailable(input: QuoteEmailInput): QuoteEmail {
  const rows: MailRow[] = [
    { label: 'Référence', value: input.reference },
    { label: 'Objet', value: shorten(input.subject) },
    { label: 'Montant total', value: input.total },
    { label: 'Validité', value: input.validUntil ? `Jusqu’au ${input.validUntil}` : 'Sans date d’expiration' },
  ];
  if (input.replaces) rows.push({ label: 'Remplace', value: `le devis ${input.replaces}` });

  const href = input.hasAccount
    ? `${input.siteUrl}/espace-client/devis/${encodeURIComponent(input.reference)}/`
    : `${input.siteUrl}/inscription/`;

  const blocks: EmailBlock[] = [
    { kind: 'greeting', text: `Bonjour ${input.name},` },
    {
      kind: 'paragraph',
      text: input.replaces
        ? `Une nouvelle version de votre devis MORA Shawiri est disponible. Elle remplace le devis ${input.replaces}.`
        : 'Votre devis MORA Shawiri est disponible.',
    },
    { kind: 'rows', rows },
  ];

  if (input.hasAccount) {
    blocks.push(
      {
        kind: 'paragraph',
        text:
          'Vous pouvez le consulter, le télécharger au format PDF et y répondre — l’accepter ou le refuser — ' +
          'depuis votre espace client.',
      },
      { kind: 'cta', button: { label: 'Consulter mon devis', href, variant: 'blue' } },
      { kind: 'fallback', href },
      {
        kind: 'note',
        text:
          'Pour protéger vos informations, le devis n’est pas joint à cet e-mail : il s’ouvre uniquement depuis ' +
          'votre espace client, après connexion.',
      },
    );
  } else {
    blocks.push(
      {
        kind: 'paragraph',
        text:
          'Votre demande a été envoyée sans espace client. Pour retrouver vos devis et vos documents en ligne, ' +
          'créez votre espace avec cette adresse e-mail : MORA Shawiri pourra ensuite y rattacher votre demande. ' +
          'Vous pouvez aussi simplement répondre à cet e-mail.',
      },
      { kind: 'cta', button: { label: 'Créer mon espace client', href, variant: 'blue' } },
      { kind: 'fallback', href },
    );
  }

  blocks.push({ kind: 'paragraph', text: 'Une question sur ce devis ? Répondez simplement à cet e-mail.' });

  return {
    subject: `Votre devis ${input.reference} est disponible — MORA Shawiri`,
    rendered: renderEmail(
      {
        preheader: `Devis ${input.reference} — ${input.total}`,
        title: 'Votre devis est disponible',
        blocks,
        reason: 'Vous recevez cet e-mail parce que vous avez demandé un devis à MORA Shawiri.',
      },
      input.siteUrl,
    ),
  };
}
