import Link from 'next/link';

import AffiliationDecisionForm from './AffiliationDecisionForm';
import {
  applyCode,
  attributeAffair,
  removeCode,
  revokeAttribution,
  validateAttribution,
} from '@/lib/affiliation/attribution-actions';
import { COMMISSION_STATUS_LABELS, kmf } from '@/lib/affiliation/commissions';
import { formatMoment } from '@/lib/affiliation/labels';
import type { AdminContext } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type {
  AffiliateAttributionRow,
  AffiliateCodeUseRow,
  AffiliateCommissionRow,
} from '@/lib/supabase/types-affiliation';

/**
 * Attribution affiliée d'une affaire — section ajoutée aux fiches commande et
 * demande (phase 4H-4, traçabilité du § 36 : depuis une commande, voir qui
 * l'a apportée ; de là, rejoindre la fiche de l'affilié).
 *
 * Rendue seulement pour qui détient `affiliates.view` : la RLS des
 * attributions le demande de toute façon. Chaque bouton dépend de sa
 * permission, et chaque acte la revérifie.
 */

const SOURCE_LABELS: Record<string, string> = {
  LIEN: 'Lien d’affiliation',
  CODE: 'Code partenaire',
  PROSPECT: 'Prospect déclaré et reconnu',
  ADMINISTRATION: 'Attribution administrative',
};
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'En cours',
  VALIDEE: 'Validée (verrouillée)',
  REMPLACEE: 'Remplacée',
  REVOQUEE: 'Révoquée',
};
const NOTICES: Record<string, string> = {
  ATTRIBUEE: 'L’affaire est attribuée et l’attribution validée.',
  VALIDEE: 'L’attribution est validée : elle ne sera plus déplacée automatiquement.',
  REVOQUEE: 'L’attribution est révoquée.',
  CODE_APPLIQUE: 'Le code est appliqué : la remise figure sur les lignes éligibles, et l’affaire est attribuée à son affilié.',
  CODE_RETIRE: 'Le code est retiré : la remise est annulée à l’identique.',
};

