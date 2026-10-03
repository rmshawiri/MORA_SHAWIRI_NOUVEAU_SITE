/**
 * Quantité commandée d'une offre à prix défini (remarques 01, compteur des
 * remarques 02).
 *
 * Une seule définition pour le formulaire et pour la route serveur : le
 * compteur − / + du navigateur s'arrête aux mêmes bornes que celles que le
 * serveur fait respecter. Le navigateur ne fait qu'afficher ; c'est la route
 * qui décide.
 */

export const QUANTITY_MIN = 1;
export const QUANTITY_MAX = 99;

/** Ramène une quantité dans les bornes — usage du compteur, jamais du serveur. */
export function clampQuantity(value: number): number {
  return Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, Math.trunc(value)));
}

/**
 * Lit la quantité reçue par la route. Absente : 1, comme le compteur à
 * l'ouverture. Présente : un entier de 1 à 99 écrit en chiffres, sinon
 * `null` — la demande est alors refusée, et non corrigée en silence.
 */
export function parseQuantity(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return QUANTITY_MIN;
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,2}$/.test(text)) return null;
  const quantity = Number(text);
  return quantity >= QUANTITY_MIN && quantity <= QUANTITY_MAX ? quantity : null;
}
