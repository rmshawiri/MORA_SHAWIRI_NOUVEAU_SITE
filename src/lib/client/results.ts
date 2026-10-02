/**
 * Messages de résultat de l'espace client (phase 4I-3).
 *
 * Après une décision, la carte qui portait le formulaire disparaît (le devis
 * n'attend plus de réponse, le rendez-vous n'est plus annulable, il n'y a
 * plus rien à rattacher) : son message disparaîtrait avec elle. L'action
 * redirige donc vers la page avec `?resultat=<code>`, et la page affiche le
 * message. Liste fermée : aucun texte ne vient de l'adresse.
 */

export const CLIENT_RESULTS = {
  accepte: 'Vous avez accepté ce devis. Votre accord est transmis à MORA Shawiri, qui établira la commande.',
  refuse: 'Vous avez refusé ce devis. Votre décision est transmise à MORA Shawiri.',
  annule: 'Votre rendez-vous est annulé. MORA Shawiri en est informé.',
  rattachement: 'Les éléments envoyés avec votre adresse ont été rattachés à votre espace.',
} as const;

export type ClientResult = keyof typeof CLIENT_RESULTS;

export function clientResultMessage(value: unknown): string | null {
  return typeof value === 'string' && Object.hasOwn(CLIENT_RESULTS, value) ? CLIENT_RESULTS[value as ClientResult] : null;
}
