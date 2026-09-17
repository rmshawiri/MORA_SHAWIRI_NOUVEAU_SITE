/**
 * Résolution et contrôle de cohérence des environnements Supabase.
 *
 * Règle de la phase 4A : deux projets Supabase distincts, l'un pour le
 * développement, l'autre pour la production. La base de production ne doit
 * jamais servir d'environnement de test (`10_DEPLOIEMENT/00_SUPABASE.md` § 48,
 * `01_ARCHITECTURE_BASE_DE_DONNEES.md` § 9-10).
 *
 * Ce module transforme cette règle en garantie vérifiable : une configuration
 * qui ferait pointer un déploiement de prévisualisation vers la base de
 * production échoue explicitement au lieu de fonctionner silencieusement.
 *
 * Aucune valeur secrète n'est exposée ici. `NEXT_PUBLIC_SUPABASE_URL` et
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` sont publiques par construction ;
 * `SUPABASE_SECRET_KEY` n'est lue que par `admin.ts`, jamais dans ce fichier.
 */

/** Contexte d'exécution réel du code. */
export type RuntimeEnvironment = 'production' | 'preview' | 'development' | 'local';

/** Projet Supabase déclaré par la configuration. */
export type SupabaseEnvironment = 'dev' | 'prod';

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
  if (raw === 'dev' || raw === 'prod') return raw;
  return undefined;
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
 * Le message ne contient ni URL, ni clé, ni identifiant de projet.
 */
export function describeEnvironmentMismatch(
  runtime: RuntimeEnvironment,
  supabase: SupabaseEnvironment,
): string | null {
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
  const url = readOptional('NEXT_PUBLIC_SUPABASE_URL');
  const publishableKey = readOptional('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

  if (!url || !publishableKey) return null;

  const environment = parseSupabaseEnvironment(readOptional('NEXT_PUBLIC_SUPABASE_ENV'));

  if (!environment) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ENV est absente ou invalide. ' +
        'Valeurs attendues : « dev » ou « prod ». Cette variable déclare explicitement ' +
        'quel projet Supabase les clés désignent.',
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
