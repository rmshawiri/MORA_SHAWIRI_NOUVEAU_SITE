'use server';

/**
 * Actions du module Affiliation — phase 4H.
 *
 * Même discipline que les modules précédents, dans le même ordre :
 *
 *   1. **permission** — `assertPermission()`, qui journalise un refus ;
 *   2. **validation** — rien de ce qu'envoie le navigateur n'est cru ;
 *   3. **écriture en base, sous la session** — par les fonctions de la
 *      migration, qui revérifient elles-mêmes la permission ;
 *   4. **e-mail ensuite**, journalisé — un échec SMTP n'annule jamais l'acte,
 *      et l'e-mail reste renvoyable.
 *
 * Un e-mail ne part que si l'administrateur a coché « Notifier » : une note,
 * une correction mineure, un geste technique ne dérangent personne.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
import { renderApplicationStatus, type ApplicationStatusEmail } from '@/lib/emails/affiliation';
import { retryLoggedEmail, sendLoggedEmail } from '@/lib/emails/send';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';

const ok = (message: string): AdminActionState => ({ status: 'ok', message });
const ko = (message: string): AdminActionState => ({ status: 'error', message });

const MESSAGES = {
  denied: 'Vous n’avez pas le droit d’effectuer cette action.',
  unexpected: 'L’opération n’a pas abouti. Réessayez dans un instant.',
  noSupabase: 'La base de données est momentanément indisponible.',
  unknown: 'Cette candidature est introuvable.',
  badStatus: 'Ce changement n’est pas possible depuis l’état actuel de la candidature.',
  infoRequired: 'Précisez les informations demandées au candidat.',
  reasonRequired: 'Le motif interne du refus est obligatoire.',
  categoryRequired: 'Choisissez la catégorie de l’affilié.',
  noteEmpty: 'Une note vide n’apporte rien : écrivez au moins une phrase.',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function field(formData: FormData, name: string, max = 2000): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Traduit une erreur de la base en message lisible, sans détail technique. */
function describe(error: { code?: string; message?: string }): string {
  if (error.code === '42501') return MESSAGES.denied;
  if (error.code === 'P0002' || error.code === '02000') return MESSAGES.unknown;
  if (error.code === '23514') {
    // Les messages de nos fonctions sont rédigés pour être lus.
    const message = error.message ?? '';
    return message.length > 0 && message.length < 200 ? message : MESSAGES.badStatus;
  }
  return MESSAGES.unexpected;
}

function refreshApplication(id: string) {
  revalidatePath('/administration/affiliation/');
  revalidatePath('/administration/affiliation/candidatures/');
  revalidatePath(`/administration/affiliation/candidatures/${id}/`);
}

async function notifyCandidate(
  applicationId: string,
  status: ApplicationStatusEmail,
  message: string | null,
  actorId: string,
): Promise<'sent' | 'failed' | 'skipped'> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return 'failed';
  const { data } = await supabase
    .from('affiliate_applications')
    .select('first_name, email')
    .eq('id', applicationId)
    .maybeSingle();
  if (!data) return 'failed';
  const email = renderApplicationStatus(status, { firstName: data.first_name, message });
  const outcome = await sendLoggedEmail({
    template: `affiliation.candidature.${status.toLowerCase()}`,
    to: data.email,
    subject: email.subject,
    rendered: email.rendered,
    entityType: 'affiliate_application',
    entityId: applicationId,
    createdBy: actorId,
  });
  return outcome.state === 'sent' ? 'sent' : 'failed';
}


/**
 * Où revenir après une décision. La décision fait souvent disparaître le
 * bouton qui l'a déclenchée (un statut franchi n'est plus proposé) : le retour
 * se fait donc par la page elle-même, qui lit un code fermé — jamais un texte
 * reçu — et affiche le message correspondant.
 */
function resultUrl(id: string, result: string, mail: 'sent' | 'failed' | 'skipped'): string {
  return `/administration/affiliation/candidatures/${id}/?resultat=${result}&mail=${mail}`;
}

