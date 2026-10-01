import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import ConfirmForm from '@/components/admin/ConfirmForm';
import PermissionGrid, { type PermissionCell } from '@/components/admin/PermissionGrid';
import { setAccountStatusAction } from '@/lib/admin/actions';
import {
  getAccountPermissions,
  getAdministrator,
  listPermissionCatalogue,
} from '@/lib/admin/administrators';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Fiche administrateur',
  robots: { index: false, follow: false },
};

/**
 * Fiche d'un compte administratif : ses rôles, ses droits, son état.
 *
 * ## Trois protections, pas une
 *
 * **Son propre compte est en lecture seule.** Le § 96 interdit l'auto-élévation
 * sans exception ; la grille est donc désactivée quand la cible est l'auteur.
 * Ce n'est pas la protection réelle — l'action refuse, et le déclencheur
 * `user_permissions_guard` refuse aussi —, c'est celle qui évite de proposer un
 * geste qui sera rejeté.
 *
 * **Le dernier détenteur d'une permission critique est protégé.** La règle vit
 * en base (§ 21) : décocher une case qui rendrait la plateforme inadministrable
 * est refusé, et le refus est traduit en phrase lisible plutôt qu'en erreur
 * technique.
 *
 * **Le rôle n'est pas modifiable ici.** Retirer `SUPER_ADMIN` à quelqu'un est
 * une opération d'un autre ordre que décocher `orders.update` ; elle n'est pas
 * livrée en phase 4C, et l'omettre vaut mieux que la livrer à moitié.
 */
export default async function AdministrateurPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireModule('administrateurs');
  const { id } = await params;

  const administrator = await getAdministrator(id);
  if (!administrator) notFound();

  const [catalogue, accountPermissions] = await Promise.all([
    listPermissionCatalogue(),
    getAccountPermissions(id),
  ]);

  const byCode = new Map(accountPermissions.map((row) => [row.code, row]));

  const cells: PermissionCell[] = catalogue.map((row) => {
    const account = byCode.get(row.code);

    return {
      code: row.code,
      label: row.label,
      domain: row.domain,
      critical: row.is_critical,
      fromRole: account?.from_role ?? false,
      effect: (account?.effect as 'OCTROI' | 'RETRAIT' | null) ?? null,
      effective: account?.effective ?? false,
    };
  });

  const isSelf = administrator.userId === context.access.userId;
  const held = cells.filter((cell) => cell.effective).length;
  const canEdit = context.can('admins.permissions') && !isSelf;

  return (
    <AdminPage
      eyebrow="Administrateurs"
      title={administrator.profile.username ?? 'Compte administratif'}
      lead={administrator.profile.full_name ?? undefined}
      actions={
        <Link className="btn btn--ghost" href="/administration/administrateurs/">
          Retour à la liste
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Identité et état</h2>
        </div>

        <dl className="admin-meta">
          <div>
            <dt>Identifiant</dt>
            <dd>{administrator.profile.username ?? '—'}</dd>
          </div>
          <div>
            <dt>Rôles</dt>
            <dd>{administrator.roles.join(', ') || '—'}</dd>
          </div>
          <div>
            <dt>Statut</dt>
            <dd>{administrator.profile.status}</dd>
          </div>
          <div>
            <dt>Permissions détenues</dt>
            <dd>
              {administrator.roles.includes('SUPER_ADMIN')
                ? 'Accès complet (admin.full_access)'
                : `${held} sur ${cells.length}`}
            </dd>
          </div>
          <div>
            <dt>Mot de passe à changer</dt>
            <dd>{administrator.profile.must_change_password ? 'Oui' : 'Non'}</dd>
          </div>
          <div>
            <dt>Dernière connexion</dt>
            <dd>{formatDate(administrator.profile.last_login_at)}</dd>
          </div>
        </dl>

        {context.can('admins.disable') && !isSelf ? (
          <div className="admin-actions">
            <ConfirmForm
              action={setAccountStatusAction}
              fields={{
                compte: administrator.userId,
                statut: administrator.profile.status === 'ACTIF' ? 'SUSPENDU' : 'ACTIF',
              }}
              trigger={
                administrator.profile.status === 'ACTIF'
                  ? 'Suspendre ce compte'
                  : 'Rétablir ce compte'
              }
              title={
                administrator.profile.status === 'ACTIF'
                  ? 'Confirmer la révocation de l’accès de cet administrateur ?'
                  : 'Confirmer le rétablissement de ce compte ?'
              }
              consequence={
                administrator.profile.status === 'ACTIF'
                  ? 'Ce compte perdra immédiatement tout accès, y compris depuis une session déjà ouverte. Ses données et ses permissions sont conservées. Si ce compte est le dernier à détenir une permission critique, l’opération sera refusée.'
                  : 'Ce compte retrouvera l’accès à l’administration, avec exactement les permissions qu’il avait avant sa suspension.'
              }
              confirmLabel={
                administrator.profile.status === 'ACTIF' ? 'Suspendre' : 'Rétablir'
              }
            />
          </div>
        ) : null}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Permissions</h2>
          <p>
            Une case cochée signifie que ce compte détient la permission, quelle qu’en soit
            l’origine. L’étiquette sous chaque ligne dit d’où elle vient.
          </p>
        </div>

        {isSelf ? (
          <div className="admin-notice">
            <p>
              <strong>Ceci est votre compte.</strong> Personne ne peut modifier ses propres
              permissions, quelle que soit sa fonction. Demandez la modification à un autre
              administrateur : l’opération sera ainsi tracée à son nom, et non au vôtre.
            </p>
          </div>
        ) : null}

        {!isSelf && !context.can('admins.permissions') ? (
          <div className="admin-notice">
            <p>
              Vous consultez ces droits sans pouvoir les modifier. La permission
              <code> admins.permissions </code>
              est nécessaire.
            </p>
          </div>
        ) : null}

        {administrator.roles.includes('SUPER_ADMIN') ? (
          <div className="admin-notice">
            <p>
              Ce compte porte le rôle <strong>SUPER_ADMIN</strong>, qui lui accorde
              <code> admin.full_access </code>
              et donc l’ensemble des permissions. Les cases ci-dessous décrivent les ajustements
              nominatifs : tant que <code>admin.full_access</code> est détenu, il couvre tout.
            </p>
          </div>
        ) : null}

        <PermissionGrid
          userId={administrator.userId}
          accountLabel={administrator.profile.full_name ?? administrator.profile.username ?? 'ce compte'}
          cells={cells}
          readOnly={!canEdit}
        />
      </section>
    </AdminPage>
  );
}

function formatDate(value: string | null): string {
  if (!value) return 'Jamais';

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Indian/Comoro',
  }).format(new Date(value));
}
