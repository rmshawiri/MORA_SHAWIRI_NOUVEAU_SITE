'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Close } from '@/components/ui/Icon';
import { legalDocuments, type LegalKey } from '@/content/legal';

const FOCUSABLE = 'button, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Liens « Mentions légales » et « Confidentialité » du pied de page, avec leur
 * fenêtre modale. Comportement repris de l'ébauche : ouverture au clic,
 * fermeture par Échap ou clic hors panneau, piège de focus et restitution du
 * focus au déclencheur.
 */
export default function LegalLinks() {
  const [openKey, setOpenKey] = useState<LegalKey | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const open = (key: LegalKey) => {
    lastFocused.current = document.activeElement as HTMLElement | null;
    setOpenKey(key);
  };

  const close = useCallback(() => {
    setOpenKey(null);
    lastFocused.current?.focus();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('modal-open', openKey !== null);
    return () => document.body.classList.remove('modal-open');
  }, [openKey]);

  useEffect(() => {
    if (!openKey) return;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) return;

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openKey, close]);

  const doc = openKey ? legalDocuments[openKey] : null;

  return (
    <>
      <nav aria-label="Informations légales">
        <button type="button" onClick={() => open('legal')}>
          Mentions légales
        </button>
        <button type="button" onClick={() => open('privacy')}>
          Confidentialité
        </button>
      </nav>

      <div
        className={`modal${doc ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-hidden={doc ? undefined : true}
        onMouseDown={(event) => {
          if (!panelRef.current?.contains(event.target as Node)) close();
        }}
      >
        <div className="modal__panel" ref={panelRef}>
          <div className="modal__head">
            <div>
              <h2 id="modal-title">{doc?.title ?? ''}</h2>
              <p>{doc?.updated ?? ''}</p>
            </div>
            <button className="modal__close" type="button" aria-label="Fermer" ref={closeRef} onClick={close}>
              <Close />
            </button>
          </div>
          <div className="modal__body" tabIndex={0}>
            {doc?.body}
          </div>
          <div className="modal__foot">{doc?.foot ?? ''}</div>
        </div>
      </div>
    </>
  );
}
