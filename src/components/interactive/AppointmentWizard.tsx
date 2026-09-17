'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Whatsapp } from '@/components/ui/Icon';
import {
  isChoiceStep,
  rdvIntro,
  rdvLabels,
  rdvOutro,
  rdvSteps,
  type InputStep,
} from '@/content/rendez-vous';
import { whatsappLink } from '@/lib/site';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Formate une date ISO en date longue française. */
function prettyDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type SendStatus = 'idle' | 'sending' | 'sent' | 'error';

/** Messages d'erreur renvoyés par la route serveur, traduits pour le visiteur. */
const SERVER_MESSAGES: Record<string, string> = {
  rate_limited:
    'Plusieurs demandes ont été envoyées coup sur coup. Patientez quelques minutes avant de réessayer, ou écrivez-nous sur WhatsApp.',
  mail_disabled:
    'Notre service d’envoi est momentanément indisponible. Votre demande n’a pas été transmise : écrivez-nous sur WhatsApp, nous la prendrons immédiatement.',
  send_failed:
    'Votre demande n’a pas pu être transmise. Vos réponses sont conservées : réessayez, ou passez par WhatsApp.',
  invalid_email: 'L’adresse e-mail saisie n’a pas été acceptée. Modifiez-la puis réessayez.',
};

const GENERIC_ERROR =
  'Votre demande n’a pas pu être envoyée. Vos réponses sont conservées : réessayez, ou écrivez-nous sur WhatsApp.';

/**
 * Prise de rendez-vous conversationnelle.
 *
 * Une question à la fois, réponses modifiables, récapitulatif final, puis envoi
 * réel vers la route serveur `/api/contact` : la demande est notifiée à l'équipe
 * et un accusé de réception part vers le demandeur (`08_EMAILS` § 15). La
 * confirmation n'est affichée qu'après un succès avéré ; WhatsApp est proposé
 * ensuite, comme copie facultative. Aucune donnée n'est stockée : l'état du
 * questionnaire vit uniquement dans la page.
 */
