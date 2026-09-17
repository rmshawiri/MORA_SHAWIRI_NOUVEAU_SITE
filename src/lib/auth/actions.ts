'use server';

/**
 * Actions serveur des parcours d'authentification.
 *
 * Tout passe par ici : rien n'est demandé à Supabase depuis le navigateur.
 * Ce choix n'est pas stylistique. Il permet d'appliquer, **avant** que la
 * requête n'atteigne le serveur d'authentification, trois contrôles qu'un
 * appel depuis le navigateur rendrait facultatifs :
 *
 *   * la limitation de fréquence partagée entre instances (§ 12 du cadrage) ;
 *   * la politique de mot de passe (§ 26-28 de l'authentification) ;
 *   * l'attribution du rôle `CLIENT`, qui ne doit jamais dépendre d'une valeur
 *     venue du navigateur (§ 1 du cadrage, § 75 et § 129 de l'authentification).
 *
 * Aucune de ces actions ne journalise de mot de passe, de code TOTP, de jeton
 * ni de secret d'enrôlement (§ 141, § 160).
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSiteUrl } from '@/lib/env';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getServerSupabaseClient } from '@/lib/supabase/server';

import { adminAccessObstacle, canRemoveFactor, privateAccessObstacle } from './access';
import { recordAnonymousAuthEvent, recordAuthEvent } from './audit';
import { resolveLoginIdentifier } from './identifiers';
import {
  AUTH_MESSAGES,
  authError,
  authOk,
  type AuthActionState,
  type MfaEnrolmentState,
} from './messages';
import { assessPassword, passwordContext, PASSWORD_MAX_LENGTH } from './passwords';
import { AUTH_RATE_RULES, callerKey, clearAttempts, consumeAttempt } from './rate-limit';
import { AUTH_ROUTES, NEXT_PARAM, safeInternalPath } from './routes';
import { getAuthContext } from './session';
import { isPublicRegistrationEnabled } from './settings';

/* ========================================================================== */
/*  Outils communs                                                            */
/* ========================================================================== */

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * Pot de miel : un champ invisible qu'un humain ne remplit jamais.
 *
 * `04_AUTHENTIFICATION.md` § 38 écarte le CAPTCHA systématique — « il ne doit
 * pas être imposé inutilement » —, et § 126 demande néanmoins une protection
 * contre les robots. Le pot de miel n'impose rien à personne et arrête les
 * automates les moins soignés ; la limitation de fréquence s'occupe des autres.
 */
function looksAutomated(formData: FormData): boolean {
  return field(formData, 'site_web').trim().length > 0;
}

async function callerAddress(): Promise<string> {
  return callerKey(await headers());
}

/** Destination après une authentification réussie, obstacles compris. */
function destinationAfterSignIn(
  context: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>,
  requested: string | null,
): string {
  const obstacle = context.isAdmin
    ? adminAccessObstacle(context)
    : privateAccessObstacle(context);

  switch (obstacle) {
    case 'mot-de-passe-a-changer':
      return AUTH_ROUTES.changePassword;
    case 'second-facteur-a-enroler':
      return AUTH_ROUTES.mfaSettings;
    case 'second-facteur-a-verifier':
      return AUTH_ROUTES.mfaChallenge;
    default:
      break;
  }

  const fallback = context.isAdmin ? AUTH_ROUTES.adminArea : AUTH_ROUTES.clientArea;
  return safeInternalPath(requested, fallback);
}

/**
 * Horodate la dernière connexion.
 *
 * La colonne est protégée par le déclencheur `profiles_guard`, qui la remet à
 * sa valeur précédente pour tout appelant ordinaire : elle est tenue par le
 * serveur, jamais par le client (§ 56). Seule la clé à privilèges peut donc
 * l'écrire.
 */
async function stampLastLogin(userId: string): Promise<void> {
  try {
    const client = getAdminSupabaseClient();
    if (!client) return;

    await client
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', userId);
  } catch {
    // Information de confort : son absence ne bloque aucune connexion.
  }
}

/* ========================================================================== */
/*  Connexion                                                                 */
/* ========================================================================== */

/**
 * Connexion par identifiant métier ou adresse e-mail.
 *
 * Le message d'échec est unique (§ 31-32) : ni l'inexistence du compte, ni un
 * mot de passe erroné, ni un identifiant mal formé ne produisent une réponse
 * distincte.
 */
