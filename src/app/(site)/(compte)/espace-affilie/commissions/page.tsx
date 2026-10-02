import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceKpis, SpaceList } from '@/components/affiliation/SpaceUi';
import { ACQUISITION_TRIGGER_LABELS } from '@/lib/affiliation/affiliates';
import {
  ADJUSTMENT_KIND_LABELS,
  COMMISSION_STATUS_HINTS,
  COMMISSION_STATUS_LABELS,
  kmf,
  lineReasonLabel,
  readCommissionLines,
} from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';
import { getMySpace, myCommissions, myPayouts, myTotals } from '@/lib/affiliation/space';
import { commissionTone } from '@/lib/affiliation/space-labels';
import { formatRate } from '@/lib/domain/affiliation';

export const metadata: Metadata = {
  title: 'Mes commissions',
  robots: { index: false, follow: false },
};

/**
 * Commissions (phase 4H-8).
 *
 * Chaque commission se lit **dans son instantané** : les lignes figées à son
 * calcul, avec la règle appliquée à la date de l'affaire. Une règle changée
 * aujourd'hui ne modifie rien de ce qui s'affiche ici. Les totaux sont ceux
 * de `affiliate_commission_totals`, les mêmes que dans l'administration.
 */
export default async function CommissionsPage() {
  const space = await getMySpace();
  if (space.state !== 'ready') return null;

  const [totals, { commissions, adjustments }, { payouts }] = await Promise.all([
    myTotals(space),
    myCommissions(space),
    myPayouts(space),
  ]);
  const payoutRef = new Map(payouts.map((p) => [p.id, p.reference]));
  const loose = adjustments.filter((a) => !a.commission_id);

  return (
    <>
      <SpaceCard title="Mes commissions" intro="Les montants sont calculés et figés par MORA Shawiri ; ce sont exactement ceux de votre dossier.">
        <SpaceKpis
          label="Totaux des commissions"
          items={[
            { label: 'Prévisionnelles', value: kmf(totals?.forecast ?? 0), hint: 'peuvent encore évoluer' },
            { label: 'Acquises', value: kmf(totals?.acquired ?? 0), hint: 'définitives, à verser', tone: 'gold' },
            { label: 'Dans un versement en préparation', value: kmf(totals?.to_pay ?? 0) },
            { label: 'Versées', value: kmf(totals?.paid ?? 0), tone: 'green' },
            ...(totals && totals.adjustments_pending !== 0
              ? [{ label: 'Ajustements à imputer', value: kmf(totals.adjustments_pending), hint: 'sur un prochain versement' }]
              : []),
          ]}
        />
      </SpaceCard>

      <SpaceCard title="Détail" intro="Ouvrez une commission pour voir son calcul, ligne par ligne.">
        {commissions.length === 0 ? (
          <SpaceEmpty title="Aucune commission pour le moment">
            Une commission naît quand une commande comportant une offre éligible vous est attribuée.
          </SpaceEmpty>
        ) : (
          <SpaceList label="Commissions">
            {commissions.map((commission) => {
              const lines = readCommissionLines(commission.lines);
              const own = adjustments.filter((a) => a.commission_id === commission.id);
              const net = Number(commission.amount) + own.reduce((sum, a) => sum + Number(a.amount), 0);
              return (
                <li key={commission.id} id={commission.reference} className="aff-item">
                  <div className="aff-item__top">
                    <span className="aff-item__title">{commission.reference}</span>
                    <span className="aff-item__amount">{kmf(commission.amount)}</span>
                  </div>
                  <div className="aff-item__meta">
                    <span className={`aff-pill aff-pill--${commissionTone(commission.status)}`}>{COMMISSION_STATUS_LABELS[commission.status]}</span>
                    <span className="aff-item__info">
                      Commande {commission.order_reference} du {formatMoment(commission.order_date)}
                      {own.length > 0 ? ` · net après ajustements ${kmf(net)}` : ''}
                    </span>
                  </div>
                  <details>
                    <summary>Voir le calcul</summary>
                    <div className="aff-item__body">
                      <p>{COMMISSION_STATUS_HINTS[commission.status]}</p>
                      <dl className="auth-meta">
                        <div>
                          <dt>Assiette commissionnable</dt>
                          <dd>{kmf(commission.base_amount)}</dd>
                        </div>
                        <div>
                          <dt>Condition d’acquisition</dt>
                          <dd>{ACQUISITION_TRIGGER_LABELS[commission.acquisition_trigger]}</dd>
                        </div>
                        {commission.acquired_at ? (
                          <div>
                            <dt>Acquise le</dt>
                            <dd>{formatMoment(commission.acquired_at)}</dd>
                          </div>
                        ) : null}
                        {commission.status === 'ANNULEE' && commission.cancel_reason ? (
                          <div>
                            <dt>Motif d’annulation</dt>
                            <dd>{commission.cancel_reason}</dd>
                          </div>
                        ) : null}
                        {commission.payout_id && payoutRef.get(commission.payout_id) ? (
                          <div>
                            <dt>Versement</dt>
                            <dd>
                              <Link href={`/espace-affilie/versements/#${payoutRef.get(commission.payout_id)}`}>{payoutRef.get(commission.payout_id)}</Link>
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      <SpaceList label={`Lignes de ${commission.reference}`}>
                        {lines.map((line, index) => (
                          <SpaceItem
                            key={`${commission.id}-${index}`}
                            title={line.designation}
                            amount={kmf(line.amount)}
                            status={lineReasonLabel(line.reason)}
                            tone={line.eligible ? 'ok' : 'muted'}
                            meta={[
                              `assiette ${kmf(line.base)}`,
                              line.rate !== null ? `règle ${formatRate(line.rate)}` : null,
                              line.capApplied && line.capRate !== null ? `plafond de l’offre ${formatRate(line.capRate)} appliqué` : null,
                              line.derogation ? 'dérogation contractuelle' : null,
                              line.ruleLabel,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          />
                        ))}
                      </SpaceList>
                      {own.length > 0 ? (
                        <>
                          <h3 className="aff-subhead">Ajustements</h3>
                          <dl className="auth-meta">
                            {own.map((adj) => (
                              <div key={adj.id}>
                                <dt>{ADJUSTMENT_KIND_LABELS[adj.kind]}</dt>
                                <dd>
                                  {kmf(adj.amount)} — {adj.reason} — {formatMoment(adj.created_at)}
                                  {adj.status === 'IMPUTE' ? ' (imputé)' : ' (à imputer)'}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </>
                      ) : null}
                    </div>
                  </details>
                </li>
              );
            })}
          </SpaceList>
        )}
      </SpaceCard>

      {loose.length > 0 ? (
        <SpaceCard title="Autres ajustements" intro="Corrections rattachées à votre affiliation plutôt qu’à une commission précise.">
          <SpaceList label="Autres ajustements">
            {loose.map((adj) => (
              <SpaceItem
                key={adj.id}
                title={ADJUSTMENT_KIND_LABELS[adj.kind]}
                amount={kmf(adj.amount)}
                status={adj.status === 'IMPUTE' ? 'Imputé' : 'À imputer'}
                tone={adj.status === 'IMPUTE' ? 'ok' : 'todo'}
                meta={`${adj.reason} · ${formatMoment(adj.created_at)}`}
              />
            ))}
          </SpaceList>
        </SpaceCard>
      ) : null}
    </>
  );
}
