/**
 * Gabarit commun des e-mails de MORA Shawiri.
 *
 * Un seul endroit décide de l'apparence d'un e-mail : l'identité en tête, la
 * typographie, le bouton d'action, le lien de secours, la signature. Chaque
 * événement ne fournit que son **contenu**, sous forme de blocs ; ce module en
 * tire la version HTML et la version texte, qui disent donc toujours la même
 * chose.
 *
 * Trois familles d'e-mails l'utilisent aujourd'hui :
 *
 *   * les e-mails du formulaire de contact (`templates.ts`) ;
 *   * l'invitation d'un administrateur (`src/lib/admin/invitations.ts`) ;
 *   * les modèles de Supabase Auth (`auth.ts`), générés ici puis déposés dans
 *     la configuration du projet par `scripts/configure-auth-emails.mjs`.
 *
 * Les e-mails de l'Affiliation (phase 4H) et de l'Espace Client (phase 4I)
 * devront passer par `renderEmail()` : c'est ce qui leur donnera la même
 * identité sans recopier une ligne de HTML.
 *
 * ## Contraintes de rendu
 *
 * Volontairement conservatrices — tableaux de mise en page, styles en ligne,
 * aucune image indispensable — parce que les clients de messagerie ignorent
 * largement le CSS moderne :
 *
 *   * **images bloquées** : le logo porte un texte alternatif, et le nom
 *     « MORA Shawiri » est écrit en toutes lettres à côté. L'identité reste
 *     lisible sans aucune image ;
 *   * **téléphone** : largeur fluide plafonnée à 600 px, marges réduites par
 *     une requête média quand le client la comprend, et des valeurs de base
 *     qui tiennent dans 320 px quand il l'ignore ;
 *   * **adresses longues** : le lien de secours se coupe n'importe où plutôt
 *     que d'élargir le message ;
 *   * **accessibilité** : contrastes du design system (bleu `#003366` sur
 *     blanc, bleu profond sur or), libellés d'action explicites, et aucune
 *     information portée par la seule couleur.
 *
 * Ce module ne lit aucun secret et n'importe rien de réservé au serveur : il
 * est utilisé tel quel par un script Node pour produire les modèles Supabase.
 */

import { getSiteUrl } from '@/lib/env';
import { site } from '@/lib/site';

/** Palette de marque, reprise du design system (§ 1 de `globals.css`). */
export const EMAIL_COLORS = {
  blue: '#003366',
  blueDeep: '#001f3f',
  gold: '#ffd700',
  green: '#00a859',
  text: '#10161d',
  textSoft: '#555555',
  border: '#e5e7eb',
  surface: '#f2f2f2',
  page: '#f8f9fa',
  white: '#ffffff',
} as const;

const C = EMAIL_COLORS;

export const EMAIL_FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const FONT = EMAIL_FONT;

export type MailRow = {
  label: string;
  value: string;
  /** Rend la valeur cliquable (`mailto:`, `tel:`, `https://wa.me/…`). */
  href?: string;
};

export type EmailButton = {
  label: string;
  href: string;
  variant?: 'gold' | 'blue';
};

/**
 * Blocs de contenu. Tous les textes sont échappés : un bloc ne transporte
 * jamais de HTML, ce qui ferme la porte à toute injection depuis une valeur
 * saisie dans un formulaire.
 */
export type EmailBlock =
  /** Paragraphe courant. */
  | { kind: 'paragraph'; text: string }
  /** Salutation, en tête du message. */
  | { kind: 'greeting'; text: string }
  /** Intertitre, souligné du filet or de l'identité. */
  | { kind: 'heading'; text: string }
  /** Tableau libellé / valeur. */
  | { kind: 'rows'; rows: readonly MailRow[] }
  /** Texte libre sur fond gris, retours à la ligne conservés. */
  | { kind: 'message'; text: string }
  /** Bouton d'action principal, centré. */
  | { kind: 'cta'; button: EmailButton }
  /** Rangée de boutons secondaires. */
  | { kind: 'actions'; buttons: readonly EmailButton[] }
  /** Lien de secours, en clair, pour les clients qui n'affichent pas le bouton. */
  | { kind: 'fallback'; href: string }
  /** Mention discrète : sécurité, validité d'un lien, message à ignorer. */
  | { kind: 'note'; text: string }
  /** Séparateur. */
  | { kind: 'divider' };

export type EmailContent = {
  /** Aperçu affiché par la boîte de réception, après l'objet. */
  preheader: string;
  /** Titre du message, en tête du corps. */
  title: string;
  blocks: readonly EmailBlock[];
  /** Pourquoi la personne reçoit ce message — dernière ligne du pied. */
  reason: string;
  /**
   * `signature` : coordonnées publiques de MORA Shawiri (e-mails destinés à un
   * client, un prospect, un affilié). `internal` : simple mention d'origine
   * (notification adressée à l'équipe).
   */
  footer?: 'signature' | 'internal';
};

