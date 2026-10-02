import type { Metadata } from 'next';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { describeDiscount } from '@/lib/affiliation/affiliates';
import { kmf } from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';
import { getMySpace } from '@/lib/affiliation/space';
import { codeState } from '@/lib/affiliation/space-labels';
import type { AffiliateCodeRow } from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Codes partenaires',
  robots: { index: false, follow: false },
};

/**
 * Codes partenaires (phase 4H-8) — lecture seule.
 *
 * Les codes sont créés par MORA Shawiri (décision N4) et appliqués par elle
 * à l'affaire du client. L'écran distingue sans ambiguïté la **remise** que le
 * code accorde au client de la **commission** de l'affilié, qui n'en dépend
 * pas.
 */
export default async function CodesPage() {
  const space = await getMySpace();
  if (space.state !== 'ready') return null;
  const { affiliate, supabase } = space;

  const [codes, services, products] = await Promise.all([
    supabase.from('affiliate_codes').select('*').eq('affiliate_id', affiliate.id).order('created_at', { ascending: false }),
    supabase.from('services').select('id, title').eq('status', 'PUBLIE'),
    supabase.from('products').select('id, title').eq('status', 'PUBLIE'),
  ]);
  const rows = (codes.data ?? []) as AffiliateCodeRow[];
  const titles = new Map([...(services.data ?? []), ...(products.data ?? [])].map((row) => [row.id as string, row.title as string]));
  const names = (ids: readonly string[]) => ids.map((id) => titles.get(id) ?? 'une offre du catalogue').join(', ');

  return (
    <SpaceCard title="Mes codes partenaires" intro="Communiquez votre code à vos contacts : MORA Shawiri l’applique à leur commande.">
      <p className="aff-distinct">
        <strong>Remise client ≠ commission.</strong> La réduction indiquée est accordée à votre client sur sa commande. Votre
        commission, elle, est calculée selon vos règles, sur le montant réellement payé.
      </p>
      {rows.length === 0 ? (
        <SpaceEmpty title="Aucun code partenaire pour le moment">MORA Shawiri vous en attribuera un si votre activité s’y prête.</SpaceEmpty>
      ) : (
        <SpaceList label="Codes partenaires">
          {rows.map((code) => {
            const state = codeState(code);
            const conditions = [
              code.min_order_amount ? `commande d’au moins ${kmf(code.min_order_amount)}` : null,
              code.max_discount_amount ? `remise plafonnée à ${kmf(code.max_discount_amount)}` : null,
              code.max_uses ? `${code.max_uses} utilisation(s) au total` : null,
              code.max_uses_per_customer ? `${code.max_uses_per_customer} par client` : null,
            ].filter(Boolean);
            const scope = [...code.service_ids, ...code.product_ids];
            const excluded = [...code.excluded_service_ids, ...code.excluded_product_ids];
            return (
              <SpaceItem
                key={code.id}
                title={<span className="aff-code">{code.code}</span>}
                amount={`Remise client : ${describeDiscount(code.discount_kind, code.discount_value)}`}
                status={state.label}
                tone={state.tone}
                meta={`Du ${formatMoment(code.valid_from)}${code.valid_to ? ` au ${formatMoment(code.valid_to)}` : ', sans date de fin'}`}
              >
                <dl className="auth-meta">
                  {code.label ? (
                    <div>
                      <dt>Libellé</dt>
                      <dd>{code.label}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Offres concernées</dt>
                    <dd>{scope.length > 0 ? names(scope) : 'Toutes les offres éligibles'}</dd>
                  </div>
                  {excluded.length > 0 ? (
                    <div>
                      <dt>Offres exclues</dt>
                      <dd>{names(excluded)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Conditions</dt>
                    <dd>{conditions.length > 0 ? conditions.join(' · ') : 'Aucune condition particulière'}</dd>
                  </div>
                </dl>
              </SpaceItem>
            );
          })}
        </SpaceList>
      )}
      <p className="form__note">Un seul code s’applique par commande. Il ne se cumule pas avec un autre code.</p>
    </SpaceCard>
  );
}
