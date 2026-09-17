import 'server-only';

/**
 * Identifiant de connexion : du libellé saisi à l'adresse technique.
 *
 * Décision D-4, tranchée en phase 4A et reconduite : **les administrateurs se
 * connectent avec leur identifiant métier** (`rachade`), pas avec l'adresse
 * e-mail que Supabase Auth utilise en coulisse. Les clients, eux, se
 * connectent avec leur adresse — c'est celle qu'ils ont fournie à
 * l'inscription, et la seule qu'ils connaissent.
 *
 * Un seul champ accepte donc les deux formes. La règle de distinction est
 * mécanique : une valeur contenant `@` est une adresse, toute autre valeur est
 * un identifiant.
 *
 * ## Pourquoi une résolution en base plutôt qu'une convention
 *
 * Construire l'adresse par concaténation — `rachade` + `@morashawiri.com` —
 * serait plus simple, et c'est d'ailleurs ce que fait le script de
 * provisionnement. Mais cela graverait dans le code une correspondance que le
 * § 4 du cadrage demande explicitement de pouvoir défaire :
 *
 *   « Prévoir une architecture qui permettra ultérieurement de rattacher une
 *     vraie adresse email de récupération sans casser l'identifiant métier. »
 *
 * La résolution passe donc par `profiles.username`, qui est la source de
 * vérité. Le jour où `rachade` rattachera son adresse personnelle, sa connexion
 * continuera de fonctionner avec `rachade`, sans modification de code ni de
 * variable d'environnement.
 *
 * ## Pourquoi la clé à privilèges
 *
 * La correspondance identifiant → adresse doit être lue **avant** toute
 * session : personne n'est encore authentifié, et RLS interdit — à juste titre
 * — de lire le profil d'autrui. C'est l'un des trois usages autorisés de la
 * clé secrète, énumérés dans `src/lib/supabase/admin.ts`. La lecture est
 * strictement bornée : un identifiant en entrée, une adresse en sortie, jamais
 * de liste.
 *
 * ## Pourquoi un identifiant inconnu ne renvoie pas `null`
 *
 * `04_AUTHENTIFICATION.md` § 101 et § 172 demandent de limiter l'énumération et
 * d'éviter « des différences de comportement permettant de déduire facilement
 * si un compte existe ». Si un identifiant inconnu court-circuitait l'appel à
 * Supabase, la réponse reviendrait nettement plus vite que pour un identifiant
 * connu, et la différence se mesurerait. Une adresse de substitution, dans le
 * domaine réservé `.invalid` (RFC 2606, garanti non résolvable), est donc
 * transmise : Supabase répond « identifiants incorrects » par le même chemin,
 * au même coût.
 */

import { getAdminSupabaseClient } from '@/lib/supabase/admin';

/** Même règle que la contrainte `profiles_username_format` (migration 0001). */
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Contrôle volontairement permissif : la validation réelle est faite par Supabase. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Domaine réservé aux adresses de substitution.
 * `.invalid` ne peut être ni enregistré ni résolu : aucune adresse construite
 * ici ne peut désigner une boîte réelle.
 */
const UNRESOLVABLE_DOMAIN = 'identifiant.invalid';

export type LoginIdentifier =
  | { kind: 'email'; value: string; email: string; username: null }
  | { kind: 'username'; value: string; email: string; username: string }
  | { kind: 'invalid'; value: string; email: null; username: null };

export function isEmailLike(value: string): boolean {
  return value.includes('@');
}

export function normaliseIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Vrai si la valeur respecte le format d'un identifiant métier. */
export function isUsernameFormat(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

export function isEmailFormat(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

/**
 * Traduit ce que la personne a saisi en adresse exploitable par Supabase Auth.
 *
 * Ne révèle jamais si le compte existe : le type de retour est identique pour
 * un identifiant connu et pour un identifiant inconnu.
 */
export async function resolveLoginIdentifier(raw: string): Promise<LoginIdentifier> {
  const value = normaliseIdentifier(raw);

  if (value.length === 0) {
    return { kind: 'invalid', value, email: null, username: null };
  }

  if (isEmailLike(value)) {
    return isEmailFormat(value)
      ? { kind: 'email', value, email: value, username: null }
      : { kind: 'invalid', value, email: null, username: null };
  }

  if (!isUsernameFormat(value)) {
    return { kind: 'invalid', value, email: null, username: null };
  }

  const resolved = await lookupEmailForUsername(value);

  return {
    kind: 'username',
    value,
    email: resolved ?? `${value}@${UNRESOLVABLE_DOMAIN}`,
    username: value,
  };
}

/**
 * Adresse technique associée à un identifiant métier, ou `null`.
 *
 * Deux lectures, toutes deux bornées à un compte : le profil porte
 * l'identifiant, `auth.users` porte l'adresse. Les deux tables restent
 * séparées, conformément au § 2 de la migration 0001.
 */
async function lookupEmailForUsername(username: string): Promise<string | null> {
  const client = getAdminSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('profiles')
      .select('id')
      .eq('username', username)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) return null;

    const { data: authUser, error: authError } = await client.auth.admin.getUserById(data.id);
    if (authError || !authUser.user?.email) return null;

    return authUser.user.email.toLowerCase();
  } catch {
    // Panne de lecture : traitée comme un identifiant inconnu. Le parcours
    // échoue par le même chemin, sans message distinctif.
    return null;
  }
}

/**
 * Libellé affiché à un compte connecté.
 *
 * § 4 du cadrage : « L'adresse technique utilisée en coulisse par Supabase Auth
 * ne doit pas être affichée comme identifiant public. » Un administrateur voit
 * donc `rachade`, jamais `rachade@…`. Un client, qui n'a pas d'identifiant
 * métier, voit son adresse — c'est bien celle avec laquelle il se connecte.
 */
export function displayIdentity(profile: { username: string | null; full_name: string | null },
  email: string | null): string {
  return profile.username ?? profile.full_name ?? email ?? 'Compte';
}
