'use client';

import { useEffect, useState } from 'react';
import { ArrowUp, Whatsapp } from '@/components/ui/Icon';
import { whatsappLink } from '@/lib/site';

const DOCK_MESSAGE =
  'Bonjour MORA Shawiri, je visite votre site et j’aimerais discuter de mon projet.';

/** Seuil de défilement à partir duquel le retour en haut apparaît (ébauche). */
const TO_TOP_OFFSET = 700;

/**
 * Pastilles flottantes : retour en haut de page et accès direct à WhatsApp.
 */
export default function Dock() {
  const [showToTop, setShowToTop] = useState(false);

  useEffect(() => {
    let ticking = false;

    const update = () => {
      setShowToTop(window.scrollY > TO_TOP_OFFSET);
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <div className="dock">
      <button
        className={`to-top${showToTop ? ' is-visible' : ''}`}
        type="button"
        aria-label="Revenir en haut de la page"
        onClick={scrollToTop}
      >
        <ArrowUp />
      </button>
      <a
        className="dock__wa"
        href={whatsappLink(DOCK_MESSAGE)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Whatsapp />
        <span>Écrire sur WhatsApp</span>
      </a>
    </div>
  );
}
