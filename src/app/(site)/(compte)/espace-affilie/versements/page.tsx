import type { Metadata } from 'next';

import OfficialDocumentActions from '@/components/documents/OfficialDocumentActions';
import { SpaceCard, SpaceEmpty, SpaceList } from '@/components/affiliation/SpaceUi';
import { PAYOUT_FREQUENCY_LABELS } from '@/lib/affiliation/affiliates';
import { kmf } from '@/lib/affiliation/commissions';
import { formatPayoutDay, readMethodSnapshot, readPayoutLine } from '@/lib/affiliation/payouts';
import { getMySpace, myPayouts } from '@/lib/affiliation/space';
import type { PayoutFrequency } from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Mes versements',
  robots: { index: false, follow: false },
};

const DETAIL_LABELS: Record<string, string> = {
  numero: 'Numéro',
  titulaire: 'Titulaire',
  banque: 'Banque',
  compte: 'Compte',
  email: 'E-mail',
  ordre: 'À l’ordre de',
};

/**
 * Versements (phase 4H-8) — historique permanent.
 *
 * Seuls les versements confirmés sont visibles (RLS), sans note interne ni
 * justificatif. Le moyen affiché est celui **réellement utilisé**, figé à la
 * confirmation : un changement ultérieur de coordonnées ne le modifie pas.
 * Chaque versement a son relevé officiel RVAF, servi par le moteur de 4H-7.
 */
export default async function VersementsPage() {
  const space = await getMySpace();
  if (space.state !== 'ready') return null;
  const { affiliate, supabase } = space;

  const [{ payouts, items }, terms] = await Promise.all([
    myPayouts(space),
    supabase.rpc('affiliate_effective_terms', { p_affiliate_id: affiliate.id }),
  ]);
  const frequency = (terms.data ?? [])[0]?.payout_frequency as PayoutFrequency | undefined;

  return (
    <SpaceCard
      title="Mes versements"
      intro={`Vos commissions acquises vous sont versées ${frequency ? PAYOUT_FREQUENCY_LABELS[frequency].toLowerCase() : 'selon vos conditions'}. Un versement confirmé ne change plus.`}
    >
      {payouts.length === 0 ? (
        <SpaceEmpty title="Aucun versement pour le moment">Votre premier versement apparaîtra ici, avec son relevé officiel.</SpaceEmpty>
      ) : (
        <SpaceList label="Versements">
          {payouts.map((payout) => {
            const method = readMethodSnapshot(payout.method_snapshot);
            const lines = items.filter((item) => item.payout_id === payout.id);
            const commissions = lines.filter((item) => item.commission_id).length;
            return (
              <li key={payout.id} id={payout.reference ?? payout.id} className="aff-item">
                <div className="aff-item__top">
                  <span className="aff-item__title">{payout.reference}</span>
                  <span className="aff-item__amount">{kmf(payout.total_amount)}</span>
                </div>
                <div className="aff-item__meta">
                  <span className="aff-pill aff-pill--ok">Versé</span>
                  <span className="aff-item__info">
                    {formatPayoutDay(payout.confirmed_at)} · {method?.label ?? '—'} · {commissions} commission(s)
                    {payout.period_label ? ` · ${payout.period_label}` : ''}
                  </span>
                </div>
                <div className="aff-item__body">
                  {payout.reference ? (
                    <OfficialDocumentActions reference={payout.reference} title={`Relevé de versement ${payout.reference}`} space="espace" />
                  ) : null}
                  <details>
                    <summary>Voir le détail</summary>
                    <dl className="auth-meta">
                      <div>
                        <dt>Moyen utilisé</dt>
                        <dd>
                          {method?.label ?? '—'}
                          {method && Object.keys(method.details).length > 0
                            ? ` — ${Object.entries(method.details).map(([key, value]) => `${DETAIL_LABELS[key] ?? key} ${value}`).join(', ')}`
                            : ''}
                        </dd>
                      </div>
                      {payout.transaction_reference ? (
                        <div>
                          <dt>Référence de transaction</dt>
                          <dd>{payout.transaction_reference}</dd>
                        </div>
                      ) : null}
                      {lines.map((item) => {
                        const line = readPayoutLine(item.snapshot);
                        return (
                          <div key={item.id}>
                            <dt>{line?.label ?? 'Élément'}</dt>
                            <dd>
                              {kmf(item.amount)}
                              {line?.detail ? ` — ${line.detail}` : ''}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </details>
                </div>
              </li>
            );
          })}
        </SpaceList>
      )}
    </SpaceCard>
  );
}
