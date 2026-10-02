import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceKpis, SpaceList, SpaceMore } from '@/components/affiliation/SpaceUi';
import { COMMISSION_STATUS_LABELS, kmf } from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';
import { formatPayoutDay } from '@/lib/affiliation/payouts';
import { commissionTone } from '@/lib/affiliation/space-labels';
import { getMySpace, myCommissions, myConversions, myDocuments, myPayouts, myStats, myTotals } from '@/lib/affiliation/space';
import type { AffiliateProspectRow } from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Mon espace affilié',
  description: 'Votre espace affilié MORA Shawiri.',
  robots: { index: false, follow: false },
};

/**
 * Tableau de bord de l'espace affilié (phase 4H-8).
 *
 * Les chiffres sont ceux que voit l'administration, lus aux mêmes sources :
 * `affiliate_stats` pour l'activité, `affiliate_commission_totals` pour
 * l'argent. Aucune métrique n'est fabriquée : un chiffre que la base ne sait
 * pas calculer n'est pas affiché.
 *
 * L'activité récente est reconstituée à partir des données de l'affilié
 * lui-même (prospects, commissions, versements, pièces) — jamais du journal
 * interne de l'administration, qui porte ses motifs et ses notes.
 */
export default async function TableauDeBordAffilie() {
  const space = await getMySpace();
  if (space.state !== 'ready') return null;
  const { affiliate, supabase } = space;

  const [stats, totals, conversions, { commissions }, { payouts }, documents, prospects] = await Promise.all([
    myStats(space),
    myTotals(space),
    myConversions(space),
    myCommissions(space, 50),
    myPayouts(space, 20),
    myDocuments(space),
    supabase
      .from('affiliate_prospects')
      .select('id, affiliate_id, status, full_name, company, recognized_at, converted_at, created_at, updated_at')
      .eq('affiliate_id', affiliate.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  const prospectRows = (prospects.data ?? []) as AffiliateProspectRow[];

  // Activité récente : des faits datés, tirés des données de l'affilié.
  type Event = { at: string; label: string; detail: string; dayOnly?: boolean };
  const events: Event[] = [
    ...prospectRows.flatMap((p): Event[] => [
      { at: p.created_at, label: 'Prospect déclaré', detail: p.full_name },
      ...(p.recognized_at ? [{ at: p.recognized_at, label: 'Prospect reconnu', detail: p.full_name }] : []),
      ...(p.converted_at ? [{ at: p.converted_at, label: 'Prospect converti', detail: p.full_name }] : []),
    ]),
    ...commissions.flatMap((c): Event[] => [
      { at: c.created_at, label: 'Commission enregistrée', detail: `${c.reference} — ${kmf(c.amount)}` },
      ...(c.acquired_at ? [{ at: c.acquired_at, label: 'Commission acquise', detail: `${c.reference} — ${kmf(c.amount)}` }] : []),
    ]),
    // Seul le jour d'un versement est saisi : l'heure n'a pas de sens.
    ...payouts.map((p): Event => ({ at: p.confirmed_at ?? p.created_at, label: 'Versement reçu', detail: `${p.reference ?? ''} — ${kmf(p.total_amount)}`, dayOnly: true })),
    ...documents
      .filter((d) => d.doc_type === 'FIAF')
      .map((d): Event => ({ at: d.issued_at, label: 'Fiche affilié émise', detail: d.reference })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  const live = affiliate.status === 'ACTIF';

  return (
    <>
      <SpaceCard title="Mon activité" intro="Vos chiffres, tels qu’enregistrés par MORA Shawiri.">
        <SpaceKpis
          label="Activité"
          items={[
            { label: 'Clics sur vos liens', value: String(stats?.clicks ?? 0) },
            { label: 'Prospects déclarés', value: String(stats?.prospects ?? 0), hint: `${stats?.prospects_recognized ?? 0} reconnu(s)` },
            { label: 'Demandes attribuées', value: String(stats?.requests ?? 0) },
            { label: 'Commandes attribuées', value: String(stats?.conversions ?? 0) },
            { label: 'Chiffre d’affaires attribué', value: kmf(stats?.attributed_amount ?? 0) },
          ]}
        />
      </SpaceCard>

      <SpaceCard title="Mes commissions" intro="Les mêmes montants que dans votre dossier chez MORA Shawiri.">
        <SpaceKpis
          label="Commissions"
          items={[
            { label: 'Prévisionnelles', value: kmf(totals?.forecast ?? 0), hint: 'affaires en cours' },
            { label: 'Acquises, à verser', value: kmf((totals?.acquired ?? 0) + (totals?.to_pay ?? 0)), hint: 'en attente du prochain versement', tone: 'gold' },
            { label: 'Déjà versé', value: kmf(totals?.paid ?? 0), tone: 'green' },
            ...(totals && totals.adjustments_pending !== 0
              ? [{ label: 'Ajustements à imputer', value: kmf(totals.adjustments_pending), hint: 'sur un prochain versement' }]
              : []),
          ]}
        />
      </SpaceCard>

      <SpaceCard title="Accès rapides">
        <div className="aff-quick">
          <Link className="btn btn--primary" href="/espace-affilie/liens/">Copier mon lien</Link>
          {live ? (
            <Link className="btn btn--ghost" href="/espace-affilie/prospects/#declarer">Déclarer un prospect</Link>
          ) : null}
          <Link className="btn btn--ghost" href="/espace-affilie/commissions/">Mes commissions</Link>
          <Link className="btn btn--ghost" href="/espace-affilie/documents/">Mes documents</Link>
        </div>
      </SpaceCard>

      <SpaceCard title="Dernières conversions">
        {conversions.length === 0 ? (
          <SpaceEmpty title="Aucune commande attribuée pour le moment">
            Partagez votre lien : une commande passée par un client que vous avez recommandé apparaîtra ici.
          </SpaceEmpty>
        ) : (
          <>
            <SpaceList label="Dernières conversions">
              {conversions.slice(0, 3).map((row) => (
                <SpaceItem key={row.order_reference} title={row.order_reference} amount={kmf(row.amount)} meta={`${row.offer ?? 'Commande'} · ${formatMoment(row.ordered_at)}`} />
              ))}
            </SpaceList>
            <SpaceMore href="/espace-affilie/conversions/">Toutes mes conversions</SpaceMore>
          </>
        )}
      </SpaceCard>

      <SpaceCard title="Dernières commissions">
        {commissions.length === 0 ? (
          <SpaceEmpty title="Aucune commission pour le moment">Elle apparaîtra dès qu’une commande éligible vous sera attribuée.</SpaceEmpty>
        ) : (
          <>
            <SpaceList label="Dernières commissions">
              {commissions.slice(0, 3).map((c) => (
                <SpaceItem key={c.id} title={c.reference} amount={kmf(c.amount)} status={COMMISSION_STATUS_LABELS[c.status]} tone={commissionTone(c.status)} meta={`Commande ${c.order_reference}`} />
              ))}
            </SpaceList>
            <SpaceMore href="/espace-affilie/commissions/">Toutes mes commissions</SpaceMore>
          </>
        )}
      </SpaceCard>

      <SpaceCard title="Derniers versements">
        {payouts.length === 0 ? (
          <SpaceEmpty title="Aucun versement pour le moment">Vos commissions acquises vous sont versées selon vos conditions.</SpaceEmpty>
        ) : (
          <>
            <SpaceList label="Derniers versements">
              {payouts.slice(0, 3).map((p) => (
                <SpaceItem key={p.id} title={p.reference} amount={kmf(p.total_amount)} status="Versé" tone="ok" meta={formatPayoutDay(p.confirmed_at)} />
              ))}
            </SpaceList>
            <SpaceMore href="/espace-affilie/versements/">Tous mes versements</SpaceMore>
          </>
        )}
      </SpaceCard>

      <SpaceCard title="Activité récente">
        {events.length === 0 ? (
          <SpaceEmpty title="Rien à signaler pour le moment">Vos prospects, commissions et versements s’afficheront ici au fil de l’eau.</SpaceEmpty>
        ) : (
          <ol className="espace-timeline">
            {events.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <p className="espace-timeline__when">{event.dayOnly ? formatPayoutDay(event.at) : formatMoment(event.at)}</p>
                <p className="espace-timeline__what">{event.label}</p>
                <p>{event.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </SpaceCard>
    </>
  );
}
