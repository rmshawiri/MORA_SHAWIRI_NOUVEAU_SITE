import type { Metadata } from 'next';
import Link from 'next/link';

import { CampaignForm, CancelProspectButton, PayoutRequestForm, ProspectForm } from '@/components/affiliation/AffiliateSpaceForm';
import LinkCopyShare from '@/components/affiliation/LinkCopyShare';
import PageHero from '@/components/sections/PageHero';
import {
  ACQUISITION_TRIGGER_LABELS,
  AFFILIATE_STATUS_LABELS,
  PAYOUT_ACCOUNT_STATUS_LABELS,
  PAYOUT_FREQUENCY_LABELS,
  affiliateLink,
  codeIsCurrent,
  describeDiscount,
  describeRuleRow,
  ruleInForce,
  ruleOriginFor,
} from '@/lib/affiliation/affiliates';
import { maskPayoutValue } from '@/lib/affiliation/applications';
import { ADJUSTMENT_KIND_LABELS, COMMISSION_STATUS_HINTS, COMMISSION_STATUS_LABELS, kmf } from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';
import { PROSPECT_STATUS_LABELS } from '@/lib/affiliation/prospects';
import { cancelProspect, createOwnCampaign, declareProspect, requestPayoutChange } from '@/lib/affiliation/space-actions';
import { formatKmf, toCents } from '@/lib/domain/affiliation';
import { requirePrivateAccess } from '@/lib/auth/guards';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import { RULE_ORIGIN_LABELS } from '@/lib/domain/affiliation';
import { getSiteUrl } from '@/lib/env';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/types';
import type {
  AcquisitionTrigger,
  AffiliateAdjustmentRow,
  AffiliateCampaignRow,
  AffiliateCategoryRow,
  AffiliateCodeRow,
  AffiliateCommissionRow,
  AffiliatePayoutAccountRow,
  AffiliateProspectRow,
  AffiliateRow,
  AffiliateRuleRow,
  PayoutFrequency,
} from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Mon espace affilié',
  description: 'Votre espace affilié MORA Shawiri.',
  robots: { index: false, follow: false },
};

/**
 * Espace affilié — phase 4H.
 *
 * Une seule source de vérité : chaque information vient des mêmes tables que
 * l'administration, filtrées par RLS (l'affilié ne lit que sa ligne, ses
 * règles et celles de sa catégorie, ses campagnes, ses codes, ses
 * coordonnées). Ce que l'administration change apparaît ici au prochain
 * affichage — la page n'est jamais mise en cache.
 *
 * L'affilié consulte ; il n'agit que sur deux choses sans portée financière :
 * demander de nouvelles coordonnées (validées par MORA Shawiri) et créer ses
 * liens de campagne. Les commissions sont lues ici telles que la base les a
 * calculées ; les versements et les documents s'ajoutent avec leurs lots.
 */
