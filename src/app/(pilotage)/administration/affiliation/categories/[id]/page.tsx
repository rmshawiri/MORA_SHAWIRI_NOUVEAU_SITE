import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import AffiliateRuleEditor from '@/components/admin/AffiliateRuleEditor';
import AffiliationDecisionForm from '@/components/admin/AffiliationDecisionForm';
import { RuleStateBadge } from '@/components/admin/AffiliationBadges';
import { endRule, publishRule, saveCategory, withdrawRule } from '@/lib/affiliation/affiliate-actions';
import { RULE_KIND_LABELS, describeRuleRow, ruleState } from '@/lib/affiliation/affiliates';
import { findCategory, formatMoment, listOffers } from '@/lib/affiliation/admin';
import { categoryInputs } from '@/lib/affiliation/category-form';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Catégorie d’affiliés',
  robots: { index: false, follow: false },
};

const RESULTS: Record<string, string> = {
  CATEGORIE: 'La catégorie est enregistrée.',
  REGLE: 'La règle de catégorie est publiée. Les commissions déjà enregistrées ne changent pas.',
  REGLE_CLOSE: 'La règle est close.',
  REGLE_RETIREE: 'La version programmée est retirée.',
};

/**
 * Fiche d'une catégorie — phase 4H-3.
 *
 * Ses règles s'appliquent à tous ses membres qui n'ont pas de règle
 * individuelle pour la même cible. Aucune dérogation contractuelle ne se pose
 * ici : elle est individuelle par construction (contrainte en base).
 */
export default async function CategoriePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule('affiliation');
  const { id } = await params;
  const query = await searchParams;
  const detail = await findCategory(id);
  if (!detail) notFound();
  const { category, rules, members } = detail;
  const canManage = context.can('affiliate_rules.manage');
  const offers = canManage ? await listOffers() : [];
  const offerLabel = (offerId: string | null) => offers.find((offer) => offer.id === offerId)?.title ?? 'Offre';
  const result = typeof query.resultat === 'string' && Object.hasOwn(RESULTS, query.resultat) ? RESULTS[query.resultat] : null;

  return (
    <AdminPage
      eyebrow="Affiliation — catégorie"
      title={category.label}
      lead={`${members} affilié(s) dans cette catégorie. Code ${category.code}.`}
      actions={
        <Link className="btn btn--ghost" href="/administration/affiliation/categories/">
          Retour aux catégories
        </Link>
      }
    >
      {result ? (
        <div className="admin-notice admin-notice--ok" role="status">
          <p>{result}</p>
        </div>
      ) : null}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Paramètres par défaut</h2>
          <p>{category.description ?? 'Aucune description interne.'}</p>
        </div>
        {canManage ? (
          <AffiliationDecisionForm
            action={saveCategory}
            fields={{ id: category.id }}
            trigger="Modifier la catégorie"
            title="Enregistrer cette catégorie ?"
            consequence="Les membres sans surcharge individuelle suivent les nouveaux paramètres pour la suite. Les commissions déjà enregistrées gardent les leurs."
            confirmLabel="Enregistrer"
            inputs={categoryInputs(category)}
          />
        ) : null}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Règles de la catégorie</h2>
          <p>Elles s’appliquent aux membres qui n’ont pas de règle individuelle pour la même cible.</p>
        </div>
        {rules.length === 0 ? (
          <p className="admin-field__hint">Aucune règle : les membres de cette catégorie ne peuvent pas être activés sans règle individuelle.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Règles de la catégorie</caption>
              <thead>
                <tr>
                  <th scope="col">Cible</th>
                  <th scope="col">Règle</th>
                  <th scope="col">Période</th>
                  <th scope="col">État</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const state = ruleState(rule);
                  return (
                    <tr key={rule.id}>
                      <th scope="row">{rule.target_type === 'ALL' ? 'Toutes les offres' : offerLabel(rule.service_id ?? rule.product_id)}</th>
                      <td>
                        <strong>{RULE_KIND_LABELS[rule.kind]}</strong> — {describeRuleRow(rule)}
                        <span className="admin-field__hint"> (version {rule.version})</span>
                      </td>
                      <td>
                        {formatMoment(rule.valid_from)} → {rule.valid_to ? formatMoment(rule.valid_to) : 'sans fin'}
                      </td>
                      <td>
                        <RuleStateBadge state={state} />
                      </td>
                      <td>
                        {canManage && state === 'EN_VIGUEUR' && rule.valid_to === null ? (
                          <AffiliationDecisionForm
                            action={endRule}
                            fields={{ rule: rule.id }}
                            trigger="Clore"
                            title="Clore cette règle maintenant ?"
                            consequence="La règle cesse de s’appliquer aux nouvelles affaires de tous les membres concernés."
                            confirmLabel="Clore la règle"
                            variant="danger"
                            inputs={[{ kind: 'textarea', name: 'reason', label: 'Motif', required: true, maxLength: 1000 }]}
                          />
                        ) : canManage && state === 'PROGRAMMEE' ? (
                          <AffiliationDecisionForm
                            action={withdrawRule}
                            fields={{ rule: rule.id }}
                            trigger="Retirer"
                            title="Retirer cette version programmée ?"
                            consequence="Elle n’a jamais été appliquée ; la version précédente reste en vigueur."
                            confirmLabel="Retirer la version"
                            variant="danger"
                            inputs={[{ kind: 'textarea', name: 'reason', label: 'Motif', required: true, maxLength: 1000 }]}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {canManage ? (
          <AffiliateRuleEditor
            action={publishRule}
            ownerType="CATEGORY"
            ownerId={category.id}
            canDerogate={false}
            offers={offers.map((offer) => ({
              value: `${offer.type}:${offer.id}`,
              label: `${offer.type === 'SERVICE' ? 'Service' : 'Produit'} — ${offer.title}`,
              eligible: offer.eligible,
              maxRate: offer.maxRate,
            }))}
          />
        ) : null}
      </section>
    </AdminPage>
  );
}
