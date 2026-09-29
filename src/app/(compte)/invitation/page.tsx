import type { Metadata } from 'next';
import Link from 'next/link';

import AcceptInvitationForm from '@/components/admin/AcceptInvitationForm';
import PageHero from '@/components/sections/PageHero';
import { previewInvitation } from '@/lib/admin/accept';
import { AUTH_ROUTES } from '@/lib/auth/routes';

export const metadata: Metadata = {
  title: 'Activer votre accès',
  robots: { index: false, follow: false },
};

/**
 * Page d'activation d'un compte administrateur invité.
 *
 * Accessible **sans session** : c'est le seul moment où une personne sans
 * compte doit pouvoir atteindre une page liée à l'administration. Elle ne
 * révèle rien pour autant — un jeton absent, inconnu, expiré, révoqué ou déjà
 * utilisé produit exactement le même écran, sans indiquer lequel de ces cas
 * s'applique.
 *
 * Elle n'est référencée nulle part : ni menu, ni lien, ni plan du site, et
 * `robots.ts` la retire de l'exploration. Le lien reçu par e-mail est la seule
 * façon d'y arriver utilement.
 *
 * L'écran reste celui du site : en-tête, pied de page et feuille `auth.css` du
 * groupe `(compte)`. Rien n'est emprunté à `admin.css` — la personne qui arrive
 * ici n'est pas encore administratrice.
 */
export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.jeton;
  const token = typeof raw === 'string' ? raw : '';

  const invitation = token
    ? await previewInvitation(token)
    : { valid: false, username: null, fullName: null };

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Activer votre accès' }]}
        eyebrow="Administration"
        title="Activer votre accès"
        lead={
          invitation.valid
            ? 'Choisissez votre mot de passe pour terminer la création de votre compte.'
            : 'Ce lien ne permet pas d’activer un compte.'
        }
      />

      <section className="section auth-shell">
        <div className="container">
          <div className="auth-shell__inner">
            <div className="auth-card">
              {invitation.valid && invitation.username ? (
                <>
                  <div className="auth-card__head">
                    <h2>Bienvenue{invitation.fullName ? `, ${invitation.fullName}` : ''}</h2>
                    <p>
                      Après cette étape, une application d’authentification vous sera demandée :
                      l’administration ne s’ouvre qu’avec un second facteur. Prévoyez votre
                      téléphone.
                    </p>
                  </div>

                  <AcceptInvitationForm token={token} username={invitation.username} />
                </>
              ) : (
                <>
                  <div className="auth-card__head">
                    <h2>Lien inutilisable</h2>
                    <p>
                      Ce lien d’invitation n’est plus valable. Il a peut-être expiré, déjà servi,
                      ou été révoqué. Demandez une nouvelle invitation à MORA Shawiri.
                    </p>
                  </div>

                  <div className="btn-row">
                    <Link className="btn btn--ghost" href={AUTH_ROUTES.signIn}>
                      Aller à la connexion
                    </Link>
                    <Link className="btn btn--ghost" href="/">
                      Retour à l’accueil
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