export type RenderedEmail = {
  html: string;
  text: string;
};

/** Échappe les caractères qui auraient un sens en HTML. */
export function escapeHtml(value: string): string {
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

/** Adresse du site sans protocole, pour l'affichage. */
function displayHost(siteUrl: string): string {
  return siteUrl.replace(/^https?:\/\//, '');
}

/* -------------------------------------------------------------- HTML --- */

/** Cellule de contenu : marges latérales communes, réduites sur téléphone. */
function cell(inner: string, top = 16): string {
  return `
        <tr>
          <td class="ms-px" style="padding:${top}px 32px 0;">${inner}</td>
        </tr>`;
}

function paragraphHtml(text: string): string {
  return cell(
    `<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.65;color:${C.text};">${escapeMultiline(text)}</p>`,
  );
}

function greetingHtml(text: string): string {
  return cell(
    `<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.65;color:${C.text};font-weight:600;">${escapeHtml(text)}</p>`,
    20,
  );
}

function headingHtml(text: string): string {
  return cell(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="width:4px;background:${C.gold};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
                <td style="padding-left:10px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.blue};">${escapeHtml(text)}</td>
              </tr>
            </table>`,
    24,
  );
}

function rowsHtml(rows: readonly MailRow[]): string {
  const cells = rows
    .filter((row) => row.value.trim().length > 0)
    .map((row) => {
      const value = row.href
        ? `<a href="${escapeHtml(row.href)}" style="color:${C.blue};text-decoration:underline;">${escapeHtml(row.value)}</a>`
        : escapeHtml(row.value);
      return `
              <tr>
                <td width="38%" style="width:38%;padding:6px 12px 6px 0;font-family:${FONT};font-size:14px;line-height:1.45;color:${C.textSoft};vertical-align:top;">${escapeHtml(row.label)}</td>
                <td style="padding:6px 0;font-family:${FONT};font-size:14px;line-height:1.45;color:${C.text};font-weight:600;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;">${value}</td>
              </tr>`;
    })
    .join('');

  if (!cells) return '';

  return cell(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${cells}
            </table>`,
    10,
  );
}

function messageHtml(text: string): string {
  return cell(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.surface};border-radius:10px;">
              <tr>
                <td style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.text};word-break:break-word;overflow-wrap:anywhere;">${escapeMultiline(text)}</td>
              </tr>
            </table>`,
    10,
  );
}

/** Bouton « à toute épreuve » : un tableau, parce qu'Outlook l'exige. */
function buttonHtml({ label, href, variant = 'gold' }: EmailButton, block = false): string {
  const background = variant === 'gold' ? C.gold : C.blue;
  const color = variant === 'gold' ? C.blueDeep : C.white;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="ms-btn" style="${block ? 'margin:0 auto;' : 'display:inline-block;margin:0 8px 8px 0;'}">
              <tr>
                <td align="center" style="background:${background};border-radius:8px;">
                  <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.3;color:${color};text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
                </td>
              </tr>
            </table>`;
}

function ctaHtml(button: EmailButton): string {
  return `
        <tr>
          <td class="ms-px" align="center" style="padding:24px 32px 4px;">${buttonHtml(button, true)}</td>
        </tr>`;
}

function actionsHtml(buttons: readonly EmailButton[]): string {
  return cell(buttons.map((button) => buttonHtml(button)).join(''), 20);
}

function fallbackHtml(href: string): string {
  return cell(
    `<p style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.textSoft};">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:</p>
            <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;word-break:break-all;overflow-wrap:anywhere;"><a href="${escapeHtml(href)}" style="color:${C.blue};text-decoration:underline;">${escapeHtml(href)}</a></p>`,
    18,
  );
}

function noteHtml(text: string): string {
  return cell(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-left:3px solid ${C.gold};background:${C.page};border-radius:0 8px 8px 0;">
              <tr>
                <td style="padding:10px 14px;font-family:${FONT};font-size:13px;line-height:1.55;color:${C.textSoft};">${escapeMultiline(text)}</td>
              </tr>
            </table>`,
    18,
  );
}

function dividerHtml(): string {
  return cell(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td style="height:1px;background:${C.border};line-height:1px;font-size:0;">&nbsp;</td></tr>
            </table>`,
    22,
  );
}

function blockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return paragraphHtml(block.text);
    case 'greeting':
      return greetingHtml(block.text);
    case 'heading':
      return headingHtml(block.text);
    case 'rows':
      return rowsHtml(block.rows);
    case 'message':
      return messageHtml(block.text);
    case 'cta':
      return ctaHtml(block.button);
    case 'actions':
      return actionsHtml(block.buttons);
    case 'fallback':
      return fallbackHtml(block.href);
    case 'note':
      return noteHtml(block.text);
    case 'divider':
      return dividerHtml();
  }
}

