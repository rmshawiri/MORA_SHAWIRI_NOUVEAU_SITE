'use client';

import { useFormStatus } from 'react-dom';

import { signOutAction } from '@/lib/auth/actions';

/**
 * Déconnexion.
 *
 * Un formulaire et non un lien : la déconnexion change l'état du serveur, et
 * `04_AUTHENTIFICATION.md` § 51 demande qu'elle invalide réellement la session.
 * Un lien serait suivi par les préchargeurs de navigateur et déconnecterait la
 * personne au simple survol.
 */
export default function SignOutButton({
  label = 'Me déconnecter',
  variant = 'ghost',
}: {
  label?: string;
  variant?: 'ghost' | 'primary';
}) {
  return (
    <form action={signOutAction}>
      <Button label={label} variant={variant} />
    </form>
  );
}

function Button({ label, variant }: { label: string; variant: string }) {
  const { pending } = useFormStatus();

  return (
    <button className={`btn btn--${variant}`} type="submit" disabled={pending}>
      {pending ? 'Déconnexion…' : label}
    </button>
  );
}
