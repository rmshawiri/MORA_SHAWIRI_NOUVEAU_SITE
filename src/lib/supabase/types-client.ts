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
};

type T<Row, Insert = never, Update = never> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type ClientTables = {
  // Aucune écriture directe : la fiche naît d'un déclencheur, et le client
  // n'écrit que par `update_my_client_profile`.
  clients: T<ClientRow>;
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
};
