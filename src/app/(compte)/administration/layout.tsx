import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import AdminNav from '@/components/admin/AdminNav';
import { requireAdminContext } from '@/lib/rbac/guards';
import { allows } from '@/lib/rbac/effective';
import { ADMIN_ROOT, visibleModules } from '@/lib/rbac/modules';

import '@/styles/admin.css';

export const metadata: Metadata = {
  title: 'Administration',
  robots: { index: false, follow: false },
};

/**
 * Coquille de l'espace d'administration.
 *
 * ## Une seconde barrière, pas la seule
 *
 * Ce gabarit appelle `requireAdminContext`, donc la chaîne complète de la
 * phase 4B — session, rôle, mot de passe changé, second facteur présenté. Cela
 * pourrait laisser croire qu'une page enfant n'a plus rien à vérifier. C'est
 * faux, et c'est important : Next.js ne garantit pas qu'un gabarit soit
 * réexécuté avant chaque rendu enfant lors des navigations côté client.
 * **Chaque page appelle donc son propre garde**, sans exception. Le gabarit
 * protège la mise en page ; il ne protège pas les pages.
 *
 * ## Ce qui n'est pas touché
 *
 * L'en-tête, le pied de page et le dock restent ceux du site : ils viennent du
 * gabarit racine, qui n'est pas modifié. `globals.css` non plus. La feuille
 * `admin.css` n'est chargée que d'ici, donc jamais par une page publique —
 * même règle que `auth.css` en phase 4B, et même raison : la décision D-13.
 *
 * ## Le menu est filtré, ce n'est pas une protection
 *
 * `visibleModules` retire du menu ce que le compte ne peut pas ouvrir. Une
 * entrée masquée reste atteignable par son URL ; la page répond alors 404,
 * parce que son garde le décide. Le menu ne fait qu'éviter de proposer une
 * porte fermée.
 */
export const dynamic = 'force-dynamic';

export default async function AdministrationLayout({ children }: { children: ReactNode }) {
  const { access } = await requireAdminContext(ADMIN_ROOT);
  const modules = visibleModules(access.permissions, allows);

  return (
    <div className="admin">
      <div className="container">
        <div className="admin__grid">
          <AdminNav modules={modules} />
          <div className="admin__main">{children}</div>
        </div>
      </div>
    </div>
  );
}
