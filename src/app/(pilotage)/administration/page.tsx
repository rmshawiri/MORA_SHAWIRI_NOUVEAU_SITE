import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import SignOutButton from '@/components/auth/SignOutButton';
import { displayIdentity } from '@/lib/auth/identifiers';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import { listAdministrators, listInvitations, invitationState } from '@/lib/admin/administrators';
import { requireAdminContext } from '@/lib/rbac/guards';
import { ADMIN_MODULES, ADMIN_ROOT } from '@/lib/rbac/modules';

export const metadata: Metadata = {
  title: 'Tableau de bord',
  description: 'Espace d’administration MORA Shawiri.',
  robots: { index: false, follow: false },
};

/**
 * Tableau de bord de l'administration.
 *
 * ## Ce qui est affiché, et ce qui ne l'est pas
 *
 * Le § 12 interdit de « remplir le tableau de bord avec de fausses
 * statistiques ou de faux événements », et le § 138 le redit pour les
 * indicateurs. Les seules données métier qui existent aujourd'hui sont les
 * comptes administratifs, les invitations et le journal d'audit : ce sont donc
 * les seuls chiffres affichés, et ils sont comptés en base à chaque rendu.
 *
 * Commandes, clients, devis, rendez-vous et commissions n'ont pas encore de
 * table. Aucune carte ne leur est consacrée. Une carte « Commandes : 0 »
 * paraîtrait mesurer quelque chose alors qu'elle ne mesurerait rien — et le
 * jour où les commandes existeront, personne ne saurait dire si le zéro était
 * vrai ou provisoire.
 *
 * ## Aucun rechargement automatique
 *
 * Le prompt maître § 45-48 l'interdit. La page ne s'actualise que sur clic,
 * et dit de quand datent ses chiffres — voir `RefreshBar`.
 */
export default async function AdministrationPage() {
  const context = await requireAdminContext(ADMIN_ROOT);
  const { access, auth } = context;

  const canSeeAdmins = context.can('admins.view');

  const [administrators, invitations] = await Promise.all([
    canSeeAdmins ? listAdministrators() : Promise.resolve([]),
    canSeeAdmins ? listInvitations() : Promise.resolve([]),
  ]);

  const pending = invitations.filter((row) => invitationState(row) === 'EN_ATTENTE').length;

  const openModules = ADMIN_MODULES.filter(
    (module) => module.permission !== null && context.can(module.permission),
  );

  return (
    <AdminPage
      eyebrow="Administration"
      title="Tableau de bord"
      lead={`Bienvenue, ${displayIdentity(access.profile ?? { username: null, full_name: null }, auth.email)}. Votre session est vérifiée.`}
    >
      {access.divergence ? (
        <div className="admin-notice admin-notice--error" role="alert">
          <p>
            <strong>Incohérence de droits détectée.</strong> Le calcul de vos permissions par
            l’application ne correspond pas à celui de la base de données. C’est la base qui fait
            foi et qui vous est appliquée. Signalez ce message : il ne devrait jamais apparaître.
          </p>
        </div>
      ) : null}

      {canSeeAdmins ? (
        <div className="admin-stats">
          <div className="admin-stat">
            <p className="admin-stat__label">Administrateurs</p>
            <p className="admin-stat__value">{administrators.length}</p>
            <p className="admin-stat__note">
              {administrators.filter((entry) => entry.isSuperAdmin).length} super-administrateur
              {administrators.filter((entry) => entry.isSuperAdmin).length > 1 ? 's' : ''}
            </p>
          </div>

          <div className="admin-stat">
            <p className="admin-stat__label">Invitations en attente</p>
            <p className="admin-stat__value">{pending}</p>
            <p className="admin-stat__note">
              {pending === 0 ? 'Aucune invitation ouverte.' : 'Valables 48 heures.'}
            </p>
          </div>

          <div className="admin-stat">
            <p className="admin-stat__label">Modules ouverts</p>
            <p className="admin-stat__value">{openModules.length}</p>
            <p className="admin-stat__note">selon vos permissions</p>
          </div>
        </div>
      ) : null}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Votre session</h2>
          <p>
            L’administration exige une session vérifiée par un second facteur. Ces informations
            sont lues dans le jeton, pas dans le navigateur.
          </p>
        </div>

        <dl className="admin-meta">
          <div>
            <dt>Identifiant</dt>
            <dd>
              {displayIdentity(
                access.profile ?? { username: null, full_name: null },
                auth.email,
              )}
            </dd>
          </div>
          <div>
            <dt>Rôles</dt>
            <dd>{access.roles.join(', ') || '—'}</dd>
          </div>
          <div>
            <dt>Niveau d’assurance</dt>
            <dd>
              <span className="admin-badge admin-badge--ok">
                {auth.assuranceLevel.toUpperCase()}
              </span>
            </dd>
          </div>
          <div>
            <dt>Permissions effectives</dt>
            <dd>
              {context.can('admin.full_access')
                ? 'Accès complet (admin.full_access)'
                : `${access.permissions.length} permission${access.permissions.length > 1 ? 's' : ''}`}
            </dd>
          </div>
        </dl>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Ce que vous pouvez ouvrir</h2>
          <p>
            Les modules absents de cette liste et de la barre latérale ne vous sont pas accordés.
            Leur adresse directe ne donne rien non plus : le contrôle est refait à chaque requête,
            côté serveur.
          </p>
        </div>

        {openModules.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun module accordé</p>
            <p>
              Votre compte a accès à l’administration mais aucune permission ne lui a encore été
              attribuée. Un super-administrateur peut vous en accorder depuis le module
              Administrateurs.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Module</th>
                  <th scope="col">Permission</th>
                  <th scope="col">État</th>
                </tr>
              </thead>
              <tbody>
                {openModules.map((module) => (
                  <tr key={module.href}>
                    <th scope="row">
                      <Link href={module.href}>{module.label}</Link>
                    </th>
                    <td>
                      <code>{module.permission}</code>
                    </td>
                    <td>
                      {module.status === 'DISPONIBLE' ? (
                        <span className="admin-badge admin-badge--ok">Disponible</span>
                      ) : (
                        <span className="admin-badge admin-badge--muted">
                          À venir — phase {module.phase}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Votre compte</h2>
        </div>

        <div className="admin-actions" style={{ marginTop: 0 }}>
          <Link className="btn btn--ghost" href={AUTH_ROUTES.mfaSettings}>
            Gérer la double authentification
          </Link>
          <Link className="btn btn--ghost" href={AUTH_ROUTES.changePassword}>
            Changer mon mot de passe
          </Link>
          <SignOutButton label="Me déconnecter" />
        </div>
      </section>
    </AdminPage>
  );
}
