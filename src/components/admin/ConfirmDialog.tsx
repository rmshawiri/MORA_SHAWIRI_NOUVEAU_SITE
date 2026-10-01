'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Fenêtre de confirmation des actions sensibles de l'administration.
 *
 * ## Ce qu'elle est, et ce qu'elle n'est pas
 *
 * Une protection contre l'erreur de manipulation : on ne publie pas, on
 * n'émet pas une facture, on ne retire pas un droit d'un simple clic égaré.
 * Elle n'est **pas** une seconde authentification et ne prétend pas l'être :
 * elle ne vérifie rien. La sécurité réelle de chaque action reste côté
 * serveur — permission vérifiée par l'action, puis par la base (RLS,
 * fonctions, déclencheurs). Appeler l'action sans passer par cette fenêtre
 * n'ouvre aucun droit de plus.
 *
 * ## Comportement
 *
 * `<dialog>` natif ouvert en mode modal : le reste de la page devient inerte,
 * le focus est retenu dans la fenêtre et rendu au bouton d'origine à la
 * fermeture, Échap ferme. Le focus initial est posé sur « Annuler » : une
 * touche Entrée réflexe n'exécute pas l'action. Pendant l'envoi, les deux
 * boutons sont désactivés et Échap est sans effet — ni double envoi, ni
 * fermeture qui laisserait croire à une annulation.
 *
 * Doit être placée **à l'intérieur** du `<form>` dont elle confirme l'envoi :
 * le bouton « Confirmer » en est le bouton d'envoi.
 */
export default function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  variant = 'primary',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  variant?: 'ghost' | 'primary' | 'gold' | 'danger';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { pending } = useFormStatus();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="admin-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Échap : refusé pendant l'envoi, sinon fermeture propre.
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(event) => {
        // Un clic sur le voile, hors de la boîte, vaut « Annuler ».
        if (event.target === dialog.current && !pending) onClose();
      }}
    >
      <div className="admin-dialog__box">
        <h2 id={titleId} className="admin-dialog__title">
          {title}
        </h2>
        <div className="admin-dialog__body">{children}</div>
        <div className="admin-dialog__actions">
          <button className="btn btn--ghost" type="button" onClick={onClose} disabled={pending} autoFocus>
            Annuler
          </button>
          <button className={`btn btn--${variant}`} type="submit" disabled={pending} aria-busy={pending}>
            {pending ? 'En cours…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
