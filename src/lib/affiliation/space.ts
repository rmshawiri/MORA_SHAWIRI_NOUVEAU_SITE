import 'server-only';

/**
 * Espace affilié — lectures communes (phase 4H-8).
 *
 * Une seule règle : **l'espace lit la même vérité que l'administration**.
 * Rien n'est recalculé ici. Les chiffres viennent des fonctions de la base
 * (`affiliate_stats`, `affiliate_commission_totals`, `affiliate_click_stats`,
 * `my_affiliate_conversions`), les commissions et versements de leurs
 * instantanés figés, les pièces du moteur de documents — et la RLS décide de
 * ce que la session peut lire : l'affilié ne voit que ce qui est à lui.
 *
 * Toutes les lectures passent par le client de **session**. Aucune n'emploie
 * la clé à privilèges.
 */

import { cache } from 'react';

import { requirePrivateAccess } from '@/lib/auth/guards';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type {
  AffiliateAdjustmentRow,
  AffiliateCommissionRow,
  AffiliatePayoutItemRow,
  AffiliatePayoutRow,
  AffiliateRow,
} from '@/lib/supabase/types-affiliation';

type Client = NonNullable<Awaited<ReturnType<typeof getServerSupabaseClient>>>;

export type MySpace =
  | { state: 'ready'; supabase: Client; userId: string; affiliate: AffiliateRow }
  | { state: 'none' };

/** L'affiliation du compte connecté, une fois par requête. */
export const getMySpace = cache(async (): Promise<MySpace> => {
  await requirePrivateAccess(AUTH_ROUTES.affiliateArea);
  const supabase = await getServerSupabaseClient();
  if (!supabase) return { state: 'none' };
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return { state: 'none' };
  // RLS : `affiliates_select_own` ne rend que la ligne du compte connecté.
  const { data } = await supabase.from('affiliates').select('*').eq('user_id', me.user.id).maybeSingle();
  const affiliate = data as AffiliateRow | null;
  if (!affiliate || affiliate.status === 'PREPARATION') return { state: 'none' };
  return { state: 'ready', supabase, userId: me.user.id, affiliate };
});

export type CommissionTotals = {
  forecast: number;
  acquired: number;
  to_pay: number;
  paid: number;
  cancelled: number;
  adjustments_pending: number;
};

/** Les mêmes totaux que la fiche affilié de l'administration. */
export async function myTotals(space: Extract<MySpace, { state: 'ready' }>): Promise<CommissionTotals | null> {
  const { data } = await space.supabase.rpc('affiliate_commission_totals', { p_affiliate_id: space.affiliate.id });
  const row = data?.[0];
  if (!row) return null;
  return {
    forecast: Number(row.forecast),
    acquired: Number(row.acquired),
    to_pay: Number(row.to_pay),
    paid: Number(row.paid),
    cancelled: Number(row.cancelled),
    adjustments_pending: Number(row.adjustments_pending),
  };
}

export async function myStats(space: Extract<MySpace, { state: 'ready' }>) {
  const { data } = await space.supabase.rpc('affiliate_stats', { p_affiliate_id: space.affiliate.id });
  return data?.[0] ?? null;
}

export async function myCommissions(space: Extract<MySpace, { state: 'ready' }>, limit = 200) {
  const [commissions, adjustments] = await Promise.all([
    space.supabase.from('affiliate_commissions').select('*').eq('affiliate_id', space.affiliate.id).order('created_at', { ascending: false }).limit(limit),
    space.supabase.from('affiliate_commission_adjustments').select('*').eq('affiliate_id', space.affiliate.id).order('created_at', { ascending: false }).limit(500),
  ]);
  return {
    commissions: (commissions.data ?? []) as AffiliateCommissionRow[],
    adjustments: (adjustments.data ?? []) as AffiliateAdjustmentRow[],
  };
}

/** Versements confirmés (RLS) — colonnes accordées seulement : ni note interne, ni justificatif. */
export async function myPayouts(space: Extract<MySpace, { state: 'ready' }>, limit = 100) {
  const { data } = await space.supabase
    .from('affiliate_payouts')
    .select('id, affiliate_id, status, reference, period_label, total_amount, currency, method_snapshot, transaction_reference, confirmed_at')
    .eq('affiliate_id', space.affiliate.id)
    .order('confirmed_at', { ascending: false })
    .limit(limit);
  const payouts = (data ?? []) as unknown as AffiliatePayoutRow[];
  const { data: items } =
    payouts.length > 0
      ? await space.supabase.from('affiliate_payout_items').select('*').in('payout_id', payouts.map((row) => row.id)).order('created_at')
      : { data: [] };
  return { payouts, items: (items ?? []) as AffiliatePayoutItemRow[] };
}

export type MyDocument = { id: string; reference: string; doc_type: 'FIAF' | 'RVAF'; status: string; version: number; issued_at: string };

/** Pièces dont l'affilié est le titulaire (RLS : `owner_id`). */
export async function myDocuments(space: Extract<MySpace, { state: 'ready' }>): Promise<MyDocument[]> {
  const { data } = await space.supabase
    .from('documents')
    .select('id, reference, doc_type, status, version, issued_at')
    .eq('owner_id', space.userId)
    .in('doc_type', ['FIAF', 'RVAF'])
    .order('issued_at', { ascending: false })
    .limit(200);
  return (data ?? []) as MyDocument[];
}

export async function myConversions(space: Extract<MySpace, { state: 'ready' }>) {
  const { data } = await space.supabase.rpc('my_affiliate_conversions');
  return data ?? [];
}
