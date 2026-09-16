'use client';

import { useState } from 'react';

export type FaqItem = { question: string; answer: string };

/**
 * Accordéon de questions fréquentes.
 *
 * Conserve le comportement de l'ébauche : une seule réponse ouverte à la fois.
 * S'appuie sur `<details>`/`<summary>` natifs — le contenu reste accessible au
 * clavier et lisible même si le JavaScript n'est pas exécuté.
 */
export default function Faq({ items }: { items: readonly FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="faq reveal">
      {items.map((item, index) => (
        <details
          key={item.question}
          open={openIndex === index}
          onToggle={(event) => {
            const isOpen = event.currentTarget.open;
            setOpenIndex((current) => (isOpen ? index : current === index ? null : current));
          }}
        >
          <summary>{item.question}</summary>
          <div className="faq__body">
            <p>{item.answer}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
