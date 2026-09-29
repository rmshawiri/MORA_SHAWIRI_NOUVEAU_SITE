/**
 * Calcul des permissions effectives — règles pures, sans base ni session.
 *
 * Ce fichier ne lit rien et n'écrit rien. Il ne connaît ni Supabase, ni
 * requête HTTP, ni React. Il reçoit des faits et rend un verdict.
 *
 * C'est le même parti pris que `src/lib/auth/access.ts` en phase 4B, et pour
 * la même raison : une règle d'autorisation mêlée à un accès base ne se teste
 * qu'à moitié. Isolée, elle se parcourt exhaustivement — et c'est ce que fait
 * `tests/unit/rbac-effective.test.ts`, qui balaie l'intégralité du catalogue.
 *
 * ## La règle, en une ligne
 *
 *   effectives = permissions des rôles ∪ octrois individuels ∖ retraits individuels
 *
 * Puis, au moment de trancher une demande : `admin.full_access` couvre tout.
 *
 * Attention à l'ordre. Le retrait s'applique **après** l'union, donc il gagne
 * toujours : un retrait individuel reprend aussi bien un droit venu du rôle
 * qu'un droit octroyé par ailleurs. C'est ce qu'exige le § 10 du tableau de
 * bord (moindre privilège) — sans quoi la seule façon de reprendre un droit
 * serait de retirer le rôle entier, donc l'accès à l'administration.
 *
 * Miroir exact de `public.effective_permissions()` (migration 0004). Les deux
 * doivent rendre le même verdict ; `scripts/verify-permissions.mjs` le vérifie
 * contre la vraie base plutôt que de l'affirmer.
 *
 * Références : `02_ROLES_ET_PERMISSIONS.md` § 106, § 141-142 ; décision D-18.
 */

import { FULL_ACCESS, type Permission } from './catalogue';

/** Sens d'un ajustement individuel, tel que la colonne `effect` l'enregistre. */
export type PermissionEffect = 'OCTROI' | 'RETRAIT';

/** Un ajustement posé sur un compte précis. */
export type PermissionAdjustment = {
  permission: Permission;
  effect: PermissionEffect;
};

/** Les trois faits dont dépend le calcul. Rien d'autre n'entre en jeu. */
export type PermissionInputs = {
  /** Permissions accordées par les rôles portés par le compte. */
  fromRoles: readonly string[];
  /** Octrois et retraits posés sur ce compte. */
  adjustments: readonly PermissionAdjustment[];
};

/**
 * Permissions effectives, triées pour que deux calculs successifs donnent des
 * listes comparables — un test qui échoue sur un ordre de tri ne prouve rien.
 */
export function effectivePermissions(inputs: PermissionInputs): string[] {
  const revoked = new Set<string>();
  const granted = new Set<string>(inputs.fromRoles);

  for (const adjustment of inputs.adjustments) {
    if (adjustment.effect === 'RETRAIT') {
      revoked.add(adjustment.permission);
    } else {
      granted.add(adjustment.permission);
    }
  }

  // Le retrait s'applique après l'union : il gagne toujours.
  for (const code of revoked) granted.delete(code);

  return [...granted].sort();
}

/**
 * Tranche une demande contre un ensemble effectif déjà calculé.
 *
 * Refus par défaut : seule la présence explicite de la permission, ou celle de
 * `admin.full_access`, accorde l'accès. Aucun rôle n'est consulté — un rôle ne
 * donne jamais un droit par lui-même (§ 141).
 */
export function allows(effective: readonly string[], required: Permission): boolean {
  return effective.includes(required) || effective.includes(FULL_ACCESS);
}

/** Vrai si **toutes** les permissions demandées sont détenues. */
export function allowsAll(effective: readonly string[], required: readonly Permission[]): boolean {
  return required.every((permission) => allows(effective, permission));
}

/** Vrai si **au moins une** des permissions demandées est détenue. */
export function allowsAny(effective: readonly string[], required: readonly Permission[]): boolean {
  return required.some((permission) => allows(effective, permission));
}

/**
 * Décrit d'où vient — ou d'où ne vient pas — un droit, pour l'afficher sur la
 * fiche d'un administrateur.
 *
 * Le § 127 du tableau de bord demande la traçabilité. Cocher une case sans
 * pouvoir dire pourquoi elle est cochée n'est pas de la traçabilité : un
 * administrateur doit voir si un droit lui vient de son rôle, d'un octroi
 * nominatif, ou s'il lui a été explicitement repris.
 */
export type PermissionOrigin = 'role' | 'octroi' | 'retrait' | 'absent';

export function permissionOrigin(
  inputs: PermissionInputs,
  permission: Permission,
): PermissionOrigin {
  const adjustment = inputs.adjustments.find((entry) => entry.permission === permission);

  if (adjustment?.effect === 'RETRAIT') return 'retrait';
  if (adjustment?.effect === 'OCTROI') return 'octroi';
  if (inputs.fromRoles.includes(permission)) return 'role';

  return 'absent';
}

/**
 * Ajustements à écrire pour qu'un compte détienne exactement l'ensemble
 * souhaité, compte tenu de ce que ses rôles lui donnent déjà.
 *
 * Écrire un octroi pour un droit que le rôle accorde déjà serait du bruit ;
 * écrire un retrait pour un droit que personne n'accorde aussi. La fonction ne
 * produit donc que les lignes qui changent réellement quelque chose, et
 * signale celles à supprimer.
 *
 * Le résultat est ce que l'action serveur applique — c'est ici, et non dans
 * l'interface, que se décide le contenu de la table.
 */
export type AdjustmentPlan = {
  /** Lignes à créer ou mettre à jour. */
  upserts: PermissionAdjustment[];
  /** Permissions dont la ligne d'ajustement doit disparaître. */
  removals: Permission[];
};

export function planAdjustments(
  fromRoles: readonly string[],
  existing: readonly PermissionAdjustment[],
  desired: readonly Permission[],
): AdjustmentPlan {
  const wanted = new Set<string>(desired);
  const roleGives = new Set<string>(fromRoles);
  const current = new Map<string, PermissionEffect>(
    existing.map((entry) => [entry.permission, entry.effect]),
  );

  const upserts: PermissionAdjustment[] = [];
  const removals: Permission[] = [];

  // Toutes les permissions concernées : celles voulues, celles déjà ajustées,
  // celles que le rôle donne. Une permission hors de ces trois ensembles n'a
  // aucune raison de bouger.
  const concerned = new Set<string>([...wanted, ...current.keys(), ...roleGives]);

  for (const code of concerned) {
    const permission = code as Permission;
    const shouldHold = wanted.has(code);
    const roleHolds = roleGives.has(code);
    const adjusted = current.get(code);

    // Ce que le rôle fait déjà correctement n'a pas besoin d'une ligne.
    const needed: PermissionEffect | null =
      shouldHold === roleHolds ? null : shouldHold ? 'OCTROI' : 'RETRAIT';

    if (needed === null) {
      if (adjusted !== undefined) removals.push(permission);
      continue;
    }

    if (adjusted !== needed) upserts.push({ permission, effect: needed });
  }

  upserts.sort((a, b) => a.permission.localeCompare(b.permission));
  removals.sort();

  return { upserts, removals };
}
