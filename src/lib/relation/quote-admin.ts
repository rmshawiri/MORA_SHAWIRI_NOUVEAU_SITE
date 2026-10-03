import 'server-only';

/**
 * Lectures complémentaires de la fiche d'une demande — remarques 01.
 *
 * Tout passe par la session, donc par RLS : un administrateur sans
 * `orders.view` ne voit pas la commande issue de la demande, sans `quotes.view`
 * il ne voit ni lignes ni e-mails. Rien n'est lu avec la clé serveur.
 */

import type { QuoteLineDraft } from '@/lib/relation/quote-lines';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { Json, OrderStatus, QuoteRequestRow, QuoteRow } from '@/lib/supabase/types';
import type { QuoteItemRow } from '@/lib/supabase/types-commercial';
import type { EmailOutboxRow } from '@/lib/supabase/types-affiliation';

export type QuoteWorkspace = {
  itemsByQuote: Map<string, QuoteItemRow[]>;
  emails: EmailOutboxRow[];
  orders: { reference: string; status: OrderStatus; quote_id: string | null }[];
  /** Offre du catalogue de la demande, avec son prix public s'il est défini. */
  offer: { title: string; price: number | null; priceLabel: string | null } | null;
};

export async function loadQuoteWorkspace(request: QuoteRequestRow, quotes: readonly QuoteRow[]): Promise<QuoteWorkspace> {
  const empty: QuoteWorkspace = { itemsByQuote: new Map(), emails: [], orders: [], offer: null };
  const supabase = await getServerSupabaseClient();
  if (!supabase) return empty;

  const ids = quotes.map((quote) => quote.id);
  const [items, emails, orders, service] = await Promise.all([
    ids.length > 0
      ? supabase.from('quote_items').select('*').in('quote_id', ids).order('position', { ascending: true })
      : Promise.resolve({ data: [] as QuoteItemRow[] }),
    ids.length > 0
      ? supabase
          .from('email_outbox')
          .select('*')
          .eq('entity_type', 'quote')
          .in('entity_id', ids)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as EmailOutboxRow[] }),
    supabase.from('orders').select('reference, status, quote_id').eq('quote_request_id', request.id),
    request.service_id
      ? supabase.from('services').select('title, price_amount, price_label').eq('id', request.service_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const itemsByQuote = new Map<string, QuoteItemRow[]>();
  for (const item of (items.data ?? []) as QuoteItemRow[]) {
    itemsByQuote.set(item.quote_id, [...(itemsByQuote.get(item.quote_id) ?? []), item]);
  }

  const row = service.data as { title: string; price_amount: number | string | null; price_label: string | null } | null;
  return {
    itemsByQuote,
    emails: (emails.data ?? []) as EmailOutboxRow[],
    orders: (orders.data ?? []) as QuoteWorkspace['orders'],
    offer: row
      ? {
          title: row.title,
          price: row.price_amount === null ? null : Number(row.price_amount),
          priceLabel: row.price_label,
        }
      : null,
  };
}

const plain = (value: number | string) => String(Number(value)).replace('.', ',');

/** Lignes d'un brouillon existant, pour le rouvrir dans l'éditeur. */
export function draftLines(items: readonly QuoteItemRow[], quote: QuoteRow): QuoteLineDraft[] {
  if (items.length === 0) {
    // Brouillon antérieur aux lignes : une ligne, celle qu'il portait.
    return [{ designation: quote.summary.slice(0, 300), description: '', quantity: '1', unitPrice: plain(quote.amount), discount: '' }];
  }
  return items.map((item) => ({
    designation: item.designation,
    description: item.description ?? '',
    quantity: plain(item.quantity),
    unitPrice: plain(item.unit_price),
    discount: Number(item.discount_amount) > 0 ? plain(item.discount_amount) : '',
  }));
}

/**
 * Première ligne proposée pour un nouveau devis : l'offre demandée, au prix
 * du catalogue s'il est défini, à la quantité demandée par le client (parcours
 * « prix défini »). Une proposition, que l'administrateur corrige librement.
 */
export function suggestedLines(request: QuoteRequestRow, offer: QuoteWorkspace['offer']): QuoteLineDraft[] {
  const quantity = requestedQuantity(request.details);
  return [
    {
      designation: offer?.title ?? request.offer_title ?? '',
      description: '',
      quantity: String(quantity ?? 1),
      unitPrice: offer?.price !== null && offer?.price !== undefined ? plain(offer.price) : '',
      discount: '',
    },
  ];
}

/** Quantité demandée sur une offre à prix défini (réponse « Quantité »), ou `null`. */
export function requestedQuantity(details: Json): number | null {
  if (!Array.isArray(details)) return null;
  for (const entry of details) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, Json>;
    if (record.label === 'Quantité' && typeof record.value === 'string') {
      const value = Number(record.value);
      return Number.isInteger(value) && value > 0 && value <= 999 ? value : null;
    }
  }
  return null;
}
