'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Sélecteurs révélés au défilement (mêmes classes que l'ébauche). */
const TARGETS = '.reveal, .reveal-group, .steps__item';

/**
 * Révélation progressive des blocs au défilement.
 *
 * Monté une fois dans le layout, ce composant observe les éléments de la page
 * courante et rejoue l'observation à chaque navigation. Deux garde-fous repris
 * de l'ébauche évitent qu'un contenu reste invisible :
 * — un bloc plus haut que 1,5 écran est affiché immédiatement ;
 * — un filet de sécurité révèle après 1,2 s tout bloc déjà dans la fenêtre.
 *
 * `prefers-reduced-motion` désactive entièrement le mécanisme.
 */
export default function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(TARGETS));
    if (elements.length === 0) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const reveal = (element: HTMLElement) => element.classList.add('is-visible');

    if (reduced || !('IntersectionObserver' in window)) {
      elements.forEach(reveal);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -48px 0px', threshold: 0 },
    );

    elements.forEach((element) => {
      if (element.getBoundingClientRect().height > window.innerHeight * 1.5) {
        reveal(element);
        return;
      }
      observer.observe(element);
    });

    const safetyNet = window.setTimeout(() => {
      elements.forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) reveal(element);
      });
    }, 1200);

    return () => {
      window.clearTimeout(safetyNet);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
