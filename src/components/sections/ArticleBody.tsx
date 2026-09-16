import { Fragment } from 'react';
import type { ArticleBlock, Inline } from '@/content/article-bodies';

/** Rend une suite de segments inline (texte, gras, italique). */
function renderInline(content: readonly Inline[]) {
  return content.map((segment, index) => {
    if (typeof segment === 'string') return <Fragment key={index}>{segment}</Fragment>;
    if ('b' in segment) return <strong key={index}>{segment.b}</strong>;
    return <em key={index}>{segment.i}</em>;
  });
}

/**
 * Corps d'un article de blog.
 * Rendu à partir de blocs typés — aucune injection de HTML brut.
 */
export default function ArticleBody({ blocks }: { blocks: readonly ArticleBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'h2':
            return <h2 key={index}>{block.text}</h2>;
          case 'h3':
            return <h3 key={index}>{block.text}</h3>;
          case 'p':
            return <p key={index}>{renderInline(block.content)}</p>;
          case 'ul':
            return (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          case 'note':
            return (
              <div className="article__note" key={index}>
                <p>{renderInline(block.content)}</p>
              </div>
            );
        }
      })}
    </>
  );
}
