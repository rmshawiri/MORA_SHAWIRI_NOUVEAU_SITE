'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { mainNav } from '@/lib/site';

/** Largeur au-delà de laquelle la navigation redevient horizontale (cf. CSS). */
const DESKTOP_QUERY = '(min-width: 1081px)';

/**
 * En-tête fixe : marque, navigation principale, actions.
 *
 * Reprend les trois comportements de l'ébauche :
 * 1. tiroir de navigation mobile (bouton hamburger, fermeture au clic et à Échap) ;
 * 2. état « collé » au défilement (`is-stuck`) ;
 * 3. barre de progression de lecture (`--scroll-progress`).
 */
export default function Header() {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [navOpen, setNavOpen] = useState(false);

  const closeNav = useCallback(() => setNavOpen(false), []);

  // `body.nav-open` verrouille le défilement sous le tiroir (règle CSS existante).
  useEffect(() => {
    document.body.classList.toggle('nav-open', navOpen);
    return () => document.body.classList.remove('nav-open');
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeNav();
      toggleRef.current?.focus();
    };

    const media = window.matchMedia(DESKTOP_QUERY);
    const onBreakpoint = (event: MediaQueryListEvent) => {
      if (event.matches) closeNav();
    };

    document.addEventListener('keydown', onKeyDown);
    media.addEventListener('change', onBreakpoint);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      media.removeEventListener('change', onBreakpoint);
    };
  }, [navOpen, closeNav]);

  // État collé + progression de lecture, recalculés sur une frame d'animation.
  useEffect(() => {
    let ticking = false;

    const update = () => {
      const header = headerRef.current;
      if (header) {
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        header.classList.toggle('is-stuck', y > 12);
        header.style.setProperty('--scroll-progress', max > 0 ? (y / max).toFixed(4) : '0');
      }
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [pathname]);

  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const actions = (
    <>
      <Link className="btn btn--light btn--quote" href="/contact/">
        Devis gratuit
      </Link>
      <Link className="btn btn--gold" href="/rendez-vous/">
        Prendre rendez-vous
      </Link>
    </>
  );

  return (
    <header className="site-header" ref={headerRef}>
      <div className="container header-inner">
        <Link className="brand" href="/" aria-label="MORA Shawiri — accueil">
          <Image
            src="/logo-circle.png"
            alt="MORA Shawiri"
            width={56}
            height={56}
            priority
            sizes="56px"
          />
        </Link>

        <button
          className="nav-toggle"
          type="button"
          ref={toggleRef}
          aria-expanded={navOpen}
          aria-controls="site-nav"
          aria-label={navOpen ? 'Fermer le menu de navigation' : 'Ouvrir le menu de navigation'}
          onClick={() => setNavOpen((open) => !open)}
        >
          <span />
        </button>

        {/* Tout clic sur un lien du tiroir le referme, quel que soit le lien. */}
        <nav
          className={`site-nav${navOpen ? ' is-open' : ''}`}
          id="site-nav"
          aria-label="Navigation principale"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) closeNav();
          }}
        >
          <ul>
            {mainNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={isCurrent(item.href) ? 'page' : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="header-actions">{actions}</div>
        </nav>

        <div className="header-actions header-actions--desktop">{actions}</div>
      </div>
    </header>
  );
}
