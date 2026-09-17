/**
 * Gabarits des e-mails transactionnels de MORA Shawiri.
 *
 * Deux messages sont produits pour chaque demande :
 *   1. la notification envoyée à l'équipe (traitement de la demande) ;
 *   2. l'accusé de réception envoyé au demandeur.
 *
 * Contraintes de rendu volontairement conservatrices — tableaux HTML et styles
 * en ligne — parce que les clients de messagerie ignorent largement le CSS
 * moderne. Une version texte accompagne systématiquement la version HTML :
 * elle sert l'accessibilité, les clients en mode texte et les filtres anti-spam.
 *
 * Règle de contenu : aucun délai de réponse chiffré n'est annoncé tant qu'il
 * n'a pas été officiellement validé (`06_CONTACT.md` § 41-42).
 */

import { getSiteUrl } from '@/lib/env';
import { site, whatsappLink } from '@/lib/site';

/** Palette de marque, reprise du design system (§ 1 de `globals.css`). */
const COLORS = {
  blue: '#003366',
  blueDeep: '#001f3f',
  gold: '#ffd700',
  text: '#10161d',
  textSoft: '#555555',
  border: '#e5e7eb',
  surface: '#f2f2f2',
  page: '#f8f9fa',
  white: '#ffffff',
} as const;

const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type MailRow = {
  label: string;
  value: string;
  /** Rend la valeur cliquable (`mailto:`, `tel:`, `https://wa.me/…`). */
  href?: string;
};

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

/** Échappe les caractères qui auraient un sens en HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Échappe puis restitue les retours à la ligne d'un texte libre. */
function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br />');
}

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

/** Bandeau de titre d'un bloc, avec le filet or de l'identité MORA Shawiri. */
function sectionTitle(label: string): string {
  return `
    <tr>
      <td style="padding:28px 28px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="width:4px;background:${COLORS.gold};border-radius:2px;">&nbsp;</td>
            <td style="padding-left:12px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${COLORS.blue};">${escapeHtml(label)}</td>
          </tr>
        </table>
      </td>
    </tr>`;
}

/** Tableau clé / valeur d'un bloc d'informations. */
function rowsTable(rows: readonly MailRow[]): string {
  const cells = rows
    .filter((row) => row.value.trim().length > 0)
    .map((row) => {
      const value = row.href
        ? `<a href="${escapeHtml(row.href)}" style="color:${COLORS.blue};text-decoration:underline;">${escapeHtml(row.value)}</a>`
        : escapeHtml(row.value);
      return `
        <tr>
          <td style="padding:6px 16px 6px 0;font-family:${FONT};font-size:14px;color:${COLORS.textSoft};white-space:nowrap;vertical-align:top;">${escapeHtml(row.label)}</td>
          <td style="padding:6px 0;font-family:${FONT};font-size:15px;color:${COLORS.text};font-weight:600;vertical-align:top;">${value}</td>
        </tr>`;
    })
    .join('');

  return `
    <tr>
      <td style="padding:0 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${cells}</table>
      </td>
    </tr>`;
}

/** Bloc de message libre, sur fond gris, retours à la ligne préservés. */
function messageBlock(message: string): string {
  return `
    <tr>
      <td style="padding:4px 28px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.surface};border-radius:12px;">
          <tr>
            <td style="padding:18px 20px;font-family:${FONT};font-size:15px;line-height:1.6;color:${COLORS.text};">${escapeMultiline(message)}</td>
          </tr>
        </table>
      </td>
    </tr>`;
}

/** Séparateur discret entre deux blocs. */
function divider(): string {
  return `
    <tr>
      <td style="padding:24px 28px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="height:1px;background:${COLORS.border};line-height:1px;font-size:0;">&nbsp;</td></tr>
        </table>
      </td>
    </tr>`;
}

