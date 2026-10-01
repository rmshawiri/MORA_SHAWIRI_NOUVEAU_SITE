/**
 * Catalogue des permissions et des rôles — miroir applicatif du schéma.
 *
 * La source de vérité reste la base (`supabase/migrations/…_seed_roles_et_permissions.sql`) :
 * c'est elle que lisent les politiques RLS. Ce fichier existe pour que le code
 * TypeScript manipule des chaînes typées plutôt que des littéraux libres, et
 * qu'une faute de frappe dans `requirePermission('orders.viwe')` soit une
 * erreur de compilation.
 *
 * Les deux listes ne peuvent pas diverger sans être détectées :
 * `tests/unit/rbac-catalogue.test.ts` relit le fichier SQL et compare.
 *
 * Référence : 07_ARCHITECTURE_TECHNIQUE/02_ROLES_ET_PERMISSIONS.md § 30-45.
 */

export const PERMISSIONS = [
  'users.view',
  'users.create',
  'users.update',
  'users.disable',
  'users.delete',

  'admins.view',
  'admins.create',
  'admins.update',
  'admins.disable',
  'admins.delete',
  'admins.permissions',

  'services.view',
  'services.create',
  'services.update',
  'services.delete',
  'services.publish',

  'products.view',
  'products.create',
  'products.update',
  'products.delete',
  'products.publish',

  'orders.view',
  'orders.update',
  'orders.cancel',
  'orders.refund',

  'payments.view',
  'payments.verify',
  'payments.refund',

  // Ajoutée par la finalisation 4G (migration 20261001120000) : émettre une
  // facture officielle n'est plus un effet de bord d'`orders.update`.
  'invoices.issue',

  'quotes.view',
  'quotes.create',
  'quotes.update',
  'quotes.delete',
  'quotes.manage',

  'appointments.view',
  'appointments.create',
  'appointments.update',
  'appointments.cancel',
  'appointments.manage',

  'affiliates.view',
  'affiliates.create',
  'affiliates.update',
  'affiliates.disable',
  'commissions.view',
  'commissions.manage',
  'commissions.validate',
  'payouts.manage',

  // Ajoutées par la phase 4H (migration 20261001140000) : l'affiliation est
  // devenue un moteur configurable, et chaque acte financier a sa permission.
  'affiliate_applications.view',
  'affiliate_applications.manage',
  'affiliate_rules.manage',
  'affiliate_rules.derogate',
  'affiliate_codes.manage',
  'affiliate_attributions.manage',
  'affiliate_documents.issue',
  'payouts.view',

  'content.view',
  'content.create',
  'content.update',
  'content.delete',
  'content.publish',

  'media.view',
  'media.upload',
  'media.update',
  'media.delete',

  'notifications.view',
  'notifications.create',
  'notifications.manage',

  'settings.view',
  'settings.update',

  'analytics.view',
  'analytics.manage',

  'audit.view',

  'admin.full_access',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Permissions critiques au sens du § 142 : gestion des administrateurs,
 * modification des permissions, paramètres de sécurité, opérations
 * financières, suppression définitive.
 */
export const CRITICAL_PERMISSIONS = [
  'users.delete',
  'admins.create',
  'admins.update',
  'admins.disable',
  'admins.delete',
  'admins.permissions',
  'services.delete',
  'products.delete',
  'orders.refund',
  'payments.verify',
  'payments.refund',
  'invoices.issue',
  'quotes.delete',
  'affiliates.update',
  'affiliates.disable',
  'commissions.manage',
  'commissions.validate',
  'payouts.manage',
  'affiliate_rules.manage',
  'affiliate_rules.derogate',
  'affiliate_codes.manage',
  'affiliate_attributions.manage',
  'affiliate_documents.issue',
  'content.delete',
  'media.delete',
  'settings.update',
  'audit.view',
  'admin.full_access',
] as const satisfies readonly Permission[];

export type CriticalPermission = (typeof CRITICAL_PERMISSIONS)[number];

/** Permission globale reconnue comme couvrant toutes les autres (§ 45). */
export const FULL_ACCESS: Permission = 'admin.full_access';

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'CLIENT', 'AFFILIE'] as const;

export type RoleCode = (typeof ROLES)[number];

/**
 * Modèle opérationnel proposé à la création d'un administrateur.
 *
 * Jusqu'à la phase 4C, cette liste était **attachée au rôle `ADMIN` en base** :
 * attribuer le rôle accordait les 40 permissions d'un bloc. La décision D-18 a
 * renversé ce principe — les permissions se donnent désormais compte par
 * compte — et la migration 0004 a donc vidé le rôle.
 *
 * La liste n'a pas disparu pour autant : elle décrit le périmètre opérationnel
 * documenté au § 49 de `02_ROLES_ET_PERMISSIONS.md`, et sert à **pré-cocher**
 * la grille lors d'une invitation. Rien de plus. Un modèle proposé n'est pas un
 * droit accordé : tant que le super-administrateur n'a pas validé la grille,
 * aucune ligne n'est écrite.
 *
 * Elle ne contient, par construction, aucune permission critique — un test le
 * vérifie contre le catalogue plutôt que de le supposer.
 */
export const ADMIN_TEMPLATE_PERMISSIONS = [
  'users.view',
  'users.create',
  'users.update',
  'users.disable',
  'admins.view',
  'services.view',
  'services.create',
  'services.update',
  'services.publish',
  'products.view',
  'products.create',
  'products.update',
  'products.publish',
  'orders.view',
  'orders.update',
  'orders.cancel',
  'payments.view',
  'quotes.view',
  'quotes.create',
  'quotes.update',
  'quotes.manage',
  'appointments.view',
  'appointments.create',
  'appointments.update',
  'appointments.cancel',
  'appointments.manage',
  'affiliates.view',
  'affiliate_applications.view',
  'affiliate_applications.manage',
  'commissions.view',
  'content.view',
  'content.create',
  'content.update',
  'content.publish',
  'media.view',
  'media.upload',
  'media.update',
  'notifications.view',
  'notifications.create',
  'notifications.manage',
  'settings.view',
  'analytics.view',
] as const satisfies readonly Permission[];

/** Rôles donnant accès à l'espace d'administration. */
export const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const satisfies readonly RoleCode[];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function isRoleCode(value: string): value is RoleCode {
  return (ROLES as readonly string[]).includes(value);
}

export function isCriticalPermission(value: Permission): boolean {
  return (CRITICAL_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Évalue une permission contre un ensemble détenu.
 *
 * Refus par défaut (§ 106) : seule la présence explicite de la permission, ou
 * celle de `admin.full_access`, accorde l'accès. Aucun rôle n'est consulté ici
 * — un rôle ne donne jamais un droit par lui-même (§ 141).
 */
export function grants(held: readonly string[], required: Permission): boolean {
  return held.includes(required) || held.includes(FULL_ACCESS);
}
