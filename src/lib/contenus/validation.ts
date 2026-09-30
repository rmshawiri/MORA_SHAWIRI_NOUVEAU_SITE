/**
 * Validation des contenus lus en base, avant rendu.
 *
 * ## Pourquoi valider une donnée écrite par un administrateur
 *
 * La tentation serait de faire confiance : ces lignes ne viennent pas d'un
 * visiteur, elles viennent de l'administration, derrière une session à double
 * facteur et une permission. Trois raisons l'interdisent quand même.
 *
 *   1. **Le compilateur ne garantit plus rien.** Tant que ces textes vivaient
 *      dans `src/content/*.ts`, TypeScript refusait un champ manquant ou une
 *      icône inexistante. La phase 4E-2 retire cette garantie — il faut donc la
 *      remplacer, sans quoi la phase rendrait le site plus fragile qu'avant.
 *      C'est le même raisonnement que les contraintes de la migration, du côté
 *      applicatif cette fois.
 *   2. **Un champ absent casserait une page publique.** Un `jsonb` sans son
 *      `title` produirait `undefined` dans un `<h2>`. La validation transforme
 *      cet accident en **repli silencieux sur la valeur du code** : la page
 *      reste complète.
 *   3. **Un lien est une surface.** Le § 18 du module autorise les liens
 *      externes, mais rien n'oblige à accepter `javascript:` ou `data:`. Aucune
 *      des listes administrables n'a besoin d'un lien externe aujourd'hui ;
 *      la contrainte est donc fermée plutôt qu'ouverte « au cas où ».
 *
 * ## Le principe retenu partout
 *
 * **Une valeur invalide n'est jamais rendue et ne casse jamais la page : elle
 * est écartée, et le code reprend la main.** Le repli est donc granulaire — un
 * bloc fautif ne fait pas retomber toute la page sur ses valeurs par défaut.
 *
 * Référence : `07_GESTION_CONTENUS.md` § 16-19, § 98-100 ;
 * `07_ARCHITECTURE_TECHNIQUE/03_SECURITE.md`.
 */

import type { ListShape } from '@/content/blocks';

/* ------------------------------------------------------------------ outils --- */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

/**
 * Lien accepté dans un contenu administrable.
 *
 * Fermé volontairement à l'interne : un chemin absolu du site, éventuellement
 * suivi d'une ancre. Ce que cela écarte est plus important que ce que cela
 * autorise — `javascript:`, `data:`, `vbscript:`, mais aussi `//evil.tld` qui
 * est un lien protocole-relatif vers un autre domaine, et que bien des
 * contrôles naïfs laissent passer parce qu'il « commence par une barre ».
 */
