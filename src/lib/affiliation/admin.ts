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
  AffiliateApplicationEventRow,
  AffiliateApplicationRow,
  AffiliateCategoryRow,
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
