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
 * `nodemailer`, la même identité d'expéditeur, et le même gabarit que les
 * e-mails transactionnels existants.
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

import { INVITATION_SUBJECT, renderInvitationEmail } from '@/lib/emails/invitation';
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
 *
 * Le contenu est rédigé dans `src/lib/emails/invitation.ts`, sur le gabarit
 * commun des e-mails : ce module-ci ne fait que l'envoyer.
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
  const { html, text } = renderInvitationEmail({
    greeting,
    username: input.username,
    url,
    invitedBy: input.invitedBy,
    ttlHours: INVITATION_TTL_HOURS,
  });

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });

  await transporter.sendMail({
    from: { name: config.fromName, address: config.from },
    to: input.to,
    subject: INVITATION_SUBJECT,
    text,
    html,
  });

  return true;
}