/** Bouton d'action (rendu en tableau : les clients de messagerie l'exigent). */
function button(label: string, href: string, variant: 'gold' | 'blue' = 'gold'): string {
  const background = variant === 'gold' ? COLORS.gold : COLORS.blue;
  const color = variant === 'gold' ? COLORS.blueDeep : COLORS.white;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-block;margin:0 8px 8px 0;">
      <tr>
        <td style="background:${background};border-radius:10px;">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:700;color:${color};text-decoration:none;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

/**
 * Enveloppe commune : bandeau bleu avec le logo au cercle blanc (règle absolue
 * du Design System § 4.3), corps blanc, pied de page discret.
 */
function layout({
  preheader,
  bannerTitle,
  bannerSubtitle,
  body,
  footer,
}: {
  preheader: string;
  bannerTitle: string;
  bannerSubtitle: string;
  body: string;
  footer: string;
}): string {
  const siteUrl = getSiteUrl();

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(bannerTitle)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.page};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:${COLORS.white};border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,31,63,.07);">

        <tr>
          <td style="background:${COLORS.blue};padding:24px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:16px;" valign="middle">
                  <img src="${siteUrl}/logo-circle.png" width="52" height="52" alt="MORA Shawiri" style="display:block;width:52px;height:52px;border:0;" />
                </td>
                <td valign="middle">
                  <div style="font-family:${FONT};font-size:18px;font-weight:700;color:${COLORS.white};">${escapeHtml(bannerTitle)}</div>
                  <div style="font-family:${FONT};font-size:14px;color:rgba(255,255,255,.74);margin-top:2px;">${escapeHtml(bannerSubtitle)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${body}

        <tr>
          <td style="padding:28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.page};border-radius:12px;">
              <tr>
                <td style="padding:18px 20px;font-family:${FONT};font-size:13px;line-height:1.7;color:${COLORS.textSoft};">${footer}</td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Signature commune, reprise des coordonnées officielles centralisées. */
function signatureHtml(): string {
  const siteUrl = getSiteUrl();
  return [
    `<strong style="color:${COLORS.blue};">MORA Shawiri</strong> — ${escapeHtml(site.slogan)}`,
    `<a href="${site.phoneHref}" style="color:${COLORS.textSoft};">${escapeHtml(site.phone)}</a> · <a href="${site.emailHref}" style="color:${COLORS.textSoft};">${escapeHtml(site.email)}</a>`,
    escapeHtml(site.addressLabel),
    `<a href="${siteUrl}/" style="color:${COLORS.textSoft};">${escapeHtml(siteUrl.replace(/^https?:\/\//, ''))}</a>`,
  ].join('<br />');
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

/** Rendu texte d'une liste de lignes clé / valeur. */
function rowsText(rows: readonly MailRow[]): string[] {
  return rows.filter((row) => row.value.trim().length > 0).map((row) => `${row.label} : ${row.value}`);
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
  const essentials = [...essentialRows(request), { label: 'Reçu le', value: request.receivedAt }];
  const requester = requesterRows(request);

  const text = [
    request.kind === 'devis'
      ? 'Nouvelle demande de devis reçue depuis le site.'
      : 'Nouvelle demande de rendez-vous reçue depuis le site.',
    '',
    "L'ESSENTIEL",
    ...rowsText(essentials),
    '',
    'LE DEMANDEUR',
    ...rowsText(requester),
    '',
    'SON MESSAGE',
    request.message,
  ].join('\n');

  const actions = [
    button('Répondre par e-mail', `mailto:${request.email}`, 'blue'),
    ...(digits.length >= 6 ? [button('Répondre sur WhatsApp', `https://wa.me/${digits}`)] : []),
  ].join('');

  const body = [
    sectionTitle("L'essentiel"),
    rowsTable(essentials),
    divider(),
    sectionTitle('Le demandeur'),
    rowsTable(requester),
    divider(),
    sectionTitle('Son message'),
    messageBlock(request.message),
    `<tr><td style="padding:24px 28px 0;">${actions}</td></tr>`,
  ].join('');

  const html = layout({
    preheader: `${request.sujet} — ${request.nom}`,
    bannerTitle: request.kind === 'devis' ? 'Nouvelle demande de devis' : 'Nouvelle demande de rendez-vous',
    bannerSubtitle: 'Reçue depuis le site MORA Shawiri',
    body,
    footer: `Message envoyé automatiquement depuis <a href="${getSiteUrl()}/" style="color:${COLORS.textSoft};">${escapeHtml(getSiteUrl().replace(/^https?:\/\//, ''))}</a>.<br />Répondre à cet e-mail écrit directement au demandeur.`,
  });

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

  const recap = essentialRows(request);

  const nextStep =
    request.kind === 'devis'
      ? 'Notre équipe examine votre demande et revient vers vous avec une proposition adaptée à votre besoin. Si une précision nous manque, nous vous recontactons directement.'
      : 'Notre équipe examine votre demande et revient vers vous pour confirmer le créneau. Si une précision nous manque, nous vous recontactons directement.';

  const whatsappHref = whatsappLink(
    `Bonjour MORA Shawiri, je viens d’envoyer une demande depuis votre site (${request.sujet}) et je souhaite ajouter une précision.`,
  );

  const text = [
    `Merci ${firstName},`,
    '',
    'Nous avons bien reçu votre demande.',
    '',
    'RÉCAPITULATIF DE VOTRE DEMANDE',
    ...rowsText(recap),
    '',
    'Votre message :',
    request.message,
    '',
    'LA SUITE',
    nextStep,
    '',
    `Une précision à ajouter ? Écrivez-nous sur WhatsApp : ${site.whatsappBase}`,
    `Découvrir nos prestations : ${siteUrl}/services/`,
    '',
    `MORA Shawiri — ${site.slogan}`,
    `${site.phone} · ${site.email}`,
    site.addressLabel,
  ].join('\n');

  const body = [
    `<tr>
      <td style="padding:28px 28px 0;font-family:${FONT};font-size:17px;line-height:1.6;color:${COLORS.text};">
        <strong>Merci ${escapeHtml(firstName)},</strong><br />nous avons bien reçu votre demande.
      </td>
    </tr>`,
    divider(),
    sectionTitle('Récapitulatif de votre demande'),
    rowsTable(recap),
    `<tr><td style="padding:14px 28px 0;font-family:${FONT};font-size:14px;color:${COLORS.textSoft};">Votre message :</td></tr>`,
    messageBlock(request.message),
    divider(),
    sectionTitle('La suite'),
    `<tr>
      <td style="padding:0 28px;font-family:${FONT};font-size:15px;line-height:1.7;color:${COLORS.text};">${escapeHtml(nextStep)}</td>
    </tr>`,
    `<tr>
      <td style="padding:24px 28px 0;font-family:${FONT};font-size:15px;color:${COLORS.text};">
        Une précision à ajouter&nbsp;?
      </td>
    </tr>`,
    `<tr><td style="padding:12px 28px 0;">${button('Écrire sur WhatsApp', whatsappHref)}${button('Découvrir nos prestations', `${siteUrl}/services/`, 'blue')}</td></tr>`,
  ].join('');

  const html = layout({
    preheader: 'Nous avons bien reçu votre demande.',
    bannerTitle: 'Votre demande est bien arrivée',
    bannerSubtitle: 'MORA Shawiri — Moroni, Union des Comores',
    body,
    footer: signatureHtml(),
  });

  return { subject, text, html };
}
