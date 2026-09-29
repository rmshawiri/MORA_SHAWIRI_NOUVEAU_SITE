'use server';

/**
 * Actions du module Administrateurs.
 *
 * Quatre opérations sensibles : inviter, révoquer une invitation, ajuster des
 * permissions, suspendre ou rétablir un compte. Toutes suivent la même
 * discipline, dans cet ordre :
 *
 *   1. **permission** — `assertPermission()`, qui journalise le refus ;
 *   2. **validation** — les valeurs reçues du navigateur sont recalculées, pas
 *      crues (§ 195 : « validation serveur ») ;
 *   3. **écriture sous RLS** — par le client de session, jamais par la clé à
 *      privilèges, afin que la troisième barrière s'applique aussi ;
 *   4. **audit** — `record_audit_event`, dont la base fixe l'auteur.
 *
 * ## Ce que le navigateur ne décide pas
 *
 * Le formulaire de permissions renvoie une liste de cases cochées. Cette liste
 * n'est **jamais** écrite telle quelle : le serveur la confronte au catalogue,
 * écarte tout code inconnu, la compare à ce que les rôles accordent déjà, et
 * n'écrit que les différences. Une case forgée qui ne correspond à aucune
 * permission du catalogue disparaît à cette étape ; une case forgée qui
 * correspond à une permission réelle est écrite, puis refusée par RLS si
 * l'auteur ne détient pas `admins.permissions`.
 *
 * ## L'auto-élévation
 *
 * Elle est impossible à trois niveaux, et pas seulement au premier : le
 * formulaire n'affiche pas son propre compte, l'action refuse une cible égale à
 * l'auteur, et le déclencheur `user_permissions_guard` lève de toute façon.
 * C'est volontairement redondant — le § 96 n'admet aucune exception, et une
 * seule barrière finit toujours par être contournée par une route oubliée.
 *
 * Références : `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 113-114, § 158-160,
 * § 193-196 ; `02_ROLES_ET_PERMISSIONS.md` § 21, § 96-97, § 142.
 */

import { revalidatePath } from 'next/cache';

import { getServerSupabaseClient } from '@/lib/supabase/server';
import { isPermission, type Permission } from '@/lib/rbac/catalogue';
import { planAdjustments, type PermissionAdjustment } from '@/lib/rbac/effective';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { recordAuditEvent } from '@/lib/rbac';
import { displayIdentity } from '@/lib/auth/identifiers';

import { getAccountPermissions } from './administrators';
import { issueInvitationToken, sendInvitationEmail } from './invitations';

export type AdminActionState = {
  status: 'idle' | 'ok' | 'error';
  message: string;
};

const ok = (message: string): AdminActionState => ({ status: 'ok', message });
const ko = (message: string): AdminActionState => ({ status: 'error', message });

/** Messages génériques : le § 129 interdit d'exposer une cause technique. */
const MESSAGES = {
  denied: 'Vous n’avez pas le droit d’effectuer cette action.',
  unexpected: 'L’opération n’a pas abouti. Réessayez dans un instant.',
  selfTarget: 'Vous ne pouvez pas modifier vos propres droits. Demandez-le à un autre administrateur.',
  invalidUsername:
    'L’identifiant doit comporter 3 à 32 caractères : lettres minuscules, chiffres, point, tiret ou tiret bas.',
  invalidEmail: 'Cette adresse e-mail semble incomplète. Exemple : nom@domaine.com',
  usernameTaken: 'Cet identifiant est déjà utilisé.',
} as const;

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Permissions cochées, ramenées au catalogue.
 *
 * `getAll` peut renvoyer n'importe quoi : des codes inventés, des doublons, un
 * millier d'entrées. Le filtre `isPermission` est ce qui empêche la suite du
 * traitement de raisonner sur du texte libre.
 */
function checkedPermissions(formData: FormData): Permission[] {
  const raw = formData.getAll('permissions');

  return [
    ...new Set(
      raw.flatMap((value) =>
        typeof value === 'string' && isPermission(value) ? [value as Permission] : [],
      ),
    ),
  ];
}

/* ========================================================================== */
/*  Ajustement des permissions d'un compte                                    */
/* ========================================================================== */

