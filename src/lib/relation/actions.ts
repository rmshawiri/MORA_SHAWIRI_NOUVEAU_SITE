'use server';

/**
 * Actions des modules Demandes et devis, et Rendez-vous — phase 4F.
 *
 * Même discipline que les phases 4C et 4E, dans le même ordre, pour la même
 * raison — un second patron finirait par diverger du premier :
 *
 *   1. **permission** — `assertPermission()`, qui journalise le refus ;
 *   2. **validation** — les valeurs reçues du navigateur sont revalidées côté
 *      serveur, jamais crues ;
 *   3. **écriture sous RLS** — par le client de session, jamais par la clé à
 *      privilèges ;
 *   4. **audit et historique** — assurés par les déclencheurs de la migration
 *      0008, qui voient passer toute écriture quel qu'en soit le chemin.
 *
 * ## Quatre barrières, et pourquoi il en faut quatre
 *
 * Le § 129 du tableau de bord et le point 15 du cadrage sont sans ambiguïté :
 * « un ADMIN sans permission ne doit pas pouvoir réaliser l'action en appelant
 * directement le serveur ». Masquer un bouton ne protège rien. D'où :
 *
 *   * `assertPermission()` refuse et laisse une trace — barrière applicative ;
 *   * RLS refuse l'écriture — barrière de la base, qui tient même si une
 *     action future oublie la première ;
 *   * le **privilège de colonne** retire `reference`, `document_id` et
 *     `sent_at` aux sessions — c'est ce qui rend l'attribution d'un numéro
 *     impossible hors des fonctions prévues, contrainte à l'appui ;
 *   * les **déclencheurs de transition** refusent un changement de statut
 *     illégal ou non autorisé — seuls à voir l'ancienne et la nouvelle valeur.
 *
 * ## Ce que le navigateur ne décide jamais
 *
 * `user_id`, `lead_id`, `reference`, `author_id`, `created_by` : aucun n'est
 * lu depuis un formulaire. Les trois premiers sont écrits par la base à la
 * création, les deux derniers imposés par déclencheur depuis `auth.uid()`.
 * Un champ caché forgé n'a donc aucune prise.
 *
 * Références : `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 36-42, § 129,
 * § 193-196 ; `02_PRISE_DE_RENDEZ_VOUS.md` § 31-33, § 51-57, § 85-88.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
import { formatAmount } from '@/lib/commerce/labels';
import { archiveIssuedCommercialDocument } from '@/lib/documents/commercial-documents';
import { parseQuoteSnapshot } from '@/lib/domain/commercial-pdf';
import { renderQuoteAvailable } from '@/lib/emails/quote';
import { retryLoggedEmail, sendLoggedEmail } from '@/lib/emails/send';
import { getSiteUrl } from '@/lib/env';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type {
  AvailabilityKind,
  Json,
  QuoteRequestStatus,
  QuoteStatus,
} from '@/lib/supabase/types';

import { formatDay } from './labels';
import { checkLines, readLineDrafts } from './quote-lines';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ok = (message: string): AdminActionState => ({ status: 'ok', message });
const ko = (message: string): AdminActionState => ({ status: 'error', message });

/** Messages génériques : le § 129 interdit d'exposer une cause technique. */
const MESSAGES = {
  denied: 'Vous n’avez pas le droit d’effectuer cette action.',
  unexpected: 'L’opération n’a pas abouti. Réessayez dans un instant.',
  unknownRequest: 'Cette demande est introuvable.',
  unknownQuote: 'Ce devis est introuvable.',
  unknownAppointment: 'Ce rendez-vous est introuvable.',
  badStatus: 'Ce changement de statut n’est pas possible depuis l’état actuel.',
  badAmount: 'Le montant doit être un nombre supérieur à zéro.',
  badSummary: 'Décrivez en une phrase ce que couvre le devis.',
  badSlot: 'Indiquez une date de début et une date de fin, la fin après le début.',
  slotTaken:
    'Un autre rendez-vous confirmé occupe déjà ce créneau. Choisissez un autre horaire.',
  slotClosed:
    'Ce créneau sort des disponibilités déclarées. Ajoutez une ouverture exceptionnelle, ou choisissez un autre horaire.',
  noteEmpty: 'Une note vide n’apporte rien : écrivez au moins une phrase.',
  badAvailability:
    'Une ouverture demande un jour et des horaires ; une indisponibilité demande une date.',
  alreadySent: 'Ce devis a déjà été émis : son numéro ne peut plus changer.',
  noSupabase: 'La base de données est momentanément indisponible.',
} as const;

