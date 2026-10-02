'use client';

import { useState } from 'react';

/**
 * Copier ou partager un lien d'affiliation.
 *
 * Partager un **lien** est ici le bon geste : c'est l'adresse elle-même qui
 * circule (le partage d'un vrai fichier PDF, lui, viendra avec les documents).
 * La feuille de partage native s'ouvre quand le navigateur la propose — sur
 * Android, WhatsApp y figure s'il est installé ; sinon, le lien est copié.
 */
export default function LinkCopyShare({ url, title }: { url: string; title: string }) {
  const [message, setMessage] = useState('');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Lien copié.');
    } catch {
      setMessage('La copie automatique est indisponible : sélectionnez le lien pour le copier.');
    }
  };

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        setMessage('');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await copy();
  };

  return (
    <div className="aff-link">
      <code className="aff-link__url">{url}</code>
      <div className="btn-row">
        <button type="button" className="btn btn--primary" onClick={copy}>
          Copier le lien
        </button>
        <button type="button" className="btn btn--ghost" onClick={share}>
          Partager
        </button>
      </div>
      <p className="aff-link__status" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
