import Link from 'next/link';

import AdminPage from './AdminPage';
import type { AdminModule } from '@/lib/rbac/modules';

/**
 * Écran d'un module dont la place est prise mais le contenu pas encore écrit.
 *
 * Le § 171 du tableau de bord est la raison d'être de ce composant :
 *
 *   « Ces fonctionnalités ne doivent pas être simulées si elles ne sont pas
 *     encore implémentées. »
 *
 * Et le § 12, dans le même sens : « Claude Code ne doit jamais remplir le
 * tableau de bord avec de fausses statistiques ou de faux événements. »
 *
 * Un module à venir n'affiche donc **ni chiffre, ni tableau, ni graphique, ni
 * ligne d'exemple**. Il dit ce qu'il fera, et à quelle phase du plan. C'est
 * moins flatteur qu'une maquette remplie de données inventées ; c'est surtout
 * la seule version qui ne mentira pas au premier regard.
 *
 * La page est pour autant **entièrement réelle** sur un point qui compte : son
 * contrôle d'accès. Elle est protégée par la permission du module, exactement
 * comme le sera son contenu définitif. C'est ce qui permet de prouver dès la
 * phase 4C qu'un administrateur privé du droit `payments.view` ne voit pas la
 * page Paiements — et de le vérifier sans attendre la phase 4G.
 */
export default function ModuleAVenir({ module }: { module: AdminModule }) {
  return (
    <AdminPage
      eyebrow="Administration"
      title={module.label}
      lead={module.summary}
      refreshable={false}
    >
      <div className="admin-empty">
        <p className="admin-empty__title">Module à construire</p>
        <p>
          Votre accès à ce module est vérifié et fonctionne : la permission{' '}
          <strong>{module.permission ?? 'accès administrateur'}</strong> vous est reconnue. Son
          contenu — écrans, tableaux et actions — sera livré à la phase{' '}
          <strong>{module.phase}</strong> du plan de développement.
        </p>
        <p style={{ marginTop: 'var(--sp-4)' }}>
          Aucun chiffre n’est affiché ici tant qu’il n’est pas réel. Une donnée d’exemple sur un
          écran d’administration finit toujours par être prise pour une donnée vraie.
        </p>

        <div className="admin-actions" style={{ justifyContent: 'center' }}>
          <Link className="btn btn--ghost" href="/administration/">
            Retour au tableau de bord
          </Link>
        </div>
      </div>
    </AdminPage>
  );
}
