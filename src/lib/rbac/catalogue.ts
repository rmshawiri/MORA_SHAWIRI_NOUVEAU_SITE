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
  'quotes.delete',
  'affiliates.update',
  'affiliates.disable',
  'commissions.manage',
  'commissions.validate',
  'payouts.manage',
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
