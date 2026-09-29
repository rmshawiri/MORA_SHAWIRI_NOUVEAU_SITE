'use server';

/**
 * Acceptation d'une invitation d'administrateur.
 *
 * ## Pourquoi cette action emprunte la clé à privilèges
 *
 * C'est le seul chemin du projet où une écriture privilégiée est inévitable :
 * **il n'y a pas encore de session**. La personne invitée n'a pas de compte,
 * donc pas de jeton, donc aucune politique RLS ne peut lui accorder quoi que ce
 * soit. Créer le compte, lui attribuer son rôle et poser ses permissions
 * suppose de passer outre — c'est précisément l'un des trois usages autorisés
 * énumérés dans `src/lib/supabase/admin.ts`.
 *
 * La contrepartie est que les garde-fous en base ne s'appliquent pas ici :
 * `is_privileged_db_role()` fait revenir les déclencheurs sans rien vérifier.
 * Les contrôles sont donc refaits dans cette action, un par un, et ils sont
 * plus stricts que ceux d'un ajustement ordinaire :
 *
 *   * le jeton est comparé à temps constant, à son empreinte seule ;
 *   * une invitation acceptée, révoquée ou expirée ne vaut rien ;
 *   * l'identifiant est revérifié au moment de l'acceptation — quarante-huit
 *     heures ont pu passer, et quelqu'un d'autre a pu le prendre ;
 *   * les permissions écrites sont **celles enregistrées à l'invitation**,
 *     jamais celles que le formulaire renverrait. Le navigateur de la personne
 *     invitée ne décide pas de ses propres droits ;
 *   * le mot de passe passe par la même politique que partout ailleurs.
 *
 * Le compte est créé avec un e-mail déjà confirmé : le lien reçu prouve que
 * l'adresse fonctionne, et redemander une confirmation par le service intégré
 * de Supabase ramènerait la limite que la décision D-19 sert à éviter.
 *
 * Références : `04_AUTHENTIFICATION.md` § 62-64, § 26-28 ; migration 0004 § 7.
 */

import { requireAdminSupabaseClient } from '@/lib/supabase/admin';
import { assessPassword, passwordContext } from '@/lib/auth/passwords';
import { AUTH_MESSAGES } from '@/lib/auth/messages';

import { hashToken } from './invitations';

export type AcceptState = {
  status: 'idle' | 'ok' | 'error';
  message: string;
  reasons?: string[];
};

const ko = (message: string, reasons?: string[]): AcceptState => ({
  status: 'error',
  message,
  ...(reasons?.length ? { reasons } : {}),
});

/**
 * Message unique pour tous les cas où l'invitation ne vaut rien.
 *
 * Jeton inconnu, expiré, déjà utilisé ou révoqué reçoivent la même réponse.
 * Distinguer « ce jeton n'existe pas » de « ce jeton a expiré » apprendrait à
 * qui essaie des valeurs au hasard laquelle a existé — la même logique que
 * l'anti-énumération de la phase 4B.
 */
const INVALID = 'Ce lien d’invitation n’est plus valable. Demandez-en un nouveau.';

/** État d'une invitation, tel que la page d'accueil du lien l'affiche. */
export type InvitationPreview = {
  valid: boolean;
  username: string | null;
  fullName: string | null;
};

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const invitation = await findUsableInvitation(token);

  return invitation
    ? { valid: true, username: invitation.username, fullName: invitation.full_name }
    : { valid: false, username: null, fullName: null };
}

type UsableInvitation = {
  id: string;
  username: string;
  email: string;
  full_name: string | null;
  role_id: string;
  permissions: string[];
  token_hash: string;
};

