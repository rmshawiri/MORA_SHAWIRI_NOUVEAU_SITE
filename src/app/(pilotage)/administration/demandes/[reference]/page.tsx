import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import AffiliationTrace from '@/components/admin/AffiliationTrace';
import ConfirmForm from '@/components/admin/ConfirmForm';
import QuoteDraftForm from '@/components/admin/QuoteDraftForm';
import RelationNoteForm from '@/components/admin/RelationNoteForm';
import RelationSelectForm from '@/components/admin/RelationSelectForm';
import { listAdministrators } from '@/lib/admin/administrators';
import { displayIdentity } from '@/lib/auth/identifiers';
import { requireModule } from '@/lib/rbac/guards';
import {
  assignQuoteRequest,
  changeQuoteRequestStatus,
  deleteRelationNote,
  respondToQuote,
  sendQuote,
} from '@/lib/relation/actions';
import {
  describeEvent,
  findQuoteRequest,
  formatAmount,
  formatDay,
  formatMoment,
  offeredQuoteRequestStatuses,
  QUOTE_REQUEST_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  QUOTE_TRANSITIONS,
} from '@/lib/relation/admin';
import type { Json, QuoteStatus } from '@/lib/supabase/types';

export const metadata: Metadata = {
  title: 'Demande',
  robots: { index: false, follow: false },
};

/**
 * Fiche d'une demande — phase 4F.
 *
 * ## Ce que cette page fait, et dans quel ordre
 *
 * Elle montre la demande telle qu'elle a été reçue, puis ce qu'on en a fait.
 * Le message libre est rendu **intégralement** : c'est un test explicite du
 * plan de développement, et un résumé trahirait le demandeur.
 *
 * ## Le message est du texte, pas du balisage
 *
 * Il est écrit par un visiteur anonyme. Il est donc rendu dans un
 * `<p>`/`<pre>` sans jamais être interprété — aucun `dangerouslySetInnerHTML`
 * n'apparaît ici. C'est la même règle que pour les réponses de la FAQ en
 * 4E-2 : ne pas ouvrir une surface XSS pour un besoin qui n'existe pas.
 *
 * ## Les boutons suivent les permissions, sans les remplacer
 *
 * Chaque action revérifie côté serveur, et la base refuse de son côté. Le
 * § 129 est explicite : masquer un bouton n'est pas une sécurité.
 */
