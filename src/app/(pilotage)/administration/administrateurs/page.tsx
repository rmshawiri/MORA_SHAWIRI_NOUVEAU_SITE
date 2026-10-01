import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import ConfirmForm from '@/components/admin/ConfirmForm';
import InviteForm from '@/components/admin/InviteForm';
import type { PermissionCell } from '@/components/admin/PermissionGrid';
import { revokeInvitationAction } from '@/lib/admin/actions';
import {
  invitationState,
  listAdministrators,
  listInvitations,
  listPermissionCatalogue,
} from '@/lib/admin/administrators';
import { ADMIN_TEMPLATE_PERMISSIONS } from '@/lib/rbac/catalogue';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Administrateurs',
  robots: { index: false, follow: false },
};

/**
 * Module Administrateurs — la liste, et l'invitation.
 *
 * Le § 113 confie au super-administrateur la gestion des comptes
 * administratifs ; le § 114 celle de leurs permissions. Ce module met les deux
 * en œuvre, sous trois permissions distinctes plutôt qu'une seule :
 *
 *   * `admins.view`        ouvre le module et la liste ;
 *   * `admins.create`      autorise l'invitation et sa révocation ;
 *   * `admins.permissions` autorise l'ajustement des droits ;
 *   * `admins.disable`     autorise la suspension d'un compte.
 *
 * Voir sans pouvoir modifier est donc un état parfaitement normal, et c'est ce
 * que le § 10 (moindre privilège) demande de rendre possible.
 */
export default async function AdministrateursPage() {
  const context = await requireModule('administrateurs');

  const [administrators, invitations, catalogue] = await Promise.all([
    listAdministrators(),
    context.can('admins.create') ? listInvitations() : Promise.resolve([]),
    context.can('admins.create') ? listPermissionCatalogue() : Promise.resolve([]),
  ]);

  const cells: PermissionCell[] = catalogue.map((row) => ({
    code: row.code,
    label: row.label,
    domain: row.domain,
    critical: row.is_critical,
    fromRole: false,
    effect: null,
    effective: false,
  }));

  return (
    <AdminPage
      eyebrow="Système"
      title="Administrateurs"
      lead="Comptes ayant accès à l’administration, invitations en cours et droits accordés à chacun."
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Comptes administratifs</h2>
          <p>
            Un rôle donne l’accès à l’administration ; il ne donne aucun droit par lui-même. Les
            permissions se consultent et s’ajustent compte par compte.
          </p>
        </div>

        {administrators.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun compte administratif visible</p>
            <p>
              Votre permission ne vous donne accès à aucune fiche. Si vous pensez que c’est une
              erreur, demandez à un super-administrateur de vérifier vos droits.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Liste des comptes ayant accès à l’administration</caption>
              <thead>
                <tr>
                  <th scope="col">Identifiant</th>
                  <th scope="col">Nom</th>
                  <th scope="col">Rôles</th>
                  <th scope="col">État</th>
                  <th scope="col">Droits</th>
                </tr>
              </thead>
              <tbody>
                {administrators.map((entry) => (
                  <tr key={entry.userId}>
                    <th scope="row">{entry.profile.username ?? '—'}</th>
                    <td>{entry.profile.full_name ?? '—'}</td>
                    <td>
                      {entry.roles.map((role) => (
                        <span
                          className={`admin-badge ${
                            role === 'SUPER_ADMIN' ? 'admin-badge--gold' : 'admin-badge--brand'
                          }`}
                          key={role}
                          style={{ marginRight: 'var(--sp-2)' }}
                        >
                          {role}
                        </span>
                      ))}
                    </td>
                    <td>{statusBadge(entry.profile.status)}</td>
                    <td>
                      <Link
                        className="btn btn--ghost"
                        href={`/administration/administrateurs/${entry.userId}/`}
                      >
                        Consulter
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {context.can('admins.create') ? (
        <>
          <section className="admin-card">
            <div className="admin-card__head">
              <h2>Invitations</h2>
              <p>
                Une invitation vaut 48 heures et ne fonctionne qu’une fois. Elle n’est jamais
                supprimée : acceptée, révoquée ou expirée, elle reste visible.
              </p>
            </div>

            {invitations.length === 0 ? (
              <div className="admin-empty">
                <p className="admin-empty__title">Aucune invitation pour le moment.</p>
                <p>Les invitations envoyées apparaîtront ici avec leur état.</p>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Identifiant</th>
                      <th scope="col">Adresse</th>
                      <th scope="col">Permissions</th>
                      <th scope="col">État</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.map((row) => {
                      const state = invitationState(row);

                      return (
                        <tr key={row.id}>
                          <th scope="row">{row.username}</th>
                          <td>{row.email}</td>
                          <td>{row.permissions.length}</td>
                          <td>{invitationBadge(state)}</td>
                          <td>
                            {state === 'EN_ATTENTE' ? (
                              <ConfirmForm
                                action={revokeInvitationAction}
                                fields={{ invitation: row.id }}
                                trigger="Révoquer"
                                title="Confirmer la révocation de cette invitation ?"
                                consequence={`Le lien envoyé à ${row.email} cessera immédiatement de fonctionner. Aucun compte ne sera créé. L’invitation restera visible, marquée révoquée.`}
                                confirmLabel="Révoquer l’invitation"
                              />
                            ) : (
                              <span className="admin-badge admin-badge--muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admin-card">
            <div className="admin-card__head">
              <h2>Inviter un administrateur</h2>
              <p>
                La personne invitée choisit elle-même son mot de passe, puis enrôle une application
                d’authentification. Aucun mot de passe ne transite par vous.
              </p>
            </div>

            <InviteForm cells={cells} template={ADMIN_TEMPLATE_PERMISSIONS} />
          </section>
        </>
      ) : (
        <div className="admin-notice">
          <p>
            Vous consultez les comptes administratifs sans pouvoir en créer. La permission
            <code> admins.create </code>
            est nécessaire pour envoyer une invitation.
          </p>
        </div>
      )}
    </AdminPage>
  );
}

function statusBadge(status: string) {
  if (status === 'ACTIF') return <span className="admin-badge admin-badge--ok">Actif</span>;
  if (status === 'SUSPENDU') return <span className="admin-badge admin-badge--danger">Suspendu</span>;
  return <span className="admin-badge admin-badge--muted">Désactivé</span>;
}

function invitationBadge(state: string) {
  switch (state) {
    case 'EN_ATTENTE':
      return <span className="admin-badge admin-badge--gold">En attente</span>;
    case 'ACCEPTEE':
      return <span className="admin-badge admin-badge--ok">Acceptée</span>;
    case 'REVOQUEE':
      return <span className="admin-badge admin-badge--danger">Révoquée</span>;
    default:
      return <span className="admin-badge admin-badge--muted">Expirée</span>;
  }
}