/** Coordonnées publiques, reprises de la configuration centralisée du site. */
function signatureHtml(siteUrl: string): string {
  return [
    `<strong style="color:${C.blue};">MORA Shawiri</strong> — ${escapeHtml(site.slogan)}`,
    `<a href="${escapeHtml(site.phoneHref)}" style="color:${C.textSoft};">${escapeHtml(site.phone)}</a> · <a href="${escapeHtml(site.emailHref)}" style="color:${C.textSoft};">${escapeHtml(site.email)}</a>`,
    escapeHtml(site.addressLabel),
    `<a href="${escapeHtml(siteUrl)}/" style="color:${C.textSoft};">${escapeHtml(displayHost(siteUrl))}</a>`,
  ].join('<br />');
}

/**
 * Rend un e-mail complet.
 *
 * `siteUrl` peut être fourni par l'appelant — c'est le cas du script qui
 * produit les modèles Supabase, pour qu'ils désignent l'adresse de production
 * quel que soit le poste qui les génère. Par défaut, l'adresse configurée.
 */
export function renderEmail(content: EmailContent, siteUrl: string = getSiteUrl()): RenderedEmail {
  return { html: renderHtml(content, siteUrl), text: renderText(content, siteUrl) };
}

function renderHtml(content: EmailContent, siteUrl: string): string {
  const footer = content.footer ?? 'signature';
  const body = content.blocks.map(blockHtml).join('');

  const footerHtml =
    footer === 'signature'
      ? `${signatureHtml(siteUrl)}<br /><br /><span style="color:#6b7280;">${escapeHtml(content.reason)}</span>`
      : `<span style="color:#6b7280;">${escapeHtml(content.reason)}</span>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(content.title)}</title>
<style>
  @media (max-width: 480px) {
    .ms-outer { padding: 12px 6px !important; }
    .ms-px { padding-left: 18px !important; padding-right: 18px !important; }
    .ms-title { font-size: 20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(content.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.page};">
  <tr>
    <td class="ms-outer" align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:${C.white};border:1px solid ${C.border};border-radius:12px;overflow:hidden;">

        <tr>
          <td class="ms-px" style="background:${C.blue};padding:18px 32px;border-bottom:4px solid ${C.gold};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" style="padding-right:12px;">
                  <img src="${escapeHtml(siteUrl)}/logo-circle.png" width="44" height="44" alt="MORA Shawiri" style="display:block;width:44px;height:44px;border:0;font-family:${FONT};font-size:11px;color:${C.white};" />
                </td>
                <td valign="middle">
                  <div style="font-family:${FONT};font-size:17px;font-weight:700;line-height:1.2;color:${C.white};">MORA Shawiri</div>
                  <div style="font-family:${FONT};font-size:12px;line-height:1.4;color:${C.gold};">${escapeHtml(site.slogan)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="ms-px" style="padding:28px 32px 0;">
            <h1 class="ms-title" style="margin:0;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${C.blueDeep};">${escapeHtml(content.title)}</h1>
          </td>
        </tr>
${body}

        <tr>
          <td class="ms-px" style="padding:28px 32px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${C.border};">
              <tr>
                <td style="padding-top:16px;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.textSoft};">${footerHtml}</td>
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

/* -------------------------------------------------------------- TEXTE --- */

function rowsText(rows: readonly MailRow[]): string[] {
  return rows.filter((row) => row.value.trim().length > 0).map((row) => `${row.label} : ${row.value}`);
}

function blockText(block: EmailBlock): string[] {
  switch (block.kind) {
    case 'paragraph':
    case 'greeting':
      return [block.text, ''];
    case 'heading':
      return [block.text.toUpperCase()];
    case 'rows':
      return [...rowsText(block.rows), ''];
    case 'message':
      return [block.text, ''];
    case 'cta':
      return [`${block.button.label} :`, block.button.href, ''];
    case 'actions':
      return [...block.buttons.map((button) => `${button.label} : ${button.href}`), ''];
    case 'fallback':
      // Le lien figure déjà en clair sous le libellé du bouton.
      return [];
    case 'note':
      return [block.text, ''];
    case 'divider':
      return [];
  }
}

function renderText(content: EmailContent, siteUrl: string): string {
  const footer = content.footer ?? 'signature';
  const lines = [content.title, '', ...content.blocks.flatMap(blockText)];

  lines.push('—');
  if (footer === 'signature') {
    lines.push(
      `MORA Shawiri — ${site.slogan}`,
      `${site.phone} · ${site.email}`,
      site.addressLabel,
      `${siteUrl}/`,
      '',
    );
  }
  lines.push(content.reason);

  // Deux lignes vides consécutives au plus : la version texte reste aérée
  // sans paraître trouée.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
