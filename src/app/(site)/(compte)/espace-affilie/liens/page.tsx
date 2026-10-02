import type { Metadata } from 'next';

import { CampaignForm } from '@/components/affiliation/AffiliateSpaceForm';
import LinkCopyShare from '@/components/affiliation/LinkCopyShare';
import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { affiliateLink } from '@/lib/affiliation/affiliates';
import { createOwnCampaign } from '@/lib/affiliation/space-actions';
import { getMySpace, myStats } from '@/lib/affiliation/space';
import { getSiteUrl } from '@/lib/env';
import type { AffiliateCampaignRow } from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Liens et campagnes',
  robots: { index: false, follow: false },
};

/**
 * Liens et campagnes (phase 4H-8).
 *
 * Un lien principal stable, et des liens de campagne pour mesurer un canal
 * (WhatsApp, Facebook, salon…). Une campagne ne change pas la rémunération.
 * Les chiffres par campagne viennent de `affiliate_click_stats`, la même
 * fonction que l'administration.
 */
export default async function LiensPage() {
  const space = await getMySpace();
  if (space.state !== 'ready') return null;
  const { affiliate, supabase } = space;
  const site = getSiteUrl();

  const [campaigns, clickStats, stats] = await Promise.all([
    supabase.from('affiliate_campaigns').select('*').eq('affiliate_id', affiliate.id).order('created_at'),
    supabase.rpc('affiliate_click_stats', { p_affiliate_id: affiliate.id }),
    myStats(space),
  ]);
  const rows = (campaigns.data ?? []) as AffiliateCampaignRow[];
  const perCampaign = new Map(((clickStats.data ?? []) as { campaign_id: string | null; clicks: number; requests: number }[]).map((row) => [row.campaign_id, row]));
  const direct = perCampaign.get(null);

  return (
    <>
      <SpaceCard title="Mon lien principal" intro="Il ne change jamais. Les visites qu’il apporte, et les affaires qui suivent, vous sont attribuées.">
        <LinkCopyShare url={affiliateLink(site, affiliate.slug)} title="MORA Shawiri" />
        <p className="form__note">
          {direct ? `${direct.clicks} clic(s) et ${direct.requests} demande(s) par ce lien.` : 'Aucun clic enregistré sur ce lien pour le moment.'}{' '}
          Au total : {stats?.clicks ?? 0} clic(s).
        </p>
      </SpaceCard>

      <SpaceCard
        title="Mes liens de campagne"
        intro="Un lien par canal pour savoir ce qui fonctionne. Il ne change pas votre rémunération."
      >
        {rows.length === 0 ? (
          <SpaceEmpty title="Aucune campagne pour le moment">Créez un lien pour chaque canal où vous parlez de MORA Shawiri.</SpaceEmpty>
        ) : (
          <SpaceList label="Liens de campagne">
            {rows.map((campaign) => {
              const figures = perCampaign.get(campaign.id);
              return (
                <SpaceItem
                  key={campaign.id}
                  title={campaign.label}
                  status={campaign.is_active ? 'Active' : 'Désactivée'}
                  tone={campaign.is_active ? 'ok' : 'muted'}
                  meta={`${figures?.clicks ?? 0} clic(s) · ${figures?.requests ?? 0} demande(s)`}
                >
                  {campaign.is_active && affiliate.status === 'ACTIF' ? (
                    <LinkCopyShare url={affiliateLink(site, affiliate.slug, campaign.code)} title="MORA Shawiri" />
                  ) : (
                    <p>Ce lien n’attribue plus de nouvelles affaires.</p>
                  )}
                </SpaceItem>
              );
            })}
          </SpaceList>
        )}
      </SpaceCard>

      {affiliate.status !== 'TERMINE' ? (
        <SpaceCard title="Créer un lien de campagne">
          <CampaignForm action={createOwnCampaign} />
        </SpaceCard>
      ) : null}
    </>
  );
}