export async function signInAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const identifier = field(formData, 'identifiant');
  const password = field(formData, 'mot_de_passe');
  const requested = safeInternalPath(field(formData, NEXT_PARAM), '');

  if (looksAutomated(formData)) return authError(AUTH_MESSAGES.suspectedAutomation);
  if (!identifier.trim() || !password) return authError(AUTH_MESSAGES.missingFields);

  const address = await callerAddress();

  const byIp = await consumeAttempt(AUTH_RATE_RULES.signInByIp, address);
  if (!byIp.allowed) {
    await recordAnonymousAuthEvent({
      action: 'auth.limite_atteinte',
      metadata: { parcours: 'connexion', portee: 'adresse' },
    });
    return authError(AUTH_MESSAGES.rateLimited);
  }

  const resolved = await resolveLoginIdentifier(identifier);

  const byIdentifier = await consumeAttempt(
    AUTH_RATE_RULES.signInByIdentifier,
    resolved.email ?? resolved.value,
  );
  if (!byIdentifier.allowed) {
    await recordAnonymousAuthEvent({
      action: 'auth.limite_atteinte',
      metadata: { parcours: 'connexion', portee: 'identifiant' },
    });
    return authError(AUTH_MESSAGES.rateLimited);
  }

  // Un identifiant mal formé emprunte le même chemin qu'un identifiant
  // inconnu : `resolveLoginIdentifier` fournit alors une adresse du domaine
  // réservé `.invalid`, et Supabase répond « identifiants incorrects » au même
  // coût. Voir `identifiers.ts` pour le raisonnement (§ 172).
  if (resolved.kind === 'invalid') {
    await recordAnonymousAuthEvent({
      action: 'auth.connexion_refusee',
      metadata: { motif: 'identifiant_invalide' },
    });
    return authError(AUTH_MESSAGES.invalidCredentials);
  }

  const supabase = await getServerSupabaseClient();
  if (!supabase) return authError(AUTH_MESSAGES.unexpected);

  const { error } = await supabase.auth.signInWithPassword({
    email: resolved.email,
    password,
  });

  if (error) {
    await recordAnonymousAuthEvent({
      action: 'auth.connexion_refusee',
      metadata: { motif: 'identifiants_invalides' },
    });
    return authError(AUTH_MESSAGES.invalidCredentials);
  }

  // La session existe désormais ; le contexte serveur décide de la suite.
  // `getAuthContext()` renvoie `null` si le profil n'est pas actif : un compte
  // suspendu, désactivé ou supprimé ne conserve pas sa session (§ 33-35, § 150).
  const context = await getAuthContext();

  if (!context) {
    await supabase.auth.signOut();
    await recordAnonymousAuthEvent({
      action: 'auth.connexion_refusee',
      metadata: { motif: 'compte_non_actif' },
    });
    return authError(AUTH_MESSAGES.accountUnavailable);
  }

  await Promise.all([
    stampLastLogin(context.userId),
    clearAttempts(AUTH_RATE_RULES.signInByIdentifier, resolved.email),
    recordAuthEvent({
      action: 'auth.connexion',
      metadata: { niveau: context.assuranceLevel, administrateur: context.isAdmin },
    }),
  ]);

  redirect(destinationAfterSignIn(context, requested || null));
}

/* ========================================================================== */
/*  Déconnexion                                                               */
/* ========================================================================== */

/**
 * Déconnexion réelle : la session est révoquée côté Supabase, pas seulement
 * oubliée côté navigateur (§ 51-52).
 *
 * `scope: 'global'` révoque toutes les sessions du compte. C'est le
 * comportement attendu d'un « me déconnecter » sur un poste partagé, et le
 * § 54 le recommande explicitement pour les comptes d'administration.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await getServerSupabaseClient();

  if (supabase) {
    await recordAuthEvent({ action: 'auth.deconnexion' });
    await supabase.auth.signOut({ scope: 'global' });
  }

  redirect(AUTH_ROUTES.signIn);
}

/* ========================================================================== */
/*  Inscription publique                                                      */
/* ========================================================================== */

/**
 * Création d'un compte client (décision D-9).
 *
 * Trois points structurent cette action.
 *
 * **Le rôle n'est jamais choisi.** Le formulaire ne comporte aucun champ de
 * rôle, et l'action n'en lit aucun : `CLIENT` est attribué côté serveur, après
 * création du compte. Même une requête forgée transportant `role=ADMIN`
 * n'aurait aucun effet, puisque la valeur n'est simplement pas lue. En base, le
 * déclencheur `user_roles_guard` interdit de toute façon à un compte de
 * s'attribuer un rôle à lui-même, quelle que soit sa permission.
 *
 * **Aucune métadonnée n'est relayée.** Seul le nom complet est transmis à
 * Supabase Auth. En particulier, `username` n'est jamais renseigné : un compte
 * créé publiquement ne peut donc pas revendiquer un identifiant
 * d'administrateur.
 *
 * **La réponse ne varie pas.** Adresse libre ou déjà utilisée, la personne est
 * conduite au même écran avec le même message (§ 127, § 171).
 */
