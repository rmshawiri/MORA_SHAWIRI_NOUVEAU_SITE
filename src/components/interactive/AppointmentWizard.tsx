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

/**
 * Prise de rendez-vous conversationnelle.
 *
 * Une question à la fois, réponses modifiables, récapitulatif final puis envoi
 * sur WhatsApp. Aucun envoi serveur, aucune donnée stockée : l'état vit
 * uniquement dans la page.
 */
export default function AppointmentWizard() {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** Saisies brutes des champs libres : elles servent aussi de valeur affichée. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** L'erreur est rattachée à une question : changer d'étape la masque sans effet. */
  const [fieldError, setFieldError] = useState<{ step: string; message: string } | null>(null);

  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const isDone = index >= rdvSteps.length;
  const step = isDone ? null : rdvSteps[index]!;
  const draft = step ? (drafts[step.name] ?? '') : '';
  const error = step && fieldError?.step === step.name ? fieldError.message : null;

  // Le focus est un effet de bord sur le DOM, pas un état dérivé.
  useEffect(() => {
    if (window.innerWidth > 900) fieldRef.current?.focus({ preventScroll: true });
  }, [index]);

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
    setIndex(0);
  };

  const answeredCount = Math.min(index, rdvSteps.length);
  const progress = rdvSteps.length > 0 ? Math.round((answeredCount / rdvSteps.length) * 100) : 100;

  const message = () => {
    const lines = [rdvIntro, ''];
    for (const item of rdvSteps) {
      const value = answers[item.name];
      if (!value) continue;
      lines.push(`${item.label} : ${value}`);
    }
    lines.push('', rdvOutro);
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
            <p className="rdv-q">{step.question}</p>
            {step.hint ? <p className="rdv-hint">{step.hint}</p> : null}

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
                    aria-label={step.question}
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
                    aria-label={step.question}
                    value={draft}
                    onChange={(event) => updateDraft(step.name, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      submitInput(step);
                    }}
                  />
                )}
                <p className="rdv-error" hidden={!error}>
                  {error}
                </p>
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
          <div className="rdv-step rdv-done is-in">
            <div className="rdv-done__head">
              <span className="rdv-done__icon" aria-hidden="true">
                <Check size={16} strokeWidth={3} />
              </span>
              <h2>{rdvLabels.doneTitle}</h2>
            </div>
            <p className="rdv-done__lead">{rdvLabels.doneLead}</p>

            <ul className="rdv-recap">
              {rdvSteps.map((item, itemIndex) => {
                const value = answers[item.name];
                if (!value) return null;
                return (
                  <li key={item.name}>
                    <span className="rdv-recap__k">{item.label}</span>
                    <span className="rdv-recap__v">{value}</span>
                    <button type="button" className="rdv-edit" onClick={() => goTo(itemIndex)}>
                      {rdvLabels.edit}
                    </button>
                  </li>
                );
              })}
            </ul>

            <a
              className="btn btn--gold btn--lg rdv-send"
              href={whatsappLink(message())}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Whatsapp size={20} />
              {rdvLabels.sendLabel}
            </a>

            <p className="rdv-done__note">{rdvLabels.doneNote}</p>

            <button type="button" className="rdv-back rdv-restart" onClick={restart}>
              {rdvLabels.restart}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
