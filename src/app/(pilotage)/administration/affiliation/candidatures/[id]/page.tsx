import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AffiliationDecisionForm from '@/components/admin/AffiliationDecisionForm';
import { ApplicationStatusBadge, EmailStatusBadge } from '@/components/admin/AffiliationBadges';
import AdminPage from '@/components/admin/AdminPage';
import ConfirmForm from '@/components/admin/ConfirmForm';
import { acceptApplication, noteApplication, retryEmail, reviewApplication } from '@/lib/affiliation/actions';
import { findApplication, formatMoment, listCategories, readApplicationPayoutDetails } from '@/lib/affiliation/admin';
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_TRANSITIONS,
  PROFILE_LABELS,
  PROFILE_OPTIONS,
  PROFILE_QUESTIONS,
  isRequestedProfile,
  maskPayoutValue,
} from '@/lib/affiliation/applications';
import { requireModule } from '@/lib/rbac/guards';

export const metadata: Metadata = {
  title: 'Candidature',
  robots: { index: false, follow: false },
};

const PAYOUT_KEY_LABELS: Record<string, string> = {
  numero: 'Numéro',
  titulaire: 'Titulaire',
  banque: 'Banque',
  compte: 'Compte / RIB',
  email: 'E-mail du compte',
  ordre: 'À l’ordre de',
};

/**
 * Fiche d'une candidature — phase 4H.
 *
 * Ce que le candidat a transmis est rendu tel quel, comme du texte : aucun
 * `dangerouslySetInnerHTML`. Les coordonnées de versement n'apparaissent que
 * sous `payouts.view`, et masquées par défaut. Les boutons suivent les
 * permissions, mais ne les remplacent pas : chaque action revérifie, et la
 * base revérifie encore.
 */
/** Retours possibles d'une décision : une liste fermée, jamais un texte reçu. */
const RESULTS: Record<string, string> = {
  EN_ETUDE: 'La candidature est passée à l’étude.',
  INFOS_REQUISES: 'La demande d’informations est enregistrée.',
  REFUSEE: 'La candidature est refusée.',
  ACCEPTEE:
    'La candidature est acceptée. La fiche affilié est créée en préparation : configurez-la, puis activez-la.',
  RENVOI: 'L’e-mail est reparti.',
};
const MAIL_RESULTS: Record<string, string> = {
  sent: ' Le candidat a été notifié par e-mail.',
  failed: ' L’e-mail n’a pas pu partir : il est journalisé ci-dessous et peut être renvoyé.',
  skipped: '',
};

