import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import AffiliateCreateForm from '@/components/admin/AffiliateCreateForm';
import { listCategories } from '@/lib/affiliation/admin';
import { requirePermission } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Ajouter un affilié',
  robots: { index: false, follow: false },
};

/**
 * Ajout direct d'un affilié — correctif de clôture 4H.
 *
 * Réservé à `affiliates.create` (404 sinon, comme tout écran d'administration
 * hors permission). La fiche naît « en préparation » ; le parcours existant
 * prend le relais : règles, coordonnées de versement, activation.
 */
export default async function NouvelAffiliePage() {
  await requirePermission('affiliates.create', '/administration/affiliation/affilies/nouveau/');
  const categories = (await listCategories())
    .filter((category) => category.is_active)
    .map((category) => ({ id: category.id, label: category.label, internal: category.is_internal }));

  return (
    <AdminPage
      eyebrow="Affiliation"
      title="Ajouter un affilié"
      lead="Pour un partenaire, une convention ou une personne recrutée qui n’est pas passée par la candidature publique."
      actions={
        <Link className="btn btn--ghost" href="/administration/affiliation/affilies/">
          Retour aux affiliés
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Nouvelle fiche</h2>
          <p>
            La fiche est créée en préparation, sans compte ni référence. Elle suit ensuite exactement le parcours
            d’un affilié issu d’une candidature : règles, coordonnées de versement, activation, référence AFIL et
            espace affilié.
          </p>
        </div>
        <AffiliateCreateForm categories={categories} />
      </section>
    </AdminPage>
  );
}
