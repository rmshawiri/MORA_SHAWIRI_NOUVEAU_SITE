export type TimelineEntry = { marker: string; title: string; text: string };

type TimelineProps = {
  items: readonly TimelineEntry[];
  /** Variante claire, sur fond bleu de marque. */
  light?: boolean;
  /** Classe de révélation : `reveal` pour l'ensemble, `reveal-group` par entrée. */
  revealClass?: 'reveal' | 'reveal-group';
};

/** Frise chronologique verticale. */
export default function Timeline({
  items,
  light = false,
  revealClass = 'reveal',
}: TimelineProps) {
  return (
    <ol className={`timeline${light ? ' timeline--light' : ''} ${revealClass}`}>
      {items.map((entry) => (
        <li className="timeline__item" key={entry.title}>
          <span className="timeline__dot" aria-hidden="true">
            {entry.marker}
          </span>
          <h3>{entry.title}</h3>
          <p>{entry.text}</p>
        </li>
      ))}
    </ol>
  );
}
