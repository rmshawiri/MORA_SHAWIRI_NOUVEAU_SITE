'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Check, Whatsapp } from '@/components/ui/Icon';
import { CONTACT_BUDGETS, CONTACT_SUBJECTS } from '@/content/contact';
import { findOffer } from '@/content/offers';
import { site, whatsappLink } from '@/lib/site';

type Status = 'idle' | 'sending' | 'sent' | 'error';

type FieldName = 'nom' | 'organisation' | 'email' | 'telephone' | 'sujet' | 'budget' | 'message';

type Values = Record<FieldName, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const EMPTY: Values = {
  nom: '',
  organisation: '',
  email: '',
  telephone: '',
  /** Vide tant que le visiteur n'a pas choisi : l'offre consultée peut alors le renseigner. */
  sujet: '',
  budget: '',
  message: '',
};

/**
 * Lecture de la chaîne de requête comme source externe.
 *
 * Elle ne change pas sans navigation complète : l'abonnement est donc vide. Le
 * rendu serveur ne connaît pas l'URL du navigateur et renvoie une chaîne vide ;
 * React réconcilie ensuite avec la valeur réelle. Ce détour évite à la fois un
 * `setState` dans un effet et le passage de la page en rendu dynamique.
 */
const subscribeToSearch = () => () => {};
const getSearch = () => window.location.search;
const getServerSearch = () => '';

/** Ordre de parcours des champs : il fixe celui du focus après une erreur. */
const FIELD_ORDER: readonly FieldName[] = [
  'nom',
  'organisation',
  'email',
  'telephone',
  'sujet',
  'budget',
  'message',
];

/** Messages d'erreur renvoyés par la route serveur, traduits pour le visiteur. */
const SERVER_MESSAGES: Record<string, string> = {
  rate_limited:
    'Vous avez envoyé plusieurs demandes coup sur coup. Patientez quelques minutes avant de réessayer, ou écrivez-nous directement sur WhatsApp.',
  mail_disabled:
    'Notre service d’envoi est momentanément indisponible. Votre demande n’a pas été transmise : écrivez-nous sur WhatsApp ou par téléphone, nous la prendrons immédiatement.',
  send_failed:
    'Votre demande n’a pas pu être transmise. Vos informations sont conservées ci-dessous : réessayez, ou passez par WhatsApp.',
  invalid_email: 'L’adresse e-mail saisie n’a pas été acceptée. Vérifiez-la puis réessayez.',
};

const GENERIC_ERROR =
  'Votre demande n’a pas pu être envoyée. Vos informations sont conservées ci-dessous : réessayez, ou écrivez-nous sur WhatsApp.';

/**
 * Formulaire de demande de devis.
 *
 * La demande part vers la route serveur `/api/contact` et **la réponse est
 * attendue** : la confirmation n'est affichée qu'après un succès réel
 * (`06_CONTACT.md` § 71-72). En cas d'échec, les informations saisies sont
 * conservées et WhatsApp est proposé en solution de repli.
 *
 * WhatsApp n'est plus l'action d'envoi : il est proposé *après* la
 * confirmation, comme copie facultative, sous la forme d'un lien cliqué par le
 * visiteur — jamais d'une fenêtre ouverte par le script.
 */
