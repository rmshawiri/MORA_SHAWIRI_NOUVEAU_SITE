import type { Metadata } from 'next';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import LinkCopyShare from '@/components/affiliation/LinkCopyShare';
import {
  ACQUISITION_TRIGGER_LABELS,
  AFFILIATE_STATUS_LABELS,
  PAYOUT_FREQUENCY_LABELS,
  PROTECTION_MODE_LABELS,
  affiliateLink,
  describeRuleRow,
  ruleInForce,
  ruleOriginFor,
} from '@/lib/affiliation/affiliates';
import { kmf } from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';
import { formatPayoutDay } from '@/lib/affiliation/payouts';
import { getMySpace } from '@/lib/affiliation/space';
import { RULE_ORIGIN_LABELS, formatRate } from '@/lib/domain/affiliation';
import { getSiteUrl } from '@/lib/env';
import type {
  AcquisitionTrigger,
  AffiliateCategoryRow,
  AffiliateRuleRow,
  PayoutFrequency,
  ProspectProtectionMode,
} from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Mon affiliation',
  robots: { index: false, follow: false },
};

type Offer = { id: string; title: string; affiliate_eligible: boolean; affiliate_max_rate: number | null };

/**
 * Mon affiliation (phase 4H-8) — lecture seule.
 *
 * Les règles affichées sont celles que la base applique : règles
 * individuelles et règles de catégorie en vigueur, lues sous RLS, dites par
 * `describeRuleRow` — la même lecture que dans l'administration. L'affilié ne
 * peut en modifier aucune.
 */
