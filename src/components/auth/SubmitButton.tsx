'use client';

import { useFormStatus } from 'react-dom';

import { ArrowRight } from '@/components/ui/Icon';

/**
 * Bouton de soumission désactivé pendant l'envoi.
 *
 * `04_AUTHENTIFICATION.md` § 122-123 : « L'interface doit gérer correctement
 * les connexions lentes sans créer de soumissions multiples » et « les boutons
 * de connexion et d'inscription doivent éviter les soumissions multiples
 * accidentelles ». Sur une liaison lente — le cas ordinaire aux Comores —,
 * un second clic enverrait une deuxième tentative, qui compterait dans la
 * limitation de fréquence sans rien apporter.
 *
 * `useFormStatus()` lit l'état du formulaire parent : le composant n'a donc
 * aucun état à tenir, et ne peut pas se désynchroniser.
 */
export default function SubmitButton({
  label,
  pendingLabel,
  variant = 'gold',
}: {
  label: string;
  pendingLabel: string;
  variant?: 'gold' | 'primary' | 'ghost';
}) {
  const { pending } = useFormStatus();

  return (
    <button className={`btn btn--${variant} btn--lg btn--block`} type="submit" disabled={pending}>
      {pending ? (
        <>
          <span className="btn__spinner" aria-hidden="true" /> {pendingLabel}
        </>
      ) : (
        <>
          {label} <ArrowRight />
        </>
      )}
    </button>
  );
}