export async function updatePermissionsAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let context;
  try {
    context = await assertPermission('admins.permissions', 'admin.permissions.update');
  } catch (error) {
    return error instanceof PermissionDenied ? ko(MESSAGES.denied) : ko(MESSAGES.unexpected);
  }

  const targetId = field(formData, 'compte');
  if (!targetId) return ko(MESSAGES.unexpected);

  // Première des trois barrières contre l'auto-élévation.
  if (targetId === context.access.userId) return ko(MESSAGES.selfTarget);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.unexpected);

  // L'état réel de la cible est relu en base : le formulaire a pu être rendu
  // il y a dix minutes, et un autre administrateur a pu agir entre-temps.
  const catalogue = await getAccountPermissions(targetId);
  if (catalogue.length === 0) return ko(MESSAGES.unexpected);

  const fromRoles = catalogue.filter((row) => row.from_role).map((row) => row.code);

  const existing: PermissionAdjustment[] = catalogue.flatMap((row) =>
    row.effect && isPermission(row.code)
      ? [{ permission: row.code as Permission, effect: row.effect }]
      : [],
  );

  const desired = checkedPermissions(formData);
  const plan = planAdjustments(fromRoles, existing, desired);

  if (plan.upserts.length === 0 && plan.removals.length === 0) {
    return ok('Aucun changement : les droits de ce compte sont déjà ceux demandés.');
  }

  // Les identifiants des permissions concernées, pour écrire dans une table
  // qui référence `permissions.id` et non son code.
  const codes = [...plan.upserts.map((entry) => entry.permission), ...plan.removals];

  const { data: permissionRows, error: catalogueError } = await supabase
    .from('permissions')
    .select('id, code')
    .in('code', codes);

  if (catalogueError || !permissionRows) return ko(MESSAGES.unexpected);

  const idByCode = new Map(
    (permissionRows as { id: string; code: string }[]).map((row) => [row.code, row.id]),
  );

  if (plan.removals.length > 0) {
    const ids = plan.removals.flatMap((code) => {
      const id = idByCode.get(code);
      return id ? [id] : [];
    });

    if (ids.length > 0) {
      const { error } = await supabase
        .from('user_permissions')
        .delete()
        .eq('user_id', targetId)
        .in('permission_id', ids);

      if (error) return ko(refusalMessage(error.message));
    }
  }

  if (plan.upserts.length > 0) {
    const rows = plan.upserts.flatMap((entry) => {
      const id = idByCode.get(entry.permission);
      if (!id) return [];
      return [
        {
          user_id: targetId,
          permission_id: id,
          effect: entry.effect,
          granted_by: context.access.userId,
        },
      ];
    });

    const { error } = await supabase
      .from('user_permissions')
      .upsert(rows, { onConflict: 'user_id,permission_id' });

    if (error) return ko(refusalMessage(error.message));
  }

  await recordAuditEvent({
    action: 'admin.permissions.update',
    resourceType: 'profiles',
    resourceId: targetId,
    // Les codes concernés, pas les valeurs : le journal doit rester lisible
    // sans devenir une copie de la table.
    metadata: {
      octrois: plan.upserts.filter((e) => e.effect === 'OCTROI').map((e) => e.permission),
      retraits: plan.upserts.filter((e) => e.effect === 'RETRAIT').map((e) => e.permission),
      alignes_sur_le_role: plan.removals,
    },
  });

  revalidatePath('/administration/administrateurs/');
  revalidatePath(`/administration/administrateurs/${targetId}/`);

  return ok('Permissions mises à jour.');
}

/* ========================================================================== */
/*  Invitation d'un administrateur                                            */
/* ========================================================================== */

export async function inviteAdministratorAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let context;
  try {
    context = await assertPermission('admins.create', 'admin.invitation.create');
  } catch (error) {
    return error instanceof PermissionDenied ? ko(MESSAGES.denied) : ko(MESSAGES.unexpected);
  }

  const username = field(formData, 'identifiant').toLowerCase();
  const email = field(formData, 'email').toLowerCase();
  const fullName = field(formData, 'nom') || null;

  if (!USERNAME_PATTERN.test(username)) return ko(MESSAGES.invalidUsername);
  if (!EMAIL_PATTERN.test(email)) return ko(MESSAGES.invalidEmail);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.unexpected);

  // L'identifiant est unique sur toute la plateforme (contrainte de la
  // migration 0001). Le vérifier ici donne un message utile plutôt qu'une
  // erreur d'écriture à l'acceptation, quarante-huit heures plus tard.
  const { data: taken } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (taken) return ko(MESSAGES.usernameTaken);

  const { data: role } = await supabase
    .from('roles')
    .select('id')
    .eq('code', 'ADMIN')
    .maybeSingle();

  if (!role) return ko(MESSAGES.unexpected);

  // Le rôle `ADMIN` n'accorde plus aucune permission depuis la décision D-18 :
  // les droits proposés ici sont donc la totalité de ce que la personne
  // recevra, et rien ne s'y ajoute en coulisse.
  const permissions = checkedPermissions(formData);
  const issued = issueInvitationToken();

  const { data: invitation, error } = await supabase
    .from('admin_invitations')
    .insert({
      username,
      email,
      full_name: fullName,
      role_id: (role as { id: string }).id,
      permissions,
      token_hash: issued.hash,
      expires_at: issued.expiresAt.toISOString(),
      created_by: context.access.userId,
    })
    .select('id')
    .maybeSingle();

  if (error || !invitation) return ko(refusalMessage(error?.message ?? ''));

  await recordAuditEvent({
    action: 'admin.invitation.create',
    resourceType: 'admin_invitations',
    resourceId: (invitation as { id: string }).id,
    // Ni le jeton, ni son empreinte : la base refuserait, et elle a raison.
    metadata: { identifiant: username, permissions },
  });

  revalidatePath('/administration/administrateurs/');

  let delivered = false;
  try {
    delivered = await sendInvitationEmail({
      to: email,
      username,
      fullName,
      token: issued.token,
      invitedBy: displayIdentity(
        context.access.profile ?? { username: null, full_name: null },
        context.auth.email,
      ),
    });
  } catch {
    // L'invitation existe, l'envoi a échoué. Le dire est plus utile que de
    // supprimer la ligne : elle peut être renvoyée ou révoquée.
    delivered = false;
  }

  return delivered
    ? ok(`Invitation envoyée à ${email}. Elle est valable 48 heures.`)
    : ok(
        'Invitation créée, mais le message n’a pas pu être envoyé : la configuration SMTP est ' +
          'incomplète ou indisponible. Révoquez cette invitation et recommencez une fois l’envoi rétabli.',
      );
}