export function isSafeInternalHref(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  if (value.startsWith('#')) return !value.includes('/');
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  // Ni retour arrière, ni caractère de contrôle, ni espace.
  if (value.includes('..')) return false;
  return /^\/[A-Za-z0-9\-._~/]*(#[A-Za-z0-9\-._~]+)?$/.test(value);
}

/* ------------------------------------------------------ icônes disponibles --- */

/**
 * Jeux d'icônes **fermés**. Une icône est un composant React choisi par le
 * code : la base ne transporte qu'un nom, jamais un fichier ni un chemin. Un
 * nom inconnu fait écarter l'élément, plutôt que de rendre une carte sans
 * pictogramme.
 */
export const EXPERTISE_ICONS = [
  'globe',
  'cart',
  'palette',
  'chart',
  'folder',
  'graduation',
] as const;

export const ENGAGEMENT_ICONS = ['shield', 'compass', 'handshake', 'sparkles'] as const;

export type ExpertiseIcon = (typeof EXPERTISE_ICONS)[number];
export type EngagementIcon = (typeof ENGAGEMENT_ICONS)[number];

/* -------------------------------------------------- blocs de texte (objet) --- */

/**
 * Champs attendus par nature de bloc. `lead` est facultatif pour une section :
 * plusieurs n'en portent pas, et en exiger un obligerait à inventer un texte
 * — ce que le § 134 interdit.
 */
const REQUIRED_TEXT_FIELDS: Record<string, readonly string[]> = {
  HERO: ['eyebrow', 'title', 'lead'],
  PAGE_HERO: ['eyebrow', 'title', 'lead'],
  SECTION: ['eyebrow', 'title'],
  CTA: ['title', 'text', 'primaryLabel', 'whatsappMessage'],
};

const OPTIONAL_TEXT_FIELDS: Record<string, readonly string[]> = {
  HERO: [],
  PAGE_HERO: [],
  SECTION: ['lead'],
  CTA: [],
};

/**
 * Valide une surcharge de bloc de texte.
 *
 * Renvoie l'objet nettoyé — **limité aux champs connus de la nature du bloc**.
 * Une clé étrangère glissée dans le `jsonb` est donc écartée plutôt que
 * transmise au composant : un composant React ignore les props inconnues, mais
 * s'appuyer sur cette indulgence serait accepter que la base pilote un jour
 * `className` ou `style`.
 */
export function validateTextFields(
  kind: string,
  value: unknown,
): Record<string, unknown> | null {
  const required = REQUIRED_TEXT_FIELDS[kind];
  const optional = OPTIONAL_TEXT_FIELDS[kind] ?? [];
  if (!required || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};

  for (const field of required) {
    if (!isNonEmptyString(source[field])) return null;
    cleaned[field] = source[field];
  }

  // `proof` est structurellement obligatoire pour un bandeau d'ouverture : le
  // composant rend exactement trois preuves, et en accepter un autre nombre
  // changerait la mise en page, que le point 17 du cadrage gèle.
  if (kind === 'HERO') {
    if (!isStringArray(source.proof) || source.proof.length !== 3) return null;
    cleaned.proof = source.proof;
  }

  for (const field of optional) {
    const candidate = source[field];
    if (candidate === undefined || candidate === null) continue;
    if (!isNonEmptyString(candidate)) return null;
    cleaned[field] = candidate;
  }

  return cleaned;
}

/* --------------------------------------------------------- listes (tableau) --- */

/**
 * Valide une surcharge de liste, élément par élément.
 *
 * Contrairement aux blocs de texte, la validation est **globale** : si un seul
 * élément est fautif, toute la liste est écartée. Rendre une liste amputée
 * serait plus trompeur qu'un repli complet — l'administrateur croirait avoir
 * publié six cartes alors que le site en montre cinq.
 */
export function validateListItems(shape: ListShape, value: unknown): unknown[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const cleaned: unknown[] = [];

  for (const item of value) {
    const validated = validateListItem(shape, item);
    if (validated === null) return null;
    cleaned.push(validated);
  }

  return cleaned;
}

function validateListItem(shape: ListShape, item: unknown): unknown | null {
  if (shape === 'TEXTE') {
    return isNonEmptyString(item) ? item : null;
  }

  if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
  const row = item as Record<string, unknown>;

  switch (shape) {
    case 'EXPERTISE': {
      if (!isNonEmptyString(row.id) || !isNonEmptyString(row.title)) return null;
      if (!isNonEmptyString(row.text)) return null;
      if (!EXPERTISE_ICONS.includes(row.icon as ExpertiseIcon)) return null;
      if (!isSafeInternalHref(row.href)) return null;
      return {
        id: row.id,
        icon: row.icon,
        title: row.title,
        text: row.text,
        href: row.href,
      };
    }

    case 'ENGAGEMENT': {
      if (!isNonEmptyString(row.title) || !isNonEmptyString(row.text)) return null;
      if (!ENGAGEMENT_ICONS.includes(row.icon as EngagementIcon)) return null;
      return { icon: row.icon, title: row.title, text: row.text };
    }

    case 'ETAPE': {
      if (!isNonEmptyString(row.title) || !isNonEmptyString(row.text)) return null;
      return { title: row.title, text: row.text };
    }

    case 'POURQUOI': {
      if (!isNonEmptyString(row.strong) || !isNonEmptyString(row.text)) return null;
      return { strong: row.strong, text: row.text };
    }

    case 'TEMOIGNAGE': {
      // Le § 134 interdit de fabriquer un témoignage ; la validation ne peut pas
      // vérifier qu'un avis est authentique, mais elle peut exiger qu'il soit
      // attribué — un témoignage sans nom ni rôle est une citation anonyme.
      if (!isNonEmptyString(row.initials) || !isNonEmptyString(row.name)) return null;
      if (!isNonEmptyString(row.role) || !isNonEmptyString(row.quote)) return null;
      return {
        initials: row.initials,
        name: row.name,
        role: row.role,
        quote: row.quote,
      };
    }

    default:
      return null;
  }
}

/* ------------------------------------------------- blocs typés d'un article --- */

/**
 * Valide le corps d'un article : une suite de blocs typés, au format déjà
 * utilisé par `src/content/article-bodies.ts`.
 *
 * Aucune balise n'est acceptée, donc aucune n'est à nettoyer. C'est tout
 * l'intérêt du format : le rendu (`ArticleBody.tsx`) construit `<h2>`, `<p>`,
 * `<ul>` et `<strong>` lui-même, à partir de types connus. Un bloc de type
 * inconnu est écarté — écarté et non rendu brut, ce qui serait la seule façon
 * d'introduire du HTML.
 */
export function validateArticleBody(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const cleaned: unknown[] = [];

  for (const block of value) {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) return null;
    const row = block as Record<string, unknown>;

    switch (row.type) {
      case 'h2':
      case 'h3': {
        if (!isNonEmptyString(row.text)) return null;
        cleaned.push({ type: row.type, text: row.text });
        break;
      }

      case 'p':
      case 'note': {
        const content = validateInlines(row.content);
        if (content === null) return null;
        cleaned.push({ type: row.type, content });
        break;
      }

      case 'ul': {
        if (!Array.isArray(row.items) || row.items.length === 0) return null;
        const items: unknown[] = [];
        for (const entry of row.items) {
          const inlines = validateInlines(entry);
          if (inlines === null) return null;
          items.push(inlines);
        }
        cleaned.push({ type: 'ul', items });
        break;
      }

      default:
        return null;
    }
  }

  return cleaned;
}

/** Segments d'un paragraphe : texte nu, gras (`b`) ou italique (`i`). */
function validateInlines(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const cleaned: unknown[] = [];

  for (const segment of value) {
    if (isNonEmptyString(segment)) {
      cleaned.push(segment);
      continue;
    }

    if (segment === null || typeof segment !== 'object' || Array.isArray(segment)) return null;
    const row = segment as Record<string, unknown>;

    if (isNonEmptyString(row.b)) {
      cleaned.push({ b: row.b });
      continue;
    }

    if (isNonEmptyString(row.i)) {
      cleaned.push({ i: row.i });
      continue;
    }

    return null;
  }

  return cleaned;
}
