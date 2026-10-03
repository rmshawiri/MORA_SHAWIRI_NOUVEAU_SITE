/**
 * Typage des tables et fonctions des notifications — phase 4J-1.
 *
 * Même règle que `types-client.ts` : écrit à la main, aligné sur
 * `supabase/migrations/20261003200000_notifications_socle.sql`, intégré au
 * schéma `Database` par `types.ts`.
 *
 * Seules figurent les fonctions qu'une session peut appeler. La création et
 * la résolution (`notifications_create`, `notifications_create_for_admins`,
 * `notifications_resolve`) sont réservées au serveur et aux déclencheurs :
 * elles ne sont volontairement pas typées ici, pour qu'aucun code
 * d'interface ne soit tenté de les appeler.
 */

import type { NotificationAudience, NotificationEntityType, NotificationLevel } from '@/lib/notifications/catalogue';

export type NotificationRow = {
  id: string;
  recipient_id: string;
  audience: NotificationAudience;
  type_code: string;
  level: NotificationLevel;
  required_permission: string | null;
  entity_type: NotificationEntityType;
  entity_id: string;
  params: Record<string, unknown>;
  source_table: string;
  source_id: string;
  created_at: string;
  read_at: string | null;
  resolved_at: string | null;
};

export type NotificationTypeRow = {
  code: string;
  audience: NotificationAudience;
  level: NotificationLevel;
  entity_type: NotificationEntityType;
  required_permission: string | null;
  label: string;
  active: boolean;
  created_at: string;
};

type T<Row, Insert = never, Update = never> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type NotificationTables = {
  // Aucune écriture directe pour une session : lecture sous RLS seulement.
  notifications: T<NotificationRow>;
  notification_types: T<NotificationTypeRow>;
};

export type NotificationFunctions = {
  my_notification_counts: {
    Args: { p_audience: NotificationAudience };
    Returns: { unread: number; pending: number }[];
  };
  mark_notification_read: { Args: { p_id: string }; Returns: boolean };
  mark_all_notifications_read: { Args: { p_audience: NotificationAudience }; Returns: number };
};