/* ========================================================================== */
/*  Révocation d'une invitation                                               */
/* ========================================================================== */

export async function revokeInvitationAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('admins.create', 'admin.invitation.revoke');
  } catch (error) {
    return error instanceof PermissionDenied ? ko(MESSAGES.denied) : ko(MESSAGES.unexpected);
  }

  const id = field(formData, 'invitation');
  if (!id) return ko(MESSAGES.unexpected);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.unexpected);

  const { error } = await supabase
    .from('admin_invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('accepted_at', null);

  if (error) return ko(refusalMessage(error.message));

  await recordAuditEvent({
    action: 'admin.invitation.revoke',
    resourceType: 'admin_invitations',
    resourceId: id,
  });

  revalidatePath('/administration/administrateurs/');

  return ok('Invitation révoquée. Le lien envoyé ne fonctionne plus.');
}

/* ========================================================================== */
/*  Suspension et rétablissement d'un compte                                  */
/* ========================================================================== */

export async function setAccountStatusAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let context;
  try {
    context = await assertPermission('admins.disable', 'admin.compte.statut');
  } catch (error) {
    return error instanceof PermissionDenied ? ko(MESSAGES.denied) : ko(MESSAGES.unexpected);
  }

  const targetId = field(formData, 'compte');
  const status = field(formData, 'statut');

  if (!targetId) return ko(MESSAGES.unexpected);
  if (targetId === context.access.userId) {
    return ko('Vous ne pouvez pas suspendre votre propre compte.');
  }
  if (status !== 'ACTIF' && status !== 'SUSPENDU') return ko(MESSAGES.unexpected);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.unexpected);

  // Le garde-fou du dernier administrateur vit en base (déclencheur
  // `profiles_guard`, phase 4A § 5.3). L'action ne le réécrit pas : elle
  // traduit son refus en phrase lisible.
  const { error } = await supabase.from('profiles').update({ status }).eq('id', targetId);

  if (error) return ko(refusalMessage(error.message));

  await recordAuditEvent({
    action: 'admin.compte.statut',
    resourceType: 'profiles',
    resourceId: targetId,
    metadata: { statut: status },
  });

  revalidatePath('/administration/administrateurs/');
  revalidatePath(`/administration/administrateurs/${targetId}/`);

  return ok(
    status === 'SUSPENDU'
      ? 'Compte suspendu. Ses sessions ne donnent plus accès à rien.'
      : 'Compte rétabli.',
  );
}

/* ========================================================================== */

/**
 * Traduit un refus de la base en phrase compréhensible.
 *
 * Les deux garde-fous que l'administrateur peut réellement rencontrer méritent
 * une explication ; tout le reste reçoit le message générique. Aucun détail
 * technique, aucune trace SQL n'est affiché — § 129.
 */
function refusalMessage(raw: string): string {
  if (raw.includes('dernier à détenir')) {
    return (
      'Refusé : ce compte est le dernier à détenir une permission critique. ' +
      'Accordez-la d’abord à un autre administrateur, puis recommencez.'
    );
  }

  if (raw.includes('ses propres permissions') || raw.includes('à lui-même')) {
    return MESSAGES.selfTarget;
  }

  return MESSAGES.unexpected;
}
