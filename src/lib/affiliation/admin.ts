import 'server-only';

/**
 * Lectures du module Affiliation — phase 4H.
 *
 * Toutes passent par le client de session : RLS décide de ce qui revient, et
 * une page affiche exactement ce que la base autorise à cette personne. Aucune
 * lecture n'emploie la clé à privilèges, sauf mention contraire.
 */

import type { Json } from '@/lib/supabase/types';
import type {
  AffiliateAdjustmentRow,
  AffiliateApplicationEventRow,
  AffiliateApplicationRow,
  AffiliateCampaignRow,
  AffiliateCategoryRow,
  AffiliateCodeRow,
  AffiliateCommissionRow,
  AffiliateEventRow,
  AffiliateNoteRow,
  AffiliatePayoutAccountRow,
  AffiliatePayoutItemRow,
  AffiliatePayoutRow,
  AffiliationFunctions,
  AffiliateRow,
  AffiliateRuleRow,
  CommissionStatus,
  EmailOutboxRow,
} from '@/lib/supabase/types-affiliation';
import { getServerSupabaseClient } from '@/lib/supabase/server';

import type { ApplicationStatus } from './applications';

export async function listApplications(): Promise<AffiliateApplicationRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from('affiliate_applications')
    .select(
      'id, status, first_name, last_name, email, phone, country, city, requested_profile, profile_answers, motivation, collaboration_idea, payout_method_code, consent_given_at, consent_version, user_id, source, info_request, decision_message, refusal_reason, reviewed_by, reviewed_at, decided_by, decided_at, affiliate_id, created_at, updated_at',
    )
    .order('created_at', { ascending: false })
    .limit(500);
  return (data ?? []) as AffiliateApplicationRow[];
}

