/**
 * Génération d'un code TOTP (RFC 6238), pour les tests uniquement.
 *
 * Les parcours de double authentification ne peuvent pas être vérifiés sans
 * produire de vrais codes : un test qui se contenterait d'appeler l'API sans
 * jamais présenter un code valide ne prouverait rien. Cette implémentation tient
 * en quelques lignes et évite d'ajouter une dépendance au projet pour un usage
 * strictement local.
 *
 * Elle n'est utilisée que par `scripts/verify-auth.mjs`, sur des comptes de
 * test éphémères. Aucun secret d'un compte réel ne passe par ici.
 */

import { createHmac } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Décode une chaîne base32 (RFC 4648), avec ou sans remplissage. */
export function base32Decode(input) {
  const cleaned = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Secret TOTP invalide : caractère hors alphabet base32.');

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Code à six chiffres pour l'instant donné.
 *
 * @param secret Secret base32 fourni par Supabase à l'enrôlement.
 * @param atMs   Horodatage, en millisecondes. Par défaut : maintenant.
 * @param step   Pas de temps, en secondes. 30 s est la valeur universelle.
 */
export function totpCode(secret, atMs = Date.now(), step = 30) {
  const counter = Math.floor(atMs / 1000 / step);

  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();

  // Troncature dynamique (RFC 4226 § 5.3).
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * Attend le début de la fenêtre suivante lorsque la courante expire bientôt.
 *
 * Sans cette précaution, un code produit à la dernière seconde d'une fenêtre
 * serait déjà périmé au moment où Supabase le vérifie, et le test échouerait
 * pour une raison qui n'a rien à voir avec le code testé.
 */
export async function waitForFreshWindow(step = 30, marginSeconds = 3) {
  const remaining = step - (Math.floor(Date.now() / 1000) % step);
  if (remaining > marginSeconds) return;

  await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1000));
}
