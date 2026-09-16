import type { CSSProperties } from 'react';

export type Step = { title: string; text: string };

/** Étapes numérotées horizontales (numérotation générée en CSS). */
export default function Steps({
  items,
  style,
}: {
  items: readonly Step[];
  style?: CSSProperties;
}) {
  return (
    <ol className="steps" style={style}>
      {items.map((step) => (
        <li className="steps__item" key={step.title}>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
        </li>
      ))}
    </ol>
  );
}
