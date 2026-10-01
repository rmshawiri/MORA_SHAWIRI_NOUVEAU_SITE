import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import AffiliationDecisionForm from '@/components/admin/AffiliationDecisionForm';
import { CommissionStatusBadge } from '@/components/admin/AffiliationBadges';
import { ACQUISITION_TRIGGER_LABELS } from '@/lib/affiliation/affiliates';
import { findCommission } from '@/lib/affiliation/admin';
import { adjustCommission, cancelCommission, validateCommission } from '@/lib/affiliation/commission-actions';
import {
  ADJUSTMENT_KIND_LABELS,
  COMMISSION_STATUS_HINTS,
  kmf,
  lineReasonLabel,
  readCommissionLines,
} from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';
import { formatRate } from '@/lib/domain/affiliation';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Commission',
  robots: { index: false, follow: false },
};

/** Retours possibles d'un acte : liste fermée, jamais un texte reçu. */
const RESULTS: Record<string, string> = {
  COMMISSION_VALIDEE: 'La commission est validée : son montant est désormais définitif.',
  COMMISSION_ANNULEE: 'La commission est annulée. Si elle avait été versée, un ajustement négatif est imputé sur les versements suivants.',
  AJUSTEMENT: 'L’ajustement est enregistré. La commission d’origine reste intacte.',
};

/**
 * Fiche d'une commission — phase 4H-5.
 *
 * Tout ce qui l'explique, ligne par ligne, avec l'instantané de la règle
 * appliquée : rien n'est recalculé à l'affichage. Les actes exigent leur
 * permission, la base la revérifie et refuse à l'affilié d'agir sur ses
 * propres commissions.
 */
