import 'server-only';

/**
 * Lectures des modules Demandes et devis, et Rendez-vous.
 *
 * Toutes passent par le client de session, donc sous RLS — le patron posé en
 * phase 4C et repris en 4E. Le client à clé secrète n'apparaît pas : il
 * contournerait la troisième barrière, et l'administration deviendrait le seul
 * endroit du système où elle ne s'applique pas.
 *
 * ## Ce qui n'est pas chargé, et pourquoi
 *
 * Les listes ne ramènent ni le message libre, ni le téléphone. Ce ne sont pas
 * des données dont un tableau a besoin, et le point 17 du cadrage demande de
 * ne pas exposer ce qui n'est pas nécessaire — y compris à quelqu'un
 * d'autorisé. Elles arrivent sur la fiche, où on les consulte en le voulant.
 *
 * ## Aucun compteur fabriqué
 *
 * Le § 171 du tableau de bord est formel : « ces fonctionnalités ne doivent
 * pas être simulées si elles ne sont pas encore implémentées ». Les nombres
 * affichés sont des `length` sur des lignes réellement lues, jamais une
 * estimation ni une valeur d'exemple.
 */

import { getServerSupabaseClient } from '@/lib/supabase/server';
import type {
  AppointmentAvailabilityRow,
  AppointmentEventRow,
  AppointmentRow,
  AppointmentStatus,
  LeadRow,
  QuoteRequestEventRow,
  QuoteRequestRow,
  QuoteRequestStatus,
  QuoteRow,
  RelationNoteRow,
} from '@/lib/supabase/types';

/*
 * Les libellés, le graphe des transitions et les mises en forme vivent dans
 * `labels.ts`, que les composants client peuvent importer — ce module-ci ne le
 * peut pas, il est `server-only`. Ils sont réexportés ici pour que les pages
 * d'administration n'aient qu'un import à connaître.
 */
import { APPOINTMENT_STATUS_LABELS, QUOTE_REQUEST_STATUS_LABELS } from './labels';

export * from './labels';

/* ----------------------------------------------------------------- listes --- */

export type QuoteRequestListEntry = Pick<
  QuoteRequestRow,
  | 'id'
  | 'reference'
  | 'subject'
  | 'status'
  | 'budget_label'
  | 'offer_title'
  | 'source'
  | 'assigned_to'
  | 'created_at'
> & {
  leads: Pick<LeadRow, 'full_name' | 'email'> | null;
  services: { title: string } | null;
};

/** Demandes reçues, les plus récentes d'abord. */
export async function listQuoteRequests(limit = 100): Promise<QuoteRequestListEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('quote_requests')
    // prettier-ignore
    .select('id, reference, subject, status, budget_label, offer_title, source, assigned_to, created_at, leads ( full_name, email ), services ( title )')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[relation] Lecture des demandes impossible : ${error.message}`);
    return [];
  }

  return (data ?? []) as unknown as QuoteRequestListEntry[];
}

export type AppointmentListEntry = Pick<
  AppointmentRow,
  | 'id'
  | 'reference'
  | 'subject'
  | 'status'
  | 'channel'
  | 'channel_label'
  | 'requested_date'
  | 'requested_slot'
  | 'scheduled_at'
  | 'scheduled_end'
  | 'assigned_to'
  | 'created_at'
> & {
  leads: Pick<LeadRow, 'full_name' | 'email'> | null;
  services: { title: string } | null;
};

/**
 * Rendez-vous.
 *
 * L'ordre place les demandes en attente avant le reste : c'est ce qui réclame
 * une décision, et le § 174 du tableau de bord demande de hiérarchiser par
 * ce que l'on regarde tous les jours. À l'intérieur, le plus ancien d'abord —
 * une demande de rendez-vous qui attend depuis trois jours passe avant celle
 * d'hier.
 */
export async function listAppointments(limit = 100): Promise<AppointmentListEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('appointments')
    // prettier-ignore
    .select('id, reference, subject, status, channel, channel_label, requested_date, requested_slot, scheduled_at, scheduled_end, assigned_to, created_at, leads ( full_name, email ), services ( title )')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[relation] Lecture des rendez-vous impossible : ${error.message}`);
    return [];
  }

  const rows = (data ?? []) as unknown as AppointmentListEntry[];

  const rank: Record<AppointmentStatus, number> = {
    EN_ATTENTE: 0,
    CONFIRME: 1,
    TERMINE: 2,
    ANNULE: 3,
  };

  return rows.sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus !== 0) return byStatus;
    return a.created_at.localeCompare(b.created_at);
  });
}

/* ------------------------------------------------------------------ fiche --- */