export default async function EspaceAffiliePage() {
  await requirePrivateAccess(AUTH_ROUTES.affiliateArea);
  const supabase = await getServerSupabaseClient();
  const { data: me } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const { data: affiliateRow } =
    supabase && me.user
      ? await supabase.from('affiliates').select('*').eq('user_id', me.user.id).maybeSingle()
      : { data: null };
  const affiliate = affiliateRow as AffiliateRow | null;

  if (!supabase || !affiliate || affiliate.status === 'PREPARATION') {
    return (
      <>
        <PageHero
          breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Espace affilié' }]}
          eyebrow="Programme d’affiliation"
          title="Espace affilié"
          lead="Aucune affiliation active n’est rattachée à ce compte."
        />
        <section className="section auth-shell auth-shell--wide">
          <div className="container">
            <div className="auth-shell__inner">
              <div className="auth-card">
                <p>
                  Si vous avez candidaté, votre espace s’ouvrira à l’activation de votre affiliation : vous recevrez un
                  e-mail. Vous pouvez aussi{' '}
                  <Link href="/affiliation/inscription/">déposer une candidature</Link>.
                </p>
              </div>
            </div>
          </div>
        </section>
      </>
    );
  }

  const [category, terms, rules, campaigns, codes, accounts, methods, stats, prospects, conversions, commissions, adjustments, totals] = await Promise.all([
    supabase.from('affiliate_categories').select('*').eq('id', affiliate.category_id).maybeSingle(),
    supabase.rpc('affiliate_effective_terms', { p_affiliate_id: affiliate.id }),
    supabase.from('affiliate_rules').select('*').order('valid_from', { ascending: false }),
    supabase.from('affiliate_campaigns').select('*').eq('affiliate_id', affiliate.id).order('created_at'),
    supabase.from('affiliate_codes').select('*').eq('affiliate_id', affiliate.id).order('created_at'),
    supabase
      .from('affiliate_payout_accounts')
      .select('id, affiliate_id, method_code, status, source, requested_by, requested_at, reviewed_by, reviewed_at, review_note, replaced_at, created_at, updated_at')
      .eq('affiliate_id', affiliate.id)
      .order('requested_at', { ascending: false }),
    supabase.rpc('affiliate_payout_methods'),
    supabase.rpc('affiliate_stats', { p_affiliate_id: affiliate.id }),
    supabase
      .from('affiliate_prospects')
      .select('id, affiliate_id, status, full_name, company, phone, email, need, comment, consent_confirmed, lead_id, review_reason, reviewed_at, recognized_at, protected_until, converted_at, created_at, updated_at')
      .eq('affiliate_id', affiliate.id)
      .order('created_at', { ascending: false }),
    supabase.rpc('my_affiliate_conversions'),
    // RLS : l'affilié ne lit que ses commissions et ses ajustements, qui ne
    // portent aucune donnée de client.
    supabase.from('affiliate_commissions').select('*').eq('affiliate_id', affiliate.id).order('created_at', { ascending: false }).limit(200),
    supabase.from('affiliate_commission_adjustments').select('*').eq('affiliate_id', affiliate.id).order('created_at', { ascending: false }).limit(200),
    supabase.rpc('affiliate_commission_totals', { p_affiliate_id: affiliate.id }),
  ]);
  const commissionRows = (commissions.data ?? []) as AffiliateCommissionRow[];
  const adjustmentRows = (adjustments.data ?? []) as AffiliateAdjustmentRow[];
  const commissionTotals = (totals.data ?? [])[0];
  const commissionRef = new Map(commissionRows.map((row) => [row.id, row.reference]));
  const figures = (stats.data ?? [])[0];
  const prospectRows = (prospects.data ?? []) as AffiliateProspectRow[];
  const conversionRows = conversions.data ?? [];

  const categoryRow = category.data as AffiliateCategoryRow | null;
  const effective = (terms.data ?? [])[0];
  const currentRules = ((rules.data ?? []) as AffiliateRuleRow[]).filter((rule) => ruleInForce(rule));
  const campaignRows = (campaigns.data ?? []) as AffiliateCampaignRow[];
  const codeRows = ((codes.data ?? []) as AffiliateCodeRow[]).filter((code) => codeIsCurrent(code));
  const accountRows = (accounts.data ?? []) as AffiliatePayoutAccountRow[];
  const methodRows = methods.data ?? [];
  const methodLabel = (code: string) => methodRows.find((row) => row.code === code)?.label ?? code;
  const active = accountRows.find((row) => row.status === 'ACTIF') ?? null;
  const pending = accountRows.find((row) => row.status === 'DEMANDE') ?? null;
  let activeDetails: Record<string, string> = {};
  if (active) {
    const { data } = await supabase.rpc('payout_account_details', { p_account_id: active.id });
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      activeDetails = Object.fromEntries(
        Object.entries(data as Record<string, Json>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
    }
  }

  const site = getSiteUrl();
  const live = affiliate.status === 'ACTIF';

  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Espace affilié' }]}
        eyebrow="Programme d’affiliation"
        title={`Bonjour ${affiliate.display_name}`}
        lead={`Affiliation ${affiliate.reference} — ${AFFILIATE_STATUS_LABELS[affiliate.status].toLowerCase()}.`}
      />

      <section className="section auth-shell auth-shell--wide">
        <div className="container">
          <div className="auth-shell__inner">
            {!live ? (
              <div className="auth-notice auth-notice--warn" role="status">
                <p>
                  {affiliate.status === 'SUSPENDU'
                    ? 'Votre affiliation est suspendue : vos liens et vos codes n’attribuent pas de nouvelles affaires pour le moment.'
                    : 'Votre affiliation a pris fin : vos liens et vos codes n’attribuent plus de nouvelles affaires. Votre historique reste consultable.'}
                </p>
              </div>
            ) : null}

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Mon affiliation</h2>
              </div>
              <dl className="auth-meta">
                <div>
                  <dt>Référence</dt>
                  <dd>{affiliate.reference}</dd>
                </div>
                <div>
                  <dt>Catégorie</dt>
                  <dd>{categoryRow?.label ?? '—'}</dd>
                </div>
                <div>
                  <dt>Statut</dt>
                  <dd>
                    <span className={`auth-badge ${live ? 'auth-badge--ok' : 'auth-badge--todo'}`}>
                      {AFFILIATE_STATUS_LABELS[affiliate.status]}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Depuis le</dt>
                  <dd>{affiliate.started_on ?? '—'}</dd>
                </div>
                {effective ? (
                  <>
                    <div>
                      <dt>Commission acquise</dt>
                      <dd>{ACQUISITION_TRIGGER_LABELS[effective.acquisition_trigger as AcquisitionTrigger]}</dd>
                    </div>
                    <div>
                      <dt>Versements</dt>
                      <dd>
                        {PAYOUT_FREQUENCY_LABELS[effective.payout_frequency as PayoutFrequency]}
                        {effective.payout_min_amount ? `, à partir de ${effective.payout_min_amount} KMF` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Durée d’attribution d’un clic</dt>
                      <dd>{effective.attribution_window_days} jours</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </div>

            {figures ? (
              <div className="auth-card">
                <div className="auth-card__head">
                  <h2>En chiffres</h2>
                </div>
                <dl className="aff-figures">
                  <div>
                    <dt>Clics sur vos liens</dt>
                    <dd>{figures.clicks}</dd>
                  </div>
                  <div>
                    <dt>Prospects déclarés</dt>
                    <dd>{figures.prospects}</dd>
                  </div>
                  <div>
                    <dt>Demandes attribuées</dt>
                    <dd>{figures.requests}</dd>
                  </div>
                  <div>
                    <dt>Commandes attribuées</dt>
                    <dd>{figures.conversions}</dd>
                  </div>
                  <div>
                    <dt>Chiffre d’affaires attribué</dt>
                    <dd>{formatKmf(toCents(figures.attributed_amount))}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Mes conditions de commission</h2>
              </div>
              {currentRules.length === 0 ? (
                <p>Aucune règle n’est en vigueur pour le moment.</p>
              ) : (
                <div className="espace-table-wrap">
                  <table className="espace-table">
                    <caption className="sr-only">Règles de commission en vigueur</caption>
                    <thead>
                      <tr>
                        <th scope="col">S’applique à</th>
                        <th scope="col">Commission</th>
                        <th scope="col">Depuis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentRules.map((rule) => (
                        <tr key={rule.id}>
                          <th scope="row">
                            {rule.target_type === 'ALL' ? 'Toutes les offres' : 'Offre spécifique'}
                            <small> — {RULE_ORIGIN_LABELS[ruleOriginFor(rule)].toLowerCase()}</small>
                          </th>
                          <td>{describeRuleRow(rule)}</td>
                          <td>{formatMoment(rule.valid_from)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="form__note">
                Une commission garde toujours la règle en vigueur au moment de l’affaire. Elle n’est calculée que sur
                les offres éligibles au programme.
              </p>
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Mes liens</h2>
              </div>
              <h3>Lien principal</h3>
              <LinkCopyShare url={affiliateLink(site, affiliate.slug)} title="MORA Shawiri" />
              {campaignRows.length > 0 ? (
                <>
                  <h3>Liens de campagne</h3>
                  {campaignRows.map((campaign) => (
                    <div key={campaign.id}>
                      <p>
                        <strong>{campaign.label}</strong>
                        {campaign.is_active ? '' : ' — désactivée'}
                      </p>
                      {campaign.is_active ? (
                        <LinkCopyShare url={affiliateLink(site, affiliate.slug, campaign.code)} title="MORA Shawiri" />
                      ) : null}
                    </div>
                  ))}
                </>
              ) : null}
              {affiliate.status !== 'TERMINE' ? <CampaignForm action={createOwnCampaign} /> : null}
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Mes prospects</h2>
              </div>
              {live ? <ProspectForm action={declareProspect} /> : null}
              {prospectRows.length === 0 ? (
                <p>Aucun prospect déclaré pour le moment.</p>
              ) : (
                <div className="espace-table-wrap">
                  <table className="espace-table">
                    <caption className="sr-only">Prospects déclarés</caption>
                    <thead>
                      <tr>
                        <th scope="col">Prospect</th>
                        <th scope="col">Déclaré le</th>
                        <th scope="col">Statut</th>
                        <th scope="col">
                          <span className="sr-only">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {prospectRows.map((prospect) => (
                        <tr key={prospect.id}>
                          <th scope="row">
                            {prospect.full_name}
                            {prospect.company ? <small> — {prospect.company}</small> : null}
                          </th>
                          <td>{formatMoment(prospect.created_at)}</td>
                          <td>
                            {PROSPECT_STATUS_LABELS[prospect.status]}
                            {prospect.status === 'RECONNU' && prospect.protected_until ? (
                              <small> — protégé jusqu’au {formatMoment(prospect.protected_until)}</small>
                            ) : null}
                          </td>
                          <td>
                            {prospect.status === 'DECLARE' || prospect.status === 'A_VERIFIER' ? (
                              <CancelProspectButton action={cancelProspect} prospectId={prospect.id} />
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Mes conversions</h2>
              </div>
              {conversionRows.length === 0 ? (
                <p>Aucune commande ne vous est encore attribuée.</p>
              ) : (
                <div className="espace-table-wrap">
                  <table className="espace-table">
                    <caption className="sr-only">Commandes attribuées</caption>
                    <thead>
                      <tr>
                        <th scope="col">Commande</th>
                        <th scope="col">Offre</th>
                        <th scope="col">Montant</th>
                        <th scope="col">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversionRows.map((row) => (
                        <tr key={row.order_reference}>
                          <th scope="row">{row.order_reference}</th>
                          <td>{row.offer ?? '—'}</td>
                          <td>{formatKmf(toCents(row.amount))}</td>
                          <td>{formatMoment(row.ordered_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="form__note">
                Par confidentialité, les coordonnées des clients ne sont jamais affichées ici.
              </p>
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Mes commissions</h2>
              </div>
              {commissionTotals ? (
                <dl className="aff-figures">
                  <div>
                    <dt>Prévisionnelles</dt>
                    <dd>{kmf(commissionTotals.forecast)}</dd>
                  </div>
                  <div>
                    <dt>Acquises</dt>
                    <dd>{kmf(commissionTotals.acquired)}</dd>
                  </div>
                  <div>
                    <dt>À verser</dt>
                    <dd>{kmf(commissionTotals.to_pay)}</dd>
                  </div>
                  <div>
                    <dt>Versées</dt>
                    <dd>{kmf(commissionTotals.paid)}</dd>
                  </div>
                </dl>
              ) : null}
              {commissionRows.length === 0 ? (
                <p>Aucune commission pour le moment. Elle apparaîtra dès qu’une commande éligible vous sera attribuée.</p>
              ) : (
                <div className="espace-table-wrap">
                  <table className="espace-table">
                    <caption className="sr-only">Mes commissions</caption>
                    <thead>
                      <tr>
                        <th scope="col">Commission</th>
                        <th scope="col">Montant</th>
                        <th scope="col">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissionRows.map((row) => (
                        <tr key={row.id}>
                          <th scope="row">
                            {row.reference}
                            <span className="aff-sub">Commande {row.order_reference}</span>
                          </th>
                          <td>{kmf(row.amount)}</td>
                          <td title={COMMISSION_STATUS_HINTS[row.status]}>
                            {COMMISSION_STATUS_LABELS[row.status]}
                            {row.status === 'ANNULEE' && row.cancel_reason ? ` — ${row.cancel_reason}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {adjustmentRows.length > 0 ? (
                <>
                  <h3 className="aff-subhead">Ajustements</h3>
                  <dl className="auth-meta">
                    {adjustmentRows.map((row) => (
                      <div key={row.id}>
                        <dt>
                          {ADJUSTMENT_KIND_LABELS[row.kind]}
                          {row.commission_id && commissionRef.get(row.commission_id) ? ` — ${commissionRef.get(row.commission_id)}` : ''}
                        </dt>
                        <dd>
                          {kmf(row.amount)} — {row.reason} — {formatMoment(row.created_at)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : null}
              <p className="form__note">
                Une commission prévisionnelle peut évoluer avec la commande. Acquise, elle ne change plus : une correction
                éventuelle apparaît comme un ajustement, imputé sur un versement suivant.
              </p>
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Mes codes de réduction</h2>
              </div>
              {codeRows.length === 0 ? (
                <p>Aucun code actif pour le moment.</p>
              ) : (
                <div className="espace-table-wrap">
                  <table className="espace-table">
                    <caption className="sr-only">Codes de réduction actifs</caption>
                    <thead>
                      <tr>
                        <th scope="col">Code</th>
                        <th scope="col">Avantage client</th>
                        <th scope="col">Valable jusqu’au</th>
                        <th scope="col">Conditions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {codeRows.map((code) => (
                        <tr key={code.id}>
                          <th scope="row">
                            <code>{code.code}</code>
                          </th>
                          <td>{describeDiscount(code.discount_kind, code.discount_value)}</td>
                          <td>{code.valid_to ? formatMoment(code.valid_to) : 'Sans date de fin'}</td>
                          <td>
                            {[
                              code.min_order_amount ? `affaire d’au moins ${code.min_order_amount} KMF` : null,
                              code.max_discount_amount ? `réduction plafonnée à ${code.max_discount_amount} KMF` : null,
                              code.service_ids.length + code.product_ids.length > 0 ? 'certaines offres seulement' : null,
                            ]
                              .filter(Boolean)
                              .join(', ') || 'Aucune'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="form__note">
                Votre client communique le code à MORA Shawiri, qui l’applique à son affaire. La réduction accordée au
                client est distincte de votre commission.
              </p>
            </div>

            <div className="auth-card">
              <div className="auth-card__head">
                <h2>Mes coordonnées de versement</h2>
              </div>
              {active ? (
                <dl className="auth-meta">
                  <div>
                    <dt>Moyen validé</dt>
                    <dd>{methodLabel(active.method_code)}</dd>
                  </div>
                  {Object.entries(activeDetails).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key === 'titulaire' ? 'Titulaire' : key === 'banque' ? 'Banque' : key === 'ordre' ? 'À l’ordre de' : 'Coordonnée'}</dt>
                      <dd>{['titulaire', 'banque', 'ordre'].includes(key) ? value : maskPayoutValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>Aucun moyen de versement n’est encore validé.</p>
              )}
              {pending ? (
                <p className="form__note">
                  Demande en attente : {methodLabel(pending.method_code)}, déposée le {formatMoment(pending.requested_at)}.{' '}
                  {PAYOUT_ACCOUNT_STATUS_LABELS.DEMANDE}.
                </p>
              ) : null}
              {affiliate.status !== 'TERMINE' && methodRows.length > 0 ? (
                <PayoutRequestForm action={requestPayoutChange} methods={methodRows} />
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
