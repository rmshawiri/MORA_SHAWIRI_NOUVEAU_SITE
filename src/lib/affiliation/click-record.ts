import 'server-only';

import { visitorHash, type ClickResult } from './click';

/**
 * Enregistrement d'un clic — appelé par le proxy, côté serveur uniquement.
 * Lit la clé secrète : ce module ne peut pas entrer dans un paquet client.
 * Un échec ne casse jamais la navigation : le visiteur arrive sur la page,
 * simplement sans cookie.
 */
export async function recordClick(input: {
  slug: string;
  campaign: string | null;
  landing: string;
  ip: string;
  userAgent: string;
}): Promise<ClickResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;

  const day = new Date().toISOString().slice(0, 10);
  try {
    const response = await fetch(`${url}/rest/v1/rpc/record_affiliate_click`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_slug: input.slug,
        p_campaign: input.campaign,
        p_landing: input.landing,
        p_visitor_hash: visitorHash(key, input.ip, input.userAgent, day),
      }),
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as { token: string; window_days: number }[];
    const row = rows[0];
    return row ? { token: row.token, windowDays: row.window_days } : null;
  } catch {
    return null;
  }
}
