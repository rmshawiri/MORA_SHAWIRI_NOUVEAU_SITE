'use client';

import { useState } from 'react';

import { canShareFile, fetchDocumentFile, shareFile } from '@/lib/documents/share';

/**
 * Envoi d'une pièce officielle — le **vrai fichier PDF**, pas un lien.
 *
 * ## Ce que fait ce bouton
 *
 * Il récupère le PDF par la route authentifiée `/api/documents/<référence>/`
 * (la session du navigateur fait foi, RLS décide), en fait un fichier
 * `MORA-FACL-A0001.pdf` de type `application/pdf`, puis ouvre la **feuille de
 * partage native** de l'appareil avec ce fichier joint. WhatsApp y figure dès
 * qu'il est installé ; c'est la personne qui le choisit.
 *
 * ## Ce qu'il ne prétend pas faire
 *
 * Un navigateur ne peut pas imposer WhatsApp comme destination, et un lien
 * `wa.me/?text=…` ne transporte jamais de fichier. Ce bouton n'ouvre donc
 * aucun `wa.me` et ne dit jamais « envoyé sur WhatsApp ». Quand l'appareil ne
 * sait pas partager un fichier — la plupart des navigateurs d'ordinateur —, il
 * le dit, télécharge le PDF et explique comment le joindre dans WhatsApp.
 *
 * ## Pourquoi deux temps
 *
 * Safari n'autorise `navigator.share()` que pendant le geste de l'utilisateur.
 * Télécharger le PDF puis partager dans le même clic échoue dès que le réseau
 * est un peu lent. Le premier appui prépare le fichier ; le second le partage,
 * à l'intérieur de son propre geste.
 */

type Tone = { ok: string; error: string };

type State =
  | { step: 'idle' }
  | { step: 'preparing' }
  | { step: 'ready'; file: File }
  | { step: 'shared' }
  | { step: 'cancelled'; file: File }
  | { step: 'fallback'; url: string }
  | { step: 'error'; message: string };

const MESSAGES = {
  preparing: 'Préparation du PDF…',
  ready: 'Le PDF est prêt. Choisissez WhatsApp — ou une autre application — dans la fenêtre de partage.',
  shared: 'Le PDF a été transmis à l’application choisie.',
  cancelled: 'Partage annulé. Le PDF reste prêt si vous voulez recommencer.',
  fallback:
    'Cet appareil ne permet pas de joindre un fichier depuis le navigateur. Le PDF vient d’être téléchargé : ouvrez WhatsApp, puis joignez-le avec le trombone (Document).',
  fetchFailed: 'Le PDF n’a pas pu être récupéré. Vérifiez votre connexion, puis réessayez.',
  shareFailed: 'Le partage n’a pas pu s’ouvrir. Réessayez, ou téléchargez le PDF pour le joindre vous-même.',
} as const;

function saveFile(url: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function DocumentShareButton({
  reference,
  title = reference,
  label = 'Envoyer / partager le PDF',
  tone,
  variant = 'ghost',
}: {
  reference: string;
  /** Titre proposé à l'application de destination, p. ex. « Facture MORA-FACL-A0001 ». */
  title?: string;
  label?: string;
  tone: Tone;
  variant?: 'ghost' | 'primary' | 'gold';
}) {
  const [state, setState] = useState<State>({ step: 'idle' });
  const href = `/api/documents/${encodeURIComponent(reference)}/`;
  const fileName = `${reference}.pdf`;

  async function prepare() {
    setState({ step: 'preparing' });

    const fetched = await fetchDocumentFile(href, fileName);
    if (!fetched.ok) {
      setState({ step: 'error', message: MESSAGES.fetchFailed });
      return;
    }

    if (canShareFile(navigator, fetched.file)) {
      setState({ step: 'ready', file: fetched.file });
      return;
    }

    // Repli honnête : téléchargement du vrai fichier, et la marche à suivre.
    // Une exception imprévue ne laisse jamais le bouton sur « Préparation… ».
    try {
      const url = URL.createObjectURL(fetched.file);
      saveFile(url, fileName);
      setState({ step: 'fallback', url });
    } catch {
      setState({ step: 'error', message: MESSAGES.shareFailed });
    }
  }

  async function share(file: File) {
    const outcome = await shareFile(navigator, file, title);
    if (outcome === 'shared') setState({ step: 'shared' });
    else if (outcome === 'cancelled') setState({ step: 'cancelled', file });
    else setState({ step: 'error', message: MESSAGES.shareFailed });
  }

  const notice = (message: string, failed = false) => (
    <p className={failed ? tone.error : tone.ok} role={failed ? 'alert' : 'status'}>
      {message}
    </p>
  );

  switch (state.step) {
    case 'idle':
      return (
        <button className={`btn btn--${variant}`} type="button" onClick={prepare}>
          {label}
        </button>
      );

    case 'preparing':
      return (
        <button className={`btn btn--${variant}`} type="button" disabled aria-busy="true">
          {MESSAGES.preparing}
        </button>
      );

    case 'ready':
    case 'cancelled':
      return (
        <div className="document-share">
          <button className="btn btn--primary" type="button" onClick={() => share(state.file)}>
            Partager {fileName}
          </button>
          {notice(state.step === 'ready' ? MESSAGES.ready : MESSAGES.cancelled)}
        </div>
      );

    case 'shared':
      return notice(MESSAGES.shared);

    case 'fallback':
      return (
        <div className="document-share">
          <a className={`btn btn--${variant}`} href={state.url} download={fileName}>
            Télécharger de nouveau {fileName}
          </a>
          {notice(MESSAGES.fallback)}
        </div>
      );

    case 'error':
      return (
        <div className="document-share">
          <button className={`btn btn--${variant}`} type="button" onClick={prepare}>
            Réessayer
          </button>
          {notice(state.message, true)}
        </div>
      );
  }
}