const MORONI = 'Indian/Comoro';

const QUOTE_REQUEST_STATUSES: readonly QuoteRequestStatus[] = [
  'NOUVELLE',
  'EN_ETUDE',
  'DEVIS_ENVOYE',
  'ACCEPTEE',
  'REFUSEE',
  'TERMINEE',
  'ANNULEE',
];

/** Réponses possibles à un devis émis. `ENVOYE` n'en est pas une. */
const QUOTE_RESPONSES: readonly QuoteStatus[] = ['ACCEPTE', 'REFUSE', 'EXPIRE', 'ANNULE'];

const AVAILABILITY_KINDS: readonly AvailabilityKind[] = ['OUVERTURE', 'EXCEPTION', 'BLOCAGE'];

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Décalage réel d'un fuseau à un instant donné.
 *
 * Écrit sans constante codée en dur : les Comores n'observent pas l'heure
 * d'été, mais inscrire `+03:00` dans le code ferait mentir la conversion le
 * jour où `site.timezone` changerait. Intl connaît la règle, on la lui demande.
 */
function zoneOffsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));

  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour') % 24,
    part('minute'),
    part('second'),
  );

  return asUtc - instant;
}

/**
 * Convertit la valeur d'un `datetime-local` en instant absolu.
 *
 * L'entrée HTML ne porte aucun fuseau : « 2026-10-05T09:00 » est neuf heures
 * *quelque part*. Le § 34 exige d'éviter toute ambiguïté — c'est donc l'heure
 * de Moroni, celle que l'administrateur lit sur sa montre et qu'il annoncera
 * au client.
 */
function fromLocalInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  const guess = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  if (!Number.isFinite(guess)) return null;

  return new Date(guess - zoneOffsetMs(guess, MORONI)).toISOString();
}

/** Rafraîchit les deux modules et les fiches, après toute écriture. */
function refresh(): void {
  revalidatePath('/administration/demandes');
  revalidatePath('/administration/rendez-vous');
}

/**
 * Traduit un refus de la base en message.
 *
 * Trois codes méritent un message propre, parce qu'ils décrivent une situation
 * que l'administrateur peut corriger — et non une panne :
 *
 *   * `23P01` — violation de la contrainte d'exclusion : le créneau est pris ;
 *   * `23514` — une contrainte ou un `raise` de garde métier ;
 *   * `42501` — permission refusée par un garde ou par RLS.
 */
function describeDatabaseError(error: { code?: string | null; message?: string }): string {
  if (error.code === '23P01') return MESSAGES.slotTaken;

  if (error.code === '42501') return MESSAGES.denied;

  if (error.code === '23514') {
    const text = error.message ?? '';
    if (text.includes('disponibilités')) return MESSAGES.slotClosed;
    // Remarques 01 : « Terminée » suit la commande — le message dit quoi faire.
    if (text.includes('commande issue de cette demande')) return text;
    if (text.includes('Transition')) return MESSAGES.badStatus;
    return MESSAGES.badStatus;
  }

  return MESSAGES.unexpected;
}

/* =========================================================== DEMANDES === */

/**
 * Change le statut d'une demande.
 *
 * `quotes.manage` — « Gérer le cycle de vie des devis », la permission semée
 * en phase 4A pour exactement cela. Consulter et corriger une demande
 * (`quotes.view`, `quotes.update`) n'autorise pas à décider de son sort : le
 * point 11 du cadrage demande de protéger la transition, pas la ligne.
 *
 * Le graphe légal est celui du déclencheur, et lui seul. L'action ne le
 * réécrit pas — deux copies d'une même règle finiraient par diverger.
 */
