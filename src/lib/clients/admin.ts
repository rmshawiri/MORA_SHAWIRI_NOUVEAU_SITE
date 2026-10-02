import 'server-only';

/**
 * Administration Clients — lectures (phase 4I-4).
 *
 * Toutes les lectures passent par le client de **session** : la RLS
 * administrative décide, et chaque bloc de la fiche n'est lu que sous la
 * permission métier qui le gouverne (commandes sous `orders.view`, demandes
 * sous `quotes.view`, rendez-vous sous `appointments.view`, affilié d'origine
 * sous la consultation de l'affiliation). L'identité (adresse e-mail, rôles)
 * vient de `admin_client_identity`, sous `users.view`.
 *
 * Statistiques : les vérités de 4G, jamais recalculées depuis un statut —
 * `paid_amount` est la somme des seuls paiements vérifiés, `refunded_amount`
 * celle des remboursements effectués ; une commande annulée ne compte pas
 * dans le montant commandé.
 */

import type { AdminContext } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { OrderSettlementStatus, OrderStatus, QuoteRequestStatus, QuoteStatus, AppointmentStatus } from '@/lib/supabase/types';
import type {
  AdminClientListRow,
  ClientNoteRow,
  ClientRow,
  ClientStatusEventRow,
  HistoricalClaimRow,
} from '@/lib/supabase/types-client';

export const CLIENT_PAGE_SIZE = 25;

export const CLIENT_SORTS = { recent: 'Plus récents', ancien: 'Plus anciens', nom: 'Nom', reference: 'Référence' } as const;
export type ClientSort = keyof typeof CLIENT_SORTS;

export const CLIENT_STATES = { ACTIF: 'Actifs', BLOQUE: 'Bloqués', SUSPENDU: 'Compte suspendu' } as const;
export type ClientStateFilter = keyof typeof CLIENT_STATES;

export type ClientListQuery = {
  search: string;
  state: ClientStateFilter | '';
  preference: 'WHATSAPP' | 'TELEPHONE' | 'EMAIL' | '';
  sort: ClientSort;
  page: number;
};

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Lit les paramètres de l'adresse, en liste fermée. */
export function readListQuery(query: Record<string, string | string[] | undefined>): ClientListQuery {
  const raw = (name: string) => (typeof query[name] === 'string' ? (query[name] as string) : '');
  const page = Number.parseInt(raw('page'), 10);
  return {
    search: raw('q').trim().slice(0, 120),
    state: pick(raw('etat'), ['', 'ACTIF', 'BLOQUE', 'SUSPENDU'] as const, ''),
    preference: pick(raw('preference'), ['', 'WHATSAPP', 'TELEPHONE', 'EMAIL'] as const, ''),
    sort: pick(raw('tri'), Object.keys(CLIENT_SORTS) as ClientSort[], 'recent'),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10000) : 1,
  };
}

export async function listClients(query: ClientListQuery): Promise<{ rows: AdminClientListRow[]; total: number; failed: boolean }> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return { rows: [], total: 0, failed: true };
  const { data, error } = await supabase.rpc('admin_list_clients', {
    p_search: query.search || null,
    p_state: query.state || null,
    p_preference: query.preference || null,
    p_sort: query.sort,
    p_limit: CLIENT_PAGE_SIZE,
    p_offset: (query.page - 1) * CLIENT_PAGE_SIZE,
  });
  const rows = (data ?? []) as AdminClientListRow[];
  return { rows, total: rows.length > 0 ? Number(rows[0]!.total_count) : 0, failed: Boolean(error) };
}

export type ClientOrder = {
  id: string;
  reference: string;
  status: OrderStatus;
  settlement_status: OrderSettlementStatus;
  total_amount: number | string;
  paid_amount: number | string;
  refunded_amount: number | string;
  currency: string;
  created_at: string;
};

export type ClientRequest = { id: string; reference: string; subject: string; offer_title: string | null; status: QuoteRequestStatus; created_at: string };
export type ClientQuote = {
  id: string;
  reference: string | null;
  quote_request_id: string;
  amount: number | string;
  currency: string;
  status: QuoteStatus;
  sent_at: string | null;
  responded_at: string | null;
  responded_by: string | null;
  client_response_reason: string | null;
};
export type ClientAppointment = {
  id: string;
  reference: string | null;
  subject: string;
  status: AppointmentStatus;
  scheduled_at: string | null;
  requested_date: string | null;
  cancelled_by: string | null;
  created_at: string;
};
export type AffiliateOrigin = { affiliateId: string; name: string; reference: string | null; source: string; at: string; on: string };

export type ClientStats = {
  orders: number;
  ordered: number;
  paid: number;
  refunded: number;
  requests: number;
  quotesAccepted: number;
  appointments: number;
};

export type ClientDetail = {
  client: ClientRow;
  profile: { full_name: string | null; phone: string | null; status: string; last_login_at: string | null; created_at: string };
  identity: { email: string; email_confirmed: boolean; roles: string[]; last_sign_in_at: string | null } | null;
  orders: ClientOrder[] | null;
  requests: ClientRequest[] | null;
  quotes: ClientQuote[] | null;
  appointments: ClientAppointment[] | null;
  notes: ClientNoteRow[];
  statusEvents: ClientStatusEventRow[];
  historical: HistoricalClaimRow[] | null;
  origin: AffiliateOrigin | null | 'interdit';
  stats: ClientStats;
  lastActivity: string | null;
};

const amount = (value: number | string | null | undefined) => Number(value ?? 0) || 0;