export default async function CommissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule('affiliation');
  const { id } = await params;
  const query = await searchParams;
  const detail = context.can('commissions.view') ? await findCommission(id) : null;
  if (!detail) notFound();
  const { commission, adjustments, affiliate } = detail;
  const lines = readCommissionLines(commission.lines);
  const net = Number(commission.amount) + adjustments.reduce((total, adj) => total + Number(adj.amount), 0);
  const isSelf = affiliate?.user_id !== null && affiliate?.user_id === context.access.userId;
  const can = {
    validate: context.can('commissions.validate') && !isSelf,
    manage: context.can('commissions.manage') && !isSelf,
  };
  const result = typeof query.resultat === 'string' && Object.hasOwn(RESULTS, query.resultat) ? RESULTS[query.resultat] : null;
  const path = `/administration/affiliation/commissions/${commission.id}/`;

  return (
    <AdminPage
      eyebrow={`Commission — ${affiliate?.display_name ?? 'affilié'}`}
      title={commission.reference}
      lead={COMMISSION_STATUS_HINTS[commission.status]}
      actions={
        <>
          <Link className="btn btn--ghost" href="/administration/affiliation/commissions/">
            Toutes les commissions
          </Link>
          {affiliate ? (
            <Link className="btn btn--ghost" href={`/administration/affiliation/affilies/${affiliate.id}/`}>
              Fiche affilié
            </Link>
          ) : null}
        </>
      }
    >
      {result ? (
        <div className="admin-notice admin-notice--ok" role="status">
          <p>{result}</p>
        </div>
      ) : null}
      {isSelf ? (
        <div className="admin-notice admin-notice--error" role="note">
          <p>Cette commission est la vôtre. Vous la consultez, mais aucune décision ne peut être prise par vous.</p>
        </div>
      ) : null}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Synthèse</h2>
          <p>
            <CommissionStatusBadge status={commission.status} />
          </p>
        </div>
        <dl className="admin-def">
          <dt>Commande</dt>
          <dd>
            <Link href={`/administration/commandes/${commission.order_reference}/`}>{commission.order_reference}</Link> — du{' '}
            {formatMoment(commission.order_date)}
          </dd>
          <dt>Assiette commissionnable</dt>
          <dd>{kmf(commission.base_amount)}</dd>
          <dt>Montant calculé</dt>
          <dd>{kmf(commission.amount)}</dd>
          <dt>Net après ajustements</dt>
          <dd>{kmf(net)}</dd>
          <dt>Condition d’acquisition</dt>
          <dd>{ACQUISITION_TRIGGER_LABELS[commission.acquisition_trigger]}</dd>
          <dt>Calculée le</dt>
          <dd>{formatMoment(commission.computed_at)}</dd>
          {commission.acquired_at ? (
            <>
              <dt>Acquise le</dt>
              <dd>
                {formatMoment(commission.acquired_at)}
                {commission.acquired_by ? ' — validation manuelle' : ' — condition remplie'}
              </dd>
            </>
          ) : null}
          {commission.cancelled_at ? (
            <>
              <dt>Annulée le</dt>
              <dd>
                {formatMoment(commission.cancelled_at)} — {commission.cancel_reason}
              </dd>
            </>
          ) : null}
          {commission.paid_at ? (
            <>
              <dt>Versée le</dt>
              <dd>{formatMoment(commission.paid_at)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Détail du calcul</h2>
          <p>Chaque ligne garde la règle appliquée à la date de l’affaire. Une nouvelle version de règle ne la modifie pas.</p>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Lignes de la commande et commission de chacune</caption>
            <thead>
              <tr>
                <th scope="col">Ligne</th>
                <th scope="col">Assiette</th>
                <th scope="col">Résultat</th>
                <th scope="col">Taux</th>
                <th scope="col">Commission</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={`${line.designation}-${index}`}>
                  <th scope="row">
                    {line.designation}
                    {line.ruleVersion !== null ? (
                      <span className="admin-field__hint">
                        {' '}
                        — règle v{line.ruleVersion}
                        {line.ruleLabel ? ` « ${line.ruleLabel} »` : ''}
                      </span>
                    ) : null}
                  </th>
                  <td>{kmf(line.base)}</td>
                  <td>
                    {lineReasonLabel(line.reason)}
                    {line.derogation ? <span className="admin-badge admin-badge--gold"> Dérogation contractuelle</span> : null}
                    {line.capApplied && line.capRate !== null ? (
                      <span className="admin-field__hint"> — plafond de l’offre {formatRate(line.capRate)} appliqué</span>
                    ) : null}
                  </td>
                  <td>
                    {line.capApplied && line.capRate !== null ? (
                      <>
                        {formatRate(line.capRate)}
                        {line.rate !== null ? <span className="admin-field__hint"> (règle {formatRate(line.rate)})</span> : null}
                      </>
                    ) : line.rate !== null ? (
                      formatRate(line.rate)
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{kmf(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Ajustements</h2>
          <p>Une correction s’ajoute, elle ne réécrit rien. Un ajustement sur une commission versée s’impute sur les versements suivants.</p>
        </div>
        {adjustments.length === 0 ? (
          <p>Aucun ajustement.</p>
        ) : (
          <ul className="admin-timeline">
            {adjustments.map((adj) => (
              <li key={adj.id}>
                <strong>{kmf(adj.amount)}</strong> — {ADJUSTMENT_KIND_LABELS[adj.kind]} — {adj.reason}
                <span className="admin-field__hint">
                  {' '}
                  ({formatMoment(adj.created_at)}
                  {adj.created_by_label ? `, ${adj.created_by_label}` : ', automatique'}
                  {adj.status === 'IMPUTE' ? ', imputé' : ', à imputer'})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {can.validate || can.manage ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Actes</h2>
            <p>Chaque acte est motivé, journalisé et revérifié par la base.</p>
          </div>
          <div className="btn-row">
            {can.validate && commission.status === 'PREVISIONNELLE' ? (
              <AffiliationDecisionForm
                action={validateCommission}
                fields={{ commission: commission.id, return: path }}
                trigger="Valider la commission"
                title="Valider cette commission ?"
                consequence={`Elle devient acquise pour ${kmf(commission.amount)} et son montant se fige.`}
                confirmLabel="Valider"
                variant="gold"
                inputs={[{ kind: 'textarea', name: 'reason', label: 'Motif', required: true, maxLength: 1000 }]}
              />
            ) : null}
            {can.manage && commission.status !== 'ANNULEE' ? (
              <AffiliationDecisionForm
                action={adjustCommission}
                fields={{ commission: commission.id, affiliate: commission.affiliate_id, return: path }}
                trigger="Ajuster"
                title="Enregistrer cet ajustement ?"
                consequence="L’ajustement s’ajoute à la commission. Il ne peut pas la rendre négative et ne se supprime pas."
                confirmLabel="Enregistrer"
                inputs={[
                  {
                    kind: 'text',
                    name: 'amount',
                    label: 'Montant (KMF)',
                    hint: 'Négatif pour réduire, par exemple -5000.',
                    required: true,
                    maxLength: 20,
                    inputMode: 'decimal',
                  },
                  { kind: 'textarea', name: 'reason', label: 'Motif', required: true, maxLength: 1000 },
                ]}
              />
            ) : null}
            {can.manage && ['PREVISIONNELLE', 'ACQUISE', 'A_VERSER', 'VERSEE'].includes(commission.status) ? (
              <AffiliationDecisionForm
                action={cancelCommission}
                fields={{ commission: commission.id, return: path }}
                trigger="Annuler la commission"
                title="Annuler cette commission ?"
                consequence={
                  commission.status === 'VERSEE'
                    ? 'Elle a déjà été versée : le versement reste intact et un ajustement négatif sera imputé sur les versements suivants.'
                    : 'Elle sort des montants dus. L’annulation est définitive.'
                }
                confirmLabel="Annuler la commission"
                variant="danger"
                inputs={[{ kind: 'textarea', name: 'reason', label: 'Motif', required: true, maxLength: 1000 }]}
              />
            ) : null}
          </div>
        </section>
      ) : null}
    </AdminPage>
  );
}
