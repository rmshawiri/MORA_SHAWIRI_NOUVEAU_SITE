import 'server-only';

/**
 * Espace client — lectures communes (phase 4I).
 *
 * Même règle que l'espace affilié : tout passe par le client de **session**,
 * la RLS décide de ce que la session lit, aucune page n'emploie la clé à
 * privilèges, aucun identifiant ne vient de l'adresse.
 *
 * Une précaution de plus : chaque lecture filtre **explicitement** sur le
 * compte connecté. La RLS laisse un administrateur détenteur de
 * `orders.view` ou `quotes.view` lire les lignes de tous les clients ; son
 * espace client ne doit montrer que les siennes (§ 144 : un administrateur
 * n'est pas un client quand il administre, et inversement).
 */

import { cache } from 'react';

import { requirePrivateAccess } from '@/lib/auth/guards';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import type { AuthContext } from '@/lib/auth/session';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { AppointmentStatus, OrderSettlementStatus, OrderStatus, QuoteRequestStatus } from '@/lib/supabase/types';
import type { ClientRow } from '@/lib/supabase/types-client';

import { isUpcoming, OPEN_REQUEST_STATUSES } from './relation-rules';

type Client = NonNullable<Awaited<ReturnType<typeof getServerSupabaseClient>>>;

export type MyClientSpace =
  | { state: 'ready'; context: AuthContext; supabase: Client; client: ClientRow; isAffiliate: boolean }
  /** Compte connecté sans espace client : administrateur ou affilié seul. */
  | { state: 'none'; context: AuthContext; isAffiliate: boolean }
  /** La base n'a pas pu répondre : l'écran le dit, sans rien inventer. */
  | { state: 'unavailable'; context: AuthContext; isAffiliate: boolean };

/** La fiche client du compte connecté, une fois par requête. */
export const getMyClientSpace = cache(async (): Promise<MyClientSpace> => {
  // Session, compte actif, non supprimé : un compte suspendu n'arrive pas ici,
  // même avec une session encore valide — `getAuthContext` relit le statut à
  // chaque requête et le renvoie à la connexion.
  const context = await requirePrivateAccess(AUTH_ROUTES.clientArea);
  const isAffiliate = context.roles.includes('AFFILIE');

  if (!context.roles.includes('CLIENT')) return { state: 'none', context, isAffiliate };

  const supabase = await getServerSupabaseClient();
  if (!supabase) return { state: 'unavailable', context, isAffiliate };

  const read = () => supabase.from('clients').select('*').eq('user_id', context.userId).maybeSingle();

  let { data, error } = await read();
  if (error) return { state: 'unavailable', context, isAffiliate };

  if (!data) {
    // Le déclencheur d'attribution n'a pas abouti (il ne bloque jamais une
    // inscription) : la base la crée maintenant si les conditions sont
    // réunies. Même règle, même allocateur, identité par la session.
    const ensured = await supabase.rpc('ensure_my_client_reference');
    if (ensured.error) return { state: 'unavailable', context, isAffiliate };
    ({ data, error } = await read());
    if (error || !data) return { state: 'unavailable', context, isAffiliate };
  }

  return { state: 'ready', context, supabase, client: data as ClientRow, isAffiliate };
});

export type Ready = Extract<MyClientSpace, { state: 'ready' }>;

export type DashboardOrder = {
  id: string;
  reference: string;
  status: OrderStatus;
  settlement_status: OrderSettlementStatus;
  total_amount: number | string;
  currency: string;
  created_at: string;
};

export type DashboardRequest = {
  id: string;
  reference: string;
  subject: string;
  offer_title: string | null;
  status: QuoteRequestStatus;
  created_at: string;
};

export type DashboardAppointment = {
  id: string;
  reference: string | null;
  subject: string;
  channel: string;
  channel_label: string | null;
  status: AppointmentStatus;
  requested_date: string | null;
  requested_slot: string | null;
  scheduled_at: string | null;
  created_at: string;
};

export type Dashboard = {
  orders: DashboardOrder[];
  ordersOpen: number;
  requests: DashboardRequest[];
  requestsOpen: number;
  appointments: DashboardAppointment[];
  appointmentsUpcoming: number;
  failed: boolean;
};

const OPEN_ORDER: readonly OrderStatus[] = ['NOUVELLE', 'CONFIRMEE', 'EN_TRAITEMENT', 'EN_ATTENTE_INFO', 'PRETE'];

/**
 * Le tableau de bord : des comptages et des listes courtes, tirés des seules
 * lignes réellement enregistrées pour ce compte.
 */
export async function myDashboard(space: Ready): Promise<Dashboard> {
  const uid = space.context.userId;
  const now = new Date().toISOString();

  const [orders, requests, appointments] = await Promise.all([
    space.supabase
      .from('orders')
      .select('id, reference, status, settlement_status, total_amount, currency, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(50),
    space.supabase
      .from('quote_requests')
      .select('id, reference, subject, offer_title, status, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(50),
    space.supabase
      .from('appointments')
      .select('id, reference, subject, channel, channel_label, status, requested_date, requested_slot, scheduled_at, created_at')
      .eq('user_id', uid)
      .in('status', ['EN_ATTENTE', 'CONFIRME'])
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const orderRows = (orders.data ?? []) as DashboardOrder[];
  const requestRows = (requests.data ?? []) as DashboardRequest[];
  // Un rendez-vous confirmé déjà passé n'est plus « à venir » ; une demande
  // de rendez-vous en attente, si.
  // Même règle que la rubrique « Mes rendez-vous » (`isUpcoming`).
  const appointmentRows = ((appointments.data ?? []) as DashboardAppointment[])
    .filter((row) => isUpcoming(row, now))
    .sort((a, b) => (a.scheduled_at ?? '9999').localeCompare(b.scheduled_at ?? '9999'));

  return {
    orders: orderRows.slice(0, 5),
    ordersOpen: orderRows.filter((row) => OPEN_ORDER.includes(row.status)).length,
    requests: requestRows.filter((row) => OPEN_REQUEST_STATUSES.includes(row.status)).slice(0, 5),
    requestsOpen: requestRows.filter((row) => OPEN_REQUEST_STATUSES.includes(row.status)).length,
    appointments: appointmentRows.slice(0, 5),
    appointmentsUpcoming: appointmentRows.length,
    failed: Boolean(orders.error || requests.error || appointments.error),
  };
}
