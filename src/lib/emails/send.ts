import 'server-only';

/**
 * Envoi journalisé des e-mails transactionnels — phase 4H.
 *
 * Un seul transport SMTP, celui du site (`getSmtpConfig()`), et un seul
 * enchaînement, toujours le même :
 *
 *   1. le message rendu est **écrit d'abord** dans `email_outbox` ;
 *   2. il est ensuite envoyé ;
 *   3. le résultat — envoyé, ou échec avec une erreur abrégée — est consigné.
 *
 * Une panne SMTP ne fait donc jamais disparaître ni l'acte qui a motivé
 * l'e-mail (déjà en base avant l'appel), ni l'e-mail lui-même (journalisé, et
 * renvoyable à l'identique depuis l'administration).
 *
 * ## Ce qui ne quitte jamais le serveur
 *
 * Le mot de passe SMTP. L'erreur consignée est réduite à son code et à une
 * phrase courte, nettoyée de tout ce qui ressemble à un identifiant — et la
 * table refuse de toute façon une erreur qui en contiendrait un.
 *
 * ## Les autres e-mails du site
 *
 * Le formulaire de contact (4F) et l'invitation d'un administrateur (4C)
 * gardent leur envoi direct : ils ont été validés tels quels, et les réécrire
 * n'est pas l'objet de cette phase. La phase 4J pourra les y brancher.
 */

import nodemailer from 'nodemailer';

import { getSmtpConfig } from '@/lib/env';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';

import type { RenderedEmail } from './layout';
import { sanitizeSmtpError } from './smtp-error';

export { sanitizeSmtpError };

export type LoggedEmail = {
  /** Nom stable du modèle : `affiliation.candidature.accuse`. */
  template: string;
  to: string;
  recipientKind?: 'EXTERNE' | 'EQUIPE';
  subject: string;
  rendered: RenderedEmail;
  entityType?: string;
  entityId?: string;
  /** Auteur de l'acte qui déclenche l'e-mail, s'il y en a un. */
  createdBy?: string | null;
};

export type SendOutcome =
  | { state: 'sent'; id: string }
  | { state: 'failed'; id: string | null; reason: 'smtp_disabled' | 'send_failed' | 'log_failed' };

async function transmit(to: string, subject: string, rendered: RenderedEmail): Promise<void> {
  const config = getSmtpConfig();
  if (!config) throw Object.assign(new Error('SMTP non configuré'), { code: 'SMTP_DISABLED' });

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });

  await transporter.sendMail({
    from: { name: config.fromName, address: config.from },
    to,
    subject,
    text: rendered.text,
    html: rendered.html,
  });
}

/** Adresse de l'équipe : celle qui reçoit déjà les demandes du site. */
export function teamAddress(): string | null {
  return getSmtpConfig()?.to ?? null;
}

/**
 * Journalise puis envoie. Ne lève jamais : l'appelant a déjà enregistré son
 * acte, et un e-mail manqué ne doit pas le faire échouer.
 */
export async function sendLoggedEmail(email: LoggedEmail): Promise<SendOutcome> {
  const admin = getAdminSupabaseClient();
  let id: string | null = null;

  if (admin) {
    const { data, error } = await admin
      .from('email_outbox')
      .insert({
        template: email.template,
        recipient: email.to,
        recipient_kind: email.recipientKind ?? 'EXTERNE',
        subject: email.subject,
        html_body: email.rendered.html,
        text_body: email.rendered.text,
        entity_type: email.entityType ?? null,
        entity_id: email.entityId ?? null,
        created_by: email.createdBy ?? null,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[email] journalisation impossible', error.code);
    } else {
      id = data.id;
    }
  }

  return attempt(id, email.to, email.subject, email.rendered);
}

async function attempt(
  id: string | null,
  to: string,
  subject: string,
  rendered: RenderedEmail,
): Promise<SendOutcome> {
  const admin = getAdminSupabaseClient();
  const now = new Date().toISOString();

  try {
    await transmit(to, subject, rendered);
    if (admin && id) {
      const current = await admin.from('email_outbox').select('attempts').eq('id', id).single();
      await admin
        .from('email_outbox')
        .update({
          status: 'ENVOYE',
          sent_at: now,
          last_attempt_at: now,
          last_error: null,
          attempts: (current.data?.attempts ?? 0) + 1,
        })
        .eq('id', id);
    }
    return id ? { state: 'sent', id } : { state: 'failed', id: null, reason: 'log_failed' };
  } catch (error) {
    const disabled =
      typeof error === 'object' && error !== null && (error as { code?: string }).code === 'SMTP_DISABLED';
    if (admin && id) {
      const current = await admin.from('email_outbox').select('attempts').eq('id', id).single();
      await admin
        .from('email_outbox')
        .update({
          status: 'ECHEC',
          last_attempt_at: now,
          last_error: sanitizeSmtpError(error),
          attempts: (current.data?.attempts ?? 0) + 1,
        })
        .eq('id', id);
    }
    console.error('[email] envoi en échec', disabled ? 'SMTP non configuré' : 'erreur SMTP');
    return { state: 'failed', id, reason: disabled ? 'smtp_disabled' : 'send_failed' };
  }
}

/**
 * Renvoie à l'identique un e-mail journalisé en échec. L'appelant a vérifié
 * la permission ; cette fonction ne renvoie jamais un e-mail déjà parti.
 */
export async function retryLoggedEmail(id: string): Promise<SendOutcome> {
  const admin = getAdminSupabaseClient();
  if (!admin) return { state: 'failed', id, reason: 'log_failed' };
  // Réservation atomique : de deux clics simultanés, un seul fait passer
  // l'e-mail d'ÉCHEC à EN_ATTENTE, et lui seul l'envoie.
  const { data } = await admin
    .from('email_outbox')
    .update({ status: 'EN_ATTENTE' })
    .eq('id', id)
    .eq('status', 'ECHEC')
    .select('*')
    .maybeSingle();
  if (!data) return { state: 'failed', id, reason: 'log_failed' };
  return attempt(id, data.recipient, data.subject, { html: data.html_body, text: data.text_body });
}