export default function AppointmentWizard() {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** Saisies brutes des champs libres : elles servent aussi de valeur affichée. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** L'erreur est rattachée à une question : changer d'étape la masque sans effet. */
  const [fieldError, setFieldError] = useState<{ step: string; message: string } | null>(null);
  const [sendStatus, setSendStatus] = useState<SendStatus>('idle');
  const [sendMessage, setSendMessage] = useState('');

  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);
  const isDone = index >= rdvSteps.length;
  const step = isDone ? null : rdvSteps[index]!;
  const draft = step ? (drafts[step.name] ?? '') : '';
  const error = step && fieldError?.step === step.name ? fieldError.message : null;
  /** Le champ est décrit par son indice et, le cas échéant, par son message d'erreur. */
  const describedBy = step
    ? [step.hint ? `rdv-${step.name}-hint` : null, error ? `rdv-${step.name}-error` : null]
        .filter(Boolean)
        .join(' ') || undefined
    : undefined;

  // Le focus est un effet de bord sur le DOM, pas un état dérivé.
  useEffect(() => {
    if (window.innerWidth > 900) fieldRef.current?.focus({ preventScroll: true });
  }, [index]);

  // La confirmation d'envoi est un changement d'état majeur : elle prend le focus.
  useEffect(() => {
    if (sendStatus === 'sent') sentRef.current?.focus();
  }, [sendStatus]);

  const commit = (name: string, value: string) => {
    setAnswers((current) => ({ ...current, [name]: value }));
    setIndex((current) => current + 1);
  };

  const goTo = (target: number) => {
    setIndex(Math.max(0, target));
  };

  const updateDraft = (name: string, value: string) => {
    setDrafts((current) => ({ ...current, [name]: value }));
    setFieldError((current) => (current?.step === name ? null : current));
  };

  const submitInput = (inputStep: InputStep) => {
    const value = draft.trim();
    const fail = (message: string) => {
      setFieldError({ step: inputStep.name, message });
      fieldRef.current?.focus();
    };

    if (!value && !inputStep.optional) return fail(rdvLabels.required);
    if (value && inputStep.type === 'email' && !EMAIL_PATTERN.test(value)) {
      return fail(rdvLabels.invalidEmail);
    }
    if (value && inputStep.type === 'tel' && value.replace(/\D/g, '').length < 6) {
      return fail(rdvLabels.invalidPhone);
    }

    setDrafts((current) => ({ ...current, [inputStep.name]: value }));

    if (value && inputStep.type === 'date') {
      commit(inputStep.name, prettyDate(value));
      return;
    }
    commit(inputStep.name, value || inputStep.emptyValue || '—');
  };

  const restart = () => {
    setAnswers({});
    setDrafts({});
    setFieldError(null);
    setSendStatus('idle');
    setSendMessage('');
    setIndex(0);
  };

  /**
   * Transmet la demande à la route serveur et attend sa réponse.
   * Aucun message de succès n'est affiché sans un `200` (`06_CONTACT.md` § 71).
   */
  const send = async () => {
    if (sendStatus === 'sending') return; // Double soumission impossible.
    setSendStatus('sending');
    setSendMessage('');

    // Les réponses hors coordonnées deviennent les lignes « l'essentiel » de l'e-mail.
    const identity = new Set(['sujet', 'nom', 'organisation', 'telephone', 'email', 'contexte']);
    const details = rdvSteps
      .filter((item) => !identity.has(item.name) && answers[item.name])
      .map((item) => ({ label: item.label, value: answers[item.name]! }));

    const payload = {
      kind: 'rendez-vous' as const,
      nom: answers.nom ?? '',
      organisation: answers.organisation ?? '',
      email: answers.email ?? '',
      telephone: answers.telephone ?? '',
      sujet: answers.sujet ?? 'Prise de rendez-vous',
      budget: answers.budget ?? '',
      offre: '',
      message: answers.contexte ?? '—',
      details,
      website: '',
    };

    try {
      // Slash final : `trailingSlash` est activé, une URL sans slash serait redirigée.
      const response = await fetch('/api/contact/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setSendStatus('sent');
        return;
      }

      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setSendMessage(SERVER_MESSAGES[body?.error ?? ''] ?? GENERIC_ERROR);
      setSendStatus('error');
    } catch {
      setSendMessage(GENERIC_ERROR);
      setSendStatus('error');
    }
  };

  const answeredCount = Math.min(index, rdvSteps.length);
  const progress = rdvSteps.length > 0 ? Math.round((answeredCount / rdvSteps.length) * 100) : 100;

  /**
   * Message WhatsApp du récapitulatif.
   * Après l'envoi, il s'annonce comme une copie : l'équipe reconnaît ainsi un
   * doublon volontaire et ne traite pas la demande deux fois.
   */
  const message = (isCopy: boolean) => {
    const lines = [
      isCopy ? 'Copie de ma demande de rendez-vous envoyée depuis le site MORA Shawiri.' : rdvIntro,
      '',
    ];
    for (const item of rdvSteps) {
      const value = answers[item.name];
      if (!value) continue;
      lines.push(`${item.label} : ${value}`);
    }
    if (!isCopy) lines.push('', rdvOutro);
    return lines.join('\n').trim();
  };

  return (
    <div className="rdv-panel">
      <div className="rdv-panel__head">
        <div className="rdv-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <p className="rdv-count">
          Question <span>{Math.min(index + 1, rdvSteps.length)}</span> sur{' '}
          <span>{rdvSteps.length}</span>
        </p>
      </div>

      {/* Historique des réponses déjà données, chacune modifiable. */}
      {answeredCount > 0 && (
        <div className="rdv-log" aria-live="polite">
          {rdvSteps.slice(0, index).map((item, itemIndex) => {
            const value = answers[item.name];
            if (!value) return null;
            return (
              <div className="rdv-exchange" key={item.name}>
                <p className="rdv-bubble rdv-bubble--q">{item.question}</p>
                <p className="rdv-bubble rdv-bubble--a">
                  <span>{value}</span>
                  <button type="button" className="rdv-edit" onClick={() => goTo(itemIndex)}>
                    {rdvLabels.edit}
                  </button>
                </p>
              </div>
            );
          })}
        </div>
      )}

      <div className="rdv-stage">
        {step ? (
          <div className="rdv-step is-in" key={step.name}>
            {/* Étape à champ libre : la question est le libellé réel du champ.
                Étape à choix : aucun champ à nommer, la question reste un paragraphe. */}
            {isChoiceStep(step) ? (
              <p className="rdv-q">{step.question}</p>
            ) : (
              <label className="rdv-q" htmlFor={`rdv-${step.name}`}>
                {step.question}
              </label>
            )}
            {step.hint ? (
              <p className="rdv-hint" id={`rdv-${step.name}-hint`}>
                {step.hint}
              </p>
            ) : null}

            {isChoiceStep(step) ? (
              <div className="rdv-options">
                {step.options.map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={`rdv-opt${answers[step.name] === option ? ' is-picked' : ''}`}
                    onClick={() => commit(step.name, option)}
                  >
                    <span className="rdv-opt__mark" aria-hidden="true" />
                    <span className="rdv-opt__label">{option}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rdv-field">
                {step.type === 'textarea' ? (
                  <textarea
                    className="rdv-input"
                    id={`rdv-${step.name}`}
                    ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
                    rows={4}
                    placeholder={step.placeholder}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    value={draft}
                    onChange={(event) => updateDraft(step.name, event.target.value)}
                  />
                ) : (
                  <input
                    className="rdv-input"
                    id={`rdv-${step.name}`}
                    ref={fieldRef as React.RefObject<HTMLInputElement>}
                    type={step.type}
                    {...(step.type === 'date' ? { min: todayIso() } : {})}
                    {...(step.inputMode ? { inputMode: step.inputMode } : {})}
                    {...(step.autoComplete ? { autoComplete: step.autoComplete } : {})}
                    placeholder={step.placeholder}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    value={draft}
                    onChange={(event) => updateDraft(step.name, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      submitInput(step);
                    }}
                  />
                )}
                {/* Inséré seulement en cas d'erreur : `role="alert"` n'annonce
                    de façon fiable qu'une apparition dans le DOM. */}
                {error && (
                  <p className="rdv-error" id={`rdv-${step.name}-error`} role="alert">
                    {error}
                  </p>
                )}
              </div>
            )}

            <div className="rdv-actions">
              {index > 0 && (
                <button type="button" className="rdv-back" onClick={() => goTo(index - 1)}>
                  <ArrowLeft />
                  {rdvLabels.back}
                </button>
              )}
              {!isChoiceStep(step) && (
                <div className="rdv-actions__right">
                  {step.optional && (
                    <button
                      type="button"
                      className="rdv-skip"
                      onClick={() => commit(step.name, step.emptyValue || '—')}
                    >
                      {rdvLabels.skip}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--primary rdv-next"
                    onClick={() => submitInput(step)}
                  >
                    {rdvLabels.next}
                    <ArrowRight />
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            className="rdv-step rdv-done is-in"
            {...(sendStatus === 'sent'
              ? { role: 'status', tabIndex: -1, ref: sentRef, 'aria-label': 'Confirmation d’envoi' }
              : {})}
          >
            <div className="rdv-done__head">
              <span className="rdv-done__icon" aria-hidden="true">
                <Check size={16} strokeWidth={3} />
              </span>
              <h2>{sendStatus === 'sent' ? rdvLabels.sentTitle : rdvLabels.doneTitle}</h2>
            </div>
            <p className="rdv-done__lead">
              {sendStatus === 'sent' ? rdvLabels.sentLead : rdvLabels.doneLead}
            </p>

            {sendStatus === 'error' && (
              <div className="form-alert" role="alert">
                <strong>{rdvLabels.errorTitle}</strong>
                <span>{sendMessage || GENERIC_ERROR}</span>
              </div>
            )}

            <ul className="rdv-recap">
              {rdvSteps.map((item, itemIndex) => {
                const value = answers[item.name];
                if (!value) return null;
                return (
                  <li key={item.name}>
                    <span className="rdv-recap__k">{item.label}</span>
                    <span className="rdv-recap__v">{value}</span>
                    {sendStatus !== 'sent' && (
                      <button type="button" className="rdv-edit" onClick={() => goTo(itemIndex)}>
                        {rdvLabels.edit}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            {sendStatus === 'sent' ? (
              <>
                <p className="form-done__ask">{rdvLabels.sentAsk}</p>
                <a
                  className="btn btn--gold btn--lg rdv-send"
                  href={whatsappLink(message(true))}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Whatsapp size={20} />
                  {rdvLabels.whatsappCopyLabel}
                </a>
                <p className="rdv-done__note">{rdvLabels.sentNote}</p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn--gold btn--lg rdv-send"
                  onClick={send}
                  disabled={sendStatus === 'sending'}
                >
                  {sendStatus === 'sending' ? (
                    <>
                      <span className="btn__spinner" aria-hidden="true" />
                      {rdvLabels.sendingLabel}
                    </>
                  ) : (
                    <>
                      <ArrowRight />
                      {sendStatus === 'error' ? rdvLabels.retryLabel : rdvLabels.sendLabel}
                    </>
                  )}
                </button>

                {sendStatus === 'error' && (
                  <a
                    className="btn btn--ghost rdv-send"
                    href={whatsappLink(message(false))}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Whatsapp size={20} />
                    {rdvLabels.whatsappFallbackLabel}
                  </a>
                )}

                <p className="rdv-done__note">{rdvLabels.doneNote}</p>
              </>
            )}

            <button type="button" className="rdv-back rdv-restart" onClick={restart}>
              {rdvLabels.restart}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
