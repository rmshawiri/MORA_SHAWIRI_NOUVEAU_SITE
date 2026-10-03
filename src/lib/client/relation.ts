import 'server-only';

/**
 * Espace client — demandes, devis, rendez-vous (phase 4I-3).
 *
 * Mêmes tables que la phase 4F, aucune règle nouvelle côté lecture. Règle de
 * l'espace client : **tout est filtré sur le compte connecté**
 * (`user_id = session`), en plus de la RLS. Les droits d'administration
 * éventuels du compte (`quotes.view`, `appointments.view`…) n'élargissent
 * jamais ce périmètre.
 *
 * Ce qui ne sort jamais d'ici : l'agent affecté (`assigned_to`), la source
 * technique, les notes internes (`relation_notes`, jamais lues), les
 * historiques bruts (le client lit sa chronologie par `my_request_timeline`
 * et `my_appointment_timeline`, qui ne rendent que les événements qui le
 * concernent), et tout devis qui n'a pas été réellement envoyé — brouillon,
 * ou brouillon abandonné (annulé sans référence).
 */

import type { AppointmentStatus, QuoteRequestStatus, QuoteStatus } from '@/lib/supabase/types';
import type { AppointmentTimelineEntry, ClaimableItem, RequestTimelineEntry } from '@/lib/supabase/types-client';

import type { Ready } from './space';

export type MyRequest = {
  id: string;
  reference: string;
  subject: string;
  offer_title: string | null;
  budget_label: string | null;
  organisation: string | null;
  message: string;
  status: QuoteRequestStatus;
  created_at: string;
  closed_at: string | null;
};

export type MyQuote = {
  id: string;
  quote_request_id: string;
  reference: string;
  amount: number | string;
  currency: string;
  summary: string;
  status: QuoteStatus;
  valid_until: string | null;
  sent_at: string | null;
  responded_at: string | null;
  responded_by: string | null;
  client_response_reason: string | null;
  service_id: string | null;
  /** Remarques 01 : observations imprimées sur le devis. */
  notes: string | null;
  document_id: string | null;
};

/** Remarques 01 : une ligne du devis, telle que le client la lit. */
export type MyQuoteLine = {
  id: string;
  designation: string;
  description: string | null;
  quantity: number | string;
  unit_price: number | string;
  discount_amount: number | string;
  line_total: number | string;
};

export type MyAppointment = {
  id: string;
  reference: string | null;
  subject: string;
  channel: string;
  channel_label: string | null;
  requested_date: string | null;
  requested_slot: string | null;
  scheduled_at: string | null;
  scheduled_end: string | null;
  message: string | null;
  status: AppointmentStatus;
  cancel_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  confirmed_at: string | null;
  created_at: string;
};

const REQUEST_COLUMNS = 'id, reference, subject, offer_title, budget_label, organisation, message, status, created_at, closed_at';
const QUOTE_COLUMNS =
  'id, quote_request_id, reference, amount, currency, summary, status, valid_until, sent_at, responded_at, responded_by, client_response_reason, service_id, notes, document_id';
const APPOINTMENT_COLUMNS =
  'id, reference, subject, channel, channel_label, requested_date, requested_slot, scheduled_at, scheduled_end, message, status, cancel_reason, cancelled_by, cancelled_at, confirmed_at, created_at';

export { awaitsDecision, canCancel, isUpcoming, OPEN_REQUEST_STATUSES, todayInComoros } from './relation-rules';

export async function myRequests(space: Ready): Promise<{ requests: MyRequest[]; failed: boolean }> {
  const { data, error } = await space.supabase
    .from('quote_requests')
    .select(REQUEST_COLUMNS)
    .eq('user_id', space.context.userId)
    .order('created_at', { ascending: false })
    .limit(200);
  return { requests: (data ?? []) as MyRequest[], failed: Boolean(error) };
}