export type QuoteRequestDetail = {
  request: QuoteRequestRow;
  lead: Pick<LeadRow, 'id' | 'full_name' | 'email' | 'phone' | 'request_count'> | null;
  serviceTitle: string | null;
  quotes: QuoteRow[];
  events: QuoteRequestEventRow[];
  notes: RelationNoteRow[];
};

/**
 * Fiche d'une demande, par sa référence.
 *
 * La référence est la clé d'entrée plutôt que l'identifiant interne : c'est
 * elle que MORA Shawiri lit dans le journal et cite au téléphone. L'UUID reste
 * l'identifiant technique, comme le § 6 de la gestion des commandes le veut.
 */
export async function findQuoteRequest(reference: string): Promise<QuoteRequestDetail | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data: request, error } = await supabase
    .from('quote_requests')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();

  if (error) {
    console.error(`[relation] Lecture de la demande impossible : ${error.message}`);
    return null;
  }
  if (!request) return null;

  const [leadResult, serviceResult, quotesResult, eventsResult, notesResult] = await Promise.all([
    supabase
      .from('leads')
      .select('id, full_name, email, phone, request_count')
      .eq('id', request.lead_id)
      .maybeSingle(),
    request.service_id
      ? supabase.from('services').select('title').eq('id', request.service_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('quotes')
      .select('*')
      .eq('quote_request_id', request.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('quote_request_events')
      .select('*')
      .eq('quote_request_id', request.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('relation_notes')
      .select('*')
      .eq('quote_request_id', request.id)
      .order('created_at', { ascending: false }),
  ]);

  return {
    request,
    lead: leadResult.data ?? null,
    serviceTitle: serviceResult.data?.title ?? null,
    quotes: quotesResult.data ?? [],
    events: eventsResult.data ?? [],
    notes: notesResult.data ?? [],
  };
}

export type AppointmentDetail = {
  appointment: AppointmentRow;
  lead: Pick<LeadRow, 'id' | 'full_name' | 'email' | 'phone' | 'request_count'> | null;
  serviceTitle: string | null;
  requestReference: string | null;
  events: AppointmentEventRow[];
  notes: RelationNoteRow[];
};

/** Fiche d'un rendez-vous, par son identifiant interne. */
export async function findAppointment(id: string): Promise<AppointmentDetail | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`[relation] Lecture du rendez-vous impossible : ${error.message}`);
    return null;
  }
  if (!appointment) return null;

  const [leadResult, serviceResult, requestResult, eventsResult, notesResult] = await Promise.all([
    supabase
      .from('leads')
      .select('id, full_name, email, phone, request_count')
      .eq('id', appointment.lead_id)
      .maybeSingle(),
    appointment.service_id
      ? supabase.from('services').select('title').eq('id', appointment.service_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    appointment.quote_request_id
      ? supabase
          .from('quote_requests')
          .select('reference')
          .eq('id', appointment.quote_request_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('appointment_events')
      .select('*')
      .eq('appointment_id', appointment.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('relation_notes')
      .select('*')
      .eq('appointment_id', appointment.id)
      .order('created_at', { ascending: false }),
  ]);

  return {
    appointment,
    lead: leadResult.data ?? null,
    serviceTitle: serviceResult.data?.title ?? null,
    requestReference: requestResult.data?.reference ?? null,
    events: eventsResult.data ?? [],
    notes: notesResult.data ?? [],
  };
}

/* --------------------------------------------------------- disponibilités --- */

/**
 * Disponibilités déclarées.
 *
 * La table est vide jusqu'à ce que MORA Shawiri y saisisse ses horaires. Cette
 * fonction existe pour que l'écran dise « aucune disponibilité déclarée » en le
 * sachant, et non en le supposant — la même raison que `listProducts()` en
 * phase 4E-1.
 */
export async function listAvailabilities(): Promise<AppointmentAvailabilityRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('appointment_availabilities')
    .select('*')
    .order('kind', { ascending: true })
    .order('weekday', { ascending: true, nullsFirst: false })
    .order('on_date', { ascending: true, nullsFirst: false });

  if (error) {
    console.error(`[relation] Lecture des disponibilités impossible : ${error.message}`);
    return [];
  }

  return data ?? [];
}

/* -------------------------------------------------------------- comptages --- */

/** Compte par statut, sur les lignes réellement lues. Aucun chiffre fabriqué. */
export function countQuoteRequestsByStatus(entries: readonly { status: QuoteRequestStatus }[]) {
  const counts = Object.fromEntries(
    (Object.keys(QUOTE_REQUEST_STATUS_LABELS) as QuoteRequestStatus[]).map((key) => [key, 0]),
  ) as Record<QuoteRequestStatus, number>;

  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

export function countAppointmentsByStatus(entries: readonly { status: AppointmentStatus }[]) {
  const counts = Object.fromEntries(
    (Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map((key) => [key, 0]),
  ) as Record<AppointmentStatus, number>;

  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

