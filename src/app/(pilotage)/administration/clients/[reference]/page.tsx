import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import ClientNoteForm from '@/components/admin/ClientNoteForm';
import CommerceReasonForm from '@/components/admin/CommerceReasonForm';
import { CONTACT_PREFERENCE_LABELS } from '@/lib/client/profile';
import { attachHistoricalAction, blockClientAction, unblockClientAction } from '@/lib/clients/actions';
import { clientDetail } from '@/lib/clients/admin';
import { formatAmount, ORDER_STATUS_LABELS, SETTLEMENT_STATUS_LABELS } from '@/lib/commerce/labels';
import { requireModule } from '@/lib/rbac/guards';
import {
  APPOINTMENT_STATUS_LABELS,
  formatDay,
  formatMoment,
  QUOTE_REQUEST_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
} from '@/lib/relation/labels';

export const metadata: Metadata = {
  title: 'Fiche client',
  robots: { index: false, follow: false },
};

const RESULTS: Record<string, string> = {
  bloque: 'Le client est bloqué. Son espace et ses accès propriétaire sont fermés ; rien n’a été supprimé.',
  debloque: 'Le client est débloqué.',
  note: 'La note interne est enregistrée.',
  rattache: 'L’élément est rattaché au client. L’acte est journalisé.',
};

const ROLE_LABELS: Record<string, string> = { CLIENT: 'Client', AFFILIE: 'Affilié', ADMIN: 'Administrateur', SUPER_ADMIN: 'Super-administrateur' };
const SOURCE_LABELS: Record<string, string> = { LIEN: 'lien affilié', CODE: 'code partenaire', PROSPECT: 'prospect déclaré', ADMINISTRATION: 'attribution administrative' };

function Missing({ permission }: { permission: string }) {
  return (
    <div className="admin-empty">
      <p className="admin-empty__title">Accès réservé</p>
      <p>La permission {permission} est nécessaire pour voir ce bloc.</p>
    </div>
  );
}

/**
 * Fiche client — phase 4I-4.
 *
 * Chaque bloc ne lit que sous sa permission métier ; rien n'est déduit. Les
 * actes (note, blocage, déblocage, rattachement) passent par les fonctions de
 * la base, qui revérifient les permissions et journalisent.
 */
