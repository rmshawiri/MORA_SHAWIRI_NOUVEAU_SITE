import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import CategoryForm from '@/components/admin/CategoryForm';
import ServiceForm from '@/components/admin/ServiceForm';
import {
  countByStatus,
  listCategories,
  listProducts,
  listServices,
  STATUS_LABELS,
} from '@/lib/catalogue/admin';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Catalogue',
  robots: { index: false, follow: false },
};

/**
 * Module Catalogue — les prestations et les produits de la Boutique.
 *
 * Le registre des modules réunit `00_GESTION_SERVICES` et
 * `01_GESTION_PRODUITS` sous une seule entrée, comme le § 34-35 du tableau de
 * bord les présente. La page ouvre sous `services.view` ; les autres droits
 * gouvernent ce qu'on peut y faire :
 *
 *   * `services.view`    ouvre le module et la liste ;
 *   * `services.create`  autorise la création d'une offre et d'une catégorie ;
 *   * `services.update`  autorise la modification ;
 *   * `services.publish` autorise la mise en ligne et le retrait ;
 *   * `services.delete`  autorise la suppression d'un brouillon.
 *
 * Consulter sans pouvoir publier est donc un état normal — c'est même le cas
 * que le § 10 (moindre privilège) demande de rendre possible.
 *
 * Les boutons suivent les permissions, mais ne les remplacent pas : chaque
 * action revérifie côté serveur. Voir `src/lib/catalogue/actions.ts`.
 */
export default async function CataloguePage() {
  const context = await requireModule('catalogue');

  const [services, categories, products] = await Promise.all([
    listServices(),
    listCategories(),
    context.can('products.view') ? listProducts() : Promise.resolve([]),
  ]);

  const counts = countByStatus(services);
  const serviceCategories = categories.filter((category) => category.kind === 'SERVICE');
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

  const canUpdate = context.can('services.update');
  const canCreate = context.can('services.create');

  return (
    <AdminPage
      eyebrow="Contenus et diffusion"
      title="Catalogue"
      lead="Prestations de la Boutique, prix, visuels et publication. Ce que vous modifiez ici remplace le site public au prochain cycle de régénération."
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Offres</h2>
          <p>
            {services.length} offre(s) enregistrée(s) : {counts.PUBLIE} publiée(s),{' '}
            {counts.BROUILLON} en brouillon, {counts.NON_PUBLIE} retirée(s), {counts.ARCHIVE}{' '}
            archivée(s). Seules les offres publiées apparaissent sur le site.
          </p>
        </div>

        {services.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune offre visible</p>
            <p>
              Soit le catalogue est vide, soit votre permission ne vous donne accès à aucune fiche.
              Si vous pensez que c’est une erreur, demandez à un super-administrateur de vérifier
              vos droits.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Offres du catalogue et leur état de publication</caption>
              <thead>
                <tr>
                  <th scope="col">Offre</th>
                  <th scope="col">Catégorie</th>
                  <th scope="col">Prix</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Boutique</th>
                  <th scope="col">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {services.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      {entry.title}
                      {entry.is_featured ? (
                        <span className="admin-badge admin-badge--gold" style={{ marginLeft: 'var(--sp-2)' }}>
                          En avant
                        </span>
                      ) : null}
                    </th>
                    <td>{categoryNameById.get(entry.category_id) ?? '—'}</td>
                    <td>{entry.price_label}</td>
                    <td>{statusBadge(entry.status)}</td>
                    <td>
                      {entry.show_in_shop ? (
                        <span className="admin-badge admin-badge--ok">Oui</span>
                      ) : (
                        <span className="admin-badge admin-badge--muted">Non</span>
                      )}
                    </td>
                    <td>
                      <Link
                        className="btn btn--ghost"
                        href={`/administration/catalogue/${entry.slug}/`}
                      >
                        {canUpdate ? 'Modifier' : 'Consulter'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Catégories</h2>
          <p>
            Les catégories regroupent les offres dans la Boutique. Une catégorie désactivée retire
            ses offres de l’affichage public ; elle ne peut pas l’être tant qu’une offre publiée s’y
            rattache.
          </p>
        </div>

        {serviceCategories.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune catégorie</p>
            <p>Créez une catégorie avant d’ajouter une offre : chaque offre doit en porter une.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Nom</th>
                  <th scope="col">Identifiant d’URL</th>
                  <th scope="col">Rang</th>
                  <th scope="col">État</th>
                  <th scope="col">Offres</th>
                </tr>
              </thead>
              <tbody>
                {serviceCategories.map((category) => (
                  <tr key={category.id}>
                    <th scope="row">{category.name}</th>
                    <td>
                      <code>{category.slug}</code>
                    </td>
                    <td>{category.sort_order}</td>
                    <td>
                      {category.is_active ? (
                        <span className="admin-badge admin-badge--ok">Active</span>
                      ) : (
                        <span className="admin-badge admin-badge--muted">Désactivée</span>
                      )}
                    </td>
                    <td>
                      {services.filter((entry) => entry.category_id === category.id).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canCreate ? <CategoryForm /> : null}
      </section>

      {canCreate ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Ajouter une offre</h2>
            <p>
              Une offre est toujours créée en brouillon : elle n’apparaît sur le site qu’après une
              publication explicite, depuis sa fiche.
            </p>
          </div>

          <ServiceForm categories={serviceCategories} mode="creation" />
        </section>
      ) : (
        <div className="admin-notice">
          <p>
            Vous consultez le catalogue sans pouvoir le modifier. La permission
            <code> services.create </code>
            est nécessaire pour ajouter une offre.
          </p>
        </div>
      )}

      {context.can('products.view') ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Produits</h2>
            <p>
              L’univers « Produits » de la Boutique. Il est distinct des prestations : un service
              n’y figure jamais automatiquement.
            </p>
          </div>

          {products.length === 0 ? (
            <div className="admin-empty">
              <p className="admin-empty__title">Aucun produit enregistré</p>
              <p>
                C’est l’état réel du catalogue, et non un écran en attente : aucun produit n’existe
                au lancement. La page publique l’annonce dans les mêmes termes.
              </p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Produit</th>
                    <th scope="col">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <th scope="row">{product.title}</th>
                      <td>{statusBadge(product.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </AdminPage>
  );
}

function statusBadge(status: keyof typeof STATUS_LABELS) {
  const className =
    status === 'PUBLIE'
      ? 'admin-badge--ok'
      : status === 'BROUILLON'
        ? 'admin-badge--gold'
        : status === 'ARCHIVE'
          ? 'admin-badge--muted'
          : 'admin-badge--danger';

  return <span className={`admin-badge ${className}`}>{STATUS_LABELS[status]}</span>;
}
