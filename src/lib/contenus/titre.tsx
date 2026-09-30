import { Fragment, type ReactNode } from 'react';

/**
 * Rendu d'un titre administrable, avec mise en valeur d'un fragment.
 *
 * ## Pourquoi un marqueur plutôt que du balisage
 *
 * Deux titres du site portent un mot en doré. Avant la phase 4E-2 ils étaient
 * écrits directement en JSX :
 *
 *     Le Choix Optimal pour votre <span className="hl-gold">Performance</span>
 *
 * En les rendant administrables, il fallait choisir comment un administrateur
 * exprime cette mise en valeur. Trois voies existaient, et deux sont écartées :
 *
 *   * **accepter du HTML dans le champ** — il faudrait alors l'injecter avec
 *     `dangerouslySetInnerHTML` et le nettoyer. Un assainisseur est une liste
 *     de choses interdites : il faut la maintenir, et elle finit toujours par
 *     oublier un cas. Le § 98 et le § 100 du module s'y opposent ;
 *   * **stocker une suite de segments typés** — sûr, mais l'éditeur cesse
 *     d'être un simple champ texte, ce que le § 101 déconseille.
 *
 * D'où le marqueur `[[…]]`. La chaîne est **découpée**, jamais interprétée : ce
 * module construit lui-même le `<span>`. Aucune balise saisie ne peut atteindre
 * le DOM, donc **la surface XSS est nulle par construction, et non par
 * filtrage** — c'est le même raisonnement que les blocs typés du blog.
 *
 * Le rendu est rigoureusement celui d'avant : « texte », puis `<span>`, puis
 * « texte », dans l'ordre. C'est ce que la comparaison de non-régression
 * vérifie sur `/` et `/formation-prospection-relation-client/`.
 */

/** Reconnaît `[[fragment]]`, sans gourmandise pour supporter deux marqueurs. */
const HIGHLIGHT = /\[\[([^\]]+)\]\]/g;

/**
 * Transforme un titre en nœuds React.
 *
 * Une chaîne sans marqueur ressort inchangée — donc les 46 titres qui n'en
 * portent pas ne traversent aucune transformation, et leur HTML ne peut pas
 * bouger.
 */
export function renderTitre(titre: string): ReactNode {
  if (!titre.includes('[[')) return titre;

  const parts: ReactNode[] = [];
  let index = 0;
  let match: RegExpExecArray | null;

  // `lastIndex` est porté par l'expression : on la réinitialise, sinon un
  // second appel reprendrait où le précédent s'est arrêté.
  HIGHLIGHT.lastIndex = 0;

  while ((match = HIGHLIGHT.exec(titre)) !== null) {
    if (match.index > index) parts.push(titre.slice(index, match.index));

    parts.push(
      <span className="hl-gold" key={`hl-${match.index}`}>
        {match[1]}
      </span>,
    );

    index = match.index + match[0].length;
  }

  if (index < titre.length) parts.push(titre.slice(index));

  return (
    <>
      {parts.map((part, position) => (
        <Fragment key={position}>{part}</Fragment>
      ))}
    </>
  );
}

/**
 * Titre réduit à son texte, marqueurs retirés.
 *
 * Nécessaire partout où un titre ne peut pas être un nœud React : balise
 * `<title>`, `aria-label`, données structurées. Servir `[[Performance]]` à un
 * moteur de recherche serait une régression SEO silencieuse.
 */
export function titreEnTexte(titre: string): string {
  return titre.replace(HIGHLIGHT, '$1');
}
