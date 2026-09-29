'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import AdminNotice from './AdminNotice';
import { inviteAdministratorAction, type AdminActionState } from '@/lib/admin/actions';
import type { PermissionCell } from './PermissionGrid';

/**
 * Invitation d'un nouvel administrateur.
 *
 * ## Aucun droit par défaut
 *
 * Le cadrage de la phase 4C est explicite : « Ne donne pas automatiquement
 * toutes les permissions à un futur ADMIN. » Depuis la décision D-18, le rôle
 * `ADMIN` n'accorde plus rien par lui-même : ce formulaire part donc de
 * **zéro permission cochée**, et ce qui est coché ici est exactement ce que la
 * personne recevra.
 *
 * Le bouton « Modèle opérationnel » coche d'un coup le périmètre décrit au
 * § 49 de `02_ROLES_ET_PERMISSIONS.md` — catalogue, commandes, clients,
 * rendez-vous, contenus, notifications. Il ne contient aucune permission
 * critique. C'est une commodité de saisie, pas un octroi : tant que le
 * formulaire n'est pas validé, rien n'est écrit.
 *
 * ## Ce qui n'est pas demandé
 *
 * Aucun mot de passe. La personne invitée choisit le sien sur la page
 * d'activation, puis enrôle son second facteur. Un mot de passe qui transite
 * par un tiers est un mot de passe connu d'un tiers.
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

export default function InviteForm({
  cells,
  template,
}: {
  cells: PermissionCell[];
  template: readonly string[];
}) {
  const [state, formAction] = useActionState(inviteAdministratorAction, INITIAL);
  const [checked, setChecked] = useState<string[]>([]);

  const groups = [...new Set(cells.map((cell) => cell.domain))].map((domain) => ({
    domain,
    cells: cells.filter((cell) => cell.domain === domain),
  }));

  return (
    <form action={formAction}>
      <AdminNotice state={state} />

      <div className="admin-field">
        <label className="admin-field__label" htmlFor="invite-identifiant">
          Identifiant de connexion
        </label>
        <input
          className="admin-input"
          id="invite-identifiant"
          name="identifiant"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          pattern="[a-z0-9][a-z0-9._\-]{2,31}"
        />
        <span className="admin-field__hint">
          3 à 32 caractères : lettres minuscules, chiffres, point, tiret ou tiret bas. C’est avec
          cet identifiant que la personne se connectera — jamais avec une adresse e-mail.
        </span>
      </div>

      <div className="admin-field">
        <label className="admin-field__label" htmlFor="invite-email">
          Adresse e-mail
        </label>
        <input
          className="admin-input"
          id="invite-email"
          name="email"
          type="email"
          required
          autoComplete="off"
        />
        <span className="admin-field__hint">
          Elle sert uniquement à recevoir le lien d’activation et, plus tard, à réinitialiser le
          mot de passe. Elle n’est jamais affichée comme identifiant.
        </span>
      </div>

      <div className="admin-field">
        <label className="admin-field__label" htmlFor="invite-nom">
          Nom complet <span style={{ fontWeight: 400 }}>(facultatif)</span>
        </label>
        <input className="admin-input" id="invite-nom" name="nom" type="text" autoComplete="off" />
      </div>

      <div className="admin-field">
        <span className="admin-field__label">Permissions accordées</span>
        <span className="admin-field__hint" style={{ marginTop: 0, marginBottom: 'var(--sp-3)' }}>
          Aucune permission n’est accordée par défaut. Ce qui est coché ci-dessous est exactement
          ce que ce compte pourra faire.
        </span>

        <div className="admin-actions" style={{ marginTop: 0 }}>
          <button
            className="btn btn--ghost"
            type="button"
            onClick={() => setChecked([...template])}
          >
            Cocher le modèle opérationnel
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => setChecked([])}>
            Tout décocher
          </button>
        </div>
      </div>

      <div className="admin-perms" style={{ marginTop: 'var(--sp-5)' }}>
        {groups.map(({ domain, cells: group }) => (
          <fieldset className="admin-perms__group" key={domain} style={{ margin: 0 }}>
            <legend className="admin-perms__title">{domain}</legend>

            {group.map((cell) => (
              <div
                className={`admin-perm${cell.critical ? ' admin-perm--critical' : ''}`}
                key={cell.code}
              >
                <input
                  type="checkbox"
                  id={`invite-${cell.code}`}
                  name="permissions"
                  value={cell.code}
                  checked={checked.includes(cell.code)}
                  onChange={(event) =>
                    setChecked((previous) =>
                      event.target.checked
                        ? [...previous, cell.code]
                        : previous.filter((code) => code !== cell.code),
                    )
                  }
                />
                <span className="admin-perm__body">
                  <label className="admin-perm__label" htmlFor={`invite-${cell.code}`}>
                    {cell.label}
                  </label>
                  <span className="admin-perm__code">{cell.code}</span>
                </span>
              </div>
            ))}
          </fieldset>
        ))}
      </div>

      <div className="admin-actions">
        <InviteButton />
      </div>
    </form>
  );
}

function InviteButton() {
  const { pending } = useFormStatus();

  return (
    <button className="btn btn--gold" type="submit" disabled={pending}>
      {pending ? 'Envoi…' : 'Envoyer l’invitation'}
    </button>
  );
}
