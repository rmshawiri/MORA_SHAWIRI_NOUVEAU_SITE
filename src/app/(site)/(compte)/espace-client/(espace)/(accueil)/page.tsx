import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceKpis, SpaceList, SpaceMore } from '@/components/affiliation/SpaceUi';
import SignOutButton from '@/components/auth/SignOutButton';
import { formatClientDate } from '@/lib/client/labels';
import { getMyClientSpace, myDashboard } from '@/lib/client/space';
import { formatAmount, ORDER_STATUS_LABELS, SETTLEMENT_STATUS_LABELS } from '@/lib/commerce/labels';
import {
  APPOINTMENT_CHANNEL_LABELS,
  APPOINTMENT_STATUS_LABELS,
  formatDay,
  formatMoment,
  QUOTE_REQUEST_STATUS_LABELS,
} from '@/lib/relation/labels';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Mon espace',
  description: 'Votre espace client MORA Shawiri.',
  robots: { index: false, follow: false },
};

function channelLabel(channel: string, label: string | null): string {
  return label ?? APPOINTMENT_CHANNEL_LABELS[channel as keyof typeof APPOINTMENT_CHANNEL_LABELS] ?? channel;
}

/**
 * Tableau de bord du client (phase 4I-1).
 *
 * Tout ce qui s'affiche vient des lignes réellement enregistrées pour ce
 * compte — commandes, demandes, rendez-vous. Aucune donnée d'exemple, aucun
 * chiffre estimé : une rubrique vide le dit, et dit ce qui la remplira.
 *
 * Les présentations compactes empruntent les briques de l'espace affilié
 * (`SpaceUi`), importées telles quelles.
 */
export default async function EspaceClientPage() {
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const dashboard = await myDashboard(space);

  return (
    <>
      {dashboard.failed ? (
        <div className="auth-notice auth-notice--warn" role="alert">
          <p>Une partie de vos informations n’a pas pu être chargée. Veuillez réessayer dans un instant.</p>
        </div>
      ) : null}

      <SpaceKpis
        label="Votre activité"
        items={[
          { label: 'Commandes en cours', value: String(dashboard.ordersOpen) },
          { label: 'Demandes en cours', value: String(dashboard.requestsOpen) },
          { label: 'Rendez-vous à venir', value: String(dashboard.appointmentsUpcoming) },
        ]}
      />

      <SpaceCard
        title="Mes commandes"
        intro={dashboard.orders.length > 0 ? 'Ouvrez une commande pour en voir le détail et déclarer votre paiement.' : undefined}
      >
        {dashboard.orders.length === 0 ? (
          <SpaceEmpty title="Vous n’avez encore aucune commande.">
            Une commande est établie par MORA Shawiri après acceptation d’un devis ; vous la retrouverez ici.{' '}
            <Link href="/boutique/">Découvrir nos offres</Link>
          </SpaceEmpty>
        ) : (
          <SpaceList label="Mes commandes récentes">
            {dashboard.orders.map((order) => (
              <SpaceItem
                key={order.id}
                title={<Link href={`/espace-client/commandes/${order.reference}/`}>{order.reference}</Link>}
                amount={formatAmount(order.total_amount, order.currency)}
                status={ORDER_STATUS_LABELS[order.status]}
                tone={order.status === 'TERMINEE' ? 'ok' : order.status === 'ANNULEE' ? 'muted' : 'todo'}
                meta={`${SETTLEMENT_STATUS_LABELS[order.settlement_status]} · ${formatClientDate(order.created_at)}`}
              />
            ))}
          </SpaceList>
        )}
        {dashboard.orders.length > 0 ? <SpaceMore href="/espace-client/commandes/">Voir toutes mes commandes</SpaceMore> : null}
      </SpaceCard>

      <SpaceCard title="Mes demandes en cours">
        {dashboard.requests.length === 0 ? (
          <SpaceEmpty title="Aucune demande en cours.">
            Les demandes de devis que vous envoyez apparaissent ici.{' '}
            <Link href="/contact/">Faire une demande</Link>
          </SpaceEmpty>
        ) : (
          <SpaceList label="Mes demandes en cours">
            {dashboard.requests.map((request) => (
              <SpaceItem
                key={request.id}
                title={<Link href={`/espace-client/demandes/${request.reference}/`}>{request.reference}</Link>}
                status={QUOTE_REQUEST_STATUS_LABELS[request.status]}
                meta={`${request.offer_title ?? request.subject} · ${formatClientDate(request.created_at)}`}
              />
            ))}
          </SpaceList>
        )}
        <SpaceMore href="/espace-client/demandes/">Voir toutes mes demandes</SpaceMore>
      </SpaceCard>

      <SpaceCard title="Mes rendez-vous à venir">
        {dashboard.appointments.length === 0 ? (
          <SpaceEmpty title="Aucun rendez-vous à venir.">
            <Link href="/rendez-vous/">Prendre rendez-vous</Link>
          </SpaceEmpty>
        ) : (
          <SpaceList label="Mes rendez-vous à venir">
            {dashboard.appointments.map((appointment) => (
              <SpaceItem
                key={appointment.id}
                title={<Link href={`/espace-client/rendez-vous/${appointment.id}/`}>{appointment.reference ?? appointment.subject}</Link>}
                status={APPOINTMENT_STATUS_LABELS[appointment.status]}
                tone={appointment.status === 'CONFIRME' ? 'ok' : 'todo'}
                meta={
                  appointment.scheduled_at
                    ? `${formatMoment(appointment.scheduled_at)} · ${channelLabel(appointment.channel, appointment.channel_label)}`
                    : `Demande en attente de confirmation${
                        appointment.requested_date ? ` · souhaité le ${formatDay(appointment.requested_date)}` : ''
                      }${appointment.requested_slot ? ` (${appointment.requested_slot})` : ''}`
                }
              />
            ))}
          </SpaceList>
        )}
        <SpaceMore href="/espace-client/rendez-vous/">Voir tous mes rendez-vous</SpaceMore>
      </SpaceCard>

      {space.isAffiliate ? (
        <SpaceCard title="Mon espace affilié" intro="Votre compte est aussi affilié : vos liens, commissions et versements ont leur propre espace.">
          <div className="btn-row">
            <Link className="btn btn--ghost" href="/espace-affilie/">
              Ouvrir mon espace affilié
            </Link>
          </div>
        </SpaceCard>
      ) : null}

      <SpaceCard title="Contacter MORA Shawiri" intro="Une question sur une commande, un devis ou un rendez-vous ? Écrivez-nous en citant votre référence client.">
        <dl className="auth-meta">
          <div>
            <dt>Votre référence client</dt>
            <dd>
              <code>{space.client.reference}</code>
            </dd>
          </div>
          <div>
            <dt>Téléphone / WhatsApp</dt>
            <dd>
              <a href={site.phoneHref}>{site.phone}</a>
            </dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>
              <a href={site.emailHref}>{site.email}</a>
            </dd>
          </div>
          <div>
            <dt>Adresse</dt>
            <dd>{site.addressLabel}</dd>
          </div>
        </dl>
        <div className="btn-row">
          <a className="btn btn--primary" href={site.whatsappBase} target="_blank" rel="noopener noreferrer">
            Écrire sur WhatsApp
          </a>
        </div>
      </SpaceCard>

      <SpaceCard title="Quitter" intro="La déconnexion ferme toutes vos sessions, sur tous vos appareils.">
        <SignOutButton />
      </SpaceCard>
    </>
  );
}
