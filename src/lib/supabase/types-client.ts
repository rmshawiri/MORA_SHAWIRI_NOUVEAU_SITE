/**
 * Typage des tables et fonctions de l'espace client — phase 4I.
 *
 * Même règle que `types-affiliation.ts` : écrit à la main, aligné sur
 * `supabase/migrations/20261002*`, intégré au schéma `Database` par
 * `types.ts`.
 */

export type ContactPreference = 'WHATSAPP' | 'TELEPHONE' | 'EMAIL';

export type ClientRow = {
  user_id: string;
  /** `MORA-CLI-A0001` — allouée par le moteur 4D, définitive. */
  reference: string;
  whatsapp: string | null;
  contact_preference: ContactPreference | null;
  created_at: string;
  updated_at: string;
  /** 4I-4 : blocage du client (espace et accès propriétaire fermés). */
  blocked_at?: string | null;
  blocked_by?: string | null;
  block_reason?: string | null;
  profile_suspended_by_block?: boolean;
};

/** 4I-4 : note interne, en ajout seul. */
export type ClientNoteRow = {
  id: string;
  client_user_id: string;
  body: string;
  corrects_note_id: string | null;
  author_id: string | null;
  author_label: string | null;
  created_at: string;
};

/** 4I-4 : historique des blocages et déblocages. */
export type ClientStatusEventRow = {
  id: number;
  client_user_id: string;
  kind: 'BLOCAGE' | 'DEBLOCAGE';
  reason: string | null;
  profile_suspended: boolean;
  actor_id: string | null;
  actor_label: string | null;
  created_at: string;
};

export type AdminClientListRow = {
  user_id: string;
  reference: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  contact_preference: ContactPreference | null;
  profile_status: string;
  blocked: boolean;
  created_at: string;
  last_login_at: string | null;
  total_count: number;
};

export type HistoricalClaimRow = {
  item_kind: 'DEMANDE' | 'RENDEZ_VOUS';
  item_id: string;
  reference: string | null;
  subject: string;
  created_at: string;
  client_user_id: string;
  client_reference: string | null;
};

type T<Row, Insert = never, Update = never> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type ClientTables = {
  // Aucune écriture directe : la fiche naît d'un déclencheur, et le client
  // n'écrit que par `update_my_client_profile`. Notes et historique de
  // blocage : par fonctions seulement (4I-4).
  clients: T<ClientRow>;
  client_notes: T<ClientNoteRow>;
  client_status_events: T<ClientStatusEventRow>;
};

/** 4I-3 : demande ou rendez-vous déposé hors connexion, rattachable par le client. */
export type ClaimableItem = {
  item_kind: 'DEMANDE' | 'RENDEZ_VOUS';
  item_id: string;
  reference: string | null;
  subject: string;
  created_at: string;
};

/** 4I-3 : événement public de la chronologie d'une demande (jamais d'acteur). */
export type RequestTimelineEntry = {
  occurred_at: string;
  kind: 'CREATION' | 'STATUT' | 'DEVIS_STATUT';
  from_status: string | null;
  to_status: string | null;
  quote_reference: string | null;
  by_me: boolean;
  note: string | null;
};

/** 4I-3 : événement public de la chronologie d'un rendez-vous (jamais d'acteur). */
export type AppointmentTimelineEntry = {
  occurred_at: string;
  kind: 'CREATION' | 'STATUT' | 'REPROGRAMMATION';
  from_status: string | null;
  to_status: string | null;
  scheduled_at_before: string | null;
  scheduled_at_after: string | null;
  by_me: boolean;
  note: string | null;
};

export type ClientFunctions = {
  ensure_my_client_reference: { Args: Record<string, never>; Returns: string | null };
  update_my_client_profile: {
    Args: {
      p_full_name: string;
      p_phone: string | null;
      p_whatsapp: string | null;
      p_contact_preference: ContactPreference | null;
    };
    Returns: ClientRow;
  };
  my_claimable_requests: { Args: Record<string, never>; Returns: ClaimableItem[] };
  claim_my_requests: {
    Args: Record<string, never>;
    Returns: { demandes: number; references: string[]; rendez_vous: number; conflits: number };
  };
  respond_to_my_quote: {
    Args: { p_quote_id: string; p_decision: 'ACCEPTE' | 'REFUSE'; p_reason: string | null };
    Returns: { id: string; status: string };
  };
  cancel_my_appointment: { Args: { p_appointment_id: string; p_reason: string }; Returns: { id: string; status: string } };
  my_request_timeline: { Args: { p_request_id: string }; Returns: RequestTimelineEntry[] };
  my_appointment_timeline: { Args: { p_appointment_id: string }; Returns: AppointmentTimelineEntry[] };
  my_client_space_state: { Args: Record<string, never>; Returns: 'AUCUN' | 'BLOQUE' | 'ACTIF' | null };
  admin_list_clients: {
    Args: {
      p_search: string | null;
      p_state: string | null;
      p_preference: string | null;
      p_sort: string;
      p_limit: number;
      p_offset: number;
    };
    Returns: AdminClientListRow[];
  };
  admin_client_identity: {
    Args: { p_user_id: string };
    Returns: { email: string; email_confirmed: boolean; roles: string[]; last_sign_in_at: string | null }[];
  };
  block_client: { Args: { p_user_id: string; p_reason: string }; Returns: ClientRow };
  unblock_client: { Args: { p_user_id: string; p_reason: string | null }; Returns: ClientRow };
  add_client_note: { Args: { p_user_id: string; p_body: string; p_corrects: string | null }; Returns: ClientNoteRow };
  historical_claimable_requests: { Args: Record<string, never>; Returns: HistoricalClaimRow[] };
  attach_historical_request: {
    Args: { p_kind: 'DEMANDE' | 'RENDEZ_VOUS'; p_item_id: string; p_reason: string };
    Returns: { element: string; compte: string };
  };
};