export default async function AffiliationTrace({
  context,
  target,
  id,
  path,
  notice,
  orderOpen,
}: {
  context: AdminContext;
  target: 'ORDER' | 'REQUEST';
  id: string;
  /** Chemin de la fiche, pour y revenir après un acte. */
  path: string;
  notice?: string | string[];
  /** Commande encore modifiable (non payée, non close) : un code peut s'y appliquer. */
  orderOpen?: boolean;
}) {
  if (!context.can('affiliates.view')) return null;
  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const column = target === 'ORDER' ? 'order_id' : 'quote_request_id';
  const [{ data: attributions }, { data: affiliates }, codeUse, commissionRows] = await Promise.all([
    supabase.from('affiliate_attributions').select('*').eq(column, id).order('created_at', { ascending: false }),
    supabase.from('affiliates').select('id, display_name, reference, status').order('display_name'),
    target === 'ORDER'
      ? supabase.from('affiliate_code_uses').select('*').eq('order_id', id).eq('status', 'ACTIVE').maybeSingle()
      : Promise.resolve({ data: null }),
    // RLS : sans commissions.view, la liste revient vide.
    target === 'ORDER'
      ? supabase.from('affiliate_commissions').select('id, reference, status, amount').eq('order_id', id).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const commissions = ((commissionRows as { data: unknown }).data ?? []) as Pick<AffiliateCommissionRow, 'id' | 'reference' | 'status' | 'amount'>[];
  const rows = (attributions ?? []) as AffiliateAttributionRow[];
  const use = (codeUse as { data: AffiliateCodeUseRow | null }).data;
  const names = new Map((affiliates ?? []).map((row) => [row.id, row]));
  const current = rows.find((row) => row.status === 'ACTIVE' || row.status === 'VALIDEE') ?? null;
  const canAttribute = context.can('affiliate_attributions.manage');
  const canCode = context.can('affiliate_codes.manage') && context.can('orders.update');
  const message = typeof notice === 'string' && Object.hasOwn(NOTICES, notice) ? NOTICES[notice] : null;
  const active = (affiliates ?? []).filter((row) => row.status === 'ACTIF');

  return (
    <section className="admin-card" aria-labelledby={`affiliation-${id}`}>
      <div className="admin-card__head">
        <h2 id={`affiliation-${id}`}>Affiliation</h2>
        <p>Qui a apporté cette affaire. Une attribution validée n’est jamais déplacée automatiquement.</p>
      </div>
      {message ? (
        <div className="admin-notice admin-notice--ok" role="status">
          <p>{message}</p>
        </div>
      ) : null}

      {current ? (
        <dl className="admin-def">
          <dt>Affilié</dt>
          <dd>
            <Link href={`/administration/affiliation/affilies/${current.affiliate_id}/`}>
              {names.get(current.affiliate_id)?.display_name ?? 'Affilié'}
            </Link>
            {names.get(current.affiliate_id)?.reference ? ` — ${names.get(current.affiliate_id)?.reference}` : ''}
          </dd>
          <dt>Origine</dt>
          <dd>{SOURCE_LABELS[current.source]}</dd>
          <dt>État</dt>
          <dd>{STATUS_LABELS[current.status]}</dd>
          {current.reason ? (
            <>
              <dt>Justification</dt>
              <dd className="admin-longtext">{current.reason}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="admin-field__hint">Aucun affilié n’est rattaché à cette affaire.</p>
      )}

      {commissions.length > 0 ? (
        <p>
          Commission :{' '}
          {commissions.map((row, index) => (
            <span key={row.id}>
              {index > 0 ? ', ' : ''}
              <Link href={`/administration/affiliation/commissions/${row.id}/`}>{row.reference}</Link> —{' '}
              {COMMISSION_STATUS_LABELS[row.status].toLowerCase()}, {kmf(row.amount)}
            </span>
          ))}
          .
        </p>
      ) : null}

      {use ? (
        <p>
          Code appliqué : remise de <strong>{use.discount_total} KMF</strong>, le {formatMoment(use.applied_at)}.
        </p>
      ) : null}

      <div className="admin-table__actions">
        {canAttribute && current && current.status === 'ACTIVE' ? (
          <AffiliationDecisionForm
            action={validateAttribution}
            fields={{ attribution: current.id, return: path }}
            trigger="Valider l’attribution"
            title="Valider cette attribution ?"
            consequence="Elle sera verrouillée : ni un lien ni un code ne pourront plus la déplacer."
            confirmLabel="Valider"
            inputs={[]}
          />
        ) : null}
        {canAttribute && current && !(use && current.source === 'CODE') ? (
          <AffiliationDecisionForm
            action={revokeAttribution}
            fields={{ attribution: current.id, return: path }}
            trigger="Révoquer"
            title="Révoquer cette attribution ?"
            consequence="L’affaire n’est plus rattachée à cet affilié. L’attribution reste dans l’historique."
            confirmLabel="Révoquer"
            variant="danger"
            inputs={[{ kind: 'textarea', name: 'reason', label: 'Motif', required: true }]}
          />
        ) : null}
        {canAttribute && current?.status !== 'VALIDEE' && active.length > 0 ? (
          <AffiliationDecisionForm
            action={attributeAffair}
            fields={{ target, id, return: path }}
            trigger="Attribuer manuellement"
            title="Attribuer cette affaire ?"
            consequence="Sur preuve suffisante seulement. L’attribution est aussitôt validée et remplace une attribution automatique."
            confirmLabel="Attribuer"
            inputs={[
              { kind: 'select', name: 'affiliate_id', label: 'Affilié', options: active.map((row) => ({ value: row.id, label: `${row.display_name} — ${row.reference ?? ''}` })) },
              { kind: 'textarea', name: 'reason', label: 'Preuve ou justification', required: true, hint: 'Par exemple : transmission par WhatsApp du 3 octobre.' },
            ]}
          />
        ) : null}
        {target === 'ORDER' && canCode && orderOpen && !use ? (
          <AffiliationDecisionForm
            action={applyCode}
            fields={{ order: id, return: path }}
            trigger="Appliquer un code partenaire"
            title="Appliquer ce code ?"
            consequence="La réduction est répartie sur les lignes éligibles. L’affaire est attribuée à l’affilié du code, sauf attribution validée à un autre."
            confirmLabel="Appliquer le code"
            inputs={[
              { kind: 'text', name: 'code', label: 'Code communiqué par le client', required: true, maxLength: 24 },
              { kind: 'textarea', name: 'reason', label: 'Note (facultative)' },
            ]}
          />
        ) : null}
        {target === 'ORDER' && canCode && orderOpen && use ? (
          <AffiliationDecisionForm
            action={removeCode}
            fields={{ order: id, return: path }}
            trigger="Retirer le code"
            title="Retirer ce code ?"
            consequence="La remise est annulée à l’identique sur les mêmes lignes, et l’attribution par ce code est révoquée."
            confirmLabel="Retirer le code"
            variant="danger"
            inputs={[{ kind: 'textarea', name: 'reason', label: 'Motif', required: true }]}
          />
        ) : null}
      </div>

      {rows.length > 1 ? (
        <ul className="admin-timeline">
          {rows.map((row) => (
            <li key={row.id}>
              <strong>
                {SOURCE_LABELS[row.source]} — {names.get(row.affiliate_id)?.display_name ?? 'Affilié'}
              </strong>
              <span className="admin-field__hint">
                {' '}
                — {STATUS_LABELS[row.status]}, {formatMoment(row.created_at)}
                {row.end_reason ? ` — ${row.end_reason}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
