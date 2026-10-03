import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import { EmailStatusBadge } from '@/components/admin/AffiliationBadges';
import AffiliationTrace from '@/components/admin/AffiliationTrace';
import ConfirmForm from '@/components/admin/ConfirmForm';
import QuoteEditor from '@/components/admin/QuoteEditor';
import RelationNoteForm from '@/components/admin/RelationNoteForm';
import RelationSelectForm from '@/components/admin/RelationSelectForm';
import { listAdministrators } from '@/lib/admin/administrators';
import { displayIdentity } from '@/lib/auth/identifiers';
import { todayInComoros } from '@/lib/client/relation-rules';
import { ORDER_STATUS_LABELS } from '@/lib/commerce/labels';
import { requireModule } from '@/lib/rbac/guards';
import {
  assignQuoteRequest,
  changeQuoteRequestStatus,
  deleteRelationNote,
  respondToQuote,
  retryQuoteEmail,
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
import { draftLines, loadQuoteWorkspace, requestedQuantity, suggestedLines } from '@/lib/relation/quote-admin';
import type { Json, QuoteRow, QuoteStatus } from '@/lib/supabase/types';
import type { QuoteItemRow } from '@/lib/supabase/types-commercial';

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
  const { affiliation: affiliationNotice, edition, resultat, devis: issuedRef } = await searchParams;
  const result = typeof resultat === 'string' && Object.hasOwn(RESULTS, resultat) ? RESULTS[resultat]! : null;
  const issued = typeof issuedRef === 'string' && /^MORA-DVCL-[A-Z]+\d{4}$/.test(issuedRef) ? issuedRef : null;
  const editing = edition === 'brouillon';

  const detail = await findQuoteRequest(decodeURIComponent(reference));

  // Introuvable, ou hors de ce que RLS laisse lire : la même réponse dans les
  // deux cas. Distinguer les deux apprendrait qu'une référence existe.
  if (!detail) notFound();

  const { request, lead, serviceTitle, quotes, events, notes } = detail;

  const canManage = context.can('quotes.manage');
  const canUpdate = context.can('quotes.update');
  const canCreateQuote = context.can('quotes.create');
  const canUpdateQuote = context.can('quotes.update');

  const administrators = canUpdate ? await listAdministrators() : [];
  const nextStatuses = offeredQuoteRequestStatuses(request.status);
  const draft = quotes.find((quote) => quote.status === 'BROUILLON') ?? null;
  const details = readDetails(request.details);
  const workspace = await loadQuoteWorkspace(request, quotes);
  const today = todayInComoros();
  const quantityAsked = requestedQuantity(request.details);
  // Une nouvelle version peut remplacer un devis émis sans réponse positive.
  const replaceable = quotes
    .filter((quote) => quote.reference && ['ENVOYE', 'REFUSE', 'EXPIRE'].includes(quote.status))
    .map((quote) => ({
      id: quote.id,
      reference: quote.reference!,
      label: `${QUOTE_STATUS_LABELS[quote.status].toLowerCase()}, ${formatAmount(quote.amount, quote.currency)}`,
      pending: quote.status === 'ENVOYE',
    }));
  // Une nouvelle version part du contenu de la plus récente version émise
  // (lignes, objet, observations) : on corrige, on ne ressaisit pas.
  const previous = quotes.find((quote) => replaceable.some((entry) => entry.id === quote.id)) ?? null;
  const newInitial = previous
    ? {
        quoteId: null,
        summary: previous.summary,
        notes: previous.notes ?? '',
        validUntil: previous.valid_until && previous.valid_until >= today ? previous.valid_until : '',
        replaces: previous.status === 'ENVOYE' ? previous.id : '',
        lines: draftLines(workspace.itemsByQuote.get(previous.id) ?? [], previous),
      }
    : {
        quoteId: null,
        summary: '',
        notes: '',
        validUntil: '',
        replaces: '',
        lines: suggestedLines(request, workspace.offer),
      };

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
          <dd>{SOURCE_LABELS[request.source ?? ''] ?? request.source ?? '—'}</dd>
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
            hint="« Devis envoyé » s’obtient en émettant un devis ; « Acceptée » suit l’acceptation du devis. « Terminée » signifie que la prestation demandée a été réalisée et livrée."
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

        {workspace.orders.length > 0 ? (
          <div className="admin-notice">
            {workspace.orders.map((order) => (
              <p key={order.reference}>
                Commande issue de cette demande :{' '}
                <Link href={`/administration/commandes/${order.reference}/`}>
                  <code>{order.reference}</code>
                </Link>{' '}
                — {ORDER_STATUS_LABELS[order.status]}.{' '}
                {order.status === 'TERMINEE' || order.status === 'ANNULEE'
                  ? ''
                  : 'La livraison se constate sur la commande : passer la commande à « Terminée » termine aussi cette demande.'}
              </p>
            ))}
          </div>
        ) : null}

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

      {result ? (
        <div className={`admin-notice ${result.ok ? 'admin-notice--ok' : 'admin-notice--error'}`} role="status">
          <p>{result.text.replace('{devis}', issued ?? 'Le devis')}</p>
        </div>
      ) : null}

      <section className="admin-card" id="devis">
        <div className="admin-card__head">
          <h2>Devis</h2>
          <p>
            Une demande de devis n’est pas un devis. Un devis se prépare en brouillon, se vérifie en aperçu, puis
            s’émet : il reçoit alors son numéro DVCL, son contenu est figé et le client reçoit un e-mail.
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
                  <th scope="col">Objet</th>
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
                      {quote.replaces_quote_id ? (
                        <span className="admin-field__hint">
                          <br />
                          remplace {quotes.find((entry) => entry.id === quote.replaces_quote_id)?.reference ?? 'une version précédente'}
                        </span>
                      ) : null}
                    </th>
                    <td>{quote.summary.length > 80 ? `${quote.summary.slice(0, 79)}…` : quote.summary}</td>
                    <td>{formatAmount(quote.amount, quote.currency)}</td>
                    <td>
                      {quoteBadge(quote.status)}
                      {quote.responded_by ? (
                        <span className="admin-field__hint">
                          <br />
                          Décision du client, le {formatMoment(quote.responded_at)}
                          {quote.client_response_reason ? ` — motif : ${quote.client_response_reason}` : ''}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {quote.valid_until ? formatDay(quote.valid_until) : 'Sans date d’expiration'}
                    </td>
                    <td>{formatMoment(quote.sent_at)}</td>
                    <td>
                      {quote.reference ? (
                        <a
                          className="btn btn--ghost"
                          href={`/api/documents/${quote.reference}/?affichage=1`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ouvrir le PDF
                        </a>
                      ) : (
                        <a
                          className="btn btn--ghost"
                          href={`/api/devis/${quote.id}/apercu/?affichage=1`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Aperçu
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {draft ? (
          <div className="admin-card__foot" id="devis-brouillon">
            <h3>Brouillon en cours — {formatAmount(draft.amount, draft.currency)}</h3>

            {editing && (canUpdateQuote || canCreateQuote) ? (
              <QuoteEditor
                reference={request.reference}
                currency={draft.currency}
                initial={{
                  quoteId: draft.id,
                  summary: draft.summary,
                  notes: draft.notes ?? '',
                  validUntil: draft.valid_until ?? '',
                  replaces: draft.replaces_quote_id ?? '',
                  lines: draftLines(workspace.itemsByQuote.get(draft.id) ?? [], draft),
                }}
                replaceable={replaceable}
                today={today}
                onCancelHref={`/administration/demandes/${request.reference}/#devis-brouillon`}
              />
            ) : (
              <>
                <QuoteLinesTable items={workspace.itemsByQuote.get(draft.id) ?? []} quote={draft} />
                {draft.notes ? (
                  <p className="admin-field__hint">
                    <strong>Observations :</strong> {draft.notes}
                  </p>
                ) : null}
                <div className="admin-actions">
                  <a
                    className="btn btn--ghost"
                    href={`/api/devis/${draft.id}/apercu/?affichage=1`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Aperçu du devis (PDF)
                  </a>
                  {canUpdateQuote || canCreateQuote ? (
                    <Link
                      className="btn btn--ghost"
                      href={`/administration/demandes/${request.reference}/?edition=brouillon#devis-brouillon`}
                    >
                      Modifier le brouillon
                    </Link>
                  ) : null}
                </div>
              </>
            )}

            {canManage && !editing ? (
              <div className="admin-card__foot">
                <h3>Émettre et envoyer le devis</h3>
                <p>
                  L’émission passe par le Moteur de Documents : elle alloue le numéro DVCL, fige le contenu du
                  devis tel que l’aperçu le montre, et fait passer la demande à « Devis envoyé ».{' '}
                  {lead?.email
                    ? `Un e-mail prévient ensuite ${lead.email} que son devis est disponible, sans lien public vers le PDF.`
                    : 'Aucune adresse e-mail n’est connue : aucun e-mail ne partira.'}
                </p>
                <ConfirmForm
                  action={sendQuote}
                  fields={{ quoteId: draft.id }}
                  trigger={`Émettre et envoyer le devis de ${formatAmount(draft.amount, draft.currency)}`}
                  consequence="Le devis recevra un numéro définitif, son contenu sera figé, la demande passera à « Devis envoyé » et le client recevra un e-mail. Cette action ne s’annule pas : une correction se fera par une nouvelle version."
                  confirmLabel="Émettre et envoyer"
                  variant="gold"
                />
              </div>
            ) : null}
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
                  hint="« Accepté » fait passer la demande à « Acceptée ». « Expiré » est une décision : aucune tâche ne l’applique d’office, faute de durée de validité officielle."
                />
              </div>
            ) : null,
          )}

        {!draft && canCreateQuote && request.status !== 'ANNULEE' ? (
          <div className="admin-card__foot" id="devis-nouveau">
            <h3>{previous ? 'Préparer une nouvelle version du devis' : 'Préparer un devis'}</h3>
            <dl className="admin-meta quote-editor__context">
              <div>
                <dt>Client</dt>
                <dd>
                  {lead?.full_name ?? '—'}
                  {request.organisation ? ` — ${request.organisation}` : ''}
                </dd>
              </div>
              <div>
                <dt>Adresse e-mail</dt>
                <dd>{lead?.email ?? '—'}</dd>
              </div>
              <div>
                <dt>Demande d’origine</dt>
                <dd>
                  {request.reference} — {request.subject}
                </dd>
              </div>
              <div>
                <dt>Offre demandée</dt>
                <dd>
                  {workspace.offer
                    ? `${workspace.offer.title}${workspace.offer.price !== null ? ` — prix du catalogue : ${formatAmount(String(workspace.offer.price), 'KMF')}` : ' — sur devis'}`
                    : (request.offer_title ?? 'Aucune offre précise')}
                  {quantityAsked ? ` · quantité demandée : ${quantityAsked}` : ''}
                </dd>
              </div>
            </dl>
            {previous ? (
              <p className="admin-field__hint">
                Prérempli à partir du devis {previous.reference} : corrigez ce qui change, puis enregistrez la
                nouvelle version.
              </p>
            ) : null}
            <QuoteEditor
              reference={request.reference}
              currency="KMF"
              initial={newInitial}
              replaceable={replaceable}
              today={today}
            />
          </div>
        ) : null}

        {workspace.emails.length > 0 ? (
          <div className="admin-card__foot" id="devis-emails">
            <h3>E-mails</h3>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">E-mails envoyés pour les devis de cette demande</caption>
                <thead>
                  <tr>
                    <th scope="col">Objet</th>
                    <th scope="col">Destinataire</th>
                    <th scope="col">Résultat</th>
                    <th scope="col">Dernière tentative</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.emails.map((email) => (
                    <tr key={email.id}>
                      <th scope="row">{email.subject}</th>
                      <td>{email.recipient}</td>
                      <td>
                        <EmailStatusBadge status={email.status} />
                        {email.last_error ? <span className="admin-field__hint"> {email.last_error}</span> : null}
                      </td>
                      <td>{formatMoment(email.last_attempt_at ?? email.created_at)}</td>
                      <td>
                        {email.status === 'ECHEC' && canManage ? (
                          <ConfirmForm
                            action={retryQuoteEmail}
                            fields={{ email: email.id }}
                            trigger="Renvoyer"
                            consequence="Le même e-mail est renvoyé, à l’identique, au même destinataire."
                            confirmLabel="Renvoyer l’e-mail"
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

/** Lignes d'un brouillon, en lecture : ce que l'aperçu imprimera. */
function QuoteLinesTable({ items, quote }: { items: readonly QuoteItemRow[]; quote: QuoteRow }) {
  const rows =
    items.length > 0
      ? items.map((item) => ({
          key: item.id,
          designation: item.designation,
          description: item.description,
          quantity: String(Number(item.quantity)).replace('.', ','),
          unit: formatAmount(String(item.unit_price), quote.currency),
          discount: Number(item.discount_amount) > 0 ? `– ${formatAmount(String(item.discount_amount), quote.currency)}` : '—',
          total: formatAmount(String(item.line_total), quote.currency),
        }))
      : [
          {
            key: quote.id,
            designation: quote.summary,
            description: null,
            quantity: '1',
            unit: formatAmount(quote.amount, quote.currency),
            discount: '—',
            total: formatAmount(quote.amount, quote.currency),
          },
        ];

  return (
    <>
      <p className="admin-field__hint">
        <strong>Objet :</strong> {quote.summary}
        {quote.valid_until ? ` · valable jusqu’au ${formatDay(quote.valid_until)}` : ' · sans date d’expiration'}
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <caption className="sr-only">Lignes du brouillon de devis</caption>
          <thead>
            <tr>
              <th scope="col">Désignation</th>
              <th scope="col">Qté</th>
              <th scope="col">Prix unitaire</th>
              <th scope="col">Remise</th>
              <th scope="col">Montant</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {row.designation}
                  {row.description ? <span className="admin-field__hint">{row.description}</span> : null}
                </th>
                <td>{row.quantity}</td>
                <td>{row.unit}</td>
                <td>{row.discount}</td>
                <td>{row.total}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>
                Total
              </th>
              <td>
                <strong>{formatAmount(quote.amount, quote.currency)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/** Retours d'action, lus dans une liste fermée — jamais un texte reçu. */
const RESULTS: Record<string, { ok: boolean; text: string }> = {
  'brouillon-cree': { ok: true, text: 'Le devis a été créé en brouillon. Vérifiez l’aperçu avant de l’émettre : il n’est pas encore envoyé.' },
  'brouillon-maj': { ok: true, text: 'Le brouillon a été mis à jour. Il n’est pas encore envoyé.' },
  'devis-envoye': { ok: true, text: '{devis} a été émis et l’e-mail « devis disponible » est parti chez le client.' },
  'devis-emis-sans-mail': {
    ok: false,
    text: '{devis} a été émis, mais l’e-mail au client n’a pas pu partir : renvoyez-le depuis la rubrique « E-mails » ci-dessous.',
  },
};

/** Origine lisible d'une demande ; une valeur inconnue s'affiche telle quelle. */
const SOURCE_LABELS: Record<string, string> = {
  boutique: 'Boutique — offre sur devis',
  'boutique-prix': 'Boutique — offre à prix défini',
  contact: 'Formulaire de contact',
  'rendez-vous': 'Prise de rendez-vous',
};

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
