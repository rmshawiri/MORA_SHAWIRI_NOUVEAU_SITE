import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import AffiliationDecisionForm from '@/components/admin/AffiliationDecisionForm';
import { PayoutStatusBadge } from '@/components/admin/AffiliationBadges';
import ConfirmForm from '@/components/admin/ConfirmForm';
import { findPayout, listPayoutMethods } from '@/lib/affiliation/admin';
import { kmf } from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';
import { attachPayoutProof, cancelPayout, confirmPayout, removePayoutItem } from '@/lib/affiliation/payout-actions';
import { formatPayoutDay, readMethodSnapshot, readPayoutLine } from '@/lib/affiliation/payouts';
import { moroniToday } from '@/lib/affiliation/time';
import { requireModule } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Versement',
  robots: { index: false, follow: false },
};

/** Retours possibles d'un acte : liste fermée, jamais un texte reçu. */
const RESULTS: Record<string, string> = {
  PREPARE: 'Le versement est préparé. Contrôlez les lignes, payez l’affilié, puis confirmez.',
  LIGNE_RETIREE: 'La ligne est retirée du versement : la commission redevient acquise.',
  ANNULE: 'Le brouillon est annulé. Les commissions redeviennent acquises.',
  CONFIRME: 'Le versement est confirmé et son relevé RVAF émis. Il ne se modifie plus.',
  JUSTIFICATIF: 'Le justificatif est rattaché au versement.',
};
const MAIL_RESULTS: Record<string, string> = {
  sent: ' L’affilié a été prévenu par e-mail.',
  failed: ' L’e-mail n’a pas pu partir : il est journalisé et peut être renvoyé depuis la fiche affilié.',
  skipped: '',
};
const DETAIL_LABELS: Record<string, string> = {
  numero: 'Numéro',
  titulaire: 'Titulaire',
  banque: 'Banque',
  compte: 'Compte / RIB',
  email: 'E-mail du compte',
  ordre: 'À l’ordre de',
};

/**
 * Fiche d'un versement — phase 4H-6.
 *
 * Brouillon : on contrôle les lignes, on en retire, on annule ou on confirme.
 * Confirmé : tout est figé — lignes, moyen réellement utilisé, référence de
 * transaction, relevé RVAF. Seul le justificatif peut encore être rattaché,
 * une fois.
 */
