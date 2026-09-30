import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import ConfirmForm from '@/components/admin/ConfirmForm';
import ServiceForm from '@/components/admin/ServiceForm';
import { deleteServiceAction, setServiceStatusAction } from '@/lib/catalogue/actions';
import { findService, listCategories, STATUS_LABELS } from '@/lib/catalogue/admin';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Fiche d’offre',
  robots: { index: false, follow: false },
};

/**
 * Fiche d'une offre — consultation, modification, publication.
 *
 * Le garde est celui du registre : `requireModule('catalogue')` exige la
 * session, le rôle, le second facteur et `services.view`. L'offre est ensuite
 * lue **sous RLS** : un compte qui n'a pas le droit de la voir reçoit `null`,
 * donc un 404, et non une fiche vide qui confirmerait son existence (§ 102).
 *
 * Les quatre transitions de statut du § 28 sont proposées séparément plutôt
 * que par une liste déroulante. Une liste demanderait de choisir puis de
 * valider, sans dire ce que chaque valeur entraîne ; ici chaque bouton porte
 * sa conséquence, comme le § 129 le demande.
 */
export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await requireModule('catalogue');

  const [service, categories] = await Promise.all([findService(slug), listCategories()]);
  if (!service) notFound();

  const canUpdate = context.can('services.update');
  const canPublish = context.can('services.publish');
  const canDelete = context.can('services.delete');
  const neverPublished = service.published_at === null;

  return (
    <AdminPage
      eyebrow="Catalogue"
      title={service.title}
      lead={`Identifiant d’URL : ${service.slug} · Statut : ${STATUS_LABELS[service.status]}`}
      actions={
        <Link className="btn btn--ghost" href="/administration/catalogue/">
          Retour au catalogue
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Publication</h2>
          <p>
            {service.status === 'PUBLIE'
              ? 'Cette offre est visible sur le site public. Le retrait conserve toutes ses données.'
              : 'Cette offre n’apparaît pas sur le site public.'}
            {service.published_at
              ? ` Première mise en ligne le ${formatDate(service.published_at)}.`
              : ' Elle n’a jamais été publiée.'}
          </p>
        </div>

        {canPublish ? (
          <div className="admin-table__actions">
            {service.status !== 'PUBLIE' ? (
              <ConfirmForm
                action={setServiceStatusAction}
                fields={{ offre: service.id, statut: 'PUBLIE' }}
                trigger="Publier"
                consequence={`« ${service.title} » deviendra visible sur la Boutique et, si elle est mise en avant, sur la page d’accueil. Le site public en tiendra compte au prochain cycle de régénération, dans les cinq minutes.`}
                confirmLabel="Publier l’offre"
                variant="primary"
              />
            ) : (
              <ConfirmForm
                action={setServiceStatusAction}
                fields={{ offre: service.id, statut: 'NON_PUBLIE' }}
                trigger="Dépublier"
                consequence={`« ${service.title} » sera retirée du site public dans les cinq minutes. Aucune donnée n’est perdue et l’offre pourra être republiée.`}
                confirmLabel="Retirer du site"
              />
            )}

            {service.status !== 'ARCHIVE' ? (
              <ConfirmForm
                action={setServiceStatusAction}
                fields={{ offre: service.id, statut: 'ARCHIVE' }}
                trigger="Archiver"
                consequence={`« ${service.title} » sera retirée du site public et marquée archivée. Elle restera consultable en administration, ce qui préserve l’historique des commandes à venir.`}
                confirmLabel="Archiver l’offre"
              />
            ) : (
              <ConfirmForm
                action={setServiceStatusAction}
                fields={{ offre: service.id, statut: 'BROUILLON' }}
                trigger="Sortir de l’archive"
                consequence={`« ${service.title} » repassera en brouillon. Elle ne sera pas publiée pour autant : la mise en ligne reste une action distincte.`}
                confirmLabel="Repasser en brouillon"
              />
            )}
          </div>
        ) : (
          <div className="admin-notice">
            <p>
              Vous pouvez consulter cette offre sans pouvoir la mettre en ligne ni la retirer. La
              permission
              <code> services.publish </code>
              est nécessaire.
            </p>
          </div>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Fiche</h2>
          <p>
            La modification ne change jamais le statut : une offre publiée le reste, une offre en
            brouillon aussi.
          </p>
        </div>

        <ServiceForm
          categories={categories.filter((category) => category.kind === 'SERVICE')}
          mode="modification"
          service={service}
          readOnly={!canUpdate}
        />
      </section>

      {canDelete ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Suppression</h2>
            <p>
              Une offre déjà publiée ne se supprime pas : elle s’archive. C’est ce qui garantit que
              les commandes passées conserveront leur contexte.
            </p>
          </div>

          {neverPublished ? (
            <ConfirmForm
              action={deleteServiceAction}
              fields={{ offre: service.id }}
              trigger="Supprimer définitivement"
              consequence={`« ${service.title} » sera effacée sans possibilité de retour. Cette offre n’a jamais été publiée, aucune donnée commerciale n’y est rattachée.`}
              confirmLabel="Supprimer l’offre"
            />
          ) : (
            <div className="admin-notice">
              <p>
                Cette offre a été publiée le {formatDate(service.published_at as string)}. La
                suppression est refusée par la base ; utilisez l’archivage.
              </p>
            </div>
          )}
        </section>
      ) : null}
    </AdminPage>
  );
}

/** Date lisible, au fuseau de Moroni comme le reste de l'administration. */
function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Indian/Comoro',
  }).format(new Date(value));
}
