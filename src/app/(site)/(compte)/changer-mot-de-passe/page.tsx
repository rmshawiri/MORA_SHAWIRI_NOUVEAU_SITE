import type { Metadata } from 'next';
import Link from 'next/link';

import PasswordForm from '@/components/auth/PasswordForm';
import SignOutButton from '@/components/auth/SignOutButton';
import PageHero from '@/components/sections/PageHero';
import { requireSession } from '@/lib/auth/guards';
import { AUTH_ROUTES } from '@/lib/auth/routes';

export const metadata: Metadata = {
  title: 'Changer mon mot de passe',
  description: 'Modifiez le mot de passe de votre compte.',
  robots: { index: false, follow: false },
};

/**
 * Changement de mot de passe — obligatoire ou volontaire.
 *
 * La première connexion du super-administrateur passe par ici. Le compte
 * `rachade` a été provisionné en phase 4A avec la marque
 * « changement obligatoire », précisément parce que son mot de passe d'amorçage
 * était faible (rapport 4A § 7.3). Tant que cette marque est posée, tous les
 * autres écrans privés ramènent ici : c'est la première chose à faire, avant
 * même l'enrôlement du second facteur — sceller la porte en laissant la clé
 * dessus n'aurait pas de sens.
 *
 * Le mot de passe actuel est demandé : la personne le connaît, et le § 24 le
 * recommande. Cela vaut réauthentification au sens du § 114, et empêche qu'une
 * session laissée ouverte sur un poste suffise à changer le mot de passe du
 * compte.
 *
 * Aucun mot de passe n'est affiché, journalisé ni transmis ailleurs qu'à
 * Supabase Auth, qui en assure seul le hachage et la conservation.
 */
export default async function ChangerMotDePassePage() {
  const context = await requireSession(AUTH_ROUTES.changePassword);
  const mandatory = context.mustChangePassword;

  const destination = context.isAdmin
    ? context.adminMfaRequired && context.totpFactors.length === 0
      ? { href: AUTH_ROUTES.mfaSettings, label: 'Configurer la double authentification' }
      : { href: AUTH_ROUTES.adminArea, label: 'Aller à l’administration' }
    : { href: AUTH_ROUTES.clientArea, label: 'Aller à mon espace' };

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Mot de passe' }]}
        eyebrow="Sécurité"
        title={mandatory ? 'Changez votre mot de passe' : 'Changer mon mot de passe'}
        lead={
          mandatory
            ? 'Votre mot de passe actuel a été défini lors de la création du compte. Remplacez-le avant d’aller plus loin.'
            : 'Choisissez un mot de passe que vous n’utilisez nulle part ailleurs.'
        }
      />

      <section className="section auth-shell">
        <div className="container">
          <div className="auth-shell__inner">
            {mandatory && (
              <div className="auth-notice auth-notice--warn" role="status">
                <strong>Cette étape est obligatoire.</strong>
                <span>
                  Le mot de passe qui vous a été transmis à la création du compte a circulé hors de
                  votre contrôle. Il doit être remplacé avant tout accès aux fonctions
                  d’administration.
                </span>
              </div>
            )}

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Nouveau mot de passe</h2>
                <p>Il remplace immédiatement l’ancien.</p>
              </div>

              <PasswordForm
                askCurrentPassword
                successHref={mandatory ? destination.href : undefined}
              />

              {!mandatory && (
                <div className="auth-links">
                  <Link href={destination.href}>{destination.label}</Link>
                </div>
              )}
            </div>

            {mandatory && (
              <div className="auth-card">
                <div className="auth-card__head">
                  <h2>Une fois le mot de passe changé</h2>
                  <p>
                    Cette page vous conduira automatiquement à l’étape suivante&nbsp;:{' '}
                    {context.isAdmin && context.adminMfaRequired
                      ? 'la configuration de la double authentification.'
                      : 'votre espace.'}
                  </p>
                </div>
                <SignOutButton label="Me déconnecter" />
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