export async function changeQuoteRequestStatus(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('quotes.manage', 'relation.demande.statut');

    const reference = field(formData, 'reference');
    const status = field(formData, 'status') as QuoteRequestStatus;

    if (!QUOTE_REQUEST_STATUSES.includes(status)) return ko(MESSAGES.badStatus);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('quote_requests')
      .update({ status })
      .eq('reference', reference)
      .select('reference');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unknownRequest);

    refresh();
    return ok('Le statut de la demande a été mis à jour.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    console.error('[relation] changement de statut impossible');
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Affecte une demande à un administrateur, ou retire l'affectation.
 *
 * `quotes.update` suffit : affecter organise le travail, cela ne décide rien
 * du sort de la demande. L'identifiant reçu est celui d'un profil ; si la
 * cible n'existe pas, la clé étrangère refuse — on ne vérifie pas deux fois
 * ce que la base vérifie mieux.
 */
export async function assignQuoteRequest(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('quotes.update', 'relation.demande.affectation');

    const reference = field(formData, 'reference');
    const target = field(formData, 'assignedTo');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('quote_requests')
      .update({ assigned_to: target === '' ? null : target })
      .eq('reference', reference)
      .select('reference');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unknownRequest);

    refresh();
    return ok(target === '' ? 'L’affectation a été retirée.' : 'La demande a été affectée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Prépare ou corrige un brouillon de devis, lignes comprises (remarques 01,
 * A7). Remplace la création 4F à un seul montant.
 *
 * Le navigateur envoie des lignes ; il ne décide d'aucun total. Les lignes
 * sont relues ici (forme, bornes), puis `save_quote_draft` les revalide
 * toutes et recalcule le total en base, dans la même transaction. Le devis
 * reste un brouillon : il ne consomme aucun numéro et le client ne le voit
 * pas.
 *
 * `valid_until` reste facultative : le § 134 interdit d'inventer un délai de
 * validité. L'administrateur peut en saisir un, au cas par cas.
 */
export async function saveQuoteDraft(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let destination: string;
  try {
    const quoteId = field(formData, 'quoteId');
    await assertPermission(quoteId ? 'quotes.update' : 'quotes.create', 'relation.devis.brouillon');

    const reference = field(formData, 'reference');
    const summary = field(formData, 'summary');
    const notes = field(formData, 'notes');
    const validUntil = field(formData, 'validUntil');
    const replaces = field(formData, 'replaces');

    if (summary.length < 3 || summary.length > 2000) return ko(MESSAGES.badSummary);
    if (notes.length > 2000) return ko('Les observations ne dépassent pas 2 000 caractères.');
    if (validUntil !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return ko('La date de validité est illisible.');
    if (quoteId !== '' && !UUID.test(quoteId)) return ko(MESSAGES.unknownQuote);
    if (replaces !== '' && !UUID.test(replaces)) return ko(MESSAGES.unknownQuote);

    const drafts = readLineDrafts(field(formData, 'lines'));
    if (!drafts) return ko('Les lignes du devis sont illisibles. Rechargez la page.');
    const checked = checkLines(drafts);
    if (!checked.ok) return ko(checked.message);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data: saved, error } = await supabase.rpc('save_quote_draft', {
      p_request_reference: reference || null,
      p_quote_id: quoteId || null,
      p_summary: summary,
      p_notes: notes || null,
      p_valid_until: validUntil || null,
      p_lines: checked.lines as unknown as Json,
      p_replaces: replaces || null,
    });

    if (error) {
      // Les refus métier de la fonction sont rédigés pour l'administrateur :
      // ils disent quelle ligne corriger. Rien de technique n'y figure.
      if (error.code === '23514') return ko(error.message);
      return ko(describeDatabaseError(error));
    }

    refresh();
    // Le brouillon enregistré remplace l'éditeur à l'écran : le message part
    // avec la redirection (code fermé), sinon il disparaîtrait avec lui.
    const { data: owner } = await supabase
      .from('quote_requests')
      .select('reference')
      .eq('id', saved?.quote_request_id ?? '')
      .maybeSingle();
    if (!owner) return ok('Le brouillon a été enregistré. Il n’est pas encore envoyé.');
    destination = `/administration/demandes/${owner.reference}/?resultat=${quoteId ? 'brouillon-maj' : 'brouillon-cree'}#devis-brouillon`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

/**
 * Émet le devis par le Moteur de Documents et l'envoie au client.
 *
 * L'acte métier « envoyer le devis » est celui-ci, et lui seul : la fonction
 * de base alloue le numéro sous verrou, crée la pièce `DVCL` et fige son
 * instantané, puis fait passer la demande à « Devis envoyé ». Aucun
 * changement de statut ailleurs ne déclenche d'e-mail.
 *
 * Base d'abord, e-mail ensuite : l'e-mail n'est composé qu'une fois la pièce
 * émise, depuis son instantané. Il est journalisé avant d'être envoyé ; un
 * échec SMTP n'annule rien et se renvoie à l'identique depuis la fiche.
 */
export async function sendQuote(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let destination: string;
  try {
    const context = await assertPermission('quotes.manage', 'relation.devis.emission');

    const quoteId = field(formData, 'quoteId');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase.rpc('send_quote', { p_quote_id: quoteId });

    if (error) {
      if (error.code === '23514' && (error.message ?? '').includes('déjà été émis')) {
        return ko(MESSAGES.alreadySent);
      }
      if (error.code === '23514') return ko(error.message);
      return ko(describeDatabaseError(error));
    }

    refresh();
    if (!data?.reference) return ok('Le devis a été émis.');

    // L'archive privée du PDF, posée tout de suite ; à défaut, le premier
    // téléchargement la rattrape à l'identique.
    await archiveIssuedCommercialDocument(data.reference);

    const mail = await notifyQuoteIssued(data.id, data.reference, context.auth.userId);
    const { data: owner } = await supabase
      .from('quote_requests')
      .select('reference')
      .eq('id', data.quote_request_id)
      .maybeSingle();
    if (!owner) return ok(`Le devis ${data.reference} a été émis.`);
    destination = `/administration/demandes/${owner.reference}/?resultat=${mail === 'sent' ? 'devis-envoye' : 'devis-emis-sans-mail'}&devis=${data.reference}#devis`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

/**
 * Compose et envoie l'e-mail « devis disponible », depuis l'instantané de la
 * pièce — jamais depuis le brouillon ou des données recalculées.
 *
 * La lecture passe par la clé serveur : l'émission vient d'être autorisée par
 * la base (quotes.manage), et l'administrateur qui émet n'a pas forcément le
 * droit de lire la pièce elle-même. Rien n'est renvoyé au navigateur.
 */
async function notifyQuoteIssued(quoteId: string, reference: string, actorId: string): Promise<'sent' | 'failed'> {
  const admin = getAdminSupabaseClient();
  if (!admin) return 'failed';

  const { data: quote } = await admin
    .from('quotes')
    .select('id, document_id, quote_request_id')
    .eq('id', quoteId)
    .maybeSingle();
  if (!quote?.document_id) return 'failed';

  const [{ data: snapshotRow }, { data: request }] = await Promise.all([
    admin.from('document_snapshots').select('content').eq('document_id', quote.document_id).maybeSingle(),
    admin.from('quote_requests').select('user_id').eq('id', quote.quote_request_id).maybeSingle(),
  ]);
  const snapshot = snapshotRow ? parseQuoteSnapshot(snapshotRow.content) : null;
  if (!snapshot?.customer.email) return 'failed';

  const email = renderQuoteAvailable({
    name: snapshot.customer.name,
    reference,
    subject: snapshot.subject,
    total: formatAmount(snapshot.totals.total, snapshot.currency),
    validUntil: snapshot.valid_until ? formatDay(snapshot.valid_until) : null,
    replaces: snapshot.references.replaces,
    hasAccount: Boolean(request?.user_id),
    siteUrl: getSiteUrl(),
  });

  const outcome = await sendLoggedEmail({
    template: 'relation.devis.disponible',
    to: snapshot.customer.email,
    subject: email.subject,
    rendered: email.rendered,
    entityType: 'quote',
    entityId: quoteId,
    createdBy: actorId,
  });
  return outcome.state === 'sent' ? 'sent' : 'failed';
}

/**
 * Renvoie à l'identique un e-mail de devis resté en échec. La lecture sous
 * session prouve que la personne voit cet e-mail (RLS, quotes.view) ; l'envoi
 * exige en plus `quotes.manage`, la permission de l'émission.
 */
export async function retryQuoteEmail(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('quotes.manage', 'relation.devis.email.renvoi');

    const id = field(formData, 'email');
    if (!UUID.test(id)) return ko('Cet e-mail est introuvable.');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { data } = await supabase
      .from('email_outbox')
      .select('id, entity_type, status')
      .eq('id', id)
      .maybeSingle();
    if (!data || data.entity_type !== 'quote') return ko('Cet e-mail est introuvable.');
    if (data.status !== 'ECHEC') return ko('Seul un e-mail en échec peut être renvoyé.');

    const outcome = await retryLoggedEmail(id);
    refresh();
    return outcome.state === 'sent'
      ? ok('L’e-mail est parti.')
      : ko('L’e-mail n’a toujours pas pu partir. Vérifiez la configuration d’envoi, puis réessayez.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Consigne la réponse du client à un devis (§ 42 du tableau de bord).
 *
 * Quatre réponses seulement, et `ENVOYE` n'en fait pas partie : on ne revient
 * pas en arrière sur une émission. Un devis refusé garde son statut — le
 * § 133 exige qu'il « reste identifiable ».
 *
 * L'expiration est ici une décision humaine. Aucune tâche ne l'applique
 * d'office, faute de durée de validité officielle (§ 134).
 */
export async function respondToQuote(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('quotes.manage', 'relation.devis.reponse');

    const quoteId = field(formData, 'quoteId');
    const status = field(formData, 'status') as QuoteStatus;

    if (!QUOTE_RESPONSES.includes(status)) return ko(MESSAGES.badStatus);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('quotes')
      .update({ status })
      .eq('id', quoteId)
      .select('id');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unknownQuote);

    refresh();
    return ok('La réponse au devis a été enregistrée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/* ======================================================== RENDEZ-VOUS === */

/**
 * Confirme un rendez-vous sur un créneau ferme (§ 61).
 *
 * C'est le seul moment où un créneau est réellement pris — donc le seul où la
 * double réservation doit être impossible. Elle l'est par la contrainte
 * d'exclusion de la base, pas par une vérification faite ici : le § 32 demande
 * de revérifier « au moment de la confirmation définitive », et une lecture
 * suivie d'une écriture laisserait passer deux confirmations simultanées.
 *
 * Le message du § 33 — « ce créneau vient d'être réservé » — est donc rendu
 * depuis le refus de la base, pas depuis une devinette.
 */
export async function confirmAppointment(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('appointments.update', 'relation.rendez_vous.confirmation');

    const id = field(formData, 'appointmentId');
    const start = fromLocalInput(field(formData, 'start'));
    const end = fromLocalInput(field(formData, 'end'));

    if (!start || !end || end <= start) return ko(MESSAGES.badSlot);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase.rpc('confirm_appointment', {
      p_appointment_id: id,
      p_scheduled_at: start,
      p_scheduled_end: end,
    });

    if (error) return ko(describeDatabaseError(error));
    if (!data) return ko(MESSAGES.unknownAppointment);

    refresh();
    return ok(
      data.reference
        ? `Le rendez-vous ${data.reference} est confirmé.`
        : 'Le rendez-vous est confirmé.',
    );
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Déplace un rendez-vous déjà confirmé (§ 56).
 *
 * Le statut ne change pas ; le créneau, oui. Le déclencheur d'historique
 * conserve les deux valeurs, comme le § 57 l'exige, et la contrainte
 * d'exclusion refuse un chevauchement avec le nouveau créneau comme avec
 * l'ancien. La référence, elle, ne bouge pas : c'est le même rendez-vous.
 */
export async function rescheduleAppointment(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('appointments.update', 'relation.rendez_vous.reprogrammation');

    const id = field(formData, 'appointmentId');
    const start = fromLocalInput(field(formData, 'start'));
    const end = fromLocalInput(field(formData, 'end'));

    if (!start || !end || end <= start) return ko(MESSAGES.badSlot);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('appointments')
      .update({ scheduled_at: start, scheduled_end: end })
      .eq('id', id)
      .select('id');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unknownAppointment);

    refresh();
    return ok('Le rendez-vous a été reprogrammé.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Annule un rendez-vous (§ 51-55).
 *
 * `appointments.cancel`, et non `appointments.update` : la phase 4A a réservé
 * une permission propre à cet acte, et le déclencheur l'exige de son côté. Un
 * compte qui peut corriger un rendez-vous ne peut donc pas l'annuler.
 *
 * Le motif est facultatif (§ 54) mais conservé s'il est donné : il entre dans
 * l'historique métier, où il explique la ligne. Le créneau, lui, redevient
 * libre du seul fait du changement de statut — la contrainte d'exclusion ne
 * regarde que les rendez-vous confirmés (§ 64).
 */
export async function cancelAppointment(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('appointments.cancel', 'relation.rendez_vous.annulation');

    const id = field(formData, 'appointmentId');
    const reason = field(formData, 'reason').slice(0, 500);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('appointments')
      .update({ status: 'ANNULE', cancel_reason: reason === '' ? null : reason })
      .eq('id', id)
      .select('id');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unknownAppointment);

    refresh();
    return ok('Le rendez-vous est annulé, et son créneau redevient disponible.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/** Marque un rendez-vous passé comme terminé (§ 58, § 63). */
export async function completeAppointment(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('appointments.update', 'relation.rendez_vous.cloture');

    const id = field(formData, 'appointmentId');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('appointments')
      .update({ status: 'TERMINE' })
      .eq('id', id)
      .select('id');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unknownAppointment);

    refresh();
    return ok('Le rendez-vous est marqué comme terminé.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/** Affecte un rendez-vous, ou retire l'affectation. */
export async function assignAppointment(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('appointments.update', 'relation.rendez_vous.affectation');

    const id = field(formData, 'appointmentId');
    const target = field(formData, 'assignedTo');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('appointments')
      .update({ assigned_to: target === '' ? null : target })
      .eq('id', id)
      .select('id');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unknownAppointment);

    refresh();
    return ok(target === '' ? 'L’affectation a été retirée.' : 'Le rendez-vous a été affecté.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/* ===================================================== DISPONIBILITÉS === */

/**
 * Déclare une disponibilité (§ 85-88).
 *
 * `appointments.manage` — « Gérer les disponibilités », la permission semée en
 * phase 4A pour exactement cela, et distincte de celle qui confirme un
 * rendez-vous.
 *
 * Rien n'est proposé par défaut : ni jour ouvré, ni horaire, ni jour férié. Le
 * § 86 l'interdit — « ne pas inventer automatiquement les jours non
 * disponibles » — et les horaires réels de MORA Shawiri ne sont pas arrêtés.
 * Tant que cette table reste vide, aucun créneau n'est refusé : la
 * confirmation fonctionne comme avant, sans contrainte de calendrier.
 */
export async function createAvailability(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('appointments.manage', 'relation.disponibilite.creation');

    const kind = field(formData, 'kind') as AvailabilityKind;
    if (!AVAILABILITY_KINDS.includes(kind)) return ko(MESSAGES.badAvailability);

    const weekdayRaw = field(formData, 'weekday');
    const onDate = field(formData, 'onDate');
    const starts = field(formData, 'startsAt');
    const ends = field(formData, 'endsAt');
    const label = field(formData, 'label').slice(0, 120);

    const weekday = weekdayRaw === '' ? null : Number(weekdayRaw);

    // Les trois formes du § 6 de la migration. Vérifiées ici pour rendre un
    // message utile ; les contraintes de la base les refuseraient de toute
    // façon, y compris par un appel direct.
    if (kind === 'OUVERTURE') {
      if (weekday === null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        return ko(MESSAGES.badAvailability);
      }
      if (!starts || !ends) return ko(MESSAGES.badAvailability);
    } else {
      if (!onDate) return ko(MESSAGES.badAvailability);
      if (kind === 'EXCEPTION' && (!starts || !ends)) return ko(MESSAGES.badAvailability);
      // Un blocage sans horaires couvre la journée entière (§ 87).
      if (kind === 'BLOCAGE' && Boolean(starts) !== Boolean(ends)) {
        return ko(MESSAGES.badAvailability);
      }
    }

    if (starts && ends && starts >= ends) return ko(MESSAGES.badAvailability);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { error } = await supabase.from('appointment_availabilities').insert({
      kind,
      weekday: kind === 'OUVERTURE' ? weekday : null,
      on_date: kind === 'OUVERTURE' ? null : onDate,
      starts_at: starts === '' ? null : starts,
      ends_at: ends === '' ? null : ends,
      label: label === '' ? null : label,
    });

    if (error) return ko(describeDatabaseError(error));

    refresh();
    return ok('La disponibilité a été enregistrée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Retire une disponibilité.
 *
 * Suppression franche, et non désactivation : une plage horaire n'a pas
 * d'historique métier à conserver. Le § 20 de l'architecture base de données
 * l'autorise explicitement — « toutes les tables ne doivent pas obligatoirement
 * utiliser le soft delete ». Les rendez-vous déjà confirmés sur cette plage ne
 * bougent pas : ils portent leur propre créneau.
 */
export async function deleteAvailability(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('appointments.manage', 'relation.disponibilite.suppression');

    const id = field(formData, 'availabilityId');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('appointment_availabilities')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) return ko(MESSAGES.unexpected);

    refresh();
    return ok('La disponibilité a été retirée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/* ============================================================== NOTES === */

/**
 * Ajoute une note interne (§ 60, § 75).
 *
 * L'auteur n'est pas lu depuis le formulaire : un déclencheur l'impose depuis
 * `auth.uid()`, et écrase ce que le navigateur aurait pu envoyer. Le point 9
 * du cadrage l'exige, et l'écraser vaut mieux que le valider — il n'y a rien à
 * valider, la valeur est ignorée.
 *
 * Une note n'est jamais visible par le demandeur : aucune politique RLS
 * n'ouvre `relation_notes` à celui dont elle parle.
 */
export async function addRelationNote(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const target = field(formData, 'appointmentId') !== '' ? 'rendez_vous' : 'demande';

  try {
    await assertPermission(
      target === 'demande' ? 'quotes.update' : 'appointments.update',
      `relation.${target}.note`,
    );

    const body = field(formData, 'body').slice(0, 4000);
    if (body.length < 2) return ko(MESSAGES.noteEmpty);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    let quoteRequestId: string | null = null;

    if (target === 'demande') {
      const { data: request } = await supabase
        .from('quote_requests')
        .select('id')
        .eq('reference', field(formData, 'reference'))
        .maybeSingle();

      if (!request) return ko(MESSAGES.unknownRequest);
      quoteRequestId = request.id;
    }

    const { error } = await supabase.from('relation_notes').insert({
      body,
      quote_request_id: quoteRequestId,
      appointment_id: target === 'rendez_vous' ? field(formData, 'appointmentId') : null,
    });

    if (error) return ko(describeDatabaseError(error));

    refresh();
    return ok('La note a été ajoutée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Supprime une note interne.
 *
 * La politique RLS limite à sa propre note, sauf permission sensible : un
 * administrateur ne réécrit pas les observations d'un collègue par simple
 * droit de modification. Le refus vient de la base, pas d'un test ici.
 */
export async function deleteRelationNote(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const target = field(formData, 'appointmentId') !== '' ? 'rendez_vous' : 'demande';

  try {
    await assertPermission(
      target === 'demande' ? 'quotes.update' : 'appointments.update',
      `relation.${target}.note_suppression`,
    );

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);

    const { data, error } = await supabase
      .from('relation_notes')
      .delete()
      .eq('id', field(formData, 'noteId'))
      .select('id');

    if (error) return ko(describeDatabaseError(error));
    if (!data || data.length === 0) {
      return ko('Cette note ne peut pas être supprimée : elle a été écrite par un autre compte.');
    }

    refresh();
    return ok('La note a été supprimée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}
