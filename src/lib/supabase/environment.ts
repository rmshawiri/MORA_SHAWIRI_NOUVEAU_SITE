/**
 * Résolution et contrôle de cohérence des environnements Supabase.
 *
 * `10_DEPLOIEMENT/00_SUPABASE.md` § 46-48 et `01_ARCHITECTURE_BASE_DE_DONNEES.md`
 * § 9-10 demandent de séparer développement et production, et de ne jamais
 * tester sur les données réelles.
 *
 * État actuel du projet : le plan Supabase retenu n'autorise qu'un seul projet.
 * La séparation est donc **différée**, pas abandonnée. Ce module l'exprime
 * explicitement plutôt que de la passer sous silence :
 *
 *   · `shared` — un projet unique sert tous les contextes. C'est la situation
 *     d'aujourd'hui, assumée et déclarée, et non un oubli de configuration.
 *   · `dev` / `prod` — deux projets distincts. Le jour où un second projet
 *     existe, il suffit de changer les valeurs des variables : aucune ligne de
 *     code ne bouge, et les règles de cohérence deviennent actives.
 *
 * Tant que le mode est `shared`, `isDatabaseIsolated()` renvoie `false`, ce qui
 * permet aux phases suivantes de refuser d'elles-mêmes les opérations qui
 * exigeraient une base jetable.
 *
 * Aucune valeur secrète n'est exposée ici. `NEXT_PUBLIC_SUPABASE_URL` et
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` sont publiques par construction ;
 * `SUPABASE_SECRET_KEY` n'est lue que par `admin.ts`, jamais dans ce fichier.
 */

/** Contexte d'exécution réel du code. */
export type RuntimeEnvironment = 'production' | 'preview' | 'development' | 'local';

/**
 * Projet Supabase déclaré par la configuration.
 *
 * `shared` : projet unique, séparation différée.
 * `dev` / `prod` : projets distincts, séparation effective.
 */
export type SupabaseEnvironment = 'dev' | 'prod' | 'shared';

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
  environment: SupabaseEnvironment;
};

function readOptional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Contexte d'exécution.
 *
 * `NEXT_PUBLIC_VERCEL_ENV` est renseignée automatiquement par Vercel et reste
 * lisible côté navigateur ; `VERCEL_ENV` prend le relais côté serveur. En
 * l'absence des deux — poste de travail, script Node, test — le contexte est
 * `local`. Un `next build` local n'est donc jamais considéré comme une
 * production, ce qui empêche un poste de développement d'exiger, puis
 * d'utiliser, les clés de production.
 */
export function getRuntimeEnvironment(): RuntimeEnvironment {
  const raw = readOptional('NEXT_PUBLIC_VERCEL_ENV') ?? readOptional('VERCEL_ENV');

  if (raw === 'production' || raw === 'preview' || raw === 'development') {
    return raw;
  }

  return 'local';
}

/** Vrai uniquement pour la production Vercel. */
export function isProductionRuntime(): boolean {
  return getRuntimeEnvironment() === 'production';
}

function parseSupabaseEnvironment(raw: string | undefined): SupabaseEnvironment | undefined {
  if (raw === 'dev' || raw === 'prod' || raw === 'shared') return raw;
  return undefined;
}

/**
 * Vrai lorsque le contexte courant dispose d'une base qui lui est propre.
 *
 * En mode `shared`, la réponse est `false` : toute opération destructive ou
 * massive doit alors être refusée par l'appelant, puisqu'elle porterait sur les
 * données réelles.
 */
export function isDatabaseIsolated(environment: SupabaseEnvironment): boolean {
  return environment !== 'shared';
}