export function countApplicationsByStatus(rows: readonly AffiliateApplicationRow[]) {
  const counts: Record<ApplicationStatus, number> = {
    NOUVELLE: 0,
    EN_ETUDE: 0,
    INFOS_REQUISES: 0,
    ACCEPTEE: 0,
    REFUSEE: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export type ApplicationDetail = {
  application: AffiliateApplicationRow;
  events: AffiliateApplicationEventRow[];
  emails: EmailOutboxRow[];
  payoutLabel: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function findApplication(id: string): Promise<ApplicationDetail | null> {
  if (!UUID.test(id)) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data: application } = await supabase
    .from('affiliate_applications')
    .select(
      'id, status, first_name, last_name, email, phone, country, city, requested_profile, profile_answers, motivation, collaboration_idea, payout_method_code, consent_given_at, consent_version, user_id, source, info_request, decision_message, refusal_reason, reviewed_by, reviewed_at, decided_by, decided_at, affiliate_id, created_at, updated_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (!application) return null;

  const [events, emails, method] = await Promise.all([
    supabase
      .from('affiliate_application_events')
      .select('*')
      .eq('application_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('email_outbox')
      .select('*')
      .eq('entity_type', 'affiliate_application')
      .eq('entity_id', id)
      .order('created_at', { ascending: false }),
    supabase.rpc('affiliate_payout_methods'),
  ]);

  const payoutLabel =
    (method.data ?? []).find((row) => row.code === application.payout_method_code)?.label ??
    application.payout_method_code;

  return {
    application: application as AffiliateApplicationRow,
    events: (events.data ?? []) as AffiliateApplicationEventRow[],
    emails: (emails.data ?? []) as EmailOutboxRow[],
    payoutLabel,
  };
}

/** Coordonnées de versement souhaitées. `null` sans `payouts.view`. */
export async function readApplicationPayoutDetails(id: string): Promise<Record<string, string> | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('application_payout_details', { p_application_id: id });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  return Object.fromEntries(
    Object.entries(data as Record<string, Json>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export async function listCategories(): Promise<AffiliateCategoryRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from('affiliate_categories')
    .select('*')
    .order('sort_order', { ascending: true });
  return (data ?? []) as AffiliateCategoryRow[];
}

export { EMAIL_STATUS_LABELS, formatMoment } from './labels';

// -----------------------------------------------------------------------------
// Affiliés (lot 4H-3)
// -----------------------------------------------------------------------------

export type AffiliateListEntry = AffiliateRow & { categoryLabel: string };

export async function listAffiliates(): Promise<AffiliateListEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  const [{ data: affiliates }, categories] = await Promise.all([
    supabase.from('affiliates').select('*').order('created_at', { ascending: false }).limit(500),
    listCategories(),
  ]);
  const labels = new Map(categories.map((category) => [category.id, category.label]));
  return ((affiliates ?? []) as AffiliateRow[]).map((row) => ({
    ...row,
    categoryLabel: labels.get(row.category_id) ?? '—',
  }));
}

export type EffectiveTerms = {
  attribution_window_days: number;
  prospect_protection_mode: string;
  prospect_protection_months: number | null;
  post_end_survival_months: number | null;
  payout_frequency: string;
  payout_min_amount: number | null;
  acquisition_trigger: string;
  self_referral_allowed: boolean;
};

export type AffiliateDetail = {
  affiliate: AffiliateRow;
  category: AffiliateCategoryRow | null;
  terms: EffectiveTerms | null;
  rules: AffiliateRuleRow[];
  campaigns: AffiliateCampaignRow[];
  codes: AffiliateCodeRow[];
  payoutAccounts: AffiliatePayoutAccountRow[];
  events: AffiliateEventRow[];
  notes: AffiliateNoteRow[];
  emails: EmailOutboxRow[];
  applicationId: string | null;
  blockers: string[];
};

const PAYOUT_ACCOUNT_COLUMNS =
  'id, affiliate_id, method_code, status, source, requested_by, requested_at, reviewed_by, reviewed_at, review_note, replaced_at, created_at, updated_at';

export async function findAffiliate(id: string): Promise<AffiliateDetail | null> {
  if (!UUID.test(id)) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data: affiliate } = await supabase.from('affiliates').select('*').eq('id', id).maybeSingle();
  if (!affiliate) return null;
  const row = affiliate as AffiliateRow;

  const [category, terms, ownRules, categoryRules, campaigns, codes, payouts, events, notes, emails, application] =
    await Promise.all([
      supabase.from('affiliate_categories').select('*').eq('id', row.category_id).maybeSingle(),
      supabase.rpc('affiliate_effective_terms', { p_affiliate_id: id }),
      supabase.from('affiliate_rules').select('*').eq('affiliate_id', id).order('valid_from', { ascending: false }),
      supabase.from('affiliate_rules').select('*').eq('category_id', row.category_id).order('valid_from', { ascending: false }),
      supabase.from('affiliate_campaigns').select('*').eq('affiliate_id', id).order('created_at'),
      supabase.from('affiliate_codes').select('*').eq('affiliate_id', id).order('created_at'),
      supabase
        .from('affiliate_payout_accounts')
        .select(PAYOUT_ACCOUNT_COLUMNS)
        .eq('affiliate_id', id)
        .order('requested_at', { ascending: false }),
      supabase.from('affiliate_events').select('*').eq('affiliate_id', id).order('created_at', { ascending: false }).limit(200),
      supabase.from('affiliate_notes').select('*').eq('affiliate_id', id).order('created_at', { ascending: false }),
      supabase
        .from('email_outbox')
        .select('*')
        .eq('entity_type', 'affiliate')
        .eq('entity_id', id)
        .order('created_at', { ascending: false }),
      supabase.from('affiliate_applications').select('id').eq('affiliate_id', id).maybeSingle(),
    ]);

  let blockers: string[] = [];
  if (row.status === 'PREPARATION') {
    const { data } = await supabase.rpc('affiliate_activation_blockers', { p_affiliate_id: id });
    blockers = data ?? [];
  }

  return {
    affiliate: row,
    category: (category.data ?? null) as AffiliateCategoryRow | null,
    terms: ((terms.data ?? [])[0] ?? null) as EffectiveTerms | null,
    rules: [...((ownRules.data ?? []) as AffiliateRuleRow[]), ...((categoryRules.data ?? []) as AffiliateRuleRow[])],
    campaigns: (campaigns.data ?? []) as AffiliateCampaignRow[],
    codes: (codes.data ?? []) as AffiliateCodeRow[],
    payoutAccounts: (payouts.data ?? []) as AffiliatePayoutAccountRow[],
    events: (events.data ?? []) as AffiliateEventRow[],
    notes: (notes.data ?? []) as AffiliateNoteRow[],
    emails: (emails.data ?? []) as EmailOutboxRow[],
    applicationId: (application.data as { id: string } | null)?.id ?? null,
    blockers,
  };
}

/** Coordonnées d'une demande de versement. `null` sans `payouts.view`. */
export async function readPayoutAccountDetails(id: string): Promise<Record<string, string> | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('payout_account_details', { p_account_id: id });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  return Object.fromEntries(
    Object.entries(data as Record<string, Json>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export type OfferOption = {
  type: 'SERVICE' | 'PRODUCT';
  id: string;
  title: string;
  eligible: boolean;
  maxRate: number | null;
};

/** Offres du catalogue, pour cibler une règle ou un code. */
export async function listOffers(): Promise<OfferOption[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  const [services, products] = await Promise.all([
    supabase.from('services').select('id, title, affiliate_eligible, affiliate_max_rate').order('title'),
    supabase.from('products').select('id, title, affiliate_eligible, affiliate_max_rate').order('title'),
  ]);
  type OfferRow = { id: string; title: string; affiliate_eligible: boolean; affiliate_max_rate: number | null };
  const map = (type: 'SERVICE' | 'PRODUCT') => (row: OfferRow): OfferOption => ({
    type,
    id: row.id,
    title: row.title,
    eligible: row.affiliate_eligible,
    maxRate: row.affiliate_max_rate,
  });
  return [
    ...((services.data ?? []) as OfferRow[]).map(map('SERVICE')),
    ...((products.data ?? []) as OfferRow[]).map(map('PRODUCT')),
  ];
}

export async function listPayoutMethods(): Promise<{ code: string; label: string; kind: string }[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase.rpc('affiliate_payout_methods');
  return (data ?? []).map((row) => ({ code: row.code, label: row.label, kind: row.kind }));
}

export async function findCategory(
  id: string,
): Promise<{ category: AffiliateCategoryRow; rules: AffiliateRuleRow[]; members: number } | null> {
  if (!UUID.test(id)) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data: category } = await supabase.from('affiliate_categories').select('*').eq('id', id).maybeSingle();
  if (!category) return null;
  const [rules, members] = await Promise.all([
    supabase.from('affiliate_rules').select('*').eq('category_id', id).order('valid_from', { ascending: false }),
    supabase.from('affiliates').select('id', { count: 'exact', head: true }).eq('category_id', id),
  ]);
  return {
    category: category as AffiliateCategoryRow,
    rules: (rules.data ?? []) as AffiliateRuleRow[],
    members: members.count ?? 0,
  };
}

// -----------------------------------------------------------------------------
// Commissions — phase 4H-5
// -----------------------------------------------------------------------------

export type CommissionTotals = {
  forecast: number;
  acquired: number;
  to_pay: number;
  paid: number;
  cancelled: number;
  adjustments_pending: number;
};

export type CommissionListEntry = AffiliateCommissionRow & { net: number; affiliate_name: string };

/** Commissions lisibles par la session (RLS : commissions.view, ou l'affilié lui-même). */
export async function listCommissions(filter: { affiliateId?: string; status?: CommissionStatus } = {}): Promise<CommissionListEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  let query = supabase
    .from('affiliate_commissions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (filter.affiliateId) query = query.eq('affiliate_id', filter.affiliateId);
  if (filter.status) query = query.eq('status', filter.status);
  const { data } = await query;
  const rows = (data ?? []) as AffiliateCommissionRow[];
  if (rows.length === 0) return [];
  const [adjustments, affiliates] = await Promise.all([
    supabase.from('affiliate_commission_adjustments').select('commission_id, amount').in('commission_id', rows.map((row) => row.id)),
    supabase.from('affiliates').select('id, display_name').in('id', [...new Set(rows.map((row) => row.affiliate_id))]),
  ]);
  const delta = new Map<string, number>();
  for (const adj of (adjustments.data ?? []) as { commission_id: string | null; amount: number }[]) {
    if (adj.commission_id) delta.set(adj.commission_id, (delta.get(adj.commission_id) ?? 0) + Number(adj.amount));
  }
  const names = new Map(((affiliates.data ?? []) as { id: string; display_name: string }[]).map((row) => [row.id, row.display_name]));
  return rows.map((row) => ({
    ...row,
    net: Math.round((Number(row.amount) + (delta.get(row.id) ?? 0)) * 100) / 100,
    affiliate_name: names.get(row.affiliate_id) ?? '—',
  }));
}

export async function readCommissionTotals(affiliateId: string): Promise<CommissionTotals | null> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('affiliate_commission_totals', { p_affiliate_id: affiliateId });
  if (error || !data?.[0]) return null;
  const row = data[0];
  return {
    forecast: Number(row.forecast),
    acquired: Number(row.acquired),
    to_pay: Number(row.to_pay),
    paid: Number(row.paid),
    cancelled: Number(row.cancelled),
    adjustments_pending: Number(row.adjustments_pending),
  };
}

export type CommissionDetail = {
  commission: AffiliateCommissionRow;
  adjustments: AffiliateAdjustmentRow[];
  affiliate: Pick<AffiliateRow, 'id' | 'display_name' | 'reference' | 'user_id'> | null;
};

export async function findCommission(id: string): Promise<CommissionDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.from('affiliate_commissions').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  const commission = data as AffiliateCommissionRow;
  const [adjustments, affiliate] = await Promise.all([
    supabase.from('affiliate_commission_adjustments').select('*').eq('commission_id', id).order('created_at'),
    supabase.from('affiliates').select('id, display_name, reference, user_id').eq('id', commission.affiliate_id).maybeSingle(),
  ]);
  return {
    commission,
    adjustments: (adjustments.data ?? []) as AffiliateAdjustmentRow[],
    affiliate: (affiliate.data ?? null) as CommissionDetail['affiliate'],
  };
}

/** Ajustements d'un affilié non rattachés à une commission (corrections de versement). */
export async function listLooseAdjustments(affiliateId: string): Promise<AffiliateAdjustmentRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from('affiliate_commission_adjustments')
    .select('*')
    .eq('affiliate_id', affiliateId)
    .order('created_at', { ascending: false })
    .limit(200);
  return (data ?? []) as AffiliateAdjustmentRow[];
}

// -----------------------------------------------------------------------------
// Versements — phase 4H-6
// -----------------------------------------------------------------------------

export type PayableEntry = AffiliationFunctions['affiliate_payable_overview']['Returns'][number];

export async function listPayable(): Promise<PayableEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase.rpc('affiliate_payable_overview');
  return data ?? [];
}

