import type { Metadata } from 'next';
import Link from 'next/link';

import FactorList from '@/components/auth/FactorList';
import TotpEnrolment from '@/components/auth/TotpEnrolment';
import PageHero from '@/components/sections/PageHero';
import { canRemoveFactor, mfaIsRequiredFor } from '@/lib/auth/access';
import { requireFactorManagement } from '@/lib/auth/guards';
import { AUTH_ROUTES } from '@/lib/auth/routes';

export const metadata: Metadata = {
  title: 'Double authentification',
  description: 'Gérez la double authentification de votre compte.',
  robots: { index: false, follow: false },
};

/**
 * Gestion du second facteur.
 *
 * Deux usages dans un même écran, parce que c'est la même chose vue à deux
 * moments : l'enrôlement initial, imposé aux administrateurs par la décision
 * D-12, et la gestion ultérieure des facteurs.
 *
 * Le garde `requireFactorManagement` porte la nuance qui compte : l'écran est
 * accessible en `AAL1` tant qu'aucun facteur n'existe — il faut bien enrôler le
 * premier —, puis en `AAL2` seulement. Sans cela, le vol d'un mot de passe
 * suffirait à désarmer la protection qu'il est censé contourner.
 */
export default async function DoubleFacteurPage() {
  const context = await requireFactorManagement(AUTH_ROUTES.mfaSettings);

  const required = mfaIsRequiredFor(context);
  const enrolled = context.totpFactors.length > 0;
  const removable = canRemoveFactor(context);

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Double authentification' }]}
        eyebrow="Sécurité"
        title="Double authentification"
        lead={
          enrolled
            ? 'Votre compte est protégé par un second facteur.'
            : 'Un code à usage unique, produit par votre téléphone, s’ajoute à votre mot de passe.'
        }
      />

      <section className="section auth-shell auth-shell--wide">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              <div className="auth-card__head">
                <h2>État de la protection</h2>
              </div>

              <dl className="auth-meta">
                <div>
                  <dt>Compte</dt>
                  <dd>{context.profile.username ?? context.email ?? 'Compte'}</dd>
                </div>
                <div>
                  <dt>Double authentification</dt>
                  <dd>
                    <span className={`auth-badge ${enrolled ? 'auth-badge--ok' : 'auth-badge--todo'}`}>
                      {enrolled ? 'Active' : 'À configurer'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Obligatoire pour ce compte</dt>
                  <dd>{required ? 'Oui' : 'Non'}</dd>
                </div>
                <div>
                  <dt>Niveau de cette session</dt>
                  <dd>{context.assuranceLevel === 'aal2' ? 'Vérifiée (AAL2)' : 'Mot de passe (AAL1)'}</dd>
                </div>
              </dl>
            </div>

            {required && !enrolled && (
              <div className="auth-notice auth-notice--warn" role="status">
                <strong>Cette étape est obligatoire.</strong>
                <span>
                  Les comptes d’administration de MORA Shawiri ne sont accessibles qu’avec une
                  double authentification. Tant qu’aucun facteur n’est configuré, l’administration
                  reste fermée.
                </span>
              </div>
            )}

            {enrolled && (
              <div className="auth-card">
                <div className="auth-card__head">
                  <h2>Vos facteurs</h2>
                  <p>
                    {removable
                      ? 'Vous pouvez retirer un facteur devenu inutile.'
                      : 'Pour remplacer votre téléphone, enrôlez d’abord le nouveau : le dernier facteur ne peut pas être retiré seul.'}
                  </p>
                </div>

                <FactorList factors={context.totpFactors} removable={removable} />
              </div>
            )}

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>{enrolled ? 'Ajouter un facteur' : 'Configurer la double authentification'}</h2>
                <p>
                  Compatible avec Google Authenticator, Microsoft Authenticator, Authy et toute
                  autre application respectant la norme TOTP.
                </p>
              </div>

              <TotpEnrolment />
            </div>

            {enrolled && context.assuranceLevel === 'aal2' && (
              <div className="auth-links">
                <Link href={context.isAdmin ? AUTH_ROUTES.adminArea : AUTH_ROUTES.clientArea}>
                  Retour à mon espace
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