/** Examen, demande d'informations, refus. */
export async function reviewApplication(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let destination: string;
  try {
    const context = await assertPermission('affiliate_applications.manage', 'affiliation.candidature.decision');
    const id = field(formData, 'id', 40);
    const status = field(formData, 'status', 20);
    const message = field(formData, 'message') || null;
    const reason = field(formData, 'reason', 1000) || null;
    const notify = formData.get('notify') === '1';

    if (!UUID.test(id)) return ko(MESSAGES.unknown);
    if (!['EN_ETUDE', 'INFOS_REQUISES', 'REFUSEE'].includes(status)) return ko(MESSAGES.badStatus);
    if (status === 'INFOS_REQUISES' && !message) return ko(MESSAGES.infoRequired);
    if (status === 'REFUSEE' && !reason) return ko(MESSAGES.reasonRequired);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { error } = await supabase.rpc('review_affiliate_application', {
      p_application_id: id,
      p_status: status,
      p_message: message,
      p_reason: reason,
    });
    if (error) return ko(describe(error));

    // Une demande d'informations n'a de sens que si le candidat la reçoit.
    const mustNotify = notify || status === 'INFOS_REQUISES';
    const mail = mustNotify
      ? await notifyCandidate(id, status as ApplicationStatusEmail, message, context.access.userId)
      : 'skipped';

    refreshApplication(id);
    destination = resultUrl(id, status, mail);
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    console.error('[affiliation] décision de candidature impossible');
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

/** Acceptation : la candidature devient une fiche d'affilié en préparation. */
export async function acceptApplication(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let destination: string;
  try {
    const context = await assertPermission('affiliate_applications.manage', 'affiliation.candidature.acceptation');
    if (!context.can('affiliates.create')) {
      await assertPermission('affiliates.create', 'affiliation.candidature.acceptation');
    }
    const id = field(formData, 'id', 40);
    const categoryId = field(formData, 'category', 40);
    const message = field(formData, 'message') || null;
    const notify = formData.get('notify') === '1';

    if (!UUID.test(id)) return ko(MESSAGES.unknown);
    if (!UUID.test(categoryId)) return ko(MESSAGES.categoryRequired);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { error } = await supabase.rpc('accept_affiliate_application', {
      p_application_id: id,
      p_category_id: categoryId,
      p_message: message,
    });
    if (error) return ko(describe(error));

    const mail = notify ? await notifyCandidate(id, 'ACCEPTEE', message, context.access.userId) : 'skipped';
    refreshApplication(id);
    destination = resultUrl(id, 'ACCEPTEE', mail);
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    console.error('[affiliation] acceptation impossible');
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

export async function noteApplication(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('affiliate_applications.manage', 'affiliation.candidature.note');
    const id = field(formData, 'id', 40);
    const body = field(formData, 'note', 4000);
    if (!UUID.test(id)) return ko(MESSAGES.unknown);
    if (!body) return ko(MESSAGES.noteEmpty);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { error } = await supabase.rpc('note_affiliate_application', { p_application_id: id, p_body: body });
    if (error) return ko(describe(error));
    refreshApplication(id);
    return ok('La note est enregistrée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Nouvelle tentative d'un e-mail en échec. La lecture sous session prouve que
 * la personne voit cet e-mail (RLS) ; la permission de traitement de
 * l'entité est exigée en plus.
 */
export async function retryEmail(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    const id = field(formData, 'email', 40);
    if (!UUID.test(id)) return ko('Cet e-mail est introuvable.');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { data } = await supabase.from('email_outbox').select('id, entity_type, entity_id, status').eq('id', id).maybeSingle();
    if (!data) return ko('Cet e-mail est introuvable.');
    if (data.status !== 'ECHEC') return ko('Seul un e-mail en échec peut être renvoyé.');

    if (data.entity_type === 'affiliate_application') {
      await assertPermission('affiliate_applications.manage', 'affiliation.email.renvoi');
    } else if (data.entity_type === 'affiliate') {
      await assertPermission('affiliates.update', 'affiliation.email.renvoi');
    } else {
      await assertPermission('notifications.manage', 'affiliation.email.renvoi');
    }

    const outcome = await retryLoggedEmail(id);
    if (outcome.state !== 'sent') {
      return ko('L’e-mail n’a toujours pas pu partir. Vérifiez la configuration d’envoi, puis réessayez.');
    }
    if (data.entity_type === 'affiliate_application' && data.entity_id) {
      refreshApplication(data.entity_id);
      destination = resultUrl(data.entity_id, 'RENVOI', 'sent');
    } else {
      return ok('L’e-mail est parti.');
    }
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}