export async function signUpAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = field(formData, 'email').trim().toLowerCase();
  const password = field(formData, 'mot_de_passe');
  const confirmation = field(formData, 'confirmation');
  const fullName = field(formData, 'nom').trim();
  const accepted = field(formData, 'conditions') === 'oui';

  if (looksAutomated(formData)) return authError(AUTH_MESSAGES.suspectedAutomation);

  if (!(await isPublicRegistrationEnabled())) {
    return authError(AUTH_MESSAGES.registrationClosed);
  }

  if (!email || !password || !fullName) return authError(AUTH_MESSAGES.missingFields);
  if (!accepted) return authError(AUTH_MESSAGES.termsRequired);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return authError(AUTH_MESSAGES.invalidEmail);
  if (password !== confirmation) return authError(AUTH_MESSAGES.passwordMismatch);
  if (password.length > PASSWORD_MAX_LENGTH) {
    return authError(AUTH_MESSAGES.missingFields, [
      `Restez en deçà de ${PASSWORD_MAX_LENGTH} caractères.`,
    ]);
  }

  const reasons = assessPassword(password, passwordContext({ email, fullName }));
  if (reasons.length > 0) {
    return authError('Ce mot de passe ne protégerait pas suffisamment votre compte.', reasons);
  }

  const address = await callerAddress();
  const quota = await consumeAttempt(AUTH_RATE_RULES.signUpByIp, address);
  if (!quota.allowed) {
    await recordAnonymousAuthEvent({
      action: 'auth.limite_atteinte',
      metadata: { parcours: 'inscription', portee: 'adresse' },
    });
    return authError(AUTH_MESSAGES.rateLimited);
  }

  const supabase = await getServerSupabaseClient();
  if (!supabase) return authError(AUTH_MESSAGES.unexpected);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Le lien de confirmation revient sur la route d'échange, qui décide
      // ensuite où conduire la personne.
      emailRedirectTo: `${getSiteUrl()}${AUTH_ROUTES.callback}?${NEXT_PARAM}=${encodeURIComponent(
        AUTH_ROUTES.clientArea,
      )}`,
      // `full_name` uniquement. Jamais `username`, jamais de rôle.
      data: { full_name: fullName },
    },
  });

  if (error) {
    // Y compris ici, la réponse reste neutre : un message d'erreur détaillé
    // dirait à un attaquant ce que Supabase a refusé, donc ce qu'il sait du
    // compte. Seule la limitation de fréquence est signalée telle quelle.
    if (error.status === 429) return authError(AUTH_MESSAGES.rateLimited);

    await recordAnonymousAuthEvent({
      action: 'auth.inscription',
      result: 'ECHEC',
      metadata: { motif: 'refus_service_authentification' },
    });
    redirect(AUTH_ROUTES.signUpPending);
  }

  /*
   * Détection d'une adresse déjà utilisée.
   *
   * Lorsque la confirmation par e-mail est active, Supabase renvoie, pour une
   * adresse déjà inscrite, un utilisateur factice dont la liste d'identités est
   * vide. C'est précisément le mécanisme qui empêche l'énumération : la réponse
   * ressemble en tout point à une inscription réussie. Nous l'exploitons dans
   * le même esprit — ne rien faire de plus, et surtout ne rien dire.
   */
  const isNewAccount = (data.user?.identities?.length ?? 0) > 0;

  if (isNewAccount && data.user) {
    await grantClientRole(data.user.id);
    await recordAnonymousAuthEvent({
      action: 'auth.inscription',
      result: 'SUCCES',
      actorId: data.user.id,
      metadata: { role: 'CLIENT', confirmation_requise: true },
    });
  }

  redirect(AUTH_ROUTES.signUpPending);
}

