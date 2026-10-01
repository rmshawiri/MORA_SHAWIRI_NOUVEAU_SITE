/**
 * Typage des tables et fonctions de l'affiliation — phase 4H.
 *
 * Tenu à part de `types.ts` pour que chaque lot de la phase ajoute ses
 * tables sans rouvrir un fichier de 1 800 lignes ; `types.ts` les intègre au
 * schéma `Database`. Même règle que lui : écrit à la main, aligné sur
 * `supabase/migrations/2026100114*` et suivantes.
 *
 * Les montants `numeric` arrivent en nombre (PostgREST), les taux aussi.
 */

import type { Json } from './types';

export type AffiliateStatus = 'PREPARATION' | 'ACTIF' | 'SUSPENDU' | 'TERMINE';
export type PayoutFrequency = 'HEBDOMADAIRE' | 'FIN_DE_MOIS' | 'TRIMESTRIEL' | 'A_LA_DEMANDE';
export type AcquisitionTrigger = 'PAIEMENT_INTEGRAL' | 'PREMIER_PAIEMENT' | 'VALIDATION_MANUELLE';
export type ProspectProtectionMode = 'DUREE' | 'PARTENARIAT';
export type AffiliateRuleKind = 'PERCENT' | 'FIXED' | 'TIERED' | 'EXCLUDED';
export type AffiliateRuleOwnerType = 'CATEGORY' | 'AFFILIATE';
export type AffiliateRuleTargetType = 'ALL' | 'SERVICE' | 'PRODUCT';

