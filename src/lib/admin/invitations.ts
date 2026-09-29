import 'server-only';

/**
 * Jetons d'invitation et message d'invitation.
 *
 * ## Décision D-19 — pourquoi ce fichier existe
 *
 * Supabase sait inviter un utilisateur par e-mail. Le rapport de phase 4B
 * § 10.1 a établi que son service intégré ne livre qu'aux adresses de
 * l'organisation et plafonne à deux messages par heure : une invitation
 * d'administrateur y serait perdue une fois sur deux. Le SMTP du site, lui,
 * fonctionne et sert déjà les demandes de devis depuis la phase 3.
 *
 * L'invitation part donc par le même canal, avec le même transport
 * `nodemailer`, la même identité d'expéditeur, et les mêmes contraintes de
 * rendu que les e-mails transactionnels existants.
 *
 * ## Le jeton
 *
 * 32 octets aléatoires, encodés en base64url. Seule son **empreinte SHA-256**
 * est enregistrée : la table `admin_invitations` ne contient donc aucune valeur
 * exploitable. Quelqu'un qui obtiendrait une copie de la base ne pourrait
 * accepter aucune invitation.
 *
 * C'est la règle que `04_AUTHENTIFICATION.md` § 62-64 pose pour les jetons de
 * réinitialisation ; il n'y a aucune raison de la relâcher ici, où l'enjeu est
 * précisément un compte administrateur.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';

import { getSiteUrl, getSmtpConfig } from '@/lib/env';

/** Durée de validité d'une invitation. */
export const INVITATION_TTL_HOURS = 48;

/** Chemin de la page d'acceptation. */
export const INVITATION_PATH = '/invitation/';

export type IssuedToken = {
  /** Valeur transmise par e-mail. N'existe qu'en mémoire, le temps de l'envoi. */
  token: string;
  /** Valeur enregistrée en base. */
  hash: string;
  expiresAt: Date;
};

export function issueInvitationToken(now: Date = new Date()): IssuedToken {
  const token = randomBytes(32).toString('base64url');

  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(now.getTime() + INVITATION_TTL_HOURS * 3600 * 1000),
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Comparaison à temps constant.
 *
 * Comparer deux empreintes avec `===` laisse fuir, par la durée, le nombre de
 * caractères communs. La fuite est minuscule et l'attaque peu praticable à
 * travers un réseau ; elle est aussi gratuite à supprimer.
 */
export function tokenMatches(candidate: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(candidate), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function invitationUrl(token: string): string {
  return `${getSiteUrl()}${INVITATION_PATH}?jeton=${encodeURIComponent(token)}`;
}

/** Palette de marque, reprise de `src/lib/emails/templates.ts`. */
const COLORS = {
  blue: '#003366',
  blueDeep: '#001f3f',
  gold: '#ffd700',
  text: '#10161d',
  textSoft: '#555555',
  border: '#e5e7eb',
  page: '#f8f9fa',
  white: '#ffffff',
} as const;

const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Envoie l'invitation.
 *
 * Renvoie `false` si le SMTP n'est pas configuré — sans lever, et sans
 * journaliser la moindre valeur de configuration. L'appelant en informe alors
 * l'administrateur : l'invitation existe en base, elle n'a simplement pas pu
 * partir, et elle peut être renvoyée.
 *
 * Le message ne contient **ni mot de passe, ni identifiant technique** : il
 * porte l'identifiant métier choisi et un lien à usage unique. Le mot de passe
 * est choisi par la personne invitée, et n'a donc jamais à circuler.
 */
export async function sendInvitationEmail(input: {
  to: string;
  username: string;
  fullName: string | null;
  token: string;
  invitedBy: string;
}): Promise<boolean> {
  const config = getSmtpConfig();
  if (!config) return false;

  const url = invitationUrl(input.token);
  const greeting = input.fullName?.trim() || input.username;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });

  await transporter.sendMail({
    from: `"${config.fromName}" <${config.from}>`,
    to: input.to,
    subject: 'Votre accès à l’administration MORA Shawiri',
    text: [
      `Bonjour ${greeting},`,
      '',
      `${input.invitedBy} vous a ouvert un accès à l’administration de MORA Shawiri.`,
      '',
      `Votre identifiant de connexion : ${input.username}`,
      '',
      'Pour activer votre compte, choisissez votre mot de passe ici :',
      url,
      '',
      `Ce lien est valable ${INVITATION_TTL_HOURS} heures et ne fonctionne qu’une seule fois.`,
      'Une application d’authentification vous sera ensuite demandée : l’administration',
      'n’est accessible qu’avec un second facteur.',
      '',
      'Si vous n’attendiez pas ce message, ignorez-le : aucun compte ne sera créé.',
      '',
      'MORA Shawiri — Le Choix Optimal pour votre performance.',
    ].join('\n'),
    html: renderInvitationHtml({ greeting, username: input.username, url, invitedBy: input.invitedBy }),
  });

  return true;
}

/**
 * Rendu volontairement conservateur — tableaux et styles en ligne — parce que
 * les clients de messagerie ignorent largement le CSS moderne. Même parti pris
 * que les gabarits existants.
 */
function renderInvitationHtml(input: {
  greeting: string;
  username: string;
  url: string;
  invitedBy: string;
}): string {
  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:${COLORS.page};font-family:${FONT};color:${COLORS.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:${COLORS.white};border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">
    <tr><td style="background:${COLORS.blue};padding:24px;">
      <p style="margin:0;color:${COLORS.gold};font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;">MORA Shawiri</p>
      <p style="margin:8px 0 0;color:${COLORS.white};font-size:20px;font-weight:700;">Accès à l’administration</p>
    </td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0 0 16px;">Bonjour ${escapeHtml(input.greeting)},</p>
      <p style="margin:0 0 16px;">${escapeHtml(input.invitedBy)} vous a ouvert un accès à l’administration de MORA Shawiri.</p>
      <p style="margin:0 0 16px;">Votre identifiant de connexion est <strong>${escapeHtml(input.username)}</strong>.</p>
      <p style="margin:0 0 24px;">Choisissez votre mot de passe pour activer votre compte :</p>
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${escapeHtml(input.url)}" style="display:inline-block;background:${COLORS.gold};color:${COLORS.blueDeep};font-weight:700;text-decoration:none;padding:14px 28px;border-radius:10px;">Activer mon compte</a>
      </p>
      <p style="margin:0 0 16px;color:${COLORS.textSoft};font-size:14px;">Ce lien est valable ${INVITATION_TTL_HOURS} heures et ne fonctionne qu’une seule fois. Une application d’authentification vous sera ensuite demandée : l’administration n’est accessible qu’avec un second facteur.</p>
      <p style="margin:0;color:${COLORS.textSoft};font-size:14px;">Si vous n’attendiez pas ce message, ignorez-le : aucun compte ne sera créé.</p>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