export default async function FicheClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule('clients');
  const { reference: raw } = await params;
  const reference = decodeURIComponent(raw).toUpperCase();
  if (!/^MORA-CLI-[A-Z]+\d{4}$/.test(reference)) notFound();
  const detail = await clientDetail(context, reference);
  if (!detail) notFound();

  const query = await searchParams;
  const result = typeof query.resultat === 'string' && Object.hasOwn(RESULTS, query.resultat) ? RESULTS[query.resultat] : null;
  const { client, profile, identity, stats } = detail;
  const uid = client.user_id;
  const canUpdate = context.can('users.update');
  const canDisable = context.can('users.disable');
  const blocked = Boolean(client.blocked_at);
  const fields = { client: uid, reference: client.reference };
  const currency = detail.orders?.[0]?.currency ?? 'KMF';

  return (
    <AdminPage
      eyebrow="Clients"
      title={`${profile?.full_name ?? identity?.email ?? client.reference}`}
      lead={`${client.reference} — client depuis le ${formatDay(client.created_at.slice(0, 10))}.`}
      actions={
        <Link className="btn btn--ghost" href="/administration/clients/">
          Retour à la liste
        </Link>
      }
    >
      {result ? (
        <div className="admin-notice admin-notice--ok" role="status">
          <p>{result}</p>
        </div>
      ) : null}

      {blocked ? (
        <div className="admin-notice admin-notice--error" role="note">
          <p>
            Client bloqué le {formatMoment(client.blocked_at ?? null)} — motif : {client.block_reason}.
            {client.profile_suspended_by_block ? ' Le compte est suspendu (connexion refusée).' : ' Ses autres rôles restent actifs ; seul son espace client est fermé.'}
          </p>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- Profil */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Profil</h2>
        </div>
        <dl className="admin-def">
          <dt>Référence</dt>
          <dd>
            <code>{client.reference}</code>
          </dd>
          <dt>Nom</dt>
          <dd>{profile?.full_name ?? '—'}</dd>
          <dt>Adresse e-mail</dt>
          <dd>
            {identity?.email ?? '—'}
            {identity ? (identity.email_confirmed ? ' (confirmée)' : ' (non confirmée)') : ''}
          </dd>
          <dt>Téléphone</dt>
          <dd>{profile?.phone ?? '—'}</dd>
          <dt>WhatsApp</dt>
          <dd>{client.whatsapp ?? '—'}</dd>
          <dt>Préférence de contact</dt>
          <dd>{client.contact_preference ? CONTACT_PREFERENCE_LABELS[client.contact_preference] : 'Aucune'}</dd>
          <dt>Rôles</dt>
          <dd>{(identity?.roles ?? []).map((role) => ROLE_LABELS[role] ?? role).join(', ') || '—'}</dd>
          <dt>État du compte</dt>
          <dd>
            {blocked ? (
              <span className="admin-badge admin-badge--danger">Client bloqué</span>
            ) : profile?.status !== 'ACTIF' ? (
              <span className="admin-badge admin-badge--muted">Compte {profile?.status?.toLowerCase()}</span>
            ) : (
              <span className="admin-badge admin-badge--ok">Actif</span>
            )}
          </dd>
        </dl>
      </section>

      {/* -------------------------------------------------------------- Activité */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Activité</h2>
          <p>
            Dernière activité connue : {formatMoment(detail.lastActivity)}. Dernière connexion :{' '}
            {formatMoment(profile?.last_login_at ?? identity?.last_sign_in_at ?? null)}.
          </p>
        </div>
        {detail.orders === null ? (
          <Missing permission="orders.view" />
        ) : (
          <div className="admin-stats">
            <div className="admin-stat">
              <p className="admin-stat__label">Montant commandé</p>
              <p className="admin-stat__value">{formatAmount(stats.ordered, currency)}</p>
              <p className="admin-stat__note">{stats.orders} commande(s), annulées exclues du montant</p>
            </div>
            <div className="admin-stat">
              <p className="admin-stat__label">Payé et vérifié</p>
              <p className="admin-stat__value">{formatAmount(stats.paid, currency)}</p>
              <p className="admin-stat__note">Paiements confirmés par MORA Shawiri seulement</p>
            </div>
            <div className="admin-stat">
              <p className="admin-stat__label">Remboursé</p>
              <p className="admin-stat__value">{formatAmount(stats.refunded, currency)}</p>
              <p className="admin-stat__note">Remboursements effectués</p>
            </div>
            <div className="admin-stat">
              <p className="admin-stat__label">Demandes · devis acceptés · rendez-vous</p>
              <p className="admin-stat__value">
                {detail.requests === null ? '—' : stats.requests} · {detail.quotes === null ? '—' : stats.quotesAccepted} ·{' '}
                {detail.appointments === null ? '—' : stats.appointments}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------- Commandes */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Commandes</h2>
        </div>
        {detail.orders === null ? (
          <Missing permission="orders.view" />
        ) : detail.orders.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune commande</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Commandes du client</caption>
              <thead>
                <tr>
                  <th scope="col">Référence</th>
                  <th scope="col">Date</th>
                  <th scope="col">Montant</th>
                  <th scope="col">État</th>
                  <th scope="col">Règlement</th>
                </tr>
              </thead>
              <tbody>
                {detail.orders.map((order) => (
                  <tr key={order.id}>
                    <th scope="row">
                      <Link href={`/administration/commandes/${order.reference}/`}>{order.reference}</Link>
                    </th>
                    <td>{formatMoment(order.created_at)}</td>
                    <td>{formatAmount(order.total_amount, order.currency)}</td>
                    <td>{ORDER_STATUS_LABELS[order.status]}</td>
                    <td>{SETTLEMENT_STATUS_LABELS[order.settlement_status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ Demandes / devis */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Demandes et devis</h2>
        </div>
        {detail.requests === null ? (
          <Missing permission="quotes.view" />
        ) : detail.requests.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune demande rattachée</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Demandes du client</caption>
              <thead>
                <tr>
                  <th scope="col">Demande</th>
                  <th scope="col">Objet</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Devis</th>
                  <th scope="col">Reçue le</th>
                </tr>
              </thead>
              <tbody>
                {detail.requests.map((request) => {
                  const quotes = (detail.quotes ?? []).filter((q) => q.quote_request_id === request.id && q.reference);
                  return (
                    <tr key={request.id}>
                      <th scope="row">
                        <Link href={`/administration/demandes/${request.reference}/`}>{request.reference}</Link>
                      </th>
                      <td>{request.offer_title ?? request.subject}</td>
                      <td>{QUOTE_REQUEST_STATUS_LABELS[request.status]}</td>
                      <td>
                        {quotes.length === 0
                          ? '—'
                          : quotes.map((q) => (
                              <span key={q.id}>
                                {q.reference} — {formatAmount(q.amount, q.currency)} — {QUOTE_STATUS_LABELS[q.status]}
                                {q.responded_by ? ' (décision du client)' : ''}
                                <br />
                              </span>
                            ))}
                      </td>
                      <td>{formatMoment(request.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ Rendez-vous */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Rendez-vous</h2>
        </div>
        {detail.appointments === null ? (
          <Missing permission="appointments.view" />
        ) : detail.appointments.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun rendez-vous rattaché</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Rendez-vous du client</caption>
              <thead>
                <tr>
                  <th scope="col">Rendez-vous</th>
                  <th scope="col">Objet</th>
                  <th scope="col">Date</th>
                  <th scope="col">Statut</th>
                </tr>
              </thead>
              <tbody>
                {detail.appointments.map((appt) => (
                  <tr key={appt.id}>
                    <th scope="row">
                      <Link href={`/administration/rendez-vous/${appt.id}/`}>{appt.reference ?? 'Demande'}</Link>
                    </th>
                    <td>{appt.subject}</td>
                    <td>{appt.scheduled_at ? formatMoment(appt.scheduled_at) : appt.requested_date ? `souhaité le ${formatDay(appt.requested_date)}` : '—'}</td>
                    <td>
                      {APPOINTMENT_STATUS_LABELS[appt.status]}
                      {appt.status === 'ANNULE' ? (appt.cancelled_by ? ' (par le client)' : ' (par MORA Shawiri)') : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ Affilié d'origine */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Affilié d’origine</h2>
          <p>La première attribution enregistrée par le programme d’affiliation sur une commande ou une demande de ce client.</p>
        </div>
        {detail.origin === 'interdit' ? (
          <Missing permission="affiliates.view" />
        ) : detail.origin === null ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune attribution enregistrée</p>
          </div>
        ) : (
          <dl className="admin-def">
            <dt>Affilié</dt>
            <dd>
              <Link href={`/administration/affiliation/affilies/${detail.origin.affiliateId}/`}>{detail.origin.name}</Link>
              {detail.origin.reference ? ` (${detail.origin.reference})` : ''}
            </dd>
            <dt>Origine</dt>
            <dd>
              {SOURCE_LABELS[detail.origin.source] ?? detail.origin.source}, sur {detail.origin.on}, le {formatMoment(detail.origin.at)}
            </dd>
          </dl>
        )}
      </section>

      {/* ------------------------------------------- Rattachements historiques */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Éléments historiques rattachables</h2>
          <p>
            Demandes et rendez-vous envoyés avant la mise en service du rattachement, avec l’adresse confirmée de ce client, sans titulaire
            et sans conflit. Cette détection ne modifie rien ; le rattachement est un acte explicite, motivé et journalisé.
          </p>
        </div>
        {detail.historical === null ? (
          <Missing permission="quotes.view ou appointments.view" />
        ) : detail.historical.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun élément historique rattachable</p>
          </div>
        ) : (
          <ul className="admin-notes">
            {detail.historical.map((item) => {
              const allowed = canUpdate && context.can(item.item_kind === 'DEMANDE' ? 'quotes.manage' : 'appointments.update');
              return (
                <li key={item.item_id}>
                  <p>
                    <strong>{item.item_kind === 'DEMANDE' ? 'Demande' : 'Rendez-vous'}</strong> {item.reference ?? '(sans référence : en attente de confirmation)'} —{' '}
                    {item.subject}
                  </p>
                  <p className="admin-timeline__who">Envoyé le {formatMoment(item.created_at)}</p>
                  {allowed ? (
                    <CommerceReasonForm
                      action={attachHistoricalAction}
                      fields={{ ...fields, type: item.item_kind, element: item.item_id }}
                      trigger="Rattacher au client"
                      consequence={`Cet élément rejoindra la fiche et l’espace de ${client.reference}. L’acte est définitif et journalisé avec votre nom et votre motif.`}
                      label="Motif du rattachement"
                      placeholder="Ex. : le client a confirmé par téléphone être l’auteur de cette demande."
                      confirmLabel="Rattacher"
                      variant="primary"
                    />
                  ) : (
                    <p className="admin-field__hint">
                      Rattachement réservé : users.update et {item.item_kind === 'DEMANDE' ? 'quotes.manage' : 'appointments.update'}.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- Notes internes */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Notes internes</h2>
          <p>Réservées à l’administration, jamais visibles du client. En ajout seul : une correction est une nouvelle note liée.</p>
        </div>
        {detail.notes.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune note</p>
          </div>
        ) : (
          <ul className="admin-notes">
            {detail.notes.map((note) => {
              const corrected = detail.notes.find((other) => other.id === note.corrects_note_id);
              return (
                <li key={note.id}>
                  <p className="admin-longtext">{note.body}</p>
                  <p className="admin-timeline__who">
                    {note.author_label ?? 'Compte supprimé'} — {formatMoment(note.created_at)}
                    {corrected ? ` — corrige la note du ${formatMoment(corrected.created_at)}` : ''}
                  </p>
                  {canUpdate ? (
                    <details className="admin-details">
                      <summary>Corriger cette note</summary>
                      <ClientNoteForm userId={uid} reference={client.reference} corrects={{ id: note.id, label: formatMoment(note.created_at) }} />
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {canUpdate ? <ClientNoteForm userId={uid} reference={client.reference} /> : <p className="admin-field__hint">Ajouter une note : permission users.update.</p>}
      </section>

      {/* --------------------------------------------------------------- Blocage */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Blocage</h2>
          <p>
            Bloquer ferme l’espace client et tous les accès du client à ses données, même avec une session déjà ouverte. Rien n’est supprimé.
            Un compte qui porte d’autres rôles (administration, affiliation) les conserve.
          </p>
        </div>
        {canDisable ? (
          blocked ? (
            <CommerceReasonForm
              action={unblockClientAction}
              fields={fields}
              trigger="Débloquer le client"
              consequence="Le client retrouvera son espace et ses données. Le déblocage est journalisé."
              label="Motif du déblocage"
              placeholder="Ex. : situation régularisée."
              confirmLabel="Débloquer"
              variant="primary"
            />
          ) : (
            <CommerceReasonForm
              action={blockClientAction}
              fields={fields}
              trigger="Bloquer le client"
              consequence="L’espace client et l’accès à ses données seront fermés immédiatement, sessions ouvertes comprises. Commandes, paiements, documents, demandes, rendez-vous et historique sont conservés."
              label="Motif du blocage"
              placeholder="Ex. : impayés répétés, comportement abusif."
              confirmLabel="Bloquer"
              variant="danger"
            />
          )
        ) : (
          <p className="admin-field__hint">Bloquer ou débloquer : permission users.disable.</p>
        )}
        {detail.statusEvents.length > 0 ? (
          <ol className="admin-timeline">
            {detail.statusEvents.map((event) => (
              <li key={event.id}>
                <p className="admin-timeline__when">{formatMoment(event.created_at)}</p>
                <p className="admin-timeline__what">
                  {event.kind === 'BLOCAGE' ? 'Blocage' : 'Déblocage'}
                  {event.reason ? ` — ${event.reason}` : ''}
                  {event.profile_suspended ? (event.kind === 'BLOCAGE' ? ' (compte suspendu)' : ' (compte réactivé)') : ''}
                </p>
                <p className="admin-timeline__who">{event.actor_label ?? 'Compte supprimé'}</p>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

    </AdminPage>
  );
}
