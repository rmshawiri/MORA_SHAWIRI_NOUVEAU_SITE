import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import { formatMoment } from '@/lib/affiliation/labels';
import { PROSPECT_STATUS_LABELS } from '@/lib/affiliation/prospects';
import { requireModule } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { AffiliateProspectRow } from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Prospects déclarés',
  robots: { index: false, follow: false },
};

/**
 * Prospects déclarés par les affiliés — phase 4H-4.
 *
 * La file de ce qui attend une décision de MORA Shawiri. La décision se prend
 * sur la fiche de l'affilié, où l'on voit aussi ses autres déclarations et
 * les rapprochements (« déjà connu », « déjà déclaré »).
 */
export default async function ProspectsPage() {
  await requireModule('affiliation');
  const supabase = await getServerSupabaseClient();
  const [prospects, affiliates, hints] = supabase
    ? await Promise.all([
        supabase
          .from('affiliate_prospects')
          .select('id, affiliate_id, status, full_name, company, phone, email, need, comment, consent_confirmed, lead_id, review_reason, reviewed_at, recognized_at, protected_until, converted_at, created_at, updated_at')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('affiliates').select('id, display_name'),
        supabase.rpc('affiliate_prospect_hints', { p_affiliate_id: null }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const rows = (prospects.data ?? []) as AffiliateProspectRow[];
  const names = new Map(((affiliates.data ?? []) as { id: string; display_name: string }[]).map((row) => [row.id, row.display_name]));
  const hintMap = new Map(((hints.data ?? []) as { prospect_id: string; hint: string }[]).map((row) => [row.prospect_id, row.hint]));
  const waiting = rows.filter((row) => row.status === 'DECLARE' || row.status === 'A_VERIFIER');

  return (
    <AdminPage
      eyebrow="Affiliation"
      title="Prospects déclarés"
      lead="L’origine d’un prospect est reconnue par MORA Shawiri, jamais par l’affilié. Un prospect déjà connu et activement traité peut être refusé, motif à l’appui."
      actions={
        <Link className="btn btn--ghost" href="/administration/affiliation/">
          Retour au module
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>À traiter</h2>
          <p>
            {waiting.length} déclaration(s) en attente, sur {rows.length} au total.
          </p>
        </div>
        {rows.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun prospect déclaré</p>
            <p>C’est l’état réel de la base.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Prospects déclarés, du plus récent au plus ancien</caption>
              <thead>
                <tr>
                  <th scope="col">Prospect</th>
                  <th scope="col">Affilié</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Déclaré le</th>
                  <th scope="col">Décider</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      {row.full_name}
                      {row.company ? <span className="admin-field__hint"> — {row.company}</span> : null}
                      {hintMap.get(row.id) ? <span className="admin-badge admin-badge--gold"> {hintMap.get(row.id)}</span> : null}
                    </th>
                    <td>{names.get(row.affiliate_id) ?? '—'}</td>
                    <td>{PROSPECT_STATUS_LABELS[row.status]}</td>
                    <td>{formatMoment(row.created_at)}</td>
                    <td>
                      <Link className="btn btn--ghost" href={`/administration/affiliation/affilies/${row.affiliate_id}/`}>
                        Fiche affilié
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminPage>
  );
}