/** La fiche d'un client, par sa référence MORA-CLI. `null` : introuvable ou hors droits. */
export async function clientDetail(context: AdminContext, reference: string): Promise<ClientDetail | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data: client } = await supabase.from('clients').select('*').eq('reference', reference).maybeSingle();
  if (!client) return null;
  const row = client as ClientRow;
  const uid = row.user_id;

  const canOrders = context.can('orders.view');
  const canQuotes = context.can('quotes.view');
  const canAppointments = context.can('appointments.view');
  const canAffiliation = context.can('affiliates.view');

  const [profile, identity, orders, requests, appointments, notes, events, historical] = await Promise.all([
    supabase.from('profiles').select('full_name, phone, status, last_login_at, created_at').eq('id', uid).maybeSingle(),
    supabase.rpc('admin_client_identity', { p_user_id: uid }),
    canOrders
      ? supabase
          .from('orders')
          .select('id, reference, status, settlement_status, total_amount, paid_amount, refunded_amount, currency, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(200)
      : Promise.resolve({ data: null }),
    canQuotes
      ? supabase.from('quote_requests').select('id, reference, subject, offer_title, status, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: null }),
    canAppointments
      ? supabase
          .from('appointments')
          .select('id, reference, subject, status, scheduled_at, requested_date, cancelled_by, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(200)
      : Promise.resolve({ data: null }),
    supabase.from('client_notes').select('*').eq('client_user_id', uid).order('created_at', { ascending: false }).limit(200),
    supabase.from('client_status_events').select('*').eq('client_user_id', uid).order('created_at', { ascending: false }).limit(100),
    canQuotes || canAppointments ? supabase.rpc('historical_claimable_requests') : Promise.resolve({ data: null }),
  ]);

  const requestRows = (requests.data ?? null) as ClientRequest[] | null;
  const { data: quoteData } =
    requestRows && requestRows.length > 0
      ? await supabase
          .from('quotes')
          .select('id, reference, quote_request_id, amount, currency, status, sent_at, responded_at, responded_by, client_response_reason')
          .in('quote_request_id', requestRows.map((r) => r.id))
          .order('created_at', { ascending: false })
      : { data: requestRows ? [] : null };

  const orderRows = (orders.data ?? null) as ClientOrder[] | null;
  const appointmentRows = (appointments.data ?? null) as ClientAppointment[] | null;
  const quoteRows = (quoteData ?? null) as ClientQuote[] | null;

  // Affilié d'origine : la première attribution réellement enregistrée par 4H
  // sur une commande ou une demande de ce client. Rien n'est déduit.
  let origin: AffiliateOrigin | null | 'interdit' = canAffiliation ? null : 'interdit';
  if (canAffiliation) {
    const orderIds = (orderRows ?? []).map((o) => o.id);
    const requestIds = (requestRows ?? []).map((r) => r.id);
    const filters = [
      orderIds.length > 0 ? `order_id.in.(${orderIds.join(',')})` : null,
      requestIds.length > 0 ? `quote_request_id.in.(${requestIds.join(',')})` : null,
    ].filter(Boolean);
    if (filters.length > 0) {
      const { data: attribution } = await supabase
        .from('affiliate_attributions')
        .select('affiliate_id, source, created_at, order_id, quote_request_id, status')
        .or(filters.join(','))
        .in('status', ['ACTIVE', 'VALIDEE'])
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (attribution) {
        const { data: affiliate } = await supabase.from('affiliates').select('id, display_name, reference').eq('id', attribution.affiliate_id).maybeSingle();
        const on = attribution.order_id
          ? (orderRows ?? []).find((o) => o.id === attribution.order_id)?.reference
          : (requestRows ?? []).find((r) => r.id === attribution.quote_request_id)?.reference;
        origin = {
          affiliateId: attribution.affiliate_id,
          name: (affiliate as { display_name?: string } | null)?.display_name ?? 'Affilié',
          reference: (affiliate as { reference?: string | null } | null)?.reference ?? null,
          source: attribution.source,
          at: attribution.created_at,
          on: on ?? '—',
        };
      }
    }
  }

  const live = (orderRows ?? []).filter((o) => o.status !== 'ANNULEE');
  const stats: ClientStats = {
    orders: (orderRows ?? []).length,
    ordered: live.reduce((sum, o) => sum + amount(o.total_amount), 0),
    paid: (orderRows ?? []).reduce((sum, o) => sum + amount(o.paid_amount), 0),
    refunded: (orderRows ?? []).reduce((sum, o) => sum + amount(o.refunded_amount), 0),
    requests: (requestRows ?? []).length,
    quotesAccepted: (quoteRows ?? []).filter((q) => q.status === 'ACCEPTE').length,
    appointments: (appointmentRows ?? []).length,
  };
  const dates = [
    ...(orderRows ?? []).map((o) => o.created_at),
    ...(requestRows ?? []).map((r) => r.created_at),
    ...(appointmentRows ?? []).map((a) => a.created_at),
    (profile.data as { last_login_at?: string | null } | null)?.last_login_at ?? null,
  ].filter((value): value is string => Boolean(value));

  return {
    client: row,
    profile: profile.data as ClientDetail['profile'],
    identity: ((identity.data ?? []) as ClientDetail['identity'][])[0] ?? null,
    orders: orderRows,
    requests: requestRows,
    quotes: quoteRows,
    appointments: appointmentRows,
    notes: (notes.data ?? []) as ClientNoteRow[],
    statusEvents: (events.data ?? []) as ClientStatusEventRow[],
    historical: historical.data ? ((historical.data as HistoricalClaimRow[]).filter((item) => item.client_user_id === uid)) : null,
    origin,
    stats,
    lastActivity: dates.sort().at(-1) ?? null,
  };
}
