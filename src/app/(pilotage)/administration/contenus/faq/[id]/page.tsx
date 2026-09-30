import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import ConfirmForm from '@/components/admin/ConfirmForm';
import ContenuQuestionForm from '@/components/admin/ContenuQuestionForm';
import {
  changerStatutQuestion,
  supprimerQuestion,
} from '@/lib/contenus/actions';
import { listFaq } from '@/lib/contenus/admin';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Questions d'une catégorie de FAQ.
 *
 * Les quatre statuts sont ceux du § 60 — les mêmes que pour le catalogue
 * (4E-1), conformément au § 124 qui demande une échelle cohérente sur tout le
 * site. Chaque transition est un bouton distinct portant sa conséquence, jamais
 * une liste déroulante.
 */

type PageProps = { params: Promise<{ id: string }> };

const STATUS_BADGES: Record<string, string> = {
  PUBLIE: 'admin-badge admin-badge--ok',
  BROUILLON: 'admin-badge admin-badge--gold',
  NON_PUBLIE: 'admin-badge admin-badge--muted',
  ARCHIVE: 'admin-badge admin-badge--danger',
};

const STATUS_LABELS: Record<string, string> = {
  PUBLIE: 'Publiée',
  BROUILLON: 'Brouillon',
  NON_PUBLIE: 'Retirée',
  ARCHIVE: 'Archivée',
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;

  const { can } = await requirePermission('content.view', '/administration/contenus/');

  const { categories, items } = await listFaq();
  const category = categories.find((entry) => entry.id === id);
  if (!category) notFound();

  const own = items.filter((item) => item.category_id === category.id);

  const peutCreer = can('content.create');
  const peutModifier = can('content.update');
  const peutPublier = can('content.publish');
  const peutSupprimer = can('content.delete');

  return (
    <AdminPage
      eyebrow="Questions fréquentes"
      title={category.title}
      lead={`Surface « ${category.surface} » · ${category.published} question(s) publiée(s) sur ${category.total}`}
      actions={
        <Link className="btn btn--ghost" href="/administration/contenus/">
          Retour aux contenus
        </Link>
      }
    >
      {category.is_active ? null : (
        <section className="admin-card">
          <p className="admin-notice admin-notice--error" role="alert">
            Cette catégorie est désactivée : ses questions ne sont pas affichées sur le site,
            même publiées.
          </p>
        </section>
      )}

      {/* ---------------------------------------------------------- questions --- */}

      {own.length === 0 ? (
        <section className="admin-card">
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune question dans cette catégorie</p>
            <p>Une catégorie sans question publiée n’apparaît pas sur le site.</p>
          </div>
        </section>
      ) : (
        own.map((item) => (
          <section className="admin-card" key={item.id}>
            <div className="admin-card__head">
              <h2>{item.question}</h2>
              <p>
                <span className={STATUS_BADGES[item.status]}>{STATUS_LABELS[item.status]}</span>
                {item.published_at ? (
                  <> · première publication : {item.published_at}</>
                ) : null}
              </p>
            </div>

            <ContenuQuestionForm
              mode="modification"
              categoryId={category.id}
              question={{
                id: item.id,
                question: item.question,
                answer: item.answer,
                sort_order: item.sort_order,
              }}
              readOnly={!peutModifier}
            />

            <div className="admin-actions">
              {peutPublier && item.status !== 'PUBLIE' ? (
                <ConfirmForm
                  action={changerStatutQuestion}
                  fields={{ id: item.id, status: 'PUBLIE' }}
                  trigger="Publier"
                  consequence="Cette question sera visible sur le site public dès la prochaine régénération de la page."
                  confirmLabel="Publier"
                  variant="primary"
                />
              ) : null}

              {peutPublier && item.status === 'PUBLIE' ? (
                <ConfirmForm
                  action={changerStatutQuestion}
                  fields={{ id: item.id, status: 'NON_PUBLIE' }}
                  trigger="Retirer du site"
                  consequence="Cette question disparaîtra du site public. Son texte est conservé."
                  confirmLabel="Retirer"
                />
              ) : null}

              {peutPublier && item.status !== 'ARCHIVE' ? (
                <ConfirmForm
                  action={changerStatutQuestion}
                  fields={{ id: item.id, status: 'ARCHIVE' }}
                  trigger="Archiver"
                  consequence="Cette question sera archivée : retirée du site, conservée pour l’historique."
                  confirmLabel="Archiver"
                />
              ) : null}

              {/* Une question déjà publiée ne se supprime pas : le déclencheur
                  de la base le refuse et elle s'archive (§ 69, § 112). Proposer
                  le bouton serait promettre une action impossible. */}
              {peutSupprimer && item.published_at === null ? (
                <ConfirmForm
                  action={supprimerQuestion}
                  fields={{ id: item.id }}
                  trigger="Supprimer"
                  consequence="Cette question sera définitivement supprimée. Elle n’a jamais été publiée, donc aucune adresse publique n’est concernée."
                  confirmLabel="Supprimer définitivement"
                />
              ) : null}
            </div>

            {peutPublier ? null : (
              <p className="admin-field__hint">
                La publication et le retrait exigent la permission{' '}
                <code>content.publish</code>, qui n’est pas accordée à ce compte.
              </p>
            )}
          </section>
        ))
      )}

      {/* ------------------------------------------------- nouvelle question --- */}

      {peutCreer ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Ajouter une question</h2>
            <p>
              La question est créée en brouillon : elle n’apparaît sur le site qu’après
              publication.
            </p>
          </div>

          <ContenuQuestionForm mode="creation" categoryId={category.id} />
        </section>
      ) : (
        <section className="admin-card">
          <p className="admin-field__hint">
            La création exige la permission « Créer un contenu » (<code>content.create</code>),
            qui n’est pas accordée à ce compte.
          </p>
        </section>
      )}
    </AdminPage>
  );
}