export default async function VersementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule('affiliation');
  const { id } = await params;
  const query = await searchParams;
  const detail = context.can('payouts.view') ? await findPayout(id) : null;
  if (!detail) notFound();
  const { payout, items, internal, affiliate } = detail;
  const isSelf = affiliate?.user_id !== null && affiliate?.user_id === context.access.userId;
  const canManage = context.can('payouts.manage') && !isSelf;
  const draft = payout.status === 'BROUILLON';
  const supabase = await getServerSupabaseClient();
  const [methods, activeAccount] =
    draft && canManage && supabase
      ? await Promise.all([
          listPayoutMethods(),
          supabase
            .from('affiliate_payout_accounts')
            .select('method_code')
            .eq('affiliate_id', payout.affiliate_id)
            .eq('status', 'ACTIF')
            .maybeSingle()
            .then((res) => res.data?.method_code ?? null),
        ])
      : [[], null];
  const method = readMethodSnapshot(payout.method_snapshot);
  const pick = (table: Record<string, string>, key: unknown) =>
    typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
  const result = pick(RESULTS, query.resultat);
  const mail = pick(MAIL_RESULTS, query.mail) ?? '';
  const lines = items.map((item) => ({ item, line: readPayoutLine(item.snapshot) }));

  return (
    <AdminPage
      eyebrow={`Versement — ${affiliate?.display_name ?? 'affilié'}`}
      title={payout.reference ?? `Versement en préparation${payout.period_label ? ` — ${payout.period_label}` : ''}`}
      lead={
        draft
          ? 'Brouillon : rien n’est encore payé. Les commissions qu’il contient ne peuvent entrer dans aucun autre versement.'
          : payout.status === 'CONFIRME'
            ? 'Versement confirmé : il est définitif.'
            : 'Brouillon annulé : il reste dans l’historique.'
      }
      actions={
        <>
          <Link className="btn btn--ghost" href="/administration/affiliation/versements/">
            Tous les versements
          </Link>
          {affiliate ? (
            <Link className="btn btn--ghost" href={`/administration/affiliation/affilies/${affiliate.id}/`}>
              Fiche affilié
            </Link>
          ) : null}
        </>
      }
    >
      {result ? (
        <div className={`admin-notice ${query.mail === 'failed' ? 'admin-notice--error' : 'admin-notice--ok'}`} role="status">
          <p>
            {result}
            {mail}
          </p>
        </div>
      ) : null}
      {isSelf ? (
        <div className="admin-notice admin-notice--error" role="note">
          <p>Ce versement est le vôtre. Vous le consultez, mais aucune décision ne peut être prise par vous.</p>
        </div>
      ) : null}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Synthèse</h2>
          <p>
            <PayoutStatusBadge status={payout.status} />
          </p>
        </div>
        <dl className="admin-def">
          <dt>Montant</dt>
          <dd>{kmf(payout.total_amount)}</dd>
          {payout.period_label ? (
            <>
              <dt>Période</dt>
              <dd>{payout.period_label}</dd>
            </>
          ) : null}
          <dt>Préparé le</dt>
          <dd>{formatMoment(payout.prepared_at)}</dd>
          {payout.status === 'CONFIRME' ? (
            <>
              <dt>Versé le</dt>
              <dd>{formatPayoutDay(payout.confirmed_at)}</dd>
              <dt>Moyen utilisé</dt>
              <dd>{method?.label ?? payout.method_code}</dd>
              {method && Object.keys(method.details).length > 0 ? (
                <>
                  <dt>Coordonnées</dt>
                  <dd>
                    {Object.entries(method.details)
                      .map(([key, value]) => `${DETAIL_LABELS[key] ?? key} : ${value}`)
                      .join(' · ')}
                  </dd>
                </>
              ) : null}
              <dt>Référence de transaction</dt>
              <dd>{payout.transaction_reference ?? '—'}</dd>
              <dt>Relevé</dt>
              <dd>{payout.reference} — relevé de versement émis, conservé avec son instantané.</dd>
              <dt>Justificatif</dt>
              <dd>
                {internal?.proof_path ? (
                  <a href={`/api/affiliation/versements/${payout.id}/justificatif/`} target="_blank" rel="noopener noreferrer">
                    Ouvrir le justificatif
                  </a>
                ) : (
                  'Aucun'
                )}
              </dd>
            </>
          ) : null}
          {payout.status === 'ANNULE' ? (
            <>
              <dt>Annulé le</dt>
              <dd>
                {formatMoment(payout.cancelled_at)}
                {internal?.cancel_reason ? ` — ${internal.cancel_reason}` : ''}
              </dd>
            </>
          ) : null}
          {internal?.note ? (
            <>
              <dt>Note interne</dt>
              <dd className="admin-longtext">{internal.note}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Contenu</h2>
          <p>Commissions versées et ajustements imputés. Un ajustement négatif réduit le montant ; il reprend un remboursement ou une annulation.</p>
        </div>
        {lines.length === 0 ? (
          <p>Aucune ligne.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Lignes du versement</caption>
              <thead>
                <tr>
                  <th scope="col">Élément</th>
                  <th scope="col">Détail</th>
                  <th scope="col">Montant</th>
                  {draft && canManage ? <th scope="col">Retirer</th> : null}
                </tr>
              </thead>
              <tbody>
                {lines.map(({ item, line }) => (
                  <tr key={item.id}>
                    <th scope="row">
                      {item.commission_id ? (
                        <Link href={`/administration/affiliation/commissions/${item.commission_id}/`}>{line?.label ?? 'Commission'}</Link>
                      ) : (
                        (line?.label ?? 'Ajustement')
                      )}
                    </th>
                    <td>{line?.detail ?? '—'}</td>
                    <td>{kmf(item.amount)}</td>
                    {draft && canManage ? (
                      <td>
                        {item.commission_id ? (
                          <ConfirmForm
                            action={removePayoutItem}
                            fields={{ payout: payout.id, item: item.id }}
                            trigger="Retirer"
                            consequence="La commission sort de ce versement (avec ses ajustements) et redevient acquise."
                            confirmLabel="Retirer"
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && draft ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Confirmer le versement</h2>
            <p>À faire une fois l’argent parti. La confirmation est définitive : elle fige le moyen utilisé, la référence et le relevé RVAF.</p>
          </div>
          <div className="btn-row">
            <AffiliationDecisionForm
              action={confirmPayout}
              fields={{ payout: payout.id }}
              trigger="Confirmer le versement"
              title="Confirmer ce versement ?"
              consequence={`${kmf(payout.total_amount)} seront enregistrés comme versés à ${affiliate?.display_name ?? 'l’affilié'}. Cette confirmation ne pourra plus être modifiée ni supprimée.`}
              confirmLabel="Confirmer le versement"
              variant="gold"
              inputs={[
                {
                  kind: 'row',
                  inputs: [
                    {
                      kind: 'select',
                      name: 'method',
                      label: 'Moyen réellement utilisé',
                      options: methods.map((entry) => ({
                        value: entry.code,
                        label: entry.code === activeAccount ? `${entry.label} (coordonnées validées)` : entry.label,
                      })),
                      defaultValue: activeAccount ?? undefined,
                    },
                    { kind: 'date', name: 'paid_on', label: 'Date du versement', required: true, defaultValue: moroniToday() },
                  ],
                },
                {
                  kind: 'text',
                  name: 'transaction',
                  label: 'Référence de la transaction',
                  hint: 'Obligatoire sauf en espèces.',
                  maxLength: 120,
                },
                {
                  kind: 'textarea',
                  name: 'note',
                  label: 'Note interne',
                  hint: 'Obligatoire si le moyen diffère des coordonnées validées de l’affilié.',
                  maxLength: 1000,
                },
                { kind: 'checkbox', name: 'notify', label: 'Prévenir l’affilié par e-mail', defaultChecked: true },
              ]}
            />
            <AffiliationDecisionForm
              action={cancelPayout}
              fields={{ payout: payout.id }}
              trigger="Annuler le brouillon"
              title="Annuler ce brouillon ?"
              consequence="Les commissions redeviennent acquises et pourront entrer dans un prochain versement. Le brouillon reste dans l’historique."
              confirmLabel="Annuler le brouillon"
              variant="danger"
              inputs={[{ kind: 'textarea', name: 'reason', label: 'Motif', required: true, maxLength: 1000 }]}
            />
          </div>
        </section>
      ) : null}

      {canManage && payout.status === 'CONFIRME' && !internal?.proof_path ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Justificatif</h2>
            <p>Reçu du transfert ou capture de l’opération. Il reste privé : l’affilié ne le voit pas. Il ne se remplace pas.</p>
          </div>
          <AffiliationDecisionForm
            action={attachPayoutProof}
            fields={{ payout: payout.id }}
            trigger="Joindre le justificatif"
            title="Joindre ce justificatif ?"
            consequence="Le fichier est conservé dans un espace privé et rattaché définitivement à ce versement."
            confirmLabel="Joindre"
            inputs={[
              {
                kind: 'file',
                name: 'proof',
                label: 'Fichier',
                hint: 'PDF, PNG, JPEG ou WebP, 5 Mo au plus.',
                required: true,
                accept: 'application/pdf,image/png,image/jpeg,image/webp',
              },
            ]}
          />
        </section>
      ) : null}
    </AdminPage>
  );
}