export default async function CandidaturePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule('affiliation');
  if (!context.can('affiliate_applications.view')) notFound();

  const { id } = await params;
  const query = await searchParams;
  const pick = (table: Record<string, string>, key: unknown) =>
    typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
  const result = pick(RESULTS, query.resultat);
  const mailResult = query.resultat === 'RENVOI' ? '' : (pick(MAIL_RESULTS, query.mail) ?? '');
  const detail = await findApplication(id);
  if (!detail) notFound();
  const { application, events, emails, payoutLabel } = detail;

  const canManage = context.can('affiliate_applications.manage');
  const canAccept = canManage && context.can('affiliates.create');
  const payoutDetails = context.can('payouts.view') ? await readApplicationPayoutDetails(application.id) : null;
  const categories = canAccept ? await listCategories() : [];
  const transitions = APPLICATION_TRANSITIONS[application.status];

  const profile = isRequestedProfile(application.requested_profile) ? application.requested_profile : null;
  const answers =
    application.profile_answers && typeof application.profile_answers === 'object' && !Array.isArray(application.profile_answers)
      ? (application.profile_answers as Record<string, unknown>)
      : {};
  const suggested = PROFILE_OPTIONS.find((option) => option.value === profile)?.suggestedCategory;
  const activeCategories = categories.filter((category) => category.is_active);
  const defaultCategory = activeCategories.find((category) => category.code === suggested)?.id ?? activeCategories[0]?.id;

  return (
    <AdminPage
      eyebrow="Affiliation — candidature"
      title={`${application.first_name} ${application.last_name}`}
      lead={`${APPLICATION_STATUS_LABELS[application.status]} — reçue le ${formatMoment(application.created_at)}.`}
      actions={
        <Link className="btn btn--ghost" href="/administration/affiliation/candidatures/">
          Retour aux candidatures
        </Link>
      }
    >
      {result ? (
        <div
          className={`admin-notice ${query.mail === 'failed' ? 'admin-notice--error' : 'admin-notice--ok'}`}
          role="status"
        >
          <p>
            {result}
            {mailResult}
          </p>
        </div>
      ) : null}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Le candidat</h2>
          <p>
            <ApplicationStatusBadge status={application.status} />
          </p>
        </div>
        <dl className="admin-def">
          <dt>E-mail</dt>
          <dd>
            <a href={`mailto:${application.email}`}>{application.email}</a>
          </dd>
          <dt>WhatsApp / téléphone</dt>
          <dd>{application.phone}</dd>
          <dt>Lieu</dt>
          <dd>
            {application.city}, {application.country}
          </dd>
          <dt>Profil indiqué</dt>
          <dd>{profile ? PROFILE_LABELS[profile] : application.requested_profile}</dd>
          <dt>Compte au dépôt</dt>
          <dd>{application.user_id ? 'Déposée depuis un compte connecté' : 'Déposée sans compte'}</dd>
          <dt>Consentement</dt>
          <dd>
            {formatMoment(application.consent_given_at)} — version {application.consent_version}
          </dd>
        </dl>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Potentiel et motivation</h2>
          <p>Tels que le candidat les a écrits.</p>
        </div>
        {profile && PROFILE_QUESTIONS[profile].some((question) => typeof answers[question.key] === 'string') ? (
          <dl className="admin-def">
            {PROFILE_QUESTIONS[profile]
              .filter((question) => typeof answers[question.key] === 'string')
              .map((question) => (
                <div key={question.key}>
                  <dt>{question.label}</dt>
                  <dd className="admin-longtext">{String(answers[question.key])}</dd>
                </div>
              ))}
          </dl>
        ) : null}
        <h3>Comment il compte recommander MORA Shawiri</h3>
        <p className="admin-longtext">{application.motivation}</p>
        {application.collaboration_idea ? (
          <>
            <h3>Idée de collaboration</h3>
            <p className="admin-longtext">{application.collaboration_idea}</p>
          </>
        ) : null}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Versements souhaités</h2>
          <p>Un souhait, pas un moyen validé : il se vérifie avec l’affilié avant tout versement.</p>
        </div>
        <dl className="admin-def">
          <dt>Moyen souhaité</dt>
          <dd>{payoutLabel}</dd>
          {payoutDetails
            ? Object.entries(payoutDetails).map(([key, value]) => (
                <div key={key}>
                  <dt>{PAYOUT_KEY_LABELS[key] ?? key}</dt>
                  <dd>{key === 'titulaire' || key === 'banque' || key === 'ordre' ? value : maskPayoutValue(value)}</dd>
                </div>
              ))
            : null}
        </dl>
        {payoutDetails === null ? (
          <p className="admin-field__hint">
            Les coordonnées ne s’affichent qu’avec la permission <code>payouts.view</code>.
          </p>
        ) : (
          <p className="admin-field__hint">Les numéros sont masqués à l’affichage ; ils sont conservés en base.</p>
        )}
      </section>

      {application.info_request || application.decision_message || application.refusal_reason ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Échanges et décision</h2>
          </div>
          <dl className="admin-def">
            {application.info_request ? (
              <>
                <dt>Informations demandées</dt>
                <dd className="admin-longtext">{application.info_request}</dd>
              </>
            ) : null}
            {application.decision_message ? (
              <>
                <dt>Message au candidat</dt>
                <dd className="admin-longtext">{application.decision_message}</dd>
              </>
            ) : null}
            {application.refusal_reason ? (
              <>
                <dt>Motif interne du refus</dt>
                <dd className="admin-longtext">{application.refusal_reason}</dd>
              </>
            ) : null}
            {application.affiliate_id ? (
              <>
                <dt>Fiche affilié</dt>
                <dd>Créée en préparation à l’acceptation.</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      {canManage && transitions.length > 0 ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Décider</h2>
            <p>Chaque décision est historisée. Les e-mails ne partent que si vous le demandez.</p>
          </div>
          <div className="admin-table__actions">
            {transitions.includes('EN_ETUDE') ? (
              <AffiliationDecisionForm
                action={reviewApplication}
                fields={{ id: application.id, status: 'EN_ETUDE' }}
                trigger="Passer à l’étude"
                title="Passer la candidature à l’étude ?"
                consequence="La candidature est marquée en étude. Le candidat peut en être informé par e-mail."
                confirmLabel="Passer à l’étude"
                inputs={[{ kind: 'checkbox', name: 'notify', label: 'Notifier le candidat par e-mail', defaultChecked: true }]}
              />
            ) : null}
            {transitions.includes('INFOS_REQUISES') ? (
              <AffiliationDecisionForm
                action={reviewApplication}
                fields={{ id: application.id, status: 'INFOS_REQUISES' }}
                trigger="Demander des informations"
                title="Demander des informations au candidat ?"
                consequence="Le candidat reçoit votre message par e-mail. La candidature attend sa réponse."
                confirmLabel="Envoyer la demande"
                inputs={[
                  {
                    kind: 'textarea',
                    name: 'message',
                    label: 'Informations demandées',
                    required: true,
                    hint: 'Ce texte est adressé au candidat.',
                  },
                ]}
              />
            ) : null}
            {canAccept && transitions.includes('ACCEPTEE') && activeCategories.length > 0 ? (
              <AffiliationDecisionForm
                action={acceptApplication}
                fields={{ id: application.id }}
                trigger="Accepter"
                title="Accepter cette candidature ?"
                consequence="Une fiche affilié est créée en préparation, dans la catégorie choisie. Elle n’a encore ni accès, ni référence, ni règle : il faudra la configurer puis l’activer."
                confirmLabel="Accepter la candidature"
                variant="gold"
                inputs={[
                  {
                    kind: 'select',
                    name: 'category',
                    label: 'Catégorie de l’affilié',
                    options: activeCategories.map((category) => ({
                      value: category.id,
                      label: `${category.label}${category.is_internal ? ' (interne)' : ''}`,
                    })),
                    defaultValue: defaultCategory,
                    hint: 'Proposée d’après le profil indiqué ; c’est vous qui décidez.',
                  },
                  { kind: 'textarea', name: 'message', label: 'Message au candidat (facultatif)' },
                  { kind: 'checkbox', name: 'notify', label: 'Notifier le candidat par e-mail', defaultChecked: true },
                ]}
              />
            ) : null}
            {transitions.includes('REFUSEE') ? (
              <AffiliationDecisionForm
                action={reviewApplication}
                fields={{ id: application.id, status: 'REFUSEE' }}
                trigger="Refuser"
                title="Refuser cette candidature ?"
                consequence="La décision est définitive. Le motif interne n’est jamais communiqué au candidat."
                confirmLabel="Refuser la candidature"
                variant="danger"
                inputs={[
                  {
                    kind: 'textarea',
                    name: 'reason',
                    label: 'Motif interne',
                    required: true,
                    maxLength: 1000,
                    hint: 'Par exemple : prospect déjà connu et activement traité par MORA Shawiri.',
                  },
                  { kind: 'textarea', name: 'message', label: 'Message au candidat (facultatif)' },
                  { kind: 'checkbox', name: 'notify', label: 'Notifier le candidat par e-mail', defaultChecked: true },
                ]}
              />
            ) : null}
          </div>
          {!canAccept ? (
            <p className="admin-field__hint">
              Accepter une candidature crée un affilié : la permission <code>affiliates.create</code> est nécessaire.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Historique</h2>
          <p>Statuts, demandes et notes internes, du plus récent au plus ancien.</p>
        </div>
        {canManage ? (
          <AffiliationDecisionForm
            action={noteApplication}
            fields={{ id: application.id }}
            trigger="Ajouter une note interne"
            title="Enregistrer cette note ?"
            consequence="La note rejoint l’historique de la candidature. Elle n’est jamais adressée au candidat."
            confirmLabel="Enregistrer la note"
            inputs={[{ kind: 'textarea', name: 'note', label: 'Note interne', required: true, maxLength: 4000 }]}
          />
        ) : null}
        <ul className="admin-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <strong>{event.summary}</strong>
              <span className="admin-field__hint">
                {' '}
                — {formatMoment(event.created_at)}
                {event.actor_label ? `, par ${event.actor_label}` : ''}
              </span>
              {event.message ? <p className="admin-longtext">{event.message}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>E-mails</h2>
          <p>Chaque envoi est journalisé avec son résultat. Un e-mail en échec peut être renvoyé à l’identique.</p>
        </div>
        {emails.length === 0 ? (
          <p className="admin-field__hint">Aucun e-mail journalisé pour cette candidature.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">E-mails liés à la candidature</caption>
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
                {emails.map((email) => (
                  <tr key={email.id}>
                    <th scope="row">{email.subject}</th>
                    <td>{email.recipient_kind === 'EQUIPE' ? 'Équipe MORA Shawiri' : email.recipient}</td>
                    <td>
                      <EmailStatusBadge status={email.status} />
                      {email.last_error ? <span className="admin-field__hint"> {email.last_error}</span> : null}
                    </td>
                    <td>{formatMoment(email.last_attempt_at ?? email.created_at)}</td>
                    <td>
                      {email.status === 'ECHEC' && canManage ? (
                        <ConfirmForm
                          action={retryEmail}
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
        )}
      </section>
    </AdminPage>
  );
}
