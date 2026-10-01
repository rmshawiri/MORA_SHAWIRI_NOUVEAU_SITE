/**
 * E-mails du formulaire de contact (devis et rendez-vous).
 *
 * Deux messages sont produits pour chaque demande :
 *   1. la notification envoyée à l'équipe (traitement de la demande) ;
 *   2. l'accusé de réception envoyé au demandeur.
 *
 * L'apparence — identité, typographie, boutons, signature, version texte — est
 * celle du gabarit commun `layout.ts`. Ce fichier ne décide que du contenu.
 *
 * Règle de contenu : aucun délai de réponse chiffré n'est annoncé tant qu'il
 * n'a pas été officiellement validé (`06_CONTACT.md` § 41-42).
 */

import { getSiteUrl } from '@/lib/env';
import { site, whatsappLink } from '@/lib/site';

import { renderEmail, type EmailBlock, type MailRow } from './layout';

export type { MailRow } from './layout';

export type MailRequest = {
  /** Origine de la demande : formulaire de devis ou questionnaire de rendez-vous. */
  kind: 'devis' | 'rendez-vous';
  nom: string;
  organisation: string;
  email: string;
  telephone: string;
  /** Besoin exprimé (devis) ou objet du rendez-vous. */
  sujet: string;
  budget: string;
  /** Offre consultée au moment du clic, lorsque le contexte a été transmis. */
  offre: string;
  message: string;
  /** Réponses complémentaires du questionnaire de rendez-vous, dans l'ordre. */
  details: readonly MailRow[];
  /** Horodatage lisible, calculé à l'heure de Moroni. */
  receivedAt: string;
};

export type RenderedMail = {
  subject: string;
  text: string;
  html: string;
};

/** Horodatage de réception, exprimé à l'heure de Moroni. */
export function formatReceivedAt(date: Date = new Date()): string {
  try {
    const formatted = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Indian/Comoro',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
    return `${formatted} (heure de Moroni)`;
  } catch {
    return date.toISOString();
  }
}

/** Lignes « l'essentiel » communes aux deux e-mails. */
function essentialRows(request: MailRequest): MailRow[] {
  const rows: MailRow[] = [
    { label: request.kind === 'devis' ? 'Besoin' : 'Objet', value: request.sujet },
  ];
  if (request.offre) rows.push({ label: 'Offre consultée', value: request.offre });
  if (request.budget) rows.push({ label: 'Budget indicatif', value: request.budget });
  for (const detail of request.details) rows.push(detail);
  return rows;
}

/** Coordonnées du demandeur, rendues immédiatement actionnables. */
function requesterRows(request: MailRequest): MailRow[] {
  const digits = request.telephone.replace(/\D/g, '');
  return [
    { label: 'Nom', value: request.nom },
    { label: 'Organisation', value: request.organisation },
    { label: 'E-mail', value: request.email, href: `mailto:${request.email}` },
    {
      label: 'Téléphone',
      value: request.telephone,
      ...(digits.length >= 6 ? { href: `tel:${request.telephone.replace(/\s/g, '')}` } : {}),
    },
  ];
}

/**
 * E-mail adressé à l'équipe MORA Shawiri.
 *
 * L'objet est préfixé pour permettre un tri immédiat en boîte de réception,
 * et `replyTo` (positionné par l'appelant) permet de répondre en un clic.
 */