export type AffiliateCategoryRow = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  is_active: boolean;
  is_internal: boolean;
  sort_order: number;
  attribution_window_days: number;
  prospect_protection_mode: ProspectProtectionMode;
  prospect_protection_months: number | null;
  post_end_survival_months: number | null;
  payout_frequency: PayoutFrequency;
  payout_min_amount: number | null;
  acquisition_trigger: AcquisitionTrigger;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type AffiliateRow = {
  id: string;
  reference: string | null;
  slug: string;
  user_id: string | null;
  category_id: string;
  status: AffiliateStatus;
  party_type: 'PERSONNE' | 'ORGANISATION';
  display_name: string;
  legal_name: string | null;
  contact_email: string;
  contact_phone: string | null;
  country: string | null;
  city: string | null;
  contract_reference: string | null;
  contract_signed_on: string | null;
  started_on: string | null;
  ended_on: string | null;
  end_reason: string | null;
  attribution_window_days: number | null;
  prospect_protection_mode: ProspectProtectionMode | null;
  prospect_protection_months: number | null;
  post_end_survival_months: number | null;
  payout_frequency: PayoutFrequency | null;
  payout_min_amount: number | null;
  acquisition_trigger: AcquisitionTrigger | null;
  self_referral_allowed: boolean;
  self_referral_reason: string | null;
  activated_at: string | null;
  activated_by: string | null;
  suspended_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type AffiliateNoteRow = {
  id: string;
  affiliate_id: string;
  body: string;
  author_id: string | null;
  author_label: string | null;
  created_at: string;
};

export type AffiliateRuleRow = {
  id: string;
  version: number;
  supersedes_id: string | null;
  owner_type: AffiliateRuleOwnerType;
  category_id: string | null;
  affiliate_id: string | null;
  target_type: AffiliateRuleTargetType;
  service_id: string | null;
  product_id: string | null;
  kind: AffiliateRuleKind;
  rate: number | null;
  fixed_amount: number | null;
  tiers: Json | null;
  min_commission: number | null;
  max_commission: number | null;
  min_base: number | null;
  valid_from: string;
  valid_to: string | null;
  label: string | null;
  contractual_derogation: boolean;
  derogation_reason: string | null;
  derogation_granted_by: string | null;
  derogation_granted_at: string | null;
  created_at: string;
  created_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  owner_key: string;
  target_key: string;
};

export type AffiliateEventRow = {
  id: number;
  affiliate_id: string | null;
  category_id: string | null;
  event_type: string;
  summary: string;
  old_value: Json | null;
  new_value: Json | null;
  reason: string | null;
  actor_id: string | null;
  actor_label: string | null;
  created_at: string;
};

export type AffiliateApplicationStatus = 'NOUVELLE' | 'EN_ETUDE' | 'INFOS_REQUISES' | 'ACCEPTEE' | 'REFUSEE';

/** Sans `payout_details` : la colonne n'est accordée à aucune session. */
export type AffiliateApplicationRow = {
  id: string;
  status: AffiliateApplicationStatus;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  requested_profile: string;
  profile_answers: Json;
  motivation: string;
  collaboration_idea: string | null;
  payout_method_code: string;
  consent_given_at: string;
  consent_version: string;
  user_id: string | null;
  source: string | null;
  info_request: string | null;
  decision_message: string | null;
  refusal_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  affiliate_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AffiliateApplicationEventRow = {
  id: number;
  application_id: string;
  event_type: string;
  summary: string;
  old_status: string | null;
  new_status: string | null;
  message: string | null;
  actor_id: string | null;
  actor_label: string | null;
  created_at: string;
};

export type EmailOutboxStatus = 'EN_ATTENTE' | 'ENVOYE' | 'ECHEC';

export type EmailOutboxRow = {
  id: string;
  template: string;
  recipient: string;
  recipient_kind: 'EXTERNE' | 'EQUIPE';
  subject: string;
  html_body: string;
  text_body: string;
  entity_type: string | null;
  entity_id: string | null;
  status: EmailOutboxStatus;
  attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};


export type PayoutAccountStatus = 'DEMANDE' | 'ACTIF' | 'REFUSE' | 'REMPLACE' | 'RETIRE';

/** Sans `details` : la colonne n'est accordée à aucune session. */
export type AffiliatePayoutAccountRow = {
  id: string;
  affiliate_id: string;
  method_code: string;
  status: PayoutAccountStatus;
  source: 'CANDIDATURE' | 'AFFILIE' | 'ADMINISTRATION';
  requested_by: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  replaced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AffiliateCampaignRow = {
  id: string;
  affiliate_id: string;
  code: string;
  label: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AffiliateCodeRow = {
  id: string;
  affiliate_id: string;
  code: string;
  label: string | null;
  is_active: boolean;
  discount_kind: 'PERCENT' | 'FIXED';
  discount_value: number;
  valid_from: string;
  valid_to: string | null;
  min_order_amount: number | null;
  max_discount_amount: number | null;
  max_uses: number | null;
  max_uses_per_customer: number | null;
  service_ids: string[];
  product_ids: string[];
  excluded_service_ids: string[];
  excluded_product_ids: string[];
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
};

type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type T<Row, Insert = never, Update = never, Relationships extends readonly Rel[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationships;
};

export type AffiliationTables = {
  affiliate_categories: T<
    AffiliateCategoryRow,
    Pick<AffiliateCategoryRow, 'code' | 'label'> & Partial<AffiliateCategoryRow>,
    Partial<AffiliateCategoryRow>
  >;
  affiliates: T<
    AffiliateRow,
    Pick<AffiliateRow, 'slug' | 'category_id' | 'display_name' | 'contact_email'> & Partial<AffiliateRow>,
    Partial<AffiliateRow>,
    [
      {
        foreignKeyName: 'affiliates_category_id_fkey';
        columns: ['category_id'];
        isOneToOne: false;
        referencedRelation: 'affiliate_categories';
        referencedColumns: ['id'];
      },
    ]
  >;
  affiliate_notes: T<AffiliateNoteRow, Pick<AffiliateNoteRow, 'affiliate_id' | 'body'>>;
  affiliate_rules: T<AffiliateRuleRow, Partial<AffiliateRuleRow>, Partial<AffiliateRuleRow>>;
  affiliate_events: T<AffiliateEventRow>;
  affiliate_applications: T<AffiliateApplicationRow>;
  affiliate_application_events: T<AffiliateApplicationEventRow>;
  affiliate_payout_accounts: T<AffiliatePayoutAccountRow>;
  affiliate_campaigns: T<AffiliateCampaignRow>;
  affiliate_codes: T<
    AffiliateCodeRow,
    Pick<AffiliateCodeRow, 'affiliate_id' | 'code' | 'discount_kind' | 'discount_value'> & Partial<AffiliateCodeRow>,
    Partial<AffiliateCodeRow>
  >;
  email_outbox: T<
    EmailOutboxRow,
    Pick<EmailOutboxRow, 'template' | 'recipient' | 'subject' | 'html_body' | 'text_body'> &
      Partial<EmailOutboxRow>,
    Partial<EmailOutboxRow>
  >;
};

export type AffiliationFunctions = {
  can_view_affiliation: { Args: Record<string, never>; Returns: boolean };
  affiliate_payout_methods: {
    Args: Record<string, never>;
    Returns: { code: string; label: string; kind: string; sort_order: number }[];
  };
  submit_affiliate_application: {
    Args: {
      p_first_name: string;
      p_last_name: string;
      p_email: string;
      p_phone: string;
      p_country: string;
      p_city: string;
      p_profile: string;
      p_answers: Json;
      p_motivation: string;
      p_idea: string | null;
      p_payout_method: string;
      p_payout_details: Json;
      p_consent: boolean;
      p_consent_version: string;
      p_client_hash?: string | null;
    };
    Returns: { application_id: string; duplicate: boolean }[];
  };
  review_affiliate_application: {
    Args: { p_application_id: string; p_status: string; p_message?: string | null; p_reason?: string | null };
    Returns: AffiliateApplicationRow;
  };
  accept_affiliate_application: {
    Args: { p_application_id: string; p_category_id: string; p_message?: string | null };
    Returns: AffiliateRow;
  };
  note_affiliate_application: {
    Args: { p_application_id: string; p_body: string };
    Returns: undefined;
  };
  application_payout_details: {
    Args: { p_application_id: string };
    Returns: Json;
  };
  affiliate_effective_terms: {
    Args: { p_affiliate_id: string };
    Returns: {
      attribution_window_days: number;
      prospect_protection_mode: ProspectProtectionMode;
      prospect_protection_months: number | null;
      post_end_survival_months: number | null;
      payout_frequency: PayoutFrequency;
      payout_min_amount: number | null;
      acquisition_trigger: AcquisitionTrigger;
      self_referral_allowed: boolean;
    }[];
  };
  publish_affiliate_rule: {
    Args: {
      p_owner_type: AffiliateRuleOwnerType;
      p_owner_id: string;
      p_target_type: AffiliateRuleTargetType;
      p_target_id: string | null;
      p_kind: AffiliateRuleKind;
      p_rate: number | null;
      p_fixed_amount: number | null;
      p_tiers: Json | null;
      p_min_commission: number | null;
      p_max_commission: number | null;
      p_min_base: number | null;
      p_effective_at: string | null;
      p_label: string | null;
      p_reason: string;
      p_derogation?: boolean;
      p_derogation_reason?: string | null;
    };
    Returns: AffiliateRuleRow;
  };
  end_affiliate_rule: {
    Args: { p_rule_id: string; p_end_at: string | null; p_reason: string };
    Returns: AffiliateRuleRow;
  };
  withdraw_affiliate_rule: {
    Args: { p_rule_id: string; p_reason: string };
    Returns: undefined;
  };
  affiliate_activation_blockers: { Args: { p_affiliate_id: string }; Returns: string[] };
  activate_affiliate: {
    Args: { p_affiliate_id: string; p_user_id: string; p_started_on?: string | null };
    Returns: AffiliateRow;
  };
  change_affiliate_status: {
    Args: { p_affiliate_id: string; p_status: string; p_reason: string; p_ended_on?: string | null };
    Returns: AffiliateRow;
  };
  update_affiliate_terms: {
    Args: {
      p_affiliate_id: string;
      p_category_id: string;
      p_attribution_window_days: number | null;
      p_prospect_protection_mode: string | null;
      p_prospect_protection_months: number | null;
      p_post_end_survival_months: number | null;
      p_payout_frequency: string | null;
      p_payout_min_amount: number | null;
      p_acquisition_trigger: string | null;
      p_self_referral_allowed: boolean;
      p_self_referral_reason: string | null;
      p_reason: string;
    };
    Returns: AffiliateRow;
  };
  request_payout_account: { Args: { p_method: string; p_details: Json }; Returns: AffiliatePayoutAccountRow };
  propose_payout_account: {
    Args: { p_affiliate_id: string; p_method: string; p_details: Json };
    Returns: AffiliatePayoutAccountRow;
  };
  review_payout_account: {
    Args: { p_account_id: string; p_approve: boolean; p_note?: string | null };
    Returns: AffiliatePayoutAccountRow;
  };
  payout_account_details: { Args: { p_account_id: string }; Returns: Json };
  create_affiliate_campaign: {
    Args: { p_affiliate_id: string; p_code: string; p_label: string };
    Returns: AffiliateCampaignRow;
  };
  set_affiliate_campaign_active: {
    Args: { p_campaign_id: string; p_active: boolean };
    Returns: AffiliateCampaignRow;
  };
  find_auth_user_by_email: { Args: { p_email: string }; Returns: string | null };
};
