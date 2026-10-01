/**
 * Erreur d'envoi réduite à ce qui peut être écrit dans le journal des e-mails.
 *
 * Module pur, séparé de `send.ts` (réservé au serveur) pour être vérifié par
 * les tests : aucune adresse, aucun identifiant, aucun mot qui ressemble à un
 * secret ne doit atteindre la base.
 */

/** Réduit une erreur d'envoi à ce qu'on peut écrire sans risque. */
export function sanitizeSmtpError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  const message = error instanceof Error ? error.message : String(error);
  const cleaned = message
    .replace(/\S+@\S+/g, '[adresse]')
    .replace(/(pass(word)?|mot de passe|secret|token|auth)\S*/gi, '[masqué]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
  return [code, cleaned].filter(Boolean).join(' — ').slice(0, 300) || 'Erreur d’envoi';
}
