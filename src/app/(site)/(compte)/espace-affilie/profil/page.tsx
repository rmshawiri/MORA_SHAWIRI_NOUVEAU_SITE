import type { Metadata } from 'next';
import Link from 'next/link';

import { ContactForm, PayoutRequestForm } from '@/components/affiliation/AffiliateSpaceForm';
import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { PAYOUT_ACCOUNT_STATUS_LABELS } from '@/lib/affiliation/affiliates';
import { maskPayoutValue } from '@/lib/affiliation/applications';
import { formatMoment } from '@/lib/affiliation/labels';
import { requestPayoutChange, updateMyContact } from '@/lib/affiliation/space-actions';
import { getMySpace } from '@/lib/affiliation/space';
import type { Json } from '@/lib/supabase/types';
import type { AffiliatePayoutAccountRow } from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Profil et paiement',
  robots: { index: false, follow: false },
};

const DETAIL_LABELS: Record<string, string> = {
  numero: 'Numéro',
  titulaire: 'Titulaire',
  banque: 'Banque',
  compte: 'Compte / RIB',
  email: 'E-mail du compte',
  ordre: 'À l’ordre de',
};
const KEEP_CLEAR = ['titulaire', 'banque', 'ordre'];

/**
 * Profil et paiement (phase 4H-8).
 *
 * L'affilié modifie ses coordonnées de **contact** — téléphone, ville, pays —
 * par une fonction dédiée, journalisée. Nom, e-mail de connexion, catégorie,
 * statut, règles et historique restent l'affaire de MORA Shawiri.
 *
 * Coordonnées de versement (décision J) : jamais modifiées en silence. Une
 * demande est déposée ; le moyen validé reste en vigueur jusqu'à la décision
 * de l'administration ; l'historique des demandes est conservé. Les
 * versements passés gardent le moyen réellement utilisé, figé.
 */
export default async function ProfilPage() {
  const space = await getMySpace();
  if (space.state !== 'ready') return null;
  const { affiliate, supabase } = space;

  const [accounts, methods, me] = await Promise.all([
    supabase
      .from('affiliate_payout_accounts')
      .select('id, affiliate_id, method_code, status, source, requested_by, requested_at, reviewed_by, reviewed_at, review_note, replaced_at, created_at, updated_at')
      .eq('affiliate_id', affiliate.id)
      .order('requested_at', { ascending: false }),
    supabase.rpc('affiliate_payout_methods'),
    supabase.auth.getUser(),
  ]);
  const accountRows = (accounts.data ?? []) as AffiliatePayoutAccountRow[];
  const methodRows = methods.data ?? [];
  const methodLabel = (code: string) => methodRows.find((row) => row.code === code)?.label ?? code;
  const active = accountRows.find((row) => row.status === 'ACTIF') ?? null;
  const pending = accountRows.find((row) => row.status === 'DEMANDE') ?? null;

  let activeDetails: [string, string][] = [];
  if (active) {
    const { data } = await supabase.rpc('payout_account_details', { p_account_id: active.id });
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      activeDetails = Object.entries(data as Record<string, Json>).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    }
  }
  const ended = affiliate.status === 'TERMINE';

  return (
    <>
      <SpaceCard title="Mon profil" intro="Votre nom et votre adresse de connexion sont gérés par MORA Shawiri : pour les changer, écrivez-nous.">
        <dl className="auth-meta">
          <div>
            <dt>Nom</dt>
            <dd>{affiliate.display_name}</dd>
          </div>
          {affiliate.legal_name ? (
            <div>
              <dt>Raison sociale</dt>
              <dd>{affiliate.legal_name}</dd>
            </div>
          ) : null}
          <div>
            <dt>Nature</dt>
            <dd>{affiliate.party_type === 'ORGANISATION' ? 'Organisation' : 'Personne'}</dd>
          </div>
          <div>
            <dt>Adresse de connexion</dt>
            <dd>{me.data.user?.email ?? affiliate.contact_email}</dd>
          </div>
        </dl>
        <p className="aff-more">
          <Link href="/changer-mot-de-passe/">Changer mon mot de passe</Link>
        </p>
      </SpaceCard>

      <SpaceCard title="Mes coordonnées de contact" intro="Elles nous permettent de vous joindre au sujet de vos affaires.">
        {ended ? (
          <p>Votre affiliation a pris fin : vos coordonnées ne se modifient plus ici.</p>
        ) : (
          <ContactForm
            action={updateMyContact}
            initial={{ telephone: affiliate.contact_phone ?? '', ville: affiliate.city ?? '', pays: affiliate.country ?? '' }}
          />
        )}
      </SpaceCard>

      <SpaceCard
        title="Mes coordonnées de versement"
        intro="Pour votre sécurité, elles ne changent qu’après validation par MORA Shawiri. Elles ne figurent jamais en entier à l’écran."
      >
        {active ? (
          <dl className="auth-meta">
            <div>
              <dt>Moyen validé</dt>
              <dd>{methodLabel(active.method_code)}</dd>
            </div>
            {activeDetails.map(([key, value]) => (
              <div key={key}>
                <dt>{DETAIL_LABELS[key] ?? 'Coordonnée'}</dt>
                <dd>{KEEP_CLEAR.includes(key) ? value : maskPayoutValue(value)}</dd>
              </div>
            ))}
            {active.reviewed_at ? (
              <div>
                <dt>Validé le</dt>
                <dd>{formatMoment(active.reviewed_at)}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <SpaceEmpty title="Aucun moyen de versement validé">Déposez une demande : MORA Shawiri la vérifie avant votre premier versement.</SpaceEmpty>
        )}
        {pending ? (
          <div className="auth-notice auth-notice--warn" role="status">
            <p>
              Demande en attente : {methodLabel(pending.method_code)}, déposée le {formatMoment(pending.requested_at)}. Vos coordonnées
              validées restent en vigueur jusqu’à la décision.
            </p>
          </div>
        ) : null}
        {!ended && methodRows.length > 0 ? <PayoutRequestForm action={requestPayoutChange} methods={methodRows} /> : null}
      </SpaceCard>

      <SpaceCard title="Historique de mes coordonnées" intro="Chaque demande reste tracée, qu’elle ait été validée, refusée ou remplacée.">
        {accountRows.length === 0 ? (
          <SpaceEmpty title="Aucun historique" />
        ) : (
          <SpaceList label="Historique des coordonnées de versement">
            {accountRows.map((account) => (
              <SpaceItem
                key={account.id}
                title={methodLabel(account.method_code)}
                status={PAYOUT_ACCOUNT_STATUS_LABELS[account.status]}
                tone={account.status === 'ACTIF' ? 'ok' : account.status === 'DEMANDE' ? 'todo' : account.status === 'REFUSE' ? 'warn' : 'muted'}
                meta={`Déposée le ${formatMoment(account.requested_at)}${account.reviewed_at ? ` · décidée le ${formatMoment(account.reviewed_at)}` : ''}`}
              >
                {account.status === 'REFUSE' && account.review_note ? <p>Motif : {account.review_note}</p> : null}
              </SpaceItem>
            ))}
          </SpaceList>
        )}
        <p className="form__note">Vos versements passés gardent le moyen réellement utilisé à leur date.</p>
      </SpaceCard>
    </>
  );
}