async function findUsableInvitation(token: string): Promise<UsableInvitation | null> {
  const candidate = token.trim();
  if (!candidate || candidate.length > 256) return null;

  const client = requireAdminSupabaseClient();

  // La recherche porte sur l'empreinte : la valeur en clair n'existe nulle part
  // en base, et ne peut donc pas être retrouvée par une lecture de la table.
  const { data } = await client
    .from('admin_invitations')
    .select('id, username, email, full_name, role_id, permissions, token_hash, expires_at, accepted_at, revoked_at')
    .eq('token_hash', hashToken(candidate))
    .maybeSingle();

  if (!data) return null;

  const row = data as UsableInvitation & {
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
  };

  if (row.accepted_at || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  return row;
}

export async function acceptInvitationAction(
  _previous: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const token = readField(formData, 'jeton');
  const password = readField(formData, 'mot_de_passe', { trim: false });
  const confirmation = readField(formData, 'confirmation', { trim: false });

  if (!token) return ko(INVALID);
  if (!password || !confirmation) return ko(AUTH_MESSAGES.missingFields);
  if (password !== confirmation) return ko(AUTH_MESSAGES.passwordMismatch);

  const invitation = await findUsableInvitation(token);
  if (!invitation) return ko(INVALID);

  const weaknesses = assessPassword(
    password,
    passwordContext({
      username: invitation.username,
      email: invitation.email,
      fullName: invitation.full_name,
    }),
  );

  if (weaknesses.length > 0) {
    return ko('Ce mot de passe ne convient pas.', weaknesses);
  }

  const client = requireAdminSupabaseClient();

  // L'identifiant est revérifié maintenant : quarante-huit heures ont pu
  // passer depuis l'invitation.
  const { data: taken } = await client
    .from('profiles')
    .select('id')
    .eq('username', invitation.username)
    .maybeSingle();

  if (taken) {
    return ko(
      'Cet identifiant a été attribué entre-temps. Demandez une nouvelle invitation avec un autre identifiant.',
    );
  }

  // `app_metadata` n'est écrivable que par la clé à privilèges : c'est ce qui
  // rend l'identifiant infalsifiable depuis le navigateur (migration 0004 § 8).
  const { data: created, error: createError } = await client.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    app_metadata: { username: invitation.username, full_name: invitation.full_name },
    user_metadata: { full_name: invitation.full_name },
  });

  if (createError || !created.user) {
    return ko('La création du compte a échoué. Demandez une nouvelle invitation.');
  }

  const userId = created.user.id;

  // Le rôle donne l'accès à l'administration ; il n'accorde plus aucune
  // permission par lui-même depuis la décision D-18.
  const { error: roleError } = await client
    .from('user_roles')
    .insert({ user_id: userId, role_id: invitation.role_id });

  if (roleError) {
    // Un compte sans rôle est un compte sans accès : le retirer évite de
    // laisser derrière soi une identité à moitié créée.
    await client.auth.admin.deleteUser(userId);
    return ko('La création du compte a échoué. Demandez une nouvelle invitation.');
  }

  // Les permissions écrites sont celles de l'invitation, relues en base.
  if (invitation.permissions.length > 0) {
    const { data: permissionRows } = await client
      .from('permissions')
      .select('id, code')
      .in('code', invitation.permissions);

    const rows = ((permissionRows ?? []) as { id: string; code: string }[]).map((row) => ({
      user_id: userId,
      permission_id: row.id,
      effect: 'OCTROI' as const,
      granted_by: null,
    }));

    if (rows.length > 0) {
      await client.from('user_permissions').insert(rows);
    }
  }

  await client
    .from('admin_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id);

  // L'audit passe par la clé à privilèges, donc sans auteur connecté : c'est
  // exact, personne n'était connecté. La ressource, elle, identifie le compte.
  await client.from('audit_logs').insert({
    action: 'admin.invitation.accept',
    resource_type: 'profiles',
    resource_id: userId,
    result: 'SUCCES',
    actor_label: invitation.username,
    metadata: { permissions_accordees: invitation.permissions.length },
  });

  return {
    status: 'ok',
    message:
      'Votre compte est activé. Connectez-vous avec votre identifiant, puis enrôlez une ' +
      'application d’authentification : l’administration ne s’ouvre qu’avec un second facteur.',
  };
}

function readField(
  formData: FormData,
  name: string,
  options: { trim?: boolean } = {},
): string {
  const value = formData.get(name);
  if (typeof value !== 'string') return '';
  return options.trim === false ? value : value.trim();
}
