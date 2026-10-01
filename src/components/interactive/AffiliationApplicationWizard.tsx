'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ArrowLeft, ArrowRight, Check } from '@/components/ui/Icon';
import {
  EMPTY_DRAFT,
  PAYOUT_FIELDS,
  PROFILE_LABELS,
  PROFILE_OPTIONS,
  PROFILE_QUESTIONS,
  STEPS,
  validateStep,
  type ApplicationDraft,
  type FieldErrors,
  type PayoutMethodOption,
  type StepKey,
} from '@/lib/affiliation/applications';

/**
 * Candidature au programme d'affiliation, en six étapes.
 *
 * Même vocabulaire visuel que la prise de rendez-vous (`rdv-*`), validée par
 * le propriétaire : panneau, progression, choix en cartes, récapitulatif
 * modifiable. Chaque étape se valide avant la suivante ; le serveur revalide
 * tout, puis la base une troisième fois.
 *
 * ## Ce qui est gardé dans le navigateur, et ce qui ne l'est pas
 *
 * Les étapes 1 à 4 sont conservées localement le temps de la saisie, pour
 * qu'un onglet fermé ou un réseau coupé ne fasse rien perdre. Les coordonnées
 * de versement **ne le sont jamais** : un numéro de compte n'a rien à faire
 * dans le stockage d'un navigateur partagé. Tout est effacé après l'envoi.
 *
 * ## Erreurs
 *
 * Chaque champ fautif porte `aria-invalid` et son message est relié par
 * `aria-describedby` ; le focus va au premier champ fautif. Une erreur réseau
 * laisse toutes les réponses en place et propose de réessayer.
 */

const STORAGE_KEY = 'mora-affiliation-candidature-v1';

type SendStatus = 'idle' | 'sending' | 'sent' | 'error';

const SERVER_MESSAGES: Record<string, string> = {
  rate_limited:
    'Plusieurs candidatures ont été envoyées depuis cette connexion. Patientez avant de réessayer, ou écrivez-nous sur WhatsApp.',
  invalid_fields: 'Certaines réponses n’ont pas été acceptées. Vérifiez l’étape indiquée puis réessayez.',
  invalid_payload: 'Votre candidature n’a pas pu être lue. Vérifiez vos réponses puis réessayez.',
  unavailable:
    'Notre service est momentanément indisponible. Vos réponses sont conservées sur cette page : réessayez dans un instant.',
};

const GENERIC_ERROR =
  'Votre candidature n’a pas pu être envoyée. Vos réponses sont conservées sur cette page : réessayez.';

/** Ce qui peut être conservé localement : jamais les coordonnées de versement. */
function storable(draft: ApplicationDraft) {
  return {
    firstName: draft.firstName,
    lastName: draft.lastName,
    email: draft.email,
    phone: draft.phone,
    country: draft.country,
    city: draft.city,
    profile: draft.profile,
    answers: draft.answers,
    motivation: draft.motivation,
    idea: draft.idea,
  };
}

function readStored(): Partial<ApplicationDraft> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const text = (key: string) => (typeof parsed[key] === 'string' ? (parsed[key] as string) : '');
    const answers =
      typeof parsed.answers === 'object' && parsed.answers !== null
        ? Object.fromEntries(
            Object.entries(parsed.answers as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {};
    const profile = PROFILE_OPTIONS.some((option) => option.value === parsed.profile)
      ? (parsed.profile as ApplicationDraft['profile'])
      : '';
    return {
      firstName: text('firstName'),
      lastName: text('lastName'),
      email: text('email'),
      phone: text('phone'),
      country: text('country'),
      city: text('city'),
      profile,
      answers,
      motivation: text('motivation'),
      idea: text('idea'),
    };
  } catch {
    return null;
  }
}

function readStoredRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribeStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

function hasContent(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.values(parsed).some((value) =>
      typeof value === 'string' ? value.trim() !== '' : value !== null && typeof value === 'object' && Object.keys(value).length > 0,
    );
  } catch {
    return false;
  }
}

