import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import { CONTENT_PAGES } from '@/content/blocks';
import { listBlocks, listFaq, listMedias, listPosts, type BlockState } from '@/lib/contenus/admin';
import { requireModule } from '@/lib/rbac/guards';

/**
 * Module « Contenus » — écran principal.
 *
 * Quatre familles, présentées séparément parce qu'elles ne s'administrent pas
 * de la même façon :
 *
 *   * **textes du site** — une valeur par emplacement nommé. Le code porte la
 *     valeur d'origine ; la base ne porte que les modifications ;
 *   * **FAQ** — une collection de questions, avec ses catégories et ses statuts ;
 *   * **articles** — le blog ;
 *   * **médiathèque** — l'inventaire des visuels.
 *
 * ## Les chiffres sont comptés, jamais fabriqués
 *
 * Le § 171 du tableau de bord est formel : « Ces fonctionnalités ne doivent pas
 * être simulées si elles ne sont pas encore implémentées. » Chaque décompte
 * ci-dessous provient d'une lecture réelle, sous RLS. Une médiathèque vide
 * affiche « aucun média inventorié » parce que c'est l'état réel.
 *
 * ## Pourquoi les boutons d'écriture peuvent manquer
 *
 * L'interface ne propose que ce que les permissions autorisent — mais ce n'est
 * pas là que se joue la sécurité. Le point 14 du cadrage l'écrit : le masquage
 * d'un bouton ne protège rien. Les actions revérifient chacune leur permission,
 * et la base refuse l'écriture de son côté. Le masquage évite de proposer une
 * porte fermée, et la fiche **dit** quelle permission manque plutôt que de se
 * taire.
 */

const STATE_LABELS: Record<BlockState, { label: string; badge: string }> = {
  CODE: { label: 'Texte d’origine', badge: 'admin-badge admin-badge--muted' },
  EN_LIGNE: { label: 'Modifié et en ligne', badge: 'admin-badge admin-badge--ok' },
  BROUILLON: { label: 'Brouillon en attente', badge: 'admin-badge admin-badge--gold' },
  EN_LIGNE_ET_BROUILLON: {
    label: 'En ligne + brouillon',
    badge: 'admin-badge admin-badge--brand',
  },
};

const STATUS_BADGES: Record<string, string> = {
  PUBLIE: 'admin-badge admin-badge--ok',
  BROUILLON: 'admin-badge admin-badge--gold',
  NON_PUBLIE: 'admin-badge admin-badge--muted',
  ARCHIVE: 'admin-badge admin-badge--danger',
};

const STATUS_LABELS: Record<string, string> = {
  PUBLIE: 'Publié',
  BROUILLON: 'Brouillon',
  NON_PUBLIE: 'Retiré',
  ARCHIVE: 'Archivé',
};

/**
 * Adresse de la fiche d'un bloc : la clé, son point remplacé par une barre.
 *
 * `accueil.hero` devient `accueil/hero`. Un segment contenant un point serait
 * pris par Next.js pour un nom de fichier et perdrait son slash final par
 * redirection — voir le commentaire de la fiche.
 */
function blockHref(key: string): string {
  return key.split('.').map(encodeURIComponent).join('/');
}

function octets(size: number | null): string {
  if (size === null) return '—';
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Kio`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mio`;
}

