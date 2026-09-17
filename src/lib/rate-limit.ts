/**
 * Limitation de fréquence des routes publiques.
 *
 * Exigence documentaire : `03_SECURITE.md` § 30 (« les endpoints sensibles
 * doivent utiliser une limitation de fréquence appropriée ») et § 153
 * (« les formulaires publics doivent disposer d'une protection contre les abus
 * automatisés »). La route de contact déclenche un envoi SMTP à chaque appel
 * valide : un abus a donc un coût réel et peut faire blacklister le domaine
 * expéditeur.
 *
 * Mise en œuvre volontairement simple — fenêtre glissante en mémoire, sans
 * dépendance ni stockage externe. Portée réelle : l'instance serveur courante.
 * En environnement sans état partagé, plusieurs instances peuvent coexister ;
 * la protection reste efficace contre les rafales, qui proviennent d'une même
 * connexion. Une limitation distribuée relèvera de l'infrastructure lorsqu'une
 * base de données sera disponible.
 */

type Bucket = {
  /** Horodatages des requêtes retenues dans la fenêtre courante. */
  hits: number[];
};

const buckets = new Map<string, Bucket>();

/** Au-delà de cette taille, les entrées expirées sont purgées. */
const MAX_TRACKED_KEYS = 5000;

export type RateLimitResult = {
  allowed: boolean;
  /** Secondes à attendre avant une nouvelle tentative, si bloqué. */
  retryAfter: number;
};

/** Supprime les entrées dont toutes les requêtes sont sorties de la fenêtre. */
function sweep(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    const fresh = bucket.hits.filter((time) => now - time < windowMs);
    if (fresh.length === 0) buckets.delete(key);
    else bucket.hits = fresh;
  }
}

/**
 * Enregistre une tentative et indique si elle est autorisée.
 *
 * @param key     Identifiant de l'appelant (adresse IP en pratique).
 * @param limit   Nombre de requêtes autorisées dans la fenêtre.
 * @param windowMs Durée de la fenêtre glissante, en millisecondes.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_TRACKED_KEYS) sweep(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  const hits = bucket.hits.filter((time) => now - time < windowMs);

  if (hits.length >= limit) {
    const oldest = hits[0] ?? now;
    buckets.set(key, { hits });
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }

  hits.push(now);
  buckets.set(key, { hits });
  return { allowed: true, retryAfter: 0 };
}

/**
 * Identifie l'appelant à partir des en-têtes de la requête.
 *
 * Derrière le proxy de l'hébergeur, `x-forwarded-for` contient la chaîne des
 * relais : la première adresse est celle du client. Aucune adresse n'est
 * journalisée ni conservée au-delà de la fenêtre.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'inconnu';
}