export default function AffiliationApplicationWizard({
  methods,
}: {
  methods: readonly PayoutMethodOption[];
}) {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<ApplicationDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sendStatus, setSendStatus] = useState<SendStatus>('idle');
  const [sendMessage, setSendMessage] = useState('');
  const [emailSent, setEmailSent] = useState(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const honeypotRef = useRef<HTMLInputElement>(null);

  const step = STEPS[index]!;
  const total = STEPS.length;
  const method = methods.find((entry) => entry.code === draft.payoutMethod) ?? null;

  // Un brouillon n'est écrit qu'une fois la saisie commencée : le formulaire
  // vide du chargement n'écrase jamais une saisie à reprendre.
  const [touched, setTouched] = useState(false);
  const storedRaw = useSyncExternalStore(subscribeStorage, readStoredRaw, () => null);
  const [restoreDismissed, setRestoreDismissed] = useState(false);
  const canRestore = !restoreDismissed && !touched && hasContent(storedRaw);

  useEffect(() => {
    if (sendStatus === 'sent' || !touched) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storable(draft)));
    } catch {
      // Stockage indisponible (navigation privée) : la saisie reste en mémoire.
    }
  }, [draft, sendStatus, touched]);

  // Changer d'étape annonce la nouvelle étape et y place le focus.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: false });
  }, [index]);

  useEffect(() => {
    if (sendStatus === 'sent') doneRef.current?.focus();
  }, [sendStatus]);

  const update = (patch: Partial<ApplicationDraft>, clear: string[] = []) => {
    setTouched(true);
    setDraft((current) => ({ ...current, ...patch }));
    if (clear.length) {
      setErrors((current) => {
        const next = { ...current };
        for (const key of clear) delete next[key];
        return next;
      });
    }
  };

  const focusFirstError = (fieldErrors: FieldErrors) => {
    const first = Object.keys(fieldErrors)[0];
    if (!first) return;
    requestAnimationFrame(() => {
      const element = document.getElementById(fieldId(first));
      element?.focus();
    });
  };

  const next = () => {
    const stepErrors = validateStep(step.key, draft, methods);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) {
      focusFirstError(stepErrors);
      return;
    }
    setIndex((current) => Math.min(current + 1, total - 1));
  };

  const goTo = (target: StepKey) => {
    setErrors({});
    setIndex(STEPS.findIndex((entry) => entry.key === target));
  };

  const restore = () => {
    const stored = readStored();
    setTouched(true);
    setRestoreDismissed(true);
    if (stored) setDraft((current) => ({ ...current, ...stored }));
  };

  const dismissRestore = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* rien à effacer */
    }
    setRestoreDismissed(true);
  };

  const send = async () => {
    if (sendStatus === 'sending') return; // Double soumission impossible.
    // Toutes les étapes, une dernière fois : un retour en arrière a pu en vider une.
    for (const entry of STEPS) {
      const stepErrors = validateStep(entry.key, draft, methods);
      if (Object.keys(stepErrors).length > 0) {
        setIndex(STEPS.findIndex((item) => item.key === entry.key));
        setErrors(stepErrors);
        focusFirstError(stepErrors);
        return;
      }
    }

    setSendStatus('sending');
    setSendMessage('');
    try {
      const response = await fetch('/api/affiliation/candidature/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, website: honeypotRef.current?.value ?? '' }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; step?: StepKey; emailSent?: boolean }
        | null;

      if (response.ok && body?.ok) {
        setEmailSent(body.emailSent !== false);
        setSendStatus('sent');
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* rien à effacer */
        }
        return;
      }

      if (body?.error === 'invalid_fields' && body.step) {
        setIndex(STEPS.findIndex((item) => item.key === body.step));
      }
      setSendMessage(SERVER_MESSAGES[body?.error ?? ''] ?? GENERIC_ERROR);
      setSendStatus('error');
    } catch {
      setSendMessage(GENERIC_ERROR);
      setSendStatus('error');
    }
  };

  if (sendStatus === 'sent') {
    return (
      <div className="rdv-panel">
        <div className="rdv-step rdv-done is-in" role="status" tabIndex={-1} ref={doneRef} aria-label="Candidature envoyée">
          <div className="rdv-done__head">
            <span className="rdv-done__icon" aria-hidden="true">
              <Check size={16} strokeWidth={3} />
            </span>
            <h2>Candidature envoyée</h2>
          </div>
          <p className="rdv-done__lead">
            Merci {draft.firstName}. Votre candidature est enregistrée : notre équipe va l’étudier et vous
            tiendra informé par e-mail à chaque étape.
          </p>
          <p className="rdv-done__note">
            {emailSent
              ? `Un accusé de réception vient de vous être adressé à ${draft.email}.`
              : 'L’accusé de réception n’a pas pu partir pour le moment ; votre candidature est bien enregistrée.'}
          </p>
          <p className="rdv-done__note">
            Une candidature ne vaut pas inscription : votre accès à l’espace affilié vous sera ouvert après étude et
            validation.
          </p>
        </div>
      </div>
    );
  }

  const progress = Math.round(((index + 1) / total) * 100);

  return (
    <div className="rdv-panel aff-wizard">
      <div className="rdv-panel__head">
        <div
          className="rdv-progress"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          aria-label={`Étape ${index + 1} sur ${total}`}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <ol className="aff-steps" aria-label="Étapes de la candidature">
          {STEPS.map((entry, entryIndex) => (
            <li
              key={entry.key}
              className={entryIndex === index ? 'is-current' : entryIndex < index ? 'is-done' : undefined}
              aria-current={entryIndex === index ? 'step' : undefined}
            >
              <span className="aff-steps__dot" aria-hidden="true">
                {entryIndex < index ? <Check size={12} strokeWidth={3} /> : entryIndex + 1}
              </span>
              <span className="aff-steps__label">{entry.title}</span>
            </li>
          ))}
        </ol>
        <p className="rdv-count">
          Étape <span>{index + 1}</span> sur <span>{total}</span>
        </p>
      </div>

      {canRestore && index === 0 ? (
        <div className="aff-restored" role="status">
          <span>Une candidature commencée sur cet appareil a été retrouvée.</span>{' '}
          <button type="button" className="rdv-edit" onClick={restore}>
            Reprendre ma saisie
          </button>{' '}
          <button type="button" className="rdv-edit" onClick={dismissRestore}>
            Ignorer
          </button>
        </div>
      ) : null}

      <div className="rdv-stage">
        <div className="rdv-step is-in" key={step.key}>
          <h2 className="rdv-q aff-step-title" tabIndex={-1} ref={headingRef}>
            {step.title}
          </h2>
          <p className="rdv-hint aff-step-lead">{step.lead}</p>

          {/* Pot de miel : invisible, hors tabulation, ignoré des lecteurs d'écran. */}
          <input
            ref={honeypotRef}
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="aff-honeypot"
            defaultValue=""
          />

          {step.key === 'identite' && (
            <div className="form">
              <div className="form__row">
                <TextField id="firstName" label="Prénom" value={draft.firstName} error={errors.firstName} autoComplete="given-name"
                  onChange={(value) => update({ firstName: value }, ['firstName'])} />
                <TextField id="lastName" label="Nom" value={draft.lastName} error={errors.lastName} autoComplete="family-name"
                  onChange={(value) => update({ lastName: value }, ['lastName'])} />
              </div>
              <div className="form__row">
                <TextField id="email" label="Adresse e-mail" type="email" value={draft.email} error={errors.email} autoComplete="email"
                  inputMode="email" onChange={(value) => update({ email: value }, ['email'])} />
                <TextField id="phone" label="WhatsApp ou téléphone" type="tel" value={draft.phone} error={errors.phone}
                  autoComplete="tel" inputMode="tel" placeholder="+269 …"
                  onChange={(value) => update({ phone: value }, ['phone'])} />
              </div>
              <div className="form__row">
                <TextField id="country" label="Pays" value={draft.country} error={errors.country} autoComplete="country-name"
                  placeholder="Union des Comores" onChange={(value) => update({ country: value }, ['country'])} />
                <TextField id="city" label="Ville" value={draft.city} error={errors.city} autoComplete="address-level2"
                  onChange={(value) => update({ city: value }, ['city'])} />
              </div>
            </div>
          )}

          {step.key === 'profil' && (
            <ChoiceGroup
              id="profile"
              label="Votre profil"
              error={errors.profile}
              options={PROFILE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                description: option.description,
              }))}
              value={draft.profile}
              onChange={(value) =>
                update({ profile: value as ApplicationDraft['profile'], answers: {} }, ['profile'])
              }
            />
          )}

          {step.key === 'potentiel' && draft.profile && (
            <div className="form">
              {PROFILE_QUESTIONS[draft.profile].map((question) => {
                const errorKey = `answers.${question.key}`;
                const value = draft.answers[question.key] ?? '';
                const onChange = (next: string) =>
                  update({ answers: { ...draft.answers, [question.key]: next } }, [errorKey]);
                if (question.type === 'choice') {
                  return (
                    <ChoiceGroup
                      key={question.key}
                      id={errorKey}
                      label={question.label}
                      error={errors[errorKey]}
                      options={(question.options ?? []).map((option) => ({ value: option, label: option }))}
                      value={value}
                      onChange={onChange}
                      compact
                    />
                  );
                }
                return question.type === 'textarea' ? (
                  <TextArea key={question.key} id={errorKey} label={question.label} hint={question.hint}
                    optional={question.optional} value={value} error={errors[errorKey]} onChange={onChange} />
                ) : (
                  <TextField key={question.key} id={errorKey} label={question.label} hint={question.hint}
                    optional={question.optional} placeholder={question.placeholder}
                    type={question.type === 'url' ? 'url' : 'text'} inputMode={question.type === 'url' ? 'url' : undefined}
                    value={value} error={errors[errorKey]} onChange={onChange} />
                );
              })}
            </div>
          )}

          {step.key === 'motivation' && (
            <div className="form">
              <TextArea id="motivation" label="Comment comptez-vous recommander ou promouvoir MORA Shawiri ?"
                hint="Vos canaux, votre réseau, les personnes que vous côtoyez." value={draft.motivation}
                error={errors.motivation} onChange={(value) => update({ motivation: value }, ['motivation'])} />
              <TextArea id="idea" label="Une idée de collaboration ?" optional value={draft.idea} error={errors.idea}
                onChange={(value) => update({ idea: value }, ['idea'])} />
            </div>
          )}

          {step.key === 'paiement' && (
            <div className="form">
              {methods.length === 0 ? (
                <div className="form-alert" role="alert">
                  <strong>Aucun moyen de versement n’est disponible pour le moment.</strong>
                  <span>Écrivez-nous sur WhatsApp : nous trouverons la solution avec vous.</span>
                </div>
              ) : (
                <ChoiceGroup
                  id="payoutMethod"
                  label="Moyen de versement souhaité"
                  error={errors.payoutMethod}
                  options={methods.map((entry) => ({ value: entry.code, label: entry.label }))}
                  value={draft.payoutMethod}
                  onChange={(value) => update({ payoutMethod: value, payoutDetails: {} }, ['payoutMethod'])}
                  compact
                />
              )}
              {method && PAYOUT_FIELDS[method.kind].length > 0 ? (
                <div className="form__row">
                  {PAYOUT_FIELDS[method.kind].map((fieldDef) => (
                    <TextField key={fieldDef.key} id={`payout.${fieldDef.key}`} label={fieldDef.label} hint={fieldDef.hint}
                      type={fieldDef.type} autoComplete={fieldDef.autoComplete ?? 'off'}
                      inputMode={fieldDef.type === 'tel' ? 'tel' : fieldDef.type === 'email' ? 'email' : undefined}
                      value={draft.payoutDetails[fieldDef.key] ?? ''} error={errors[`payout.${fieldDef.key}`]}
                      onChange={(value) =>
                        update({ payoutDetails: { ...draft.payoutDetails, [fieldDef.key]: value } }, [`payout.${fieldDef.key}`])
                      } />
                  ))}
                </div>
              ) : method ? (
                <p className="form__note">Aucune coordonnée n’est nécessaire pour ce moyen.</p>
              ) : null}
              <p className="form__note">
                Le moyen indiqué est un souhait : il sera vérifié avec vous avant tout versement. Ces coordonnées ne
                sont pas conservées dans votre navigateur.
              </p>
            </div>
          )}

          {step.key === 'recapitulatif' && (
            <Recap draft={draft} method={method} onEdit={goTo} errors={errors}
              onConsent={(value) => update({ consent: value }, ['consent'])} />
          )}

          {sendStatus === 'error' && step.key === 'recapitulatif' && (
            <div className="form-alert" role="alert">
              <strong>L’envoi n’a pas abouti</strong>
              <span>{sendMessage || GENERIC_ERROR}</span>
            </div>
          )}

          <div className="rdv-actions">
            {index > 0 && (
              <button type="button" className="rdv-back" onClick={() => { setErrors({}); setIndex(index - 1); }}>
                <ArrowLeft />
                Étape précédente
              </button>
            )}
            <div className="rdv-actions__right">
              {step.key === 'recapitulatif' ? (
                <button type="button" className="btn btn--gold btn--lg rdv-send" onClick={send}
                  disabled={sendStatus === 'sending'}>
                  {sendStatus === 'sending' ? (
                    <>
                      <span className="btn__spinner" aria-hidden="true" />
                      Envoi en cours…
                    </>
                  ) : (
                    <>
                      <ArrowRight />
                      {sendStatus === 'error' ? 'Réessayer l’envoi' : 'Envoyer ma candidature'}
                    </>
                  )}
                </button>
              ) : (
                <button type="button" className="btn btn--primary rdv-next" onClick={next}>
                  Continuer
                  <ArrowRight />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const fieldId = (key: string) => `aff-${key.replace(/\./g, '-')}`;

function describedBy(key: string, hint?: string, error?: string) {
  return [hint ? `${fieldId(key)}-hint` : null, error ? `${fieldId(key)}-error` : null].filter(Boolean).join(' ') || undefined;
}

function FieldMessages({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {hint ? (
        <p className="form__note" id={`${fieldId(id)}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="rdv-error" id={`${fieldId(id)}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function Label({ id, label, optional }: { id: string; label: string; optional?: boolean }) {
  return (
    <label htmlFor={fieldId(id)}>
      {label}
      {optional ? <span className="aff-optional"> (facultatif)</span> : <span className="req" aria-hidden="true"> *</span>}
    </label>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  type?: 'text' | 'email' | 'tel' | 'url';
  autoComplete?: string;
  inputMode?: 'email' | 'tel' | 'url' | 'text';
  placeholder?: string;
}) {
  return (
    <div className="field">
      <Label id={props.id} label={props.label} optional={props.optional} />
      <input
        id={fieldId(props.id)}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        required={!props.optional}
        aria-required={!props.optional}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(props.id, props.hint, props.error)}
      />
      <FieldMessages id={props.id} hint={props.hint} error={props.error} />
    </div>
  );
}

function TextArea(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
}) {
  return (
    <div className="field">
      <Label id={props.id} label={props.label} optional={props.optional} />
      <textarea
        id={fieldId(props.id)}
        rows={4}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        required={!props.optional}
        aria-required={!props.optional}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(props.id, props.hint, props.error)}
      />
      <FieldMessages id={props.id} hint={props.hint} error={props.error} />
    </div>
  );
}

/**
 * Choix exclusif présenté en cartes. Un vrai groupe de boutons radio, pour que
 * le clavier et les lecteurs d'écran le traitent comme tel : flèches pour
 * changer, une seule tabulation pour entrer et sortir.
 */
function ChoiceGroup(props: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string; description?: string }[];
  onChange: (value: string) => void;
  error?: string;
  compact?: boolean;
}) {
  return (
    <fieldset className="aff-choices" aria-describedby={props.error ? `${fieldId(props.id)}-error` : undefined}>
      <legend className="aff-choices__legend">
        {props.label}
        <span className="req" aria-hidden="true"> *</span>
      </legend>
      <div className={`rdv-options${props.compact ? ' aff-options--compact' : ''}`}>
        {props.options.map((option, optionIndex) => {
          const checked = props.value === option.value;
          return (
            <label key={option.value} className={`rdv-opt aff-opt${checked ? ' is-picked' : ''}`}>
              <input
                type="radio"
                className="aff-opt__input"
                name={fieldId(props.id)}
                id={optionIndex === 0 ? fieldId(props.id) : undefined}
                value={option.value}
                checked={checked}
                onChange={() => props.onChange(option.value)}
              />
              <span className="rdv-opt__mark" aria-hidden="true" />
              <span className="rdv-opt__label">
                <strong className="aff-opt__title">{option.label}</strong>
                {option.description ? <span className="aff-opt__desc">{option.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {props.error ? (
        <p className="rdv-error" id={`${fieldId(props.id)}-error`} role="alert">
          {props.error}
        </p>
      ) : null}
    </fieldset>
  );
}

function Recap({
  draft,
  method,
  onEdit,
  onConsent,
  errors,
}: {
  draft: ApplicationDraft;
  method: PayoutMethodOption | null;
  onEdit: (step: StepKey) => void;
  onConsent: (value: boolean) => void;
  errors: FieldErrors;
}) {
  const questions = draft.profile ? PROFILE_QUESTIONS[draft.profile] : [];
  const groups: { step: StepKey; title: string; rows: { label: string; value: string }[] }[] = [
    {
      step: 'identite',
      title: 'Vous',
      rows: [
        { label: 'Nom', value: `${draft.firstName} ${draft.lastName}` },
        { label: 'E-mail', value: draft.email },
        { label: 'WhatsApp ou téléphone', value: draft.phone },
        { label: 'Lieu', value: `${draft.city}, ${draft.country}` },
      ],
    },
    {
      step: 'profil',
      title: 'Profil',
      rows: [{ label: 'Profil', value: draft.profile ? PROFILE_LABELS[draft.profile] : '—' }],
    },
    {
      step: 'potentiel',
      title: 'Potentiel',
      rows: questions
        .filter((question) => (draft.answers[question.key] ?? '').trim())
        .map((question) => ({ label: question.label, value: draft.answers[question.key]!.trim() })),
    },
    {
      step: 'motivation',
      title: 'Motivation',
      rows: [
        { label: 'Votre façon de recommander', value: draft.motivation },
        ...(draft.idea.trim() ? [{ label: 'Idée de collaboration', value: draft.idea }] : []),
      ],
    },
    {
      step: 'paiement',
      title: 'Versements',
      rows: [
        { label: 'Moyen souhaité', value: method?.label ?? '—' },
        ...(method
          ? PAYOUT_FIELDS[method.kind].map((fieldDef) => ({
              label: fieldDef.label,
              value: draft.payoutDetails[fieldDef.key] ?? '',
            }))
          : []),
      ],
    },
  ];

  return (
    <div className="aff-recap">
      {groups.map((group) =>
        group.rows.length === 0 ? null : (
          <section key={group.step} className="aff-recap__group" aria-label={group.title}>
            <div className="aff-recap__head">
              <h3>{group.title}</h3>
              <button type="button" className="rdv-edit" onClick={() => onEdit(group.step)}>
                Modifier<span className="sr-only"> — {group.title}</span>
              </button>
            </div>
            <ul className="rdv-recap">
              {group.rows.map((row) => (
                <li key={row.label}>
                  <span className="rdv-recap__k">{row.label}</span>
                  <span className="rdv-recap__v">{row.value || '—'}</span>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}

      <div className="aff-consent">
        <input
          type="checkbox"
          id={fieldId('consent')}
          checked={draft.consent}
          onChange={(event) => onConsent(event.target.checked)}
          aria-invalid={errors.consent ? true : undefined}
          aria-describedby={errors.consent ? `${fieldId('consent')}-error` : undefined}
        />
        <label htmlFor={fieldId('consent')}>
          J’accepte que MORA Shawiri utilise ces informations pour étudier ma candidature et, si elle est retenue,
          pour gérer ma participation au programme d’affiliation, conformément à la{' '}
          <a href="/politique-de-confidentialite/" target="_blank" rel="noopener noreferrer">
            politique de confidentialité
          </a>
          . Je comprends qu’une candidature ne vaut pas inscription.
        </label>
      </div>
      {errors.consent ? (
        <p className="rdv-error" id={`${fieldId('consent')}-error`} role="alert">
          {errors.consent}
        </p>
      ) : null}
    </div>
  );
}