export function renderTeamEmail(request: MailRequest): RenderedMail {
  const label = request.kind === 'devis' ? 'Devis' : 'Rendez-vous';
  const subject = `[Site] ${label} — ${request.sujet} — ${request.nom}`;
  const digits = request.telephone.replace(/\D/g, '');
  const siteUrl = getSiteUrl();

  const blocks: EmailBlock[] = [
    {
      kind: 'paragraph',
      text:
        request.kind === 'devis'
          ? 'Nouvelle demande de devis reçue depuis le site.'
          : 'Nouvelle demande de rendez-vous reçue depuis le site.',
    },
    { kind: 'heading', text: "L'essentiel" },
    { kind: 'rows', rows: [...essentialRows(request), { label: 'Reçu le', value: request.receivedAt }] },
    { kind: 'divider' },
    { kind: 'heading', text: 'Le demandeur' },
    { kind: 'rows', rows: requesterRows(request) },
    { kind: 'divider' },
    { kind: 'heading', text: 'Son message' },
    { kind: 'message', text: request.message },
    {
      kind: 'actions',
      buttons: [
        { label: 'Répondre par e-mail', href: `mailto:${request.email}`, variant: 'blue' },
        ...(digits.length >= 6
          ? [{ label: 'Répondre sur WhatsApp', href: `https://wa.me/${digits}` }]
          : []),
      ],
    },
  ];

  const { html, text } = renderEmail(
    {
      preheader: `${request.sujet} — ${request.nom}`,
      title: request.kind === 'devis' ? 'Nouvelle demande de devis' : 'Nouvelle demande de rendez-vous',
      blocks,
      footer: 'internal',
      reason: `Message envoyé automatiquement depuis ${siteUrl.replace(/^https?:\/\//, '')}. Répondre à cet e-mail écrit directement au demandeur.`,
    },
    siteUrl,
  );

  return { subject, text, html };
}

/**
 * Accusé de réception adressé au demandeur.
 *
 * Aucun délai chiffré n'est annoncé : cette mention reste en attente d'une
 * validation officielle (`06_CONTACT.md` § 41).
 */
export function renderConfirmationEmail(request: MailRequest): RenderedMail {
  const siteUrl = getSiteUrl();
  const firstName = request.nom.split(/\s+/)[0] ?? request.nom;
  const subject =
    request.kind === 'devis'
      ? 'Nous avons bien reçu votre demande — MORA Shawiri'
      : 'Nous avons bien reçu votre demande de rendez-vous — MORA Shawiri';

  const nextStep =
    request.kind === 'devis'
      ? 'Notre équipe examine votre demande et revient vers vous avec une proposition adaptée à votre besoin. Si une précision nous manque, nous vous recontactons directement.'
      : 'Notre équipe examine votre demande et revient vers vous pour confirmer le créneau. Si une précision nous manque, nous vous recontactons directement.';

  const whatsappHref = whatsappLink(
    `Bonjour MORA Shawiri, je viens d’envoyer une demande depuis votre site (${request.sujet}) et je souhaite ajouter une précision.`,
  );

  const blocks: EmailBlock[] = [
    { kind: 'greeting', text: `Merci ${firstName},` },
    {
      kind: 'paragraph',
      text:
        request.kind === 'devis'
          ? 'Nous avons bien reçu votre demande.'
          : 'Nous avons bien reçu votre demande de rendez-vous.',
    },
    { kind: 'heading', text: 'Récapitulatif de votre demande' },
    { kind: 'rows', rows: essentialRows(request) },
    { kind: 'paragraph', text: 'Votre message :' },
    { kind: 'message', text: request.message },
    { kind: 'heading', text: 'La suite' },
    { kind: 'paragraph', text: nextStep },
    { kind: 'paragraph', text: 'Une précision à ajouter ? Écrivez-nous directement.' },
    {
      kind: 'actions',
      buttons: [
        { label: 'Écrire sur WhatsApp', href: whatsappHref },
        { label: 'Découvrir nos prestations', href: `${siteUrl}/services/`, variant: 'blue' },
      ],
    },
  ];

  const { html, text } = renderEmail(
    {
      preheader:
        request.kind === 'devis'
          ? 'Nous avons bien reçu votre demande.'
          : 'Nous avons bien reçu votre demande de rendez-vous.',
      title: 'Votre demande est bien arrivée',
      blocks,
      reason: `Vous recevez cet e-mail parce qu’une demande a été envoyée avec cette adresse depuis le site de MORA Shawiri. Pour toute question, écrivez à ${site.email}.`,
    },
    siteUrl,
  );

  return { subject, text, html };
}