/**
 * Attribue le rôle `CLIENT`, côté serveur et uniquement côté serveur.
 *
 * Le rôle est lu en base, jamais codé en dur : le jour où l'administration
 * renommera ou complétera les rôles, cette fonction suivra sans modification.
 *
 * La clé à privilèges est nécessaire ici : la personne n'a pas encore de
 * session — son adresse n'est pas confirmée — et aucune politique RLS
 * n'autorise l'insertion d'un rôle sans la permission `users.update`. C'est
 * l'usage « provisionnement » prévu par `src/lib/supabase/admin.ts`.
 */
async function grantClientRole(userId: string): Promise<void> {
  try {
    const client = getAdminSupabaseClient();
    if (!client) return;

    const { data: role, error } = await client
      .from('roles')
      .select('id')
      .eq('code', 'CLIENT')
      .maybeSingle();

    if (error || !role) return;

    await client
      .from('user_roles')
      .upsert(
        { user_id: userId, role_id: role.id },
        { onConflict: 'user_id,role_id', ignoreDuplicates: true },
      );

    // Ceinture et bretelles : un compte créé publiquement ne porte aucun
    // identifiant métier. Le déclencheur `handle_new_auth_user` n'en pose un
    // que s'il figure dans les métadonnées, ce que cette action ne fait jamais ;
    // cette remise à zéro couvre le cas d'un appel forgé directement contre
    // l'API d'authentification.
    await client.from('profiles').update({ username: null }).eq('id', userId);
  } catch {
    // Le compte existe, la confirmation part : le rôle sera réparé par
    // l'administration. Mieux vaut un compte sans rôle qu'un parcours cassé.
  }
}

/* ========================================================================== */
/*  Mot de passe oublié                                                       */
/* ========================================================================== */

/**
 * Demande de réinitialisation.
 *
 * Réponse identique dans tous les cas (§ 21-22) : adresse connue, adresse
 * inconnue, identifiant métier sans adresse rattachée.
 */
export async function requestPasswordResetAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const identifier = field(formData, 'identifiant');

  if (looksAutomated(formData)) return authError(AUTH_MESSAGES.suspectedAutomation);
  if (!identifier.trim()) return authError(AUTH_MESSAGES.missingFields);

  const address = await callerAddress();

  const byIp = await consumeAttempt(AUTH_RATE_RULES.passwordResetByIp, address);
  if (!byIp.allowed) return authError(AUTH_MESSAGES.rateLimited);

  const resolved = await resolveLoginIdentifier(identifier);

  if (resolved.kind !== 'invalid') {
    const byIdentifier = await consumeAttempt(
      AUTH_RATE_RULES.passwordResetByIdentifier,
      resolved.email,
    );

    if (byIdentifier.allowed) {
      const supabase = await getServerSupabaseClient();

      if (supabase) {
        // L'erreur éventuelle est volontairement ignorée : la faire remonter
        // distinguerait une adresse connue d'une adresse inconnue.
        await supabase.auth.resetPasswordForEmail(resolved.email, {
          redirectTo:
            `${getSiteUrl()}${AUTH_ROUTES.callback}` +
            `?${NEXT_PARAM}=${encodeURIComponent(AUTH_ROUTES.resetPassword)}`,
        });
      }
    }

    await recordAnonymousAuthEvent({
      action: 'auth.reinitialisation_demandee',
      result: 'SUCCES',
      metadata: { parcours: 'mot_de_passe_oublie' },
    });
  }

  return authOk(AUTH_MESSAGES.resetRequested);
}

/* ========================================================================== */
/*  Définition d'un nouveau mot de passe                                      */
/* ========================================================================== */

/**
 * Changement de mot de passe d'un compte connecté.
 *
 * Sert trois parcours : le changement obligatoire à la première connexion, le
 * changement volontaire, et la fin du parcours de réinitialisation — où la
 * session provient du lien reçu par e-mail.
 *
 * Le mot de passe actuel est demandé lorsqu'il est connu de la personne
 * (§ 24) ; il ne l'est pas après un lien de réinitialisation, puisque c'est
 * précisément ce qu'elle a oublié. Le champ est alors absent du formulaire, et
 * la possession du lien fait office de preuve.
 */
