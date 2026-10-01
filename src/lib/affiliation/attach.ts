import 'server-only';

import { getAdminSupabaseClient } from '@/lib/supabase/admin';

import { ATTRIBUTION_COOKIE, readAttributionToken } from './tracking';

/**
 * Rattache une demande au dernier lien d'affiliation suivi — phase 4H.
 *
 * Appelé par la route de contact, après l'enregistrement. La clé de service
 * n'écrit que ce que `attach_click_to_request` décide : la fonction vérifie
 * que le clic existe, que la fenêtre d'attribution n'est pas dépassée, que
 * l'affilié est actif et qu'il ne s'agit pas d'une auto-affiliation.
 */
export async function attachReferral(request: Request, reference: string): Promise<void> {
  const cookies = request.headers.get('cookie') ?? '';
  const match = cookies.match(new RegExp(`(?:^|;\s*)${ATTRIBUTION_COOKIE}=([^;]+)`));
  const token = readAttributionToken(match?.[1] ?? null);
  if (!token) return;
  const admin = getAdminSupabaseClient();
  if (!admin) return;
  try {
    await admin.rpc('attach_click_to_request', { p_reference: reference, p_click_token: token });
  } catch {
    console.error('[affiliation] rattachement du clic impossible');
  }
}