/**
 * Vérifie l'accord entre le contexte d'exécution et le projet Supabase visé.
 *
 * Deux incohérences sont refusées :
 *   1. un contexte autre que la production pointant vers le projet `prod` —
 *      c'est le scénario « tester sur les données réelles » ;
 *   2. la production pointant vers le projet `dev` — les visiteurs liraient
 *      alors des données fictives.
 *
 * `shared` est accepté partout : c'est un choix d'infrastructure assumé, pas
 * une erreur de configuration. Le contrôle reprend tout son effet dès qu'un
 * second projet existe et que les valeurs passent à `dev` et `prod`.
 *
 * Le message ne contient ni URL, ni clé, ni identifiant de projet.
 */
export function describeEnvironmentMismatch(
  runtime: RuntimeEnvironment,
  supabase: SupabaseEnvironment,
): string | null {
  if (supabase === 'shared') return null;

  if (supabase === 'prod' && runtime !== 'production') {
    return (
      `Configuration refusée : le contexte « ${runtime} » pointe vers le projet Supabase de production. ` +
      'La base de production ne sert jamais d\'environnement de test. ' +
      'Corrigez NEXT_PUBLIC_SUPABASE_ENV et les clés associées pour cet environnement.'
    );
  }

  if (supabase === 'dev' && runtime === 'production') {
    return (
      'Configuration refusée : la production pointe vers le projet Supabase de développement. ' +
      'Corrigez NEXT_PUBLIC_SUPABASE_ENV et les clés associées de l\'environnement Production.'
    );
  }

  return null;
}

/**
 * Configuration publique Supabase, ou `null` lorsque Supabase n'est pas encore
 * configuré. Le site vitrine doit continuer de fonctionner sans base : renvoyer
 * `null` plutôt que lever est donc volontaire.
 *
 * En revanche, une configuration *présente mais incohérente* lève : c'est une
 * erreur de déploiement, pas une absence de configuration.
 */
export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const rawUrl = readOptional('NEXT_PUBLIC_SUPABASE_URL');
  const publishableKey = readOptional('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

  if (!rawUrl || !publishableKey) return null;

  // L'URL attendue est la racine du projet. Une valeur copiée depuis le
  // dashboard peut traîner un chemin (`/rest/v1/`) qui ferait échouer toutes
  // les requêtes avec un message obscur. On normalise plutôt que d'attendre la
  // panne — même traitement que `getSiteUrl()` dans `src/lib/env.ts`.
  let url: string;
  try {
    url = new URL(rawUrl).origin;
  } catch {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL n\'est pas une URL valide. ' +
        'Attendu : la racine du projet, par exemple https://<ref>.supabase.co',
    );
  }

  const environment = parseSupabaseEnvironment(readOptional('NEXT_PUBLIC_SUPABASE_ENV'));

  if (!environment) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ENV est absente ou invalide. ' +
        'Valeurs attendues : « shared » (projet unique), « dev » ou « prod ». ' +
        'Cette variable déclare explicitement quel projet Supabase les clés désignent.',
    );
  }

  const mismatch = describeEnvironmentMismatch(getRuntimeEnvironment(), environment);
  if (mismatch) throw new Error(mismatch);

  return { url, publishableKey, environment };
}

/**
 * Variante non levante, destinée aux diagnostics et aux composants qui doivent
 * pouvoir se rendre même mal configurés.
 */
export function getSupabasePublicConfigSafe(): SupabasePublicConfig | null {
  try {
    return getSupabasePublicConfig();
  } catch {
    return null;
  }
}

/** Vrai lorsque Supabase est configuré et cohérent avec le contexte. */
export function isSupabaseConfigured(): boolean {
  return getSupabasePublicConfigSafe() !== null;
}

/**
 * Vrai si le contexte courant dispose d'une base séparée de la production.
 *
 * Renvoie `false` en mode `shared`, et `false` également lorsque Supabase n'est
 * pas configuré : l'absence de réponse ne doit jamais valoir autorisation.
 */
export function hasIsolatedDatabase(): boolean {
  const config = getSupabasePublicConfigSafe();
  return config !== null && isDatabaseIsolated(config.environment);
}
