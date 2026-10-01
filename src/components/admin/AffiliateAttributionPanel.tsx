import Link from 'next/link';

import AffiliationDecisionForm from './AffiliationDecisionForm';
import { reviewProspect } from '@/lib/affiliation/attribution-actions';
import { formatKmf, toCents } from '@/lib/domain/affiliation';
import { formatMoment } from '@/lib/affiliation/labels';
import { PROSPECT_STATUS_LABELS } from '@/lib/affiliation/prospects';
import type { AdminContext } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type {
  AffiliateAttributionRow,
  AffiliateCampaignRow,
  AffiliateProspectRow,
} from '@/lib/supabase/types-affiliation';

/**
 * Attribution d'un affilié — bloc de la fiche affilié (phase 4H-4).
 *
 * Chiffres calculés en base sur les lignes réelles (`affiliate_stats`) ; aucun
 * n'est stocké, aucun n'est estimé. Les prospects déclarés s'y décident ;
 * les affaires attribuées y renvoient vers leur commande ou leur demande.
 */

const SOURCE_LABELS: Record<string, string> = {
  LIEN: 'Lien',
  CODE: 'Code',
  PROSPECT: 'Prospect',
  ADMINISTRATION: 'Administration',
};

export default async function AffiliateAttributionPanel({
  context,
  affiliateId,
  campaigns,
  path,
}: {
  context: AdminContext;
  affiliateId: string;
  campaigns: readonly AffiliateCampaignRow[];
  path: string;
}) {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const [stats, clicks, prospects, hints, attributions] = await Promise.all([
    supabase.rpc('affiliate_stats', { p_affiliate_id: affiliateId }),
    supabase.rpc('affiliate_click_stats', { p_affiliate_id: affiliateId }),
    supabase
      .from('affiliate_prospects')
      .select('id, affiliate_id, status, full_name, company, phone, email, need, comment, consent_confirmed, lead_id, review_reason, reviewed_at, recognized_at, protected_until, converted_at, created_at, updated_at')
      .eq('affiliate_id', affiliateId)
      .order('created_at', { ascending: false }),
    supabase.rpc('affiliate_prospect_hints', { p_affiliate_id: affiliateId }),
    supabase.from('affiliate_attributions').select('*').eq('affiliate_id', affiliateId).order('created_at', { ascending: false }).limit(200),
  ]);

  const figures = (stats.data ?? [])[0];
  const prospectRows = (prospects.data ?? []) as AffiliateProspectRow[];
  const hintMap = new Map((hints.data ?? []).map((row) => [row.prospect_id, row.hint]));
  const attributionRows = (attributions.data ?? []) as AffiliateAttributionRow[];
  const orderIds = attributionRows.map((row) => row.order_id).filter((value): value is string => Boolean(value));
  const requestIds = attributionRows.map((row) => row.quote_request_id).filter((value): value is string => Boolean(value));
  const [orders, requests] = await Promise.all([
    orderIds.length
      ? supabase.from('orders').select('id, reference, total_amount, status').in('id', orderIds)
      : Promise.resolve({ data: [] as { id: string; reference: string; total_amount: number; status: string }[] }),
    requestIds.length
      ? supabase.from('quote_requests').select('id, reference').in('id', requestIds)
      : Promise.resolve({ data: [] as { id: string; reference: string }[] }),
  ]);
  const orderMap = new Map((orders.data ?? []).map((row) => [row.id, row]));
  const requestMap = new Map((requests.data ?? []).map((row) => [row.id, row]));
  const campaignLabel = (id: string | null) => (id ? (campaigns.find((row) => row.id === id)?.label ?? 'Campagne') : 'Lien principal');
  const canDecide = context.can('affiliate_attributions.manage');

  return (
    <section className="admin-card">
      <div className="admin-card__head">
        <h2>Attribution</h2>
        <p>Clics, prospects déclarés et affaires attribuées. Tous les chiffres viennent des données réelles.</p>
      </div>

      {figures ? (
        <dl className="admin-def">
          <dt>Clics</dt>
          <dd>{figures.clicks}</dd>
          <dt>Prospects déclarés</dt>
          <dd>
            {figures.prospects} (dont {figures.prospects_recognized} reconnus)
          </dd>
          <dt>Demandes attribuées</dt>
          <dd>{figures.requests}</dd>
          <dt>Commandes attribuées</dt>
          <dd>{figures.conversions}</dd>
          <dt>Chiffre d’affaires attribué</dt>
          <dd>{formatKmf(toCents(figures.attributed_amount))}</dd>
        </dl>
      ) : null}

      {(clicks.data ?? []).length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Clics par lien</caption>
            <thead>
              <tr>
                <th scope="col">Lien</th>
                <th scope="col">Clics</th>
                <th scope="col">Demandes</th>
              </tr>
            </thead>
            <tbody>
              {(clicks.data ?? []).map((row) => (
                <tr key={row.campaign_id ?? 'principal'}>
                  <th scope="row">{campaignLabel(row.campaign_id)}</th>
                  <td>{row.clicks}</td>
                  <td>{row.requests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h3>Prospects déclarés</h3>
      {prospectRows.length === 0 ? (
        <p className="admin-field__hint">Aucun prospect déclaré.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Prospects déclarés par l’affilié</caption>
            <thead>
              <tr>
                <th scope="col">Prospect</th>
                <th scope="col">Besoin</th>
                <th scope="col">Statut</th>
                <th scope="col">Décision</th>
              </tr>
            </thead>
            <tbody>
              {prospectRows.map((prospect) => (
                <tr key={prospect.id}>
                  <th scope="row">
                    {prospect.full_name}
                    {prospect.company ? <span className="admin-field__hint"> — {prospect.company}</span> : null}
                    <span className="admin-field__hint">
                      {' '}
                      {prospect.phone}
                      {prospect.email ? ` · ${prospect.email}` : ''} · déclaré le {formatMoment(prospect.created_at)}
                    </span>
                    {hintMap.get(prospect.id) ? (
                      <span className="admin-badge admin-badge--gold"> {hintMap.get(prospect.id)}</span>
                    ) : null}
                  </th>
                  <td className="admin-longtext">{prospect.need}</td>
                  <td>
                    {PROSPECT_STATUS_LABELS[prospect.status]}
                    {prospect.protected_until ? (
                      <span className="admin-field__hint"> — protégé jusqu’au {formatMoment(prospect.protected_until)}</span>
                    ) : null}
                    {prospect.review_reason ? <span className="admin-field__hint"> — {prospect.review_reason}</span> : null}
                  </td>
                  <td>
                    {canDecide && (prospect.status === 'DECLARE' || prospect.status === 'A_VERIFIER') ? (
                      <div className="admin-table__actions">
                        {prospect.status === 'DECLARE' ? (
                          <AffiliationDecisionForm
                            action={reviewProspect}
                            fields={{ prospect: prospect.id, status: 'A_VERIFIER', return: path }}
                            trigger="À vérifier"
                            title="Prendre ce prospect en vérification ?"
                            consequence="Le prospect passe « à vérifier ». L’affilié voit ce statut."
                            confirmLabel="Confirmer"
                            inputs={[]}
                          />
                        ) : null}
                        <AffiliationDecisionForm
                          action={reviewProspect}
                          fields={{ prospect: prospect.id, status: 'RECONNU', return: path }}
                          trigger="Reconnaître"
                          title="Reconnaître l’origine de ce prospect ?"
                          consequence="Le prospect est rattaché à sa fiche et protégé pour cet affilié selon ses paramètres. Une commande de ce prospect lui sera attribuée."
                          confirmLabel="Reconnaître"
                          variant="gold"
                          inputs={[
                            { kind: 'text', name: 'lead_email', label: 'Adresse e-mail du prospect', type: 'email', defaultValue: prospect.email ?? '', required: true, maxLength: 160,
                              hint: 'Elle relie le prospect à sa fiche, et donc à ses futures demandes.' },
                            { kind: 'textarea', name: 'reason', label: 'Note (facultative)' },
                          ]}
                        />
                        <AffiliationDecisionForm
                          action={reviewProspect}
                          fields={{ prospect: prospect.id, status: 'REFUSE', return: path }}
                          trigger="Refuser"
                          title="Refuser l’origine de ce prospect ?"
                          consequence="L’affilié voit le refus. Le motif est enregistré."
                          confirmLabel="Refuser"
                          variant="danger"
                          inputs={[{ kind: 'textarea', name: 'reason', label: 'Motif', required: true,
                            hint: 'Par exemple : prospect déjà connu et activement traité par MORA Shawiri.' }]}
                        />
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Affaires attribuées</h3>
      {attributionRows.length === 0 ? (
        <p className="admin-field__hint">Aucune affaire attribuée.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Affaires attribuées à l’affilié</caption>
            <thead>
              <tr>
                <th scope="col">Affaire</th>
                <th scope="col">Origine</th>
                <th scope="col">État</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {attributionRows.map((row) => {
                const order = row.order_id ? orderMap.get(row.order_id) : null;
                const request = row.quote_request_id ? requestMap.get(row.quote_request_id) : null;
                return (
                  <tr key={row.id}>
                    <th scope="row">
                      {order ? (
                        <Link href={`/administration/commandes/${order.reference}/`}>{order.reference}</Link>
                      ) : request ? (
                        <Link href={`/administration/demandes/${request.reference}/`}>{request.reference}</Link>
                      ) : row.order_id ? (
                        'Commande'
                      ) : (
                        'Demande'
                      )}
                      {order ? <span className="admin-field__hint"> — {formatKmf(toCents(order.total_amount))}</span> : null}
                    </th>
                    <td>{SOURCE_LABELS[row.source]}</td>
                    <td>
                      {row.status === 'VALIDEE' ? 'Validée' : row.status === 'ACTIVE' ? 'En cours' : row.status === 'REMPLACEE' ? 'Remplacée' : 'Révoquée'}
                    </td>
                    <td>{formatMoment(row.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
