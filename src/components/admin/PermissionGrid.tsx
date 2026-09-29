'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import { updatePermissionsAction, type AdminActionState } from '@/lib/admin/actions';

/**
 * Grille des permissions d'un compte.
 *
 * ## Ce qu'une case représente
 *
 * Une case cochée signifie « ce compte détient cette permission », quelle
 * qu'en soit l'origine. Le sous-titre dit d'où elle vient : de son rôle, d'un
 * octroi nominatif, ou — case décochée alors que le rôle l'accorde — d'un
 * retrait nominatif.
 *
 * C'est délibérément la seule question posée à l'administrateur. Lui demander
 * de choisir entre « octroyer » et « retirer » l'obligerait à raisonner sur le
 * mécanisme ; il raisonne sur le résultat, et le serveur en déduit les lignes à
 * écrire (`planAdjustments`).
 *
 * ## Ce que ce composant ne décide pas
 *
 * Rien. Il envoie une liste de cases cochées ; le serveur la confronte au
 * catalogue, écarte ce qui n'existe pas, relit l'état réel de la cible et
 * n'écrit que les différences. Cocher une case supplémentaire avec les outils
 * du navigateur ne donne aucun droit : RLS refuse l'écriture à qui ne détient
 * pas `admins.permissions`, et le déclencheur refuse qu'un compte se serve
 * lui-même.
 *
 * Références : § 194 « protection contre la manipulation », § 195 « validation
 * serveur », `02_ROLES_ET_PERMISSIONS.md` § 96-97.
 */

export type PermissionCell = {
  code: string;
  label: string;
  domain: string;
  critical: boolean;
  fromRole: boolean;
  effect: 'OCTROI' | 'RETRAIT' | null;
  effective: boolean;
};

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function PermissionGrid({
  userId,
  cells,
  readOnly,
}: {
  userId: string;
  cells: PermissionCell[];
  readOnly: boolean;
}) {
  const [state, formAction] = useActionState(updatePermissionsAction, INITIAL);

  const groups = [...new Set(cells.map((cell) => cell.domain))].map((domain) => ({
    domain,
    cells: cells.filter((cell) => cell.domain === domain),
  }));

  return (
    <form action={formAction}>
      <input type="hidden" name="compte" value={userId} />

      <AdminNotice state={state} />

      <div className="admin-perms" style={{ marginTop: 'var(--sp-5)' }}>
        {groups.map(({ domain, cells: group }) => (
          <fieldset
            className="admin-perms__group"
            key={domain}
            style={{ border: undefined, margin: 0 }}
          >
            <legend className="admin-perms__title">{domain}</legend>

            {group.map((cell) => (
              <div
                className={`admin-perm${cell.critical ? ' admin-perm--critical' : ''}`}
                key={cell.code}
              >
                <input
                  type="checkbox"
                  id={`perm-${cell.code}`}
                  name="permissions"
                  value={cell.code}
                  defaultChecked={cell.effective}
                  disabled={readOnly}
                />
                <span className="admin-perm__body">
                  <label className="admin-perm__label" htmlFor={`perm-${cell.code}`}>
                    {cell.label}
                  </label>
                  <span className="admin-perm__code">{cell.code}</span>
                  <span className="admin-perm__origin">{originBadge(cell)}</span>
                </span>
              </div>
            ))}
          </fieldset>
        ))}
      </div>

      {readOnly ? null : (
        <div className="admin-actions">
          <SaveButton />
        </div>
      )}
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button className="btn btn--primary" type="submit" disabled={pending}>
      {pending ? 'Enregistrement…' : 'Enregistrer les permissions'}
    </button>
  );
}

/**
 * L'origine du droit, en un mot.
 *
 * Le § 127 demande la traçabilité. Une case cochée sans origine lisible n'en
 * est pas : on ne saurait pas si la décocher retire un octroi nominatif ou
 * pose un retrait contre le rôle.
 */
function originBadge(cell: PermissionCell) {
  if (cell.effect === 'RETRAIT') {
    return <span className="admin-badge admin-badge--danger">Retirée à ce compte</span>;
  }
  if (cell.effect === 'OCTROI') {
    return <span className="admin-badge admin-badge--gold">Accordée nominativement</span>;
  }
  if (cell.fromRole) {
    return <span className="admin-badge admin-badge--brand">Accordée par le rôle</span>;
  }
  return <span className="admin-badge admin-badge--muted">Non accordée</span>;
}
