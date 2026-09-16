import type { CSSProperties, ReactNode } from 'react';
import { Check } from '@/components/ui/Icon';

type CheckListProps = {
  items: readonly ReactNode[];
  /** Variante claire, sur fond bleu de marque. */
  light?: boolean;
  style?: CSSProperties;
};

/** Liste à coches vertes (or sur fond de marque). */
export default function CheckList({ items, light = false, style }: CheckListProps) {
  return (
    <ul className={`check-list${light ? ' check-list--light' : ''}`} style={style}>
      {items.map((item, index) => (
        <li key={index}>
          <Check />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