export async function updatePasswordAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const current = field(formData, 'mot_de_passe_actuel');
  const password = field(formData, 'nouveau_mot_de_passe');
  const confirmation = field(formData, 'confirmation');

  if (!password || !confirmation) return authError(AUTH_MESSAGES.missingFields);
  if (password !== confirmation) return authError(AUTH_MESSAGES.passwordMismatch);
  if (password.length > PASSWORD_MAX_LENGTH) {
    return authError('Ce mot de passe ne protégerait pas suffisamment votre compte.', [
      `Restez en deçà de ${PASSWORD_MAX_LENGTH} caractères.`,
    ]);
  }

  const context = await getAuthContext();
  if (!context) return authError(AUTH_MESSAGES.sessionRequired);

  const quota = await consumeAttempt(AUTH_RATE_RULES.passwordChangeByUser, context.userId);
  if (!quota.allowed) return authError(AUTH_MESSAGES.rateLimited);

  const reasons = assessPassword(
    password,
    passwordContext({
      username: context.profile.username,
      email: context.email,
      fullName: context.profile.full_name,
    }),
  );

  if (reasons.length > 0) {
    return authError('Ce mot de passe ne protégerait pas suffisamment votre compte.', reasons);
  }

  const supabase = await getServerSupabaseClient();
  if (!supabase) return authError(AUTH_MESSAGES.unexpected);

  // Réauthentification volontaire (§ 114) lorsque le mot de passe actuel est
  // demandé. Une session ouverte sur un poste laissé sans surveillance ne doit
  // pas suffire à changer le mot de passe du compte.
  if (current) {
    if (current === password) return authError(AUTH_MESSAGES.passwordUnchanged);
    if (!context.email) return authError(AUTH_MESSAGES.unexpected);

    const { error: reauth } = await supabase.auth.signInWithPassword({
      email: context.email,
      password: current,
    });

    if (reauth) return authError('Le mot de passe actuel n’est pas correct.');
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    // Supabase refuse notamment un mot de passe identique au précédent.
    return authError(
      'Ce mot de passe n’a pas été accepté. Choisissez-en un autre, différent du précédent.',
    );
  }

  // Lève l'obligation de changement. La fonction ne manipule aucun secret :
  // elle n'écrit que deux horodatages (migration 0001 § 9.4).
  await supabase.rpc('mark_password_changed');
  await recordAuthEvent({ action: 'auth.mot_de_passe_modifie' });

  return authOk(AUTH_MESSAGES.passwordUpdated);
}

/* ========================================================================== */
/*  Double authentification (TOTP)                                            */
/* ========================================================================== */

/**
 * Démarre l'enrôlement d'un facteur TOTP.
 *
 * Les facteurs non vérifiés antérieurs sont retirés avant d'en créer un
 * nouveau : sans ce ménage, chaque affichage de la page laisserait derrière lui
 * un facteur inachevé, jusqu'à saturer le quota du compte.
 *
 * Le secret renvoyé n'est ni journalisé, ni enregistré en base : il transite
 * une seule fois vers l'écran de la personne qui l'enrôle, ce qui est la
 * définition même de l'opération.
 */
