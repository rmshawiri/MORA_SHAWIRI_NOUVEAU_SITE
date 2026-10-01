import { NextResponse } from 'next/server';

import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Justificatif d'un versement d'affiliation — phase 4H-6.
 *
 * Le bucket est privé et sans aucune politique de lecture. La base décide
 * d'abord : `affiliate_payout_internal` n'ouvre le chemin du fichier qu'à
 * `payouts.view`, sous la session de l'appelant. Le serveur ne signe une URL
 * — cinq minutes — qu'après ce feu vert. Un justificatif inaccessible est
 * introuvable, pas interdit : rien n'apprend qu'il existe.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const refused = NextResponse.json({ erreur: 'Introuvable.' }, { status: 404 });
  refused.headers.set('Cache-Control', 'no-store');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return refused;

  const supabase = await getServerSupabaseClient();
  const privileged = getAdminSupabaseClient();
  if (!supabase || !privileged) return refused;
  const { data, error } = await supabase.rpc('affiliate_payout_internal', { p_payout_id: id });
  const path = data?.[0]?.proof_path;
  if (error || !path) return refused;

  const signed = await privileged.storage.from('affiliation-justificatifs').createSignedUrl(path, 300);
  if (signed.error || !signed.data) return refused;
  const response = NextResponse.redirect(signed.data.signedUrl, 307);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}
