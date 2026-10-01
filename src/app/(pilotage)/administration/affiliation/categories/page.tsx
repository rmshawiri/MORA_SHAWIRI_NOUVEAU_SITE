import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import AffiliationDecisionForm from '@/components/admin/AffiliationDecisionForm';
import { saveCategory } from '@/lib/affiliation/affiliate-actions';
import { ACQUISITION_TRIGGER_LABELS, PAYOUT_FREQUENCY_LABELS } from '@/lib/affiliation/affiliates';
import { listCategories } from '@/lib/affiliation/admin';
import { categoryInputs } from '@/lib/affiliation/category-form';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Catégories d’affiliés',
  robots: { index: false, follow: false },
};

/**
 * Catégories d'affiliés — phase 4H-3.
 *
 * Des modèles de départ : paramètres par défaut et règles de catégorie. Un
 * affilié peut surcharger chacun d'eux sans toucher aux autres membres.
 * Aucun taux n'a été semé : une catégorie sans règle ne rémunère rien.
 */
export default async function CategoriesPage() {
  const context = await requireModule('affiliation');
  const categories = await listCategories();
  const canManage = context.can('affiliate_rules.manage');

  return (
    <AdminPage
      eyebrow="Affiliation"
      title="Catégories et règles"
      lead="Chaque catégorie porte des paramètres par défaut et, le cas échéant, ses règles de commission. Les catégories internes ne sont jamais proposées au public."
      actions={
        <Link className="btn btn--ghost" href="/administration/affiliation/">
          Retour au module
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Catégories</h2>
          <p>{categories.length} catégorie(s).</p>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Catégories d’affiliés</caption>
            <thead>
              <tr>
                <th scope="col">Catégorie</th>
                <th scope="col">Code</th>
                <th scope="col">Attribution</th>
                <th scope="col">Exigibilité</th>
                <th scope="col">Versements</th>
                <th scope="col">État</th>
                <th scope="col">Fiche</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <th scope="row">
                    {category.label}
                    {category.is_internal ? <span className="admin-badge admin-badge--muted"> Interne</span> : null}
                  </th>
                  <td>
                    <code>{category.code}</code>
                  </td>
                  <td>{category.attribution_window_days} jours</td>
                  <td>{ACQUISITION_TRIGGER_LABELS[category.acquisition_trigger]}</td>
                  <td>
                    {PAYOUT_FREQUENCY_LABELS[category.payout_frequency]}
                    {category.payout_min_amount ? `, dès ${category.payout_min_amount} KMF` : ''}
                  </td>
                  <td>{category.is_active ? 'Active' : 'Inactive'}</td>
                  <td>
                    <Link className="btn btn--ghost" href={`/administration/affiliation/categories/${category.id}/`}>
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage ? (
          <AffiliationDecisionForm
            action={saveCategory}
            fields={{}}
            trigger="Créer une catégorie"
            title="Créer cette catégorie ?"
            consequence="La catégorie est créée sans règle de commission : ses membres ne peuvent être activés qu’une fois une règle publiée."
            confirmLabel="Créer la catégorie"
            inputs={[
              { kind: 'text', name: 'code', label: 'Code', required: true, maxLength: 40, placeholder: 'AMBASSADEUR', hint: 'Majuscules, chiffres, soulignés. Stable.' },
              ...categoryInputs(null),
            ]}
          />
        ) : null}
      </section>
    </AdminPage>
  );
}
