import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import ConfirmForm from '@/components/admin/ConfirmForm';
import ContenuBlocForm, { ContenuListeForm } from '@/components/admin/ContenuBlocForm';
import { CONTENT_PAGES } from '@/content/blocks';
import { publierBloc, retablirBloc } from '@/lib/contenus/actions';
import { findBlock } from '@/lib/contenus/admin';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Fiche d'un bloc éditorial.
 *
 * Trois zones, dans cet ordre : l'état de publication, la saisie, le
 * rétablissement. C'est l'ordre des questions que se pose l'administrateur —
 * « qu'est-ce qui est en ligne ? », puis « que veux-je écrire ? », puis
 * « comment revenir en arrière ? ».
 *
 * ## Les transitions sont des boutons séparés, pas une liste déroulante
 *
 * Même parti qu'en 4E-1, et pour la même raison : une liste déroulante
 * demanderait de choisir puis de valider sans jamais dire ce que chaque valeur
 * entraîne. Ici chaque bouton porte sa conséquence en clair, comme le § 129 le
 * demande, et chacun exige une confirmation explicite.
 *
 * ## Quand un bouton manque, la page le dit
 *
 * Se taire laisserait croire à un défaut. La fiche nomme la permission absente
 * — ce qui n'affaiblit rien : la permission est vérifiée par l'action **et** par
 * la base.
 */

/**
 * L'adresse porte la clé en **deux segments** — `.../bloc/accueil/hero/` pour
 * la clé `accueil.hero` — et non en un seul segment contenant le point.
 *
 * La raison est concrète : le site est servi avec `trailingSlash: true`, et
 * Next.js voit dans un segment pointé une extension de fichier. Il retire alors
 * le slash final par une redirection 308, que la redirection de session
 * transforme en seconde redirection. L'adresse « fonctionnait » au navigateur
 * mais répondait 308 à tout contrôle automatisé — et ce sont ces redirections
 * en cascade qui l'ont révélé.
 */
type PageProps = { params: Promise<{ page: string; nom: string }> };

export default async function Page({ params }: PageProps) {
  const { page: pageSegment, nom } = await params;
  const key = `${decodeURIComponent(pageSegment)}.${decodeURIComponent(nom)}`;

  const { can } = await requirePermission('content.view', '/administration/contenus/');

  const block = await findBlock(key);
  // Une clé absente du registre n'existe pas : 404, et non un écran vide.
  if (!block) notFound();

  const pageEntry = CONTENT_PAGES.find((entry) => entry.slug === block.page);

  const enLigne = block.state === 'EN_LIGNE' || block.state === 'EN_LIGNE_ET_BROUILLON';
  const aUnBrouillon =
    block.state === 'BROUILLON' || block.state === 'EN_LIGNE_ET_BROUILLON';

  const peutModifier = can('content.update');
  const peutPublier = can('content.publish');

  return (
    <AdminPage
      eyebrow="Contenus et diffusion"
      title={block.label}
      lead={
        pageEntry
          ? `Page « ${pageEntry.label} » · emplacement ${block.key}`
          : `Emplacement ${block.key}`
      }
      actions={
        <Link className="btn btn--ghost" href="/administration/contenus/">
          Retour aux contenus
        </Link>
      }
    >
      {/* ------------------------------------------------- état et publication --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Publication</h2>
          <p>
            {enLigne
              ? 'Le site affiche actuellement le texte enregistré ici.'
              : 'Le site affiche actuellement le texte d’origine inscrit dans le code.'}
            {aUnBrouillon ? ' Une modification attend d’être publiée.' : ''}
          </p>
        </div>

        <dl className="admin-meta">
          <dt>État</dt>
          <dd>{enLigne ? 'Modification en ligne' : 'Texte d’origine'}</dd>
          <dt>Modification en attente</dt>
          <dd>{aUnBrouillon ? 'Oui' : 'Non'}</dd>
          <dt>Dernière publication</dt>
          <dd>{block.publishedAt ?? '—'}</dd>
          <dt>Dernière modification</dt>
          <dd>{block.updatedAt ?? '—'}</dd>
        </dl>

        {peutPublier ? (
          <div className="admin-actions">
            {aUnBrouillon ? (
              <ConfirmForm
                action={publierBloc}
                fields={{ key: block.key }}
                trigger="Publier la modification"
                consequence="Le texte enregistré remplacera celui affiché sur le site dès la prochaine régénération de la page."
                confirmLabel="Publier maintenant"
                variant="primary"
              />
            ) : null}

            {enLigne ? (
              <ConfirmForm
                action={retablirBloc}
                fields={{ key: block.key }}
                trigger="Rétablir le texte d’origine"
                consequence="La modification sera retirée et le site affichera de nouveau le texte inscrit dans le code. Le brouillon éventuel sera perdu."
                confirmLabel="Rétablir"
              />
            ) : null}
          </div>
        ) : (
          <p className="admin-field__hint">
            La mise en ligne et le retrait exigent la permission « Publier ou dépublier un
            contenu » (<code>content.publish</code>), qui n’est pas accordée à ce compte. Vous
            pouvez enregistrer un brouillon.
          </p>
        )}
      </section>

      {/* -------------------------------------------------------------- saisie --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Contenu</h2>
          <p>
            L’enregistrement crée un brouillon : rien n’est visible sur le site avant publication.
          </p>
        </div>

        {block.kind === 'LIST' ? (
          <ContenuListeForm
            cle={block.key}
            defaults={block.defaults}
            draft={block.draft}
            published={block.published}
            shape={block.shape ?? 'TEXTE'}
            readOnly={!peutModifier}
          />
        ) : (
          <ContenuBlocForm
            cle={block.key}
            kind={block.kind}
            defaults={block.defaults as Record<string, unknown>}
            draft={block.draft as Record<string, unknown> | null}
            published={block.published as Record<string, unknown> | null}
            readOnly={!peutModifier}
          />
        )}

        {peutModifier ? null : (
          <p className="admin-field__hint">
            La modification exige la permission « Modifier un contenu » (
            <code>content.update</code>), qui n’est pas accordée à ce compte. Cette fiche est en
            lecture seule.
          </p>
        )}
      </section>

      {/* ----------------------------------------------------- texte d'origine --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Texte d’origine</h2>
          <p>
            Ce que le site affiche lorsqu’aucune modification n’est publiée. Cette valeur est
            inscrite dans le code : elle sert aussi de secours si la base devient momentanément
            injoignable.
          </p>
        </div>

        <pre className="admin-perm__code">{JSON.stringify(block.defaults, null, 2)}</pre>
      </section>
    </AdminPage>
  );
}