export async function startTotpEnrolmentAction(
  previous: MfaEnrolmentState,
): Promise<MfaEnrolmentState> {
  // Un enrôlement déjà préparé n'est pas recommencé : produire un second secret
  // invaliderait celui que la personne vient peut-être de scanner.
  if (previous.factorId) return previous;

  const context = await getAuthContext();
  if (!context) return { ...authError(AUTH_MESSAGES.sessionRequired) };

  const quota = await consumeAttempt(AUTH_RATE_RULES.mfaByUser, context.userId);
  if (!quota.allowed) return { ...authError(AUTH_MESSAGES.rateLimited) };

  const supabase = await getServerSupabaseClient();
  if (!supabase) return { ...authError(AUTH_MESSAGES.unexpected) };

  const { data: existing } = await supabase.auth.mfa.listFactors();

  for (const factor of existing?.all ?? []) {
    if (factor.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Application d’authentification — ${new Date().toISOString().slice(0, 10)}`,
  });

  if (error || !data) {
    return { ...authError('L’enrôlement n’a pas pu démarrer. Réessayez dans un instant.') };
  }

  return {
    status: 'idle',
    message: '',
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/** Six chiffres, éventuellement séparés par des espaces à la saisie. */
function readTotpCode(formData: FormData): string | null {
  const code = field(formData, 'code').replace(/\s+/g, '');
  return /^[0-9]{6}$/.test(code) ? code : null;
}

/**
 * Confirme l'enrôlement : le facteur ne devient « vérifié » qu'après
 * présentation d'un code réellement produit par l'application.
 */
export async function confirmTotpEnrolmentAction(
  previous: MfaEnrolmentState,
  formData: FormData,
): Promise<MfaEnrolmentState> {
  const factorId = field(formData, 'facteur') || previous.factorId;
  const code = readTotpCode(formData);

  if (!factorId) return { ...previous, ...authError(AUTH_MESSAGES.unexpected) };
  if (!code) return { ...previous, ...authError(AUTH_MESSAGES.mfaCodeFormat) };

  const context = await getAuthContext();
  if (!context) return { ...authError(AUTH_MESSAGES.sessionRequired) };

  const quota = await consumeAttempt(AUTH_RATE_RULES.mfaByUser, context.userId);
  if (!quota.allowed) return { ...previous, ...authError(AUTH_MESSAGES.rateLimited) };

  const supabase = await getServerSupabaseClient();
  if (!supabase) return { ...previous, ...authError(AUTH_MESSAGES.unexpected) };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });

  if (error) return { ...previous, ...authError(AUTH_MESSAGES.mfaCodeInvalid) };

  await clearAttempts(AUTH_RATE_RULES.mfaByUser, context.userId);
  await recordAuthEvent({ action: 'auth.double_facteur_enrole' });

  // La session est désormais AAL2 : l'administration devient accessible.
  redirect(context.isAdmin ? AUTH_ROUTES.adminArea : AUTH_ROUTES.clientArea);
}

/**
 * Présente le second facteur pour une session déjà authentifiée.
 *
 * C'est l'étape qui fait passer la session de `AAL1` à `AAL2`. Sans elle,
 * l'administration reste fermée, y compris par URL directe : le garde serveur
 * relit le niveau d'assurance à chaque requête.
 */
export async function verifyTotpChallengeAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const code = readTotpCode(formData);
  const requested = safeInternalPath(field(formData, NEXT_PARAM), '');

  if (!code) return authError(AUTH_MESSAGES.mfaCodeFormat);

  const context = await getAuthContext();
  if (!context) return authError(AUTH_MESSAGES.sessionRequired);

  const quota = await consumeAttempt(AUTH_RATE_RULES.mfaByUser, context.userId);
  if (!quota.allowed) {
    await recordAuthEvent({
      action: 'auth.limite_atteinte',
      result: 'REFUS',
      metadata: { parcours: 'double_facteur' },
    });
    return authError(AUTH_MESSAGES.rateLimited);
  }

  const factor = context.totpFactors[0];
  if (!factor) redirect(AUTH_ROUTES.mfaSettings);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return authError(AUTH_MESSAGES.unexpected);

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });

  if (error) {
    await recordAuthEvent({
      action: 'auth.double_facteur_verifie',
      result: 'REFUS',
      metadata: { motif: 'code_refuse' },
    });
    return authError(AUTH_MESSAGES.mfaCodeInvalid);
  }

  await clearAttempts(AUTH_RATE_RULES.mfaByUser, context.userId);
  await recordAuthEvent({ action: 'auth.double_facteur_verifie' });

  const fallback = context.isAdmin ? AUTH_ROUTES.adminArea : AUTH_ROUTES.clientArea;
  redirect(safeInternalPath(requested, fallback));
}

/**
 * Retire un facteur vérifié.
 *
 * Refusé lorsque ce serait le dernier facteur d'un compte soumis à la double
 * authentification obligatoire : le § 9 du cadrage demande qu'un
 * `SUPER_ADMIN` ne puisse pas se mettre lui-même en difficulté par une fausse
 * manœuvre. Remplacer un téléphone reste possible — enrôler le nouveau, puis
 * retirer l'ancien.
 *
 * L'opération exige une session `AAL2`, vérifiée côté serveur : un mot de passe
 * volé ne suffit pas à désarmer la protection.
 */
export async function removeTotpFactorAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const factorId = field(formData, 'facteur');
  if (!factorId) return authError(AUTH_MESSAGES.unexpected);

  const context = await getAuthContext();
  if (!context) return authError(AUTH_MESSAGES.sessionRequired);

  if (context.assuranceLevel !== 'aal2') {
    return authError('Présentez d’abord votre second facteur pour modifier cette protection.');
  }

  if (!context.totpFactors.some((factor) => factor.id === factorId)) {
    return authError(AUTH_MESSAGES.unexpected);
  }

  if (!canRemoveFactor(context)) {
    return authError(AUTH_MESSAGES.mfaRemovalRefused);
  }

  const supabase = await getServerSupabaseClient();
  if (!supabase) return authError(AUTH_MESSAGES.unexpected);

  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return authError(AUTH_MESSAGES.unexpected);

  await recordAuthEvent({ action: 'auth.double_facteur_retire' });

  return authOk(AUTH_MESSAGES.mfaFactorRemoved);
}