export type PayoutListEntry = AffiliatePayoutRow & { affiliate_name: string };

const PAYOUT_COLUMNS =
  'id, affiliate_id, status, reference, document_id, period_label, total_amount, currency, method_code, method_snapshot, transaction_reference, prepared_at, confirmed_at, cancelled_at, created_at, updated_at';

export async function listPayouts(filter: { affiliateId?: string } = {}): Promise<PayoutListEntry[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  let query = supabase.from('affiliate_payouts').select(PAYOUT_COLUMNS).order('created_at', { ascending: false }).limit(300);
  if (filter.affiliateId) query = query.eq('affiliate_id', filter.affiliateId);
  const { data } = await query;
  const rows = (data ?? []) as unknown as AffiliatePayoutRow[];
  if (rows.length === 0) return [];
  const { data: affiliates } = await supabase
    .from('affiliates')
    .select('id, display_name')
    .in('id', [...new Set(rows.map((row) => row.affiliate_id))]);
  const names = new Map(((affiliates ?? []) as { id: string; display_name: string }[]).map((row) => [row.id, row.display_name]));
  return rows.map((row) => ({ ...row, affiliate_name: names.get(row.affiliate_id) ?? '—' }));
}

export type PayoutDetail = {
  payout: AffiliatePayoutRow;
  items: AffiliatePayoutItemRow[];
  internal: AffiliationFunctions['affiliate_payout_internal']['Returns'][number] | null;
  affiliate: Pick<AffiliateRow, 'id' | 'display_name' | 'reference' | 'user_id' | 'status'> | null;
};

export async function findPayout(id: string): Promise<PayoutDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.from('affiliate_payouts').select(PAYOUT_COLUMNS).eq('id', id).maybeSingle();
  if (!data) return null;
  const payout = data as unknown as AffiliatePayoutRow;
  const [items, internal, affiliate] = await Promise.all([
    supabase.from('affiliate_payout_items').select('*').eq('payout_id', id).order('created_at'),
    supabase.rpc('affiliate_payout_internal', { p_payout_id: id }),
    supabase.from('affiliates').select('id, display_name, reference, user_id, status').eq('id', payout.affiliate_id).maybeSingle(),
  ]);
  return {
    payout,
    items: (items.data ?? []) as AffiliatePayoutItemRow[],
    internal: internal.data?.[0] ?? null,
    affiliate: (affiliate.data ?? null) as PayoutDetail['affiliate'],
  };
}