export default async function Page() {
  const { module, can } = await requireModule('contenus');

  const [blocks, faq, posts, medias] = await Promise.all([
    listBlocks(),
    listFaq(),
    listPosts(),
    listMedias(),
  ]);

  const modifies = blocks.filter((block) => block.state !== 'CODE').length;
  const brouillons = blocks.filter(
    (block) => block.state === 'BROUILLON' || block.state === 'EN_LIGNE_ET_BROUILLON',
  ).length;

  const questionsPubliees = faq.items.filter((item) => item.status === 'PUBLIE').length;
  const articlesPublies = posts.filter((post) => post.status === 'PUBLIE').length;

  return (
    <AdminPage
      eyebrow="Contenus et diffusion"
      title={module.label}
      lead="Textes des pages, questions fréquentes, articles et visuels. Le site affiche son texte d’origine tant qu’aucune modification n’a été publiée."
    >
      <div className="admin-stats">
        <Stat
          value={String(blocks.length)}
          label="emplacements de texte"
          note={`${modifies} modifié(s), ${brouillons} brouillon(s) en attente`}
        />
        <Stat
          value={String(faq.items.length)}
          label="questions fréquentes"
          note={`${questionsPubliees} publiée(s) · ${faq.categories.length} catégorie(s)`}
        />
        <Stat
          value={String(posts.length)}
          label="articles"
          note={`${articlesPublies} publié(s)`}
        />
        <Stat
          value={String(medias.length)}
          label="médias inventoriés"
          note={`${medias.filter((media) => media.kind === 'STORAGE').length} téléversé(s)`}
        />
      </div>

      {/* ------------------------------------------------ textes du site --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Textes du site</h2>
          <p>
            Chaque emplacement porte le texte affiché aujourd’hui. Tant que rien n’est publié,
            c’est le texte d’origine du site qui est servi — une modification n’apparaît qu’après
            publication.
          </p>
        </div>

        {CONTENT_PAGES.map((page) => {
          const own = blocks.filter((block) => block.page === page.slug);
          if (own.length === 0) return null;

          return (
            <div key={page.slug} className="admin-table-wrap">
              <h3 className="admin-perms__title">{page.label}</h3>
              <table className="admin-table">
                <caption className="sr-only">Textes modifiables de la page {page.label}</caption>
                <thead>
                  <tr>
                    <th scope="col">Emplacement</th>
                    <th scope="col">Nature</th>
                    <th scope="col">État</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {own.map((block) => (
                    <tr key={block.key}>
                      <td>
                        {block.label}
                        <br />
                        <small className="admin-meta">{block.key}</small>
                      </td>
                      <td>{block.kind === 'LIST' ? 'Liste' : 'Texte'}</td>
                      <td>
                        <span className={STATE_LABELS[block.state].badge}>
                          {STATE_LABELS[block.state].label}
                        </span>
                      </td>
                      <td className="admin-table__actions">
                        <Link
                          className="btn btn--ghost"
                          href={`/administration/contenus/bloc/${blockHref(block.key)}/`}
                        >
                          Ouvrir
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>

      {/* ------------------------------------------------------------ FAQ --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Questions fréquentes</h2>
          <p>
            Trois surfaces distinctes : la page FAQ, la FAQ de l’accueil et celle de la page
            Services. Une question n’est visible que publiée, dans une catégorie active.
          </p>
        </div>

        {faq.categories.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune catégorie enregistrée</p>
            <p>
              Le site affiche la FAQ inscrite dans le code. La reprise en base n’a pas encore été
              exécutée.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Catégories de la FAQ</caption>
              <thead>
                <tr>
                  <th scope="col">Catégorie</th>
                  <th scope="col">Surface</th>
                  <th scope="col">Questions</th>
                  <th scope="col">État</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {faq.categories.map((category) => (
                  <tr key={category.id}>
                    <td>{category.title}</td>
                    <td>{category.surface}</td>
                    <td>
                      {category.published} publiée(s) sur {category.total}
                    </td>
                    <td>
                      <span
                        className={
                          category.is_active
                            ? 'admin-badge admin-badge--ok'
                            : 'admin-badge admin-badge--muted'
                        }
                      >
                        {category.is_active ? 'Active' : 'Désactivée'}
                      </span>
                    </td>
                    <td className="admin-table__actions">
                      <Link
                        className="btn btn--ghost"
                        href={`/administration/contenus/faq/${category.id}/`}
                      >
                        Ouvrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- articles --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Articles</h2>
          <p>
            Un article retiré du site répond 404 à son adresse, y compris si celle-ci est connue,
            et disparaît du plan de site.
          </p>
        </div>

        {posts.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun article enregistré</p>
            <p>Le site affiche les articles inscrits dans le code.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Articles du blog</caption>
              <thead>
                <tr>
                  <th scope="col">Titre</th>
                  <th scope="col">Rubrique</th>
                  <th scope="col">Date</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id}>
                    <td>
                      {post.title}
                      <br />
                      <small className="admin-meta">{post.slug}</small>
                    </td>
                    <td>{post.category}</td>
                    <td>{post.published_on ?? '—'}</td>
                    <td>
                      <span className={STATUS_BADGES[post.status]}>
                        {STATUS_LABELS[post.status]}
                      </span>
                    </td>
                    <td className="admin-table__actions">
                      <Link
                        className="btn btn--ghost"
                        href={`/administration/contenus/article/${post.slug}/`}
                      >
                        Ouvrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- médiathèque --- */}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Médiathèque</h2>
          <p>
            Les visuels marqués « local » sont servis par le site comme aujourd’hui : leur adresse
            ne change pas. Les visuels téléversés sont stockés dans Supabase Storage et
            référençables sans modification de code.
          </p>
        </div>

        {medias.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun média inventorié</p>
            <p>L’inventaire des visuels du site n’a pas encore été exécuté.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Médias inventoriés</caption>
              <thead>
                <tr>
                  <th scope="col">Média</th>
                  <th scope="col">Origine</th>
                  <th scope="col">Classement</th>
                  <th scope="col">Dimensions</th>
                  <th scope="col">Poids</th>
                  <th scope="col">Texte alternatif</th>
                </tr>
              </thead>
              <tbody>
                {medias.map((media) => (
                  <tr key={media.id}>
                    <td>
                      {media.title}
                      <br />
                      <small className="admin-meta">{media.path}</small>
                    </td>
                    <td>
                      <span
                        className={
                          media.kind === 'LOCAL'
                            ? 'admin-badge admin-badge--muted'
                            : 'admin-badge admin-badge--brand'
                        }
                      >
                        {media.kind === 'LOCAL' ? 'Local' : 'Storage'}
                      </span>
                    </td>
                    <td>{media.category ?? '—'}</td>
                    <td>
                      {media.width && media.height ? `${media.width} × ${media.height}` : '—'}
                    </td>
                    <td>{octets(media.byte_size)}</td>
                    <td>
                      {media.is_decorative ? (
                        <span className="admin-badge admin-badge--muted">Décorative</span>
                      ) : (
                        (media.alt_text ?? '—')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {can('media.upload') ? null : (
          <p className="admin-field__hint">
            Le téléversement de nouveaux visuels exige la permission « Téléverser un média »
            (<code>media.upload</code>), qui n’est pas accordée à ce compte.
          </p>
        )}
      </section>
    </AdminPage>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="admin-stat">
      <span className="admin-stat__value">{value}</span>
      <span className="admin-stat__label">{label}</span>
      {note ? <span className="admin-stat__note">{note}</span> : null}
    </div>
  );
}