/** Devis réellement envoyés au compte connecté, toutes demandes confondues. */
export async function myQuotes(space: Ready): Promise<{ quotes: MyQuote[]; requests: MyRequest[]; failed: boolean }> {
  const { requests, failed } = await myRequests(space);
  if (requests.length === 0) return { quotes: [], requests, failed };
  const { data, error } = await space.supabase
    .from('quotes')
    .select(QUOTE_COLUMNS)
    .in('quote_request_id', requests.map((request) => request.id))
    .neq('status', 'BROUILLON')
    .not('reference', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(200);
  return { quotes: (data ?? []) as MyQuote[], requests, failed: failed || Boolean(error) };
}

export async function myRequest(space: Ready, reference: string) {
  const { data: request } = await space.supabase
    .from('quote_requests')
    .select(REQUEST_COLUMNS)
    .eq('reference', reference)
    .eq('user_id', space.context.userId)
    .maybeSingle();
  if (!request) return null;
  const row = request as MyRequest;
  const [quotes, timeline] = await Promise.all([
    space.supabase
      .from('quotes')
      .select(QUOTE_COLUMNS)
      .eq('quote_request_id', row.id)
      .neq('status', 'BROUILLON')
      .not('reference', 'is', null)
      .order('sent_at', { ascending: false }),
    space.supabase.rpc('my_request_timeline', { p_request_id: row.id }),
  ]);
  return {
    request: row,
    quotes: (quotes.data ?? []) as MyQuote[],
    timeline: (timeline.data ?? []) as RequestTimelineEntry[],
  };
}

export async function myQuote(space: Ready, reference: string) {
  const { data: quote } = await space.supabase
    .from('quotes')
    .select(QUOTE_COLUMNS)
    .eq('reference', reference)
    .neq('status', 'BROUILLON')
    .maybeSingle();
  if (!quote) return null;
  const row = quote as MyQuote;
  // Propriété : la demande du devis doit être celle du compte connecté.
  const { data: request } = await space.supabase
    .from('quote_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', row.quote_request_id)
    .eq('user_id', space.context.userId)
    .maybeSingle();
  if (!request) return null;
  const [{ data: service }, { data: lines }, { data: document }] = await Promise.all([
    row.service_id
      ? space.supabase.from('services').select('title').eq('id', row.service_id).maybeSingle()
      : Promise.resolve({ data: null }),
    space.supabase
      .from('quote_items')
      .select('id, designation, description, quantity, unit_price, discount_amount, line_total')
      .eq('quote_id', row.id)
      .order('position', { ascending: true }),
    // La pièce DVCL, si le compte en est le titulaire (RLS + filtre explicite).
    row.document_id
      ? space.supabase
          .from('documents')
          .select('status')
          .eq('id', row.document_id)
          .eq('owner_id', space.context.userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    quote: row,
    request: request as MyRequest,
    serviceTitle: (service as { title?: string } | null)?.title ?? null,
    lines: (lines ?? []) as MyQuoteLine[],
    documentStatus: ((document as { status?: string } | null)?.status ?? null) as 'EMIS' | 'REMPLACE' | 'ANNULE' | null,
  };
}

export async function myAppointments(space: Ready): Promise<{ appointments: MyAppointment[]; failed: boolean }> {
  const { data, error } = await space.supabase
    .from('appointments')
    .select(APPOINTMENT_COLUMNS)
    .eq('user_id', space.context.userId)
    .order('created_at', { ascending: false })
    .limit(200);
  return { appointments: (data ?? []) as MyAppointment[], failed: Boolean(error) };
}

export async function myAppointment(space: Ready, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data } = await space.supabase
    .from('appointments')
    .select(APPOINTMENT_COLUMNS)
    .eq('id', id)
    .eq('user_id', space.context.userId)
    .maybeSingle();
  if (!data) return null;
  const { data: timeline } = await space.supabase.rpc('my_appointment_timeline', { p_appointment_id: id });
  return { appointment: data as MyAppointment, timeline: (timeline ?? []) as AppointmentTimelineEntry[] };
}

/** Demandes et rendez-vous déposés hors connexion avec l'adresse confirmée du compte. */
export async function myClaimable(space: Ready): Promise<ClaimableItem[]> {
  const { data } = await space.supabase.rpc('my_claimable_requests');
  return (data ?? []) as ClaimableItem[];
}
