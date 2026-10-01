/**
 * Suivi des liens d'affiliation — module pur, utilisé par le proxy.
 *
 * Ce qu'il décide, et lui seul :
 *
 *   * si une requête porte un lien d'affiliation exploitable ;
 *   * à quoi ressemble l'URL une fois nettoyée de `ref` et `c` — aucun
 *     identifiant ne reste dans la barre d'adresse, ni dans un lien recopié ;
 *   * qui n'est pas un visiteur (robots d'aperçu de WhatsApp, Facebook…) ;
 *   * les attributs du cookie d'attribution.
 *
 * Le cookie ne porte qu'un jeton aléatoire, émis par la base. Il n'ouvre
 * aucun droit et ne désigne personne : la base le revérifie (affilié actif,
 * fenêtre respectée, pas d'auto-affiliation) au moment de l'utiliser.
 */

import { CAMPAIGN_PARAM, REF_PARAM } from './affiliates';

export const ATTRIBUTION_COOKIE = 'mora_aff';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ReferralHit = { slug: string; campaign: string | null; cleanUrl: URL };

/** Lien d'affiliation exploitable, ou `null`. N'accepte que des identifiants propres. */
export function readReferral(url: URL): ReferralHit | null {
  const raw = url.searchParams.get(REF_PARAM);
  if (raw === null) return null;
  const slug = raw.trim().toLowerCase();
  const campaignRaw = url.searchParams.get(CAMPAIGN_PARAM);
  const campaign = campaignRaw ? campaignRaw.trim().toLowerCase() : null;

  const cleanUrl = new URL(url.toString());
  cleanUrl.searchParams.delete(REF_PARAM);
  cleanUrl.searchParams.delete(CAMPAIGN_PARAM);

  if (!SLUG.test(slug) || slug.length > 48) return { slug: '', campaign: null, cleanUrl };
  return { slug, campaign: campaign && SLUG.test(campaign) && campaign.length <= 32 ? campaign : null, cleanUrl };
}

const NOT_A_VISITOR =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegrambot|twitterbot|linkedinbot|discordbot|skypeuripreview|headless|curl|wget|python-requests|node-fetch/i;

/** Robots et aperçus de liens : ils ouvrent l'URL sans visiteur derrière. */
export function isAutomatedAgent(userAgent: string | null): boolean {
  return !userAgent || NOT_A_VISITOR.test(userAgent);
}

/** Jeton lu dans le cookie : un UUID, ou rien. */
export function readAttributionToken(value: string | undefined | null): string | null {
  return value && UUID.test(value) ? value : null;
}

/** Attributs du cookie d'attribution : minimal, inaccessible aux scripts. */
export function attributionCookie(token: string, windowDays: number, secure: boolean) {
  return {
    name: ATTRIBUTION_COOKIE,
    value: token,
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.max(1, Math.min(windowDays, 3650)) * 86_400,
  };
}
