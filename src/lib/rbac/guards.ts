import 'server-only';

/**
 * Gardes de permission — la barrière que toutes les pages d'administration
 * partagent.
 *
 * La phase 4B avait livré `requireAdminAccess` : session valide, rôle
 * administratif, mot de passe changé, second facteur présenté. C'est la porte
 * de l'immeuble. Ces gardes-ci sont les portes des appartements : ils
 * répondent à « cette personne a-t-elle le droit de faire *cela* ? ».
 *
 * ## Pourquoi un seul endroit
 *
 * Le cadrage de la phase 4C est explicite : « Les contrôles de permission
 * doivent être réutilisables par les futures pages d'administration. Ne crée
 * pas de système parallèle de permissions. » Chaque module à venir appelle
 * donc `requirePermission()` et rien d'autre. Un module qui écrirait sa propre
 * vérification finirait par diverger — c'est exactement ce qui est arrivé au
 * socle abandonné.
 *
 * ## Ce qu'un refus renvoie, et pourquoi
 *
 * Un compte sans le droit demandé reçoit **404**, pas 403. Le § 102 du tableau
 * de bord demande que l'interface « ne révèle pas inutilement » ce qui existe :
 * un 403 confirmerait à un client curieux qu'une page Paiements se trouve à
 * cette adresse. Une page absente ne renseigne personne, et la vraie
 * protection reste le contrôle lui-même.
 *
 * Même règle pour les **actions serveur**, avec une différence : une action
 * ne rend pas de page. `assertPermission()` lève, et l'appelant transforme la
 * levée en message neutre. Un refus d'action est toujours journalisé ; un refus
 * de page ne l'est pas, sans quoi un robot qui balaie des URLs remplirait le
 * journal d'audit à lui seul.
 *
 * Références : `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 102, § 141, § 158-160,
 * § 193-196 ; `02_ROLES_ET_PERMISSIONS.md` § 106, § 141 ; plan § 7.3.
 */

import { notFound } from 'next/navigation';

import { requireAdminAccess } from '@/lib/auth/guards';
import type { AuthContext } from '@/lib/auth/session';

import type { Permission } from './catalogue';
import { allows, allowsAll, allowsAny } from './effective';
import { findModule, type AdminModule } from './modules';
import { getCurrentAccess, recordAuditEvent, type CurrentAccess } from './index';

/** Tout ce dont une page d'administration a besoin, chargé une seule fois. */
export type AdminContext = {
  auth: AuthContext;
  access: CurrentAccess;
  /** Raccourci : tranche une permission sans nouvel appel. */
  can: (permission: Permission) => boolean;
  canAll: (permissions: readonly Permission[]) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
};

/**
 * Socle commun : l'accès administratif de la phase 4B, plus les droits
 * effectifs de la phase 4C.
 *
 * Ne vérifie **aucune** permission particulière. Seul le tableau de bord s'en
 * contente ; tout autre écran enchaîne sur `requirePermission()`.
 */
export async function requireAdminContext(from: string): Promise<AdminContext> {
  const auth = await requireAdminAccess(from);
  const access = await getCurrentAccess();

  // `requireAdminAccess` a déjà établi la session et le profil actif. Si
  // l'accès est introuvable ici, c'est que l'état a changé entre les deux
  // lectures — compte désactivé pendant la requête, par exemple. Le refus est
  // alors le seul comportement sûr.
  if (!access) notFound();

  return {
    auth,
    access,
    can: (permission) => allows(access.permissions, permission),
    canAll: (permissions) => allowsAll(access.permissions, permissions),
    canAny: (permissions) => allowsAny(access.permissions, permissions),
  };
}

/**
 * Exige une permission pour afficher une page d'administration.
 *
 * C'est l'appel que fera chaque module. Il enchaîne, dans cet ordre : session,
 * rôle, mot de passe, second facteur, **puis** permission. Un maillon manquant
 * arrête la chaîne avant le suivant.
 */
export async function requirePermission(
  permission: Permission,
  from: string,
): Promise<AdminContext> {
  const context = await requireAdminContext(from);
  if (!context.can(permission)) notFound();

  return context;
}

/** Variante « au moins une », pour un écran qui regroupe deux domaines. */
export async function requireAnyPermission(
  permissions: readonly Permission[],
  from: string,
): Promise<AdminContext> {
  const context = await requireAdminContext(from);
  if (!context.canAny(permissions)) notFound();

  return context;
}

/**
 * Exige l'accès à un module du registre, désigné par son segment d'URL.
 *
 * Passer par le registre plutôt que par une permission écrite en dur évite la
 * dérive la plus banale : un module dont le menu et la page n'exigent pas la
 * même chose.
 */
export async function requireModule(
  slug: string | null,
): Promise<AdminContext & { module: AdminModule }> {
  // Nommée `entry` et non `module` : `module` est une variable réservée dans
  // les fichiers que Next.js transpile, et l'assigner déclenche une erreur de
  // lint qui n'a rien d'arbitraire — elle protège du bundler.
  const entry = findModule(slug);
  if (!entry) notFound();

  const context =
    entry.permission === null
      ? await requireAdminContext(entry.href)
      : await requirePermission(entry.permission, entry.href);

  return { ...context, module: entry };
}

/**
 * Refus d'une action serveur, distinct d'un refus de page.
 *
 * Levée plutôt que `notFound()` : une action rend un résultat, pas une page.
 * L'appelant attrape et renvoie un message neutre — le § 129 interdit
 * d'exposer le détail technique d'un refus.
 */
export class PermissionDenied extends Error {
  constructor(readonly permission: Permission) {
    super('Action non autorisée.');
    this.name = 'PermissionDenied';
  }
}

/**
 * Exige une permission pour exécuter une action sensible, et journalise le
 * refus le cas échéant.
 *
 * Le § 196 demande que les actions sensibles laissent une trace. Un refus en
 * est une : c'est même la plus intéressante des deux, puisqu'elle signale soit
 * une erreur de conception, soit une tentative.
 */
export async function assertPermission(
  permission: Permission,
  action: string,
): Promise<AdminContext> {
  const context = await requireAdminContext('/administration/');

  if (!context.can(permission)) {
    await recordAuditEvent({
      action,
      result: 'REFUS',
      metadata: { permission_requise: permission },
    });

    throw new PermissionDenied(permission);
  }

  return context;
}

/**
 * Vérifie qu'une ressource appartient bien au compte connecté.
 *
 * Le plan § 7.3 range la propriété au même niveau que la permission : détenir
 * `orders.view` autorise à consulter *une* commande, pas à consulter celle de
 * n'importe qui. Les modules à venir s'en serviront ; il est posé ici pour
 * qu'ils n'aient pas à le réinventer chacun à leur façon.
 *
 * Une permission d'administration donnée en second argument lève la
 * restriction : un administrateur habilité voit toutes les ressources du
 * domaine, un client ne voit que les siennes.
 */
export function ownsOrCan(
  context: AdminContext,
  ownerId: string | null | undefined,
  override: Permission,
): boolean {
  if (ownerId && ownerId === context.access.userId) return true;
  return context.can(override);
}

export function requireOwnershipOrPermission(
  context: AdminContext,
  ownerId: string | null | undefined,
  override: Permission,
): void {
  if (!ownsOrCan(context, ownerId, override)) notFound();
}
