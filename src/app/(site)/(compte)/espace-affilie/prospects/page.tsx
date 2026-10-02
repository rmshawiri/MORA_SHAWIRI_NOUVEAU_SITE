import type { Metadata } from 'next';

import { CancelProspectButton, ProspectForm } from '@/components/affiliation/AffiliateSpaceForm';
import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { formatMoment } from '@/lib/affiliation/labels';
import { PROSPECT_STATUS_LABELS } from '@/lib/affiliation/prospects';
import { cancelProspect, declareProspect } from '@/lib/affiliation/space-actions';
import { getMySpace } from '@/lib/affiliation/space';
import { prospectTone } from '@/lib/affiliation/space-labels';
import type { AffiliateProspectRow } from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Mes prospects',
  robots: { index: false, follow: false },
};

/**
 * Prospects (phase 4H-8).
 *
 * L'affilié déclare ; MORA Shawiri reconnaît ou refuse — jamais l'affilié
 * lui-même. Les doublons sont refusés par la base, la déclaration exige
 * l'accord du prospect, et seule une affiliation active déclare.
 */
export default async function ProspectsPage() {
  const space = await getMySpace();
  if (space.state !== 'ready') return null;
  const { affiliate, supabase } = space;

  const { data } = await supabase
    .from('affiliate_prospects')
    .select('id, affiliate_id, status, full_name, company, phone, email, need, comment, consent_confirmed, lead_id, review_reason, reviewed_at, recognized_at, protected_until, converted_at, created_at, updated_at')
    .eq('affiliate_id', affiliate.id)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as AffiliateProspectRow[];
  const live = affiliate.status === 'ACTIF';

  return (
    <>
      <SpaceCard
        id="declarer"
        title="Déclarer un prospect"
        intro="Vous connaissez quelqu’un qui a besoin de MORA Shawiri ? Déclarez-le avec son accord : une fois reconnu, ses affaires vous sont attribuées pendant la durée de protection."
      >
        {live ? (
          <ProspectForm action={declareProspect} />
        ) : (
          <p>Votre affiliation n’est pas active : la déclaration de nouveaux prospects est fermée.</p>
        )}
      </SpaceCard>

      <SpaceCard title="Mes prospects" intro="MORA Shawiri vérifie chaque déclaration : un contact déjà connu peut être refusé, avec un motif.">
        {rows.length === 0 ? (
          <SpaceEmpty title="Aucun prospect déclaré">Les personnes que vous déclarez apparaîtront ici avec leur état.</SpaceEmpty>
        ) : (
          <SpaceList label="Prospects déclarés">
            {rows.map((prospect) => (
              <SpaceItem
                key={prospect.id}
                title={prospect.company ? `${prospect.full_name} — ${prospect.company}` : prospect.full_name}
                status={PROSPECT_STATUS_LABELS[prospect.status]}
                tone={prospectTone(prospect.status)}
                meta={`Déclaré le ${formatMoment(prospect.created_at)}`}
              >
                {prospect.status === 'RECONNU' && prospect.protected_until ? (
                  <p>Protégé pour vous jusqu’au {formatMoment(prospect.protected_until)}.</p>
                ) : null}
                {prospect.status === 'CONVERTI' && prospect.converted_at ? <p>Converti le {formatMoment(prospect.converted_at)}.</p> : null}
                {prospect.status === 'REFUSE' && prospect.review_reason ? <p>Motif : {prospect.review_reason}</p> : null}
                {prospect.status === 'DECLARE' || prospect.status === 'A_VERIFIER' ? (
                  <CancelProspectButton action={cancelProspect} prospectId={prospect.id} />
                ) : null}
              </SpaceItem>
            ))}
          </SpaceList>
        )}
      </SpaceCard>
    </>
  );
}