export default async function MonAffiliationPage() {
  const space = await getMySpace();
  if (space.state !== 'ready') return null;
  const { affiliate, supabase } = space;

  const [category, terms, rules, services, products] = await Promise.all([
    supabase.from('affiliate_categories').select('*').eq('id', affiliate.category_id).maybeSingle(),
    supabase.rpc('affiliate_effective_terms', { p_affiliate_id: affiliate.id }),
    supabase.from('affiliate_rules').select('*').order('valid_from', { ascending: false }),
    supabase.from('services').select('id, title, affiliate_eligible, affiliate_max_rate').eq('status', 'PUBLIE').order('title'),
    supabase.from('products').select('id, title, affiliate_eligible, affiliate_max_rate').eq('status', 'PUBLIE').order('title'),
  ]);
  const categoryRow = category.data as AffiliateCategoryRow | null;
  const effective = (terms.data ?? [])[0];
  const current = ((rules.data ?? []) as AffiliateRuleRow[]).filter((rule) => ruleInForce(rule));
  const offers = [...((services.data ?? []) as Offer[]), ...((products.data ?? []) as Offer[])];
  const offerTitle = new Map(offers.map((offer) => [offer.id, offer.title]));
  const eligible = offers.filter((offer) => offer.affiliate_eligible && offer.affiliate_max_rate !== null);
  const notEligible = offers.filter((offer) => !offer.affiliate_eligible);
  const excluded = current.filter((rule) => rule.kind === 'EXCLUDED');
  const derogations = current.filter((rule) => rule.contractual_derogation);

  const target = (rule: AffiliateRuleRow) =>
    rule.target_type === 'ALL'
      ? 'Toutes les offres éligibles'
      : (offerTitle.get(rule.service_id ?? rule.product_id ?? '') ?? 'Une offre du catalogue');

  const protection = effective
    ? effective.prospect_protection_mode === 'PARTENARIAT'
      ? `${PROTECTION_MODE_LABELS.PARTENARIAT}${effective.post_end_survival_months ? `, puis ${effective.post_end_survival_months} mois après sa fin` : ''}`
      : `${effective.prospect_protection_months ?? '—'} mois après sa reconnaissance`
    : '—';

  return (
    <>
      <SpaceCard title="Mon affiliation" intro="Vos conditions sont fixées par MORA Shawiri. Pour toute question, répondez simplement à l’un de nos e-mails.">
        <dl className="auth-meta">
          <div>
            <dt>Référence</dt>
            <dd>{affiliate.reference}</dd>
          </div>
          <div>
            <dt>Statut</dt>
            <dd>
              <span className={`auth-badge ${affiliate.status === 'ACTIF' ? 'auth-badge--ok' : 'auth-badge--todo'}`}>
                {AFFILIATE_STATUS_LABELS[affiliate.status]}
              </span>
            </dd>
          </div>
          <div>
            <dt>Catégorie</dt>
            <dd>{categoryRow?.label ?? '—'}</dd>
          </div>
          <div>
            <dt>Active depuis le</dt>
            <dd>{affiliate.started_on ? formatPayoutDay(`${affiliate.started_on}T09:00:00Z`) : '—'}</dd>
          </div>
          {affiliate.ended_on ? (
            <div>
              <dt>Fin</dt>
              <dd>{formatPayoutDay(`${affiliate.ended_on}T09:00:00Z`)}</dd>
            </div>
          ) : null}
        </dl>
      </SpaceCard>

      <SpaceCard title="Mon lien principal" intro="Il ne change jamais. Partagez-le tel quel : les visites qu’il apporte vous sont attribuées.">
        <LinkCopyShare url={affiliateLink(getSiteUrl(), affiliate.slug)} title="MORA Shawiri" />
      </SpaceCard>

      {effective ? (
        <SpaceCard title="Comment vous êtes rémunéré">
          <dl className="auth-meta">
            <div>
              <dt>Une commission est acquise</dt>
              <dd>{ACQUISITION_TRIGGER_LABELS[effective.acquisition_trigger as AcquisitionTrigger]}</dd>
            </div>
            <div>
              <dt>Versements</dt>
              <dd>
                {PAYOUT_FREQUENCY_LABELS[effective.payout_frequency as PayoutFrequency]}
                {effective.payout_min_amount ? `, à partir de ${kmf(effective.payout_min_amount)}` : ', sans montant minimum'}
              </dd>
            </div>
            <div>
              <dt>Durée d’un clic</dt>
              <dd>{effective.attribution_window_days} jours : une affaire conclue dans ce délai après une visite par votre lien vous est attribuée.</dd>
            </div>
            <div>
              <dt>Protection d’un prospect reconnu</dt>
              <dd>{protection}</dd>
            </div>
            <div>
              <dt>Durée de vie d’une commission acquise</dt>
              <dd>Illimitée : elle n’expire pas.</dd>
            </div>
          </dl>
          {effective.prospect_protection_mode ? (
            <p className="form__note">{PROTECTION_MODE_LABELS[effective.prospect_protection_mode as ProspectProtectionMode]}.</p>
          ) : null}
        </SpaceCard>
      ) : null}

      <SpaceCard
        title="Mes règles de commission"
        intro="Une commission garde toujours la règle en vigueur au moment de l’affaire : une nouvelle règle ne change pas les commissions déjà enregistrées."
      >
        {current.length === 0 ? (
          <SpaceEmpty title="Aucune règle en vigueur pour le moment">MORA Shawiri vous préviendra dès qu’une règle vous sera appliquée.</SpaceEmpty>
        ) : (
          <SpaceList label="Règles en vigueur">
            {current.map((rule) => (
              <SpaceItem
                key={rule.id}
                title={target(rule)}
                amount={rule.kind === 'EXCLUDED' ? null : describeRuleRow(rule)}
                status={RULE_ORIGIN_LABELS[ruleOriginFor(rule)]}
                tone={rule.kind === 'EXCLUDED' ? 'muted' : 'ok'}
                meta={`Depuis le ${formatMoment(rule.valid_from)}${rule.valid_to ? ` · jusqu’au ${formatMoment(rule.valid_to)}` : ''}`}
              >
                {rule.kind === 'EXCLUDED' ? <p>Cette offre ne donne pas lieu à commission.</p> : null}
                {rule.contractual_derogation ? (
                  <p>Dérogation contractuelle : cette règle peut dépasser le plafond habituel de l’offre.</p>
                ) : null}
                {rule.label ? <p>{rule.label}</p> : null}
              </SpaceItem>
            ))}
          </SpaceList>
        )}
        {derogations.length > 0 ? (
          <p className="form__note">Vos conditions comportent {derogations.length} dérogation(s) contractuelle(s) convenue(s) avec MORA Shawiri.</p>
        ) : null}
      </SpaceCard>

      <SpaceCard
        title="Offres éligibles"
        intro="Seules ces offres ouvrent droit à commission. Le plafond est le taux maximal qu’une règle de catégorie peut atteindre sur l’offre."
      >
        {eligible.length === 0 ? (
          <SpaceEmpty title="Aucune offre éligible publiée pour le moment" />
        ) : (
          <SpaceList label="Offres éligibles">
            {eligible.map((offer) => (
              <SpaceItem key={offer.id} title={offer.title} status="Éligible" tone="ok" meta={`Plafond ${formatRate(Number(offer.affiliate_max_rate))}`} />
            ))}
          </SpaceList>
        )}
        {notEligible.length + excluded.length > 0 ? (
          <details className="aff-more">
            <summary>Exclusions ({notEligible.length + excluded.length})</summary>
            <ul>
              {excluded.map((rule) => (
                <li key={rule.id}>{target(rule)} — exclue par une règle</li>
              ))}
              {notEligible.map((offer) => (
                <li key={offer.id}>{offer.title} — hors programme</li>
              ))}
            </ul>
          </details>
        ) : null}
      </SpaceCard>
    </>
  );
}
