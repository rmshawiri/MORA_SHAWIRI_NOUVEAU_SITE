/**
 * Typage des lignes de devis et des fonctions des documents commerciaux —
 * corrections post-4I (remarques 01).
 *
 * Même règle que `types-client.ts` : écrit à la main, aligné sur
 * `supabase/migrations/20261003120000_documents_commerciaux.sql`, intégré au
 * schéma `Database` par `types.ts`.
 */

import type { DocumentRow, Json, QuoteRow } from './types';

export type QuoteItemRow = {
  id: string;
  quote_id: string;
  position: number;
  designation: string;
  description: string | null;
  /** `numeric` : PostgREST le sérialise en nombre. */
  quantity: number | string;
  unit_price: number | string;
  discount_amount: number | string;
  /** Calculé par la base : `round(quantité × prix, 2) − remise`. */
  line_total: number | string;
  created_at: string;
};

type T<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type CommercialTables = {
  /** Lecture seule : écrites par `save_quote_draft`. */
  quote_items: T<QuoteItemRow>;
};

/** Ligne envoyée à `save_quote_draft` ; revalidée intégralement en base. */
export type QuoteLineInput = {
  designation: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
};

export type CommercialFunctions = {
  save_quote_draft: {
    Args: {
      p_request_reference: string | null;
      p_quote_id: string | null;
      p_summary: string;
      p_notes: string | null;
      p_valid_until: string | null;
      p_lines: Json;
      p_replaces: string | null;
    };
    Returns: QuoteRow;
  };
  quote_preview: { Args: { p_quote_id: string }; Returns: Json };
  issue_order_document: { Args: { p_order_id: string }; Returns: DocumentRow };
};
