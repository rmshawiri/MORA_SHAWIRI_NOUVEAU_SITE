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
 *
 * Un seul mécanisme partout — espace client, espace affilié, administration,
 * menu du compte du site public : `signOutAction` révoque **toute** la session
 * (`scope: 'global'`), quels que soient les rôles du compte. Seule change la
 * page d'arrivée : `destination="accueil"` ramène au site public.
 */
export default function SignOutButton({
  label = 'Me déconnecter',
  variant = 'ghost',
  destination,
}: {
  label?: string;
  /** `item` : entrée du menu du compte de l'en-tête public. */
  variant?: 'ghost' | 'primary' | 'light' | 'item' | 'admin' | 'topbar';
  destination?: 'accueil';
}) {
  return (
    <form action={signOutAction} className={variant === 'item' ? 'header-account__form' : undefined}>
      {destination ? <input type="hidden" name="destination" value={destination} /> : null}
      <Button label={label} variant={variant} />
    </form>
  );
}

function Button({ label, variant }: { label: string; variant: string }) {
  const { pending } = useFormStatus();

  const className =
    variant === 'item'
      ? 'header-account__item header-account__item--button'
      : variant === 'admin'
        ? 'admin-signout'
        : variant === 'topbar'
          ? 'admin-signout admin-signout--topbar'
          : `btn btn--${variant}`;

  return (
    <button className={className} type="submit" disabled={pending} role={variant === 'item' ? 'menuitem' : undefined}>
      {pending ? 'Déconnexion…' : label}
    </button>
  );
}