export default async function DemandePage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule('demandes');
  const { reference } = await params;
  const { affiliation: affiliationNotice } = await searchParams;

  const detail = await findQuoteRequest(decodeURIComponent(reference));

  // Introuvable, ou hors de ce que RLS laisse lire : la même réponse dans les
  // deux cas. Distinguer les deux apprendrait qu'une référence existe.
  if (!detail) notFound();

  const { request, lead, serviceTitle, quotes, events, notes } = detail;

  const canManage = context.can('quotes.manage');
  const canUpdate = context.can('quotes.update');
  const canCreateQuote = context.can('quotes.create');

  const administrators = canUpdate ? await listAdministrators() : [];
  const nextStatuses = offeredQuoteRequestStatuses(request.status);
  const draft = quotes.find((quote) => quote.status === 'BROUILLON') ?? null;
  const details = readDetails(request.details);

  return (
    <AdminPage
      eyebrow="Activité"
      title={request.reference}
      lead={`${QUOTE_REQUEST_STATUS_LABELS[request.status]} — reçue le ${formatMoment(request.created_at)}.`}
      actions={
        <Link className="btn btn--ghost" href="/administration/demandes/">
          Retour à la liste
        </Link>
      }
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>La demande</h2>
          <p>Ce que le demandeur a transmis, tel qu’il l’a transmis.</p>
        </div>

        <dl className="admin-def">
          <dt>Besoin exprimé</dt>
          <dd>{request.subject}</dd>

          <dt>Prestation du catalogue</dt>
          <dd>
            {serviceTitle ?? (
              <>
                {request.offer_title ?? '—'}
                {request.offer_title ? (
                  <span className="admin-field__hint">
                    {' '}
                    (titre transmis, sans rattachement à une offre publiée)
                  </span>
                ) : null}
              </>
            )}
          </dd>

          <dt>Budget indicatif</dt>
          <dd>{request.budget_label ?? 'Non renseigné'}</dd>

          <dt>Organisation</dt>
          <dd>{request.organisation ?? 'À titre personnel'}</dd>

          <dt>Origine</dt>
          <dd>{request.source ?? '—'}</dd>
        </dl>

        <h3>Message</h3>
        <p className="admin-longtext">{request.message}</p>

        {details.length > 0 ? (
          <>
            <h3>Réponses complémentaires</h3>
            <dl className="admin-def">
              {details.map((row, index) => (
                <div key={`${row.label}-${index}`}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Le demandeur</h2>
          <p>
            {request.user_id
              ? 'Cette demande est rattachée à un compte client : le rattachement a été établi par la session au moment de l’envoi, jamais par l’adresse saisie.'
              : 'Demande envoyée sans compte. Les coordonnées ci-dessous sont les seules dont nous disposons.'}
          </p>
        </div>

        <dl className="admin-def">
          <dt>Nom</dt>
          <dd>{lead?.full_name ?? '—'}</dd>

          <dt>Adresse e-mail</dt>
          <dd>{lead?.email ?? '—'}</dd>

          <dt>Téléphone</dt>
          <dd>{lead?.phone ?? 'Non renseigné'}</dd>

          <dt>Demandes de ce contact</dt>
          <dd>{lead?.request_count ?? 1}</dd>

          <dt>Compte client</dt>
          <dd>{request.user_id ? 'Oui' : 'Non'}</dd>
        </dl>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Suivi</h2>
          <p>
            Changer le statut exige <code>quotes.manage</code> ; affecter la demande se fait avec{' '}
            <code>quotes.update</code>. Un statut final ne se rouvre pas.
          </p>
        </div>

        {canManage && nextStatuses.length > 0 ? (
          <RelationSelectForm
            action={changeQuoteRequestStatus}
            fields={{ reference: request.reference }}
            name="status"
            label="Nouveau statut"
            options={nextStatuses.map((status) => ({
              value: status,
              label: QUOTE_REQUEST_STATUS_LABELS[status],
            }))}
            submitLabel="Enregistrer le statut"
            hint="« Devis envoyé » ne se choisit pas ici : ce statut s’obtient en émettant un devis."
          />
        ) : (
          <div className="admin-notice">
            <p>
              {nextStatuses.length === 0
                ? `Cette demande est ${QUOTE_REQUEST_STATUS_LABELS[request.status].toLowerCase()} : son statut n’évolue plus.`
                : 'La permission quotes.manage est nécessaire pour changer le statut.'}
            </p>
          </div>
        )}

        {canUpdate && administrators.length > 0 ? (
          <RelationSelectForm
            action={assignQuoteRequest}
            fields={{ reference: request.reference }}
            name="assignedTo"
            label="Affectée à"
            current={request.assigned_to ?? ''}
            options={[
              { value: '', label: 'Personne' },
              ...administrators.map((admin) => ({
                value: admin.userId,
                label: displayIdentity(admin.profile, null),
              })),
            ]}
            submitLabel="Enregistrer l’affectation"
          />
        ) : null}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Devis</h2>
          <p>
            Une demande de devis n’est pas un devis. Un devis naît d’un acte explicite, reste en
            brouillon jusqu’à son émission, et ne consomme un numéro qu’à ce moment-là.
          </p>
        </div>

        {quotes.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun devis pour cette demande</p>
            <p>C’est l’état réel : rien n’a été émis, et rien ne l’est automatiquement.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Référence</th>
                  <th scope="col">Montant</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Validité</th>
                  <th scope="col">Émis le</th>
                  <th scope="col">Pièce</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id}>
                    <th scope="row">
                      {quote.reference ? (
                        <code>{quote.reference}</code>
                      ) : (
                        <span className="admin-field__hint">Sans numéro (brouillon)</span>
                      )}
                    </th>
                    <td>{formatAmount(quote.amount, quote.currency)}</td>
                    <td>{quoteBadge(quote.status)}</td>
                    <td>
                      {quote.valid_until ? formatDay(quote.valid_until) : 'Sans date d’expiration'}
                    </td>
                    <td>{formatMoment(quote.sent_at)}</td>
                    <td>
                      {quote.reference ? (
                        <Link
                          className="btn btn--ghost"
                          href={`/api/documents/${quote.reference}/`}
                        >
                          Ouvrir le PDF
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {draft && canManage ? (
          <div className="admin-card__foot">
            <h3>Émettre le devis en brouillon</h3>
            <p>
              L’émission passe par le Moteur de Documents : elle alloue le numéro sous verrou, crée
              la pièce <code>DVCL</code>, et fait passer la demande à « Devis envoyé ». Elle exige
              un second facteur vérifié. Aucun courriel n’est envoyé automatiquement.
            </p>
            <ConfirmForm
              action={sendQuote}
              fields={{ quoteId: draft.id }}
              trigger={`Émettre le devis de ${formatAmount(draft.amount, draft.currency)}`}
              consequence="Le devis recevra un numéro définitif et immuable, et la demande passera à « Devis envoyé ». Cette action ne s’annule pas : un devis émis ne peut plus qu’être accepté, refusé, expiré ou annulé."
              confirmLabel="Émettre le devis"
              variant="gold"
            />
          </div>
        ) : null}

        {quotes
          .filter((quote) => quote.status === 'ENVOYE')
          .map((quote) =>
            canManage ? (
              <div className="admin-card__foot" key={`reponse-${quote.id}`}>
                <h3>Réponse du client au devis {quote.reference}</h3>
                <RelationSelectForm
                  action={respondToQuote}
                  fields={{ quoteId: quote.id }}
                  name="status"
                  label="Réponse reçue"
                  options={QUOTE_TRANSITIONS.ENVOYE.map((status) => ({
                    value: status,
                    label: QUOTE_STATUS_LABELS[status],
                  }))}
                  submitLabel="Enregistrer la réponse"
                  hint="« Expiré » est une décision : aucune tâche ne l’applique d’office, faute de durée de validité officielle."
                />
              </div>
            ) : null,
          )}

        {!draft && canCreateQuote && request.status !== 'ANNULEE' ? (
          <div className="admin-card__foot">
            <h3>Créer un devis</h3>
            <QuoteDraftForm reference={request.reference} currency="KMF" />
          </div>
        ) : null}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Historique</h2>
          <p>
            Le suivi métier de la demande, écrit par la base à chaque changement. Distinct du{' '}
            <Link href="/administration/journal/">journal d’activité</Link>, qui trace l’aspect
            technique et sécuritaire des mêmes faits.
          </p>
        </div>

        <ol className="admin-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <p className="admin-timeline__when">{formatMoment(event.created_at)}</p>
              <p className="admin-timeline__what">
                {describeEvent(event, (value) =>
                  value
                    ? (QUOTE_REQUEST_STATUS_LABELS[
                        value as keyof typeof QUOTE_REQUEST_STATUS_LABELS
                      ] ?? value)
                    : '—',
                )}
              </p>
              <p className="admin-timeline__who">{event.actor_label ?? 'Depuis le site public'}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Notes internes</h2>
          <p>
            Réservées aux comptes habilités. Le demandeur n’y a pas accès : aucune politique ne les
            lui ouvre.
          </p>
        </div>

        {notes.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucune note</p>
          </div>
        ) : (
          <ul className="admin-notes">
            {notes.map((note) => (
              <li key={note.id}>
                <p className="admin-longtext">{note.body}</p>
                <p className="admin-timeline__who">
                  {note.author_label ?? 'Compte supprimé'} — {formatMoment(note.created_at)}
                </p>
                {canUpdate ? (
                  <ConfirmForm
                    action={deleteRelationNote}
                    fields={{ noteId: note.id, reference: request.reference }}
                    trigger="Supprimer"
                    consequence="La note sera définitivement supprimée. L’historique métier et le journal d’activité en gardent la trace."
                    confirmLabel="Supprimer la note"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canUpdate ? <RelationNoteForm reference={request.reference} /> : null}
      </section>

      {/* Phase 4H — l'attribution affiliée de la demande. */}
      <AffiliationTrace
        context={context}
        target="REQUEST"
        id={request.id}
        path={`/administration/demandes/${request.reference}/`}
        notice={affiliationNotice}
      />
    </AdminPage>
  );
}

/**
 * Lit les réponses complémentaires.
 *
 * La colonne est en JSONB et son contenu vient d'un formulaire : rien n'y est
 * garanti. Chaque entrée est donc vérifiée avant d'être rendue, plutôt que
 * supposée conforme.
 */
function readDetails(value: Json): { label: string; value: string }[] {
  if (!Array.isArray(value)) return [];

  const rows: { label: string; value: string }[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, Json>;
    if (typeof record.label === 'string' && typeof record.value === 'string') {
      rows.push({ label: record.label, value: record.value });
    }
  }

  return rows;
}

function quoteBadge(status: QuoteStatus) {
  const className =
    status === 'ACCEPTE'
      ? 'admin-badge--ok'
      : status === 'BROUILLON'
        ? 'admin-badge--gold'
        : status === 'REFUSE' || status === 'ANNULE'
          ? 'admin-badge--danger'
          : 'admin-badge--muted';

  return <span className={`admin-badge ${className}`}>{QUOTE_STATUS_LABELS[status]}</span>;
}
