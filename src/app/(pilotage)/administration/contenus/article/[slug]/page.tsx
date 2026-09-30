import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import ConfirmForm from '@/components/admin/ConfirmForm';
import ContenuArticleForm from '@/components/admin/ContenuArticleForm';
import { changerStatutArticle, supprimerArticle } from '@/lib/contenus/actions';
import { findPost } from '@/lib/contenus/admin';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Fiche d'un article.
 *
 * Trois zones : publication, fiche, suppression — l'ordre des questions que se
 * pose l'administrateur. Chaque transition de statut est un bouton distinct
 * portant sa conséquence en clair (§ 129), avec confirmation explicite (§ 123).
 *
 * ## Ce que la fiche dit du corps de l'article
 *
 * Le corps est stocké en blocs typés et **n'est pas modifiable ici**. Plutôt que
 * de laisser croire le contraire par un silence, la fiche l'affiche en lecture
 * seule et le nomme. Le § 171 du tableau de bord interdit de simuler une
 * fonctionnalité absente ; l'annoncer est la seule option honnête.
 */

type PageProps = { params: Promise<{ slug: string }> };

const STATUS_BADGES: Record<string, string> = {
  PUBLIE: 'admin-badge admin-badge--ok',
  BROUILLON: 'admin-badge admin-badge--gold',
  NON_PUBLIE: 'admin-badge admin-badge--muted',
  ARCHIVE: 'admin-badge admin-badge--danger',
};

const STATUS_LABELS: Record<string, string> = {
  PUBLIE: 'Publié',
  BROUILLON: 'Brouillon',
  NON_PUBLIE: 'Retiré du site',
  ARCHIVE: 'Archivé',
};

export default async function Page({ params }: PageProps) {
  const { slug } = await params;

  const { can } = await requirePermission('content.view', '/administration/contenus/');

  const post = await findPost(slug);
  if (!post) notFound();

  const peutModifier = can('content.update');
  const peutPublier = can('content.publish');
  const peutSupprimer = can('content.delete');

  const blocs = Array.isArray(post.body) ? post.body.length : 0;

  return (
    <AdminPage
      eyebrow="Articles"
      title={post.title}
      lead={`/blog/${post.slug}/ · ${blocs} bloc(s) de contenu`}
      actions={
        <Link className="btn btn--ghost" href="/administration/contenus/">
          Retour aux contenus
        </Link>
      }
    >
      {/* ------------------------------------------------------- publication --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Publication</h2>
          <p>
            {post.status === 'PUBLIE'
              ? 'Cet article est visible sur le site et figure dans le plan de site.'
              : 'Cet article n’est pas visible sur le site : son adresse répond 404, même si elle est connue.'}
          </p>
        </div>

        <dl className="admin-meta">
          <dt>Statut</dt>
          <dd>
            <span className={STATUS_BADGES[post.status]}>{STATUS_LABELS[post.status]}</span>
          </dd>
          <dt>Première publication</dt>
          <dd>{post.published_at ?? '—'}</dd>
          <dt>Dernière modification</dt>
          <dd>{post.updated_at}</dd>
        </dl>

        {peutPublier ? (
          <div className="admin-actions">
            {post.status !== 'PUBLIE' ? (
              <ConfirmForm
                action={changerStatutArticle}
                fields={{ id: post.id, status: 'PUBLIE' }}
                trigger="Publier"
                consequence="L’article deviendra accessible à son adresse publique et sera ajouté au plan de site."
                confirmLabel="Publier"
                variant="primary"
              />
            ) : null}

            {post.status === 'PUBLIE' ? (
              <ConfirmForm
                action={changerStatutArticle}
                fields={{ id: post.id, status: 'NON_PUBLIE' }}
                trigger="Retirer du site"
                consequence="L’adresse de l’article répondra 404 et il quittera le plan de site. Son contenu est conservé."
                confirmLabel="Retirer"
              />
            ) : null}

            {post.status !== 'ARCHIVE' ? (
              <ConfirmForm
                action={changerStatutArticle}
                fields={{ id: post.id, status: 'ARCHIVE' }}
                trigger="Archiver"
                consequence="L’article sera archivé : retiré du site, conservé pour l’historique."
                confirmLabel="Archiver"
              />
            ) : null}
          </div>
        ) : (
          <p className="admin-field__hint">
            La publication et le retrait exigent la permission « Publier ou dépublier un
            contenu » (<code>content.publish</code>), qui n’est pas accordée à ce compte.
          </p>
        )}
      </section>

      {/* -------------------------------------------------------------- fiche --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Fiche de l’article</h2>
          <p>
            Les modifications sont enregistrées immédiatement. Elles n’affectent la visibilité de
            l’article que s’il est déjà publié.
          </p>
        </div>

        <ContenuArticleForm post={post} readOnly={!peutModifier} />

        {peutModifier ? null : (
          <p className="admin-field__hint">
            La modification exige la permission « Modifier un contenu » (
            <code>content.update</code>), qui n’est pas accordée à ce compte. Cette fiche est en
            lecture seule.
          </p>
        )}
      </section>

      {/* -------------------------------------------------- corps de l'article --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Corps de l’article</h2>
          <p>
            Stocké en blocs typés — titres, paragraphes, listes, encadrés — et rendu par le code,
            sans jamais interpréter de balise. Sa rédaction depuis l’administration demande un
            éditeur de blocs, qui n’est pas livré dans cette phase.
          </p>
        </div>

        <pre className="admin-perm__code">{JSON.stringify(post.body, null, 2)}</pre>
      </section>

      {/* -------------------------------------------------------- suppression --- */}

      {peutSupprimer ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Suppression</h2>
            <p>
              {post.published_at === null
                ? 'Cet article n’a jamais été publié : il peut être supprimé définitivement.'
                : 'Cet article a déjà été publié : il ne peut plus être supprimé. Son adresse a pu être partagée ou indexée. Archivez-le pour le retirer du site en conservant son historique.'}
            </p>
          </div>

          {post.published_at === null ? (
            <ConfirmForm
              action={supprimerArticle}
              fields={{ id: post.id }}
              trigger="Supprimer l’article"
              consequence="L’article sera définitivement supprimé. Il n’a jamais été publié, donc aucune adresse publique n’est concernée."
              confirmLabel="Supprimer définitivement"
            />
          ) : null}
        </section>
      ) : null}
    </AdminPage>
  );
}
