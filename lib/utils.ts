/**
 * Petite boîte à outils sans dépendance.
 */

/** Combine des noms de classes (filtre les valeurs falsy) sans dépendance externe. */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}

/** Normalise un nom de fichier pour un nom de fichier sûr (moteur de documents). */
export function normalizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** Génère un slug d'URL sûr et lisible à partir d'un libellé. */
export function slugify(input: string): string {
  return normalizeFileName(input.replace(/&/g, " et "));
}
