import 'server-only';

/**
 * Couche serveur des notifications — phase 4J-1.
 *
 * L'API dont les écrans de 4J-3 (administration), 4J-4 (client) et 4J-5
 * (affilié) se serviront. Aucun écran ne l'appelle encore.
 *
 * ## Toujours la session de l'utilisateur
 *
 * Chaque fonction passe par `getServerSupabaseClient()`, donc par la session
 * du navigateur : la RLS décide de tout — destinataire, espace réellement
 * ouvert, permission d'administration revérifiée à chaque lecture. La clé de
 * service n'est jamais utilisée ici : elle ne sert qu'à la création, qui
 * n'appartient pas à ce module.
 *
 * ## Rien d'automatique
 *
 * Ces fonctions répondent quand on les appelle — au rendu d'un gabarit, après
 * une action, sur un bouton « Actualiser ». Aucune minuterie, aucun
 * abonnement temps réel, aucun rechargement (prompt maître § 45 ; arbitrage
 * N11). Un test le vérifie.
 */

import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { NotificationRow } from '@/lib/supabase/types-notifications';

import { isNotificationAudience, type NotificationAudience } from './catalogue';
import { toNotificationView, type NotificationCounts, type NotificationView } from './view';

export type { NotificationCounts, NotificationView } from './view';

export const NOTIFICATIONS_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS =
  'id, recipient_id, audience, type_code, level, required_permission, entity_type, entity_id, params, source_table, source_id, created_at, read_at, resolved_at';

/**
 * Les notifications d'un espace, les plus récentes d'abord, page par page.
 * `null` si la base ne répond pas : l'écran le dira sans rien inventer.
 */
export async function listMyNotifications(
  audience: NotificationAudience,
  options: { unreadOnly?: boolean; page?: number; pageSize?: number } = {},
): Promise<{ items: NotificationView[]; hasMore: boolean } | null> {
  if (!isNotificationAudience(audience)) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const pageSize = Math.min(Math.max(1, Math.trunc(options.pageSize ?? NOTIFICATIONS_PAGE_SIZE)), MAX_PAGE_SIZE);
  const page = Math.max(0, Math.trunc(options.page ?? 0));
  const from = page * pageSize;

  let query = supabase
    .from('notifications')
    .select(COLUMNS)
    .eq('audience', audience)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize); // un de plus : savoir s'il reste une page
  if (options.unreadOnly) query = query.is('read_at', null);

  const { data, error } = await query;
  if (error || !data) return null;
  const rows = data as NotificationRow[];
  return {
    items: rows
      .slice(0, pageSize)
      .map(toNotificationView)
      .filter((view): view is NotificationView => view !== null),
    hasMore: rows.length > pageSize,
  };
}

/** Non lues et « à traiter » ouvertes d'un espace. `null` si indisponible. */
export async function getMyNotificationCounts(audience: NotificationAudience): Promise<NotificationCounts | null> {
  if (!isNotificationAudience(audience)) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('my_notification_counts', { p_audience: audience });
  const counts = !error && Array.isArray(data) ? data[0] : undefined;
  if (!counts) return null;
  return { unread: Number(counts.unread) || 0, pending: Number(counts.pending) || 0 };
}

/**
 * Marque une notification comme lue. Vrai si elle vient de l'être ; faux si
 * elle n'existe pas, n'appartient pas à la session ou était déjà lue — sans
 * distinction, pour ne rien révéler.
 */
export async function markMyNotificationRead(id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('mark_notification_read', { p_id: id });
  return !error && data === true;
}

/** Tout marquer comme lu dans un espace. Renvoie le nombre marqué, `null` si indisponible. */
export async function markAllMyNotificationsRead(audience: NotificationAudience): Promise<number | null> {
  if (!isNotificationAudience(audience)) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('mark_all_notifications_read', { p_audience: audience });
  return error ? null : Number(data) || 0;
}
