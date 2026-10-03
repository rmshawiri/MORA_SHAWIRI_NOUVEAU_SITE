/**
 * Présentation d'une notification — phase 4J-1.
 *
 * Transformation pure d'une ligne lue en base (sous RLS) en ce qu'un écran
 * affichera. Aucun texte n'est lu en base : la phrase vient du catalogue, la
 * cible est calculée par `targets.ts`. Une ligne dont le type est inconnu du
 * code, ou dont l'espace ne correspond pas au catalogue, n'est pas affichée.
 */

import type { NotificationRow } from '@/lib/supabase/types-notifications';

import { NOTIFICATION_LEVEL_LABELS, notificationType, type NotificationLevel } from './catalogue';
import { readNotificationParams } from './params';
import { notificationTarget } from './targets';

/** Ce qu'un écran affichera : une phrase, un niveau, deux états, un lien sûr. */
export type NotificationView = {
  id: string;
  typeCode: string;
  level: NotificationLevel;
  levelLabel: string;
  title: string;
  actionLabel: string | null;
  /** Chemin interne calculé, ou `null` si aucune cible sûre n'existe. */
  href: string | null;
  createdAt: string;
  read: boolean;
  /** « Traitée » : l'action métier attendue a eu lieu (N6). Indépendant de `read`. */
  resolved: boolean;
};

export type NotificationCounts = { unread: number; pending: number };

export function toNotificationView(row: NotificationRow): NotificationView | null {
  const spec = notificationType(row.type_code);
  if (!spec || spec.audience !== row.audience) return null;
  const params = readNotificationParams(row.params);
  return {
    id: row.id,
    typeCode: row.type_code,
    level: row.level,
    levelLabel: NOTIFICATION_LEVEL_LABELS[row.level],
    title: spec.title(params.reference ?? null),
    actionLabel: spec.action,
    href: notificationTarget({
      audience: row.audience,
      typeCode: row.type_code,
      entityType: row.entity_type,
      entityId: row.entity_id,
      params,
    }),
    createdAt: row.created_at,
    read: row.read_at !== null,
    resolved: row.resolved_at !== null,
  };
}