export default function ContactForm() {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [serverMessage, setServerMessage] = useState<string>('');
  /** Pot de miel : un humain ne le voit pas, un robot le remplit. */
  const [honeypot, setHoneypot] = useState('');
  /** Instantané de la demande réellement transmise, affiché en récapitulatif. */
  const [sent, setSent] = useState<Values | null>(null);

  const fieldRefs = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});
  const confirmationRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  // Contexte transmis par une carte d'offre : `?offre=<identifiant>`.
  const search = useSyncExternalStore(subscribeToSearch, getSearch, getServerSearch);
  const offer = findOffer(new URLSearchParams(search).get('offre')) ?? null;

  /** Besoin effectif : le choix du visiteur, sinon celui de l'offre consultée. */
  const subject = values.sujet || offer?.requestSubject || CONTACT_SUBJECTS[0]!.value;

  // La confirmation est un changement d'état majeur : elle prend le focus.
  useEffect(() => {
    if (status === 'sent') confirmationRef.current?.focus();
    if (status === 'error') alertRef.current?.focus();
  }, [status]);

  const update = (name: FieldName, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  /** Validation en ligne : le message s'affiche sous le champ concerné. */
  const validate = (candidate: Values, chosenSubject: string): Partial<Record<FieldName, string>> => {
    const found: Partial<Record<FieldName, string>> = {};
    if (!candidate.nom.trim()) found.nom = 'Indiquez votre nom pour que nous sachions qui nous répond.';
    if (!candidate.email.trim()) {
      found.email = 'Indiquez votre adresse e-mail : elle nous permet de vous répondre.';
    } else if (!EMAIL_PATTERN.test(candidate.email.trim())) {
      found.email = 'Cette adresse e-mail semble incomplète. Exemple : nom@domaine.com';
    }
    if (!chosenSubject.trim()) found.sujet = 'Choisissez le besoin qui se rapproche le plus du vôtre.';
    if (!candidate.message.trim()) found.message = 'Décrivez votre projet en quelques lignes.';
    return found;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'sending') return; // Double soumission impossible.

    const found = validate(values, subject);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = FIELD_ORDER.find((name) => found[name]);
      if (first) fieldRefs.current[first]?.focus();
      return;
    }

    setServerMessage('');
    setStatus('sending');

    const payload = {
      kind: 'devis' as const,
      nom: values.nom.trim(),
      organisation: values.organisation.trim(),
      email: values.email.trim(),
      telephone: values.telephone.trim(),
      sujet: subject,
      budget: values.budget,
      offre: offer?.title ?? '',
      message: values.message.trim(),
      website: honeypot,
    };

    try {
      // Slash final : `trailingSlash` est activé, une URL sans slash serait redirigée.
      const response = await fetch('/api/contact/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (response.ok) {
        setSent({ ...values, sujet: subject });
        setStatus('sent');
        return;
      }

      setServerMessage(SERVER_MESSAGES[body?.error ?? ''] ?? GENERIC_ERROR);
      setStatus('error');
    } catch {
      // Réseau injoignable : la demande n'est pas partie, il faut le dire.
      setServerMessage(GENERIC_ERROR);
      setStatus('error');
    }
  };

  const subjectLabel = (value: string) =>
    CONTACT_SUBJECTS.find((option) => option.value === value)?.label ?? value;

  const budgetLabel = (value: string) =>
    CONTACT_BUDGETS.find((option) => option.value === value)?.label ?? value;

  if (status === 'sent' && sent) {
    const recap: { key: string; value: string }[] = [
      ...(offer ? [{ key: 'Offre concernée', value: offer.title }] : []),
      { key: 'Besoin', value: subjectLabel(sent.sujet) },
      ...(sent.budget ? [{ key: 'Budget indicatif', value: budgetLabel(sent.budget) }] : []),
      { key: 'E-mail', value: sent.email.trim() },
      ...(sent.telephone.trim() ? [{ key: 'Téléphone', value: sent.telephone.trim() }] : []),
      { key: 'Votre message', value: sent.message.trim() },
    ];

    const copyMessage = [
      'Copie de ma demande envoyée depuis le site MORA Shawiri.',
      '',
      ...recap.map((row) => `${row.key} : ${row.value}`),
    ].join('\n');

    return (
      <div
        className="form-done"
        role="status"
        tabIndex={-1}
        ref={confirmationRef}
        aria-label="Confirmation d’envoi"
      >
        <div className="rdv-done__head">
          <span className="rdv-done__icon" aria-hidden="true">
            <Check size={16} strokeWidth={3} />
          </span>
          <h3>Votre demande a bien été envoyée</h3>
        </div>
        <p className="rdv-done__lead">
          Elle vient d’arriver chez MORA Shawiri, et un accusé de réception part vers{' '}
          <strong>{sent.email.trim()}</strong>. Notre équipe l’examine et revient vers vous.
        </p>

        <ul className="rdv-recap">
          {recap.map((row) => (
            <li key={row.key}>
              <span className="rdv-recap__k">{row.key}</span>
              <span className="rdv-recap__v">{row.value}</span>
            </li>
          ))}
        </ul>

        <p className="form-done__ask">
          Souhaitez-vous aussi en envoyer une copie sur WhatsApp&nbsp;?
        </p>
        <a
          className="btn btn--gold btn--lg"
          href={whatsappLink(copyMessage)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Whatsapp size={20} /> Envoyer une copie sur WhatsApp
        </a>

        <p className="form__note">
          Ce n’est pas obligatoire : votre demande nous est déjà parvenue. Pour toute précision, vous
          pouvez aussi nous joindre au <a href={site.phoneHref}>{site.phone}</a> ou à{' '}
          <a href={site.emailHref}>{site.email}</a>.
        </p>
      </div>
    );
  }

  const sending = status === 'sending';

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {offer && (
        <p className="form__context">
          Votre demande concerne&nbsp;: <strong>{offer.title}</strong>
        </p>
      )}

      {status === 'error' && (
        <div className="form-alert" role="alert" tabIndex={-1} ref={alertRef}>
          <strong>Votre message n’a pas été envoyé.</strong>
          <span>{serverMessage || GENERIC_ERROR}</span>
        </div>
      )}

      <div className="form__row">
        <div className="field">
          <label htmlFor="nom">
            Nom et prénom{' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="nom"
            name="nom"
            type="text"
            autoComplete="name"
            value={values.nom}
            onChange={(event) => update('nom', event.target.value)}
            aria-invalid={errors.nom ? true : undefined}
            aria-describedby={errors.nom ? 'nom-error' : undefined}
            ref={(element) => {
              fieldRefs.current.nom = element;
            }}
          />
          {errors.nom && (
            <p className="field__error" id="nom-error">
              {errors.nom}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="organisation">Organisation</label>
          <input
            id="organisation"
            name="organisation"
            type="text"
            autoComplete="organization"
            value={values.organisation}
            onChange={(event) => update('organisation', event.target.value)}
          />
        </div>
      </div>

      <div className="form__row">
        <div className="field">
          <label htmlFor="email">
            Adresse e-mail{' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(event) => update('email', event.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
            ref={(element) => {
              fieldRefs.current.email = element;
            }}
          />
          {errors.email && (
            <p className="field__error" id="email-error">
              {errors.email}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="telephone">Téléphone / WhatsApp</label>
          <input
            id="telephone"
            name="telephone"
            type="tel"
            autoComplete="tel"
            placeholder="+269 ..."
            value={values.telephone}
            onChange={(event) => update('telephone', event.target.value)}
          />
        </div>
      </div>

      <div className="form__row">
        <div className="field">
          <label htmlFor="sujet">
            Votre besoin{' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <select
            id="sujet"
            name="sujet"
            value={subject}
            onChange={(event) => update('sujet', event.target.value)}
            aria-invalid={errors.sujet ? true : undefined}
            aria-describedby={errors.sujet ? 'sujet-error' : undefined}
            ref={(element) => {
              fieldRefs.current.sujet = element;
            }}
          >
            {CONTACT_SUBJECTS.map((subject) => (
              <option key={subject.value} value={subject.value}>
                {subject.label}
              </option>
            ))}
          </select>
          {errors.sujet && (
            <p className="field__error" id="sujet-error">
              {errors.sujet}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="budget">Budget indicatif</label>
          <select
            id="budget"
            name="budget"
            value={values.budget}
            onChange={(event) => update('budget', event.target.value)}
          >
            {CONTACT_BUDGETS.map((budget) => (
              <option key={budget.label} value={budget.value}>
                {budget.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="message">
          Votre projet en quelques lignes{' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <textarea
          id="message"
          name="message"
          placeholder="Votre activité, votre objectif, votre échéance si vous en avez une."
          value={values.message}
          onChange={(event) => update('message', event.target.value)}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? 'message-error' : 'message-hint'}
          ref={(element) => {
            fieldRefs.current.message = element;
          }}
        />
        {errors.message ? (
          <p className="field__error" id="message-error">
            {errors.message}
          </p>
        ) : (
          <p className="field__hint" id="message-hint">
            Plus votre description est précise, plus notre devis sera juste.
          </p>
        )}
      </div>

      {/* Pot de miel : hors flux visuel et retiré de l'arbre d'accessibilité. */}
      <div className="hp-field" aria-hidden="true">
        <label htmlFor="website">Ne remplissez pas ce champ</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>

      <button className="btn btn--gold btn--lg btn--block" type="submit" disabled={sending}>
        {sending ? (
          <>
            <span className="btn__spinner" aria-hidden="true" /> Envoi en cours…
          </>
        ) : (
          <>
            {status === 'error' ? 'Réessayer l’envoi' : 'Envoyer ma demande'} <ArrowRight />
          </>
        )}
      </button>

      {status === 'error' && (
        <a
          className="btn btn--ghost btn--block"
          href={whatsappLink(
            `Bonjour MORA Shawiri, je souhaite vous transmettre une demande (${subjectLabel(subject)}).`,
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Whatsapp /> Nous écrire sur WhatsApp
        </a>
      )}

      <p className="form__note">
        Ce site fonctionne sans base de données : vos informations ne sont pas stockées et ne sont
        transmises à aucun tiers. Elles servent uniquement à nous faire parvenir votre demande et à
        vous répondre.
      </p>
    </form>
  );
}
