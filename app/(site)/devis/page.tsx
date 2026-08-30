"use client";

import { Suspense, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { services, type Service } from "@/lib/data/services";
import { createQuoteRequest, type QuoteRequestResult } from "@/app/actions/quote";
import { cn } from "@/lib/utils";

const steps = ["Service", "Votre besoin", "Contact", "Message", "Récapitulatif"];

export default function DevisPage() {
  return (
    <Suspense fallback={<p className="px-6 py-20 text-center text-gray-500">Chargement…</p>}>
      <DevisForm />
    </Suspense>
  );
}

function DevisForm() {
  const searchParams = useSearchParams();
  const preselected = searchParams.get("service") ?? "";

  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();

  const [serviceSlug, setServiceSlug] = useState(preselected);
  const [projectInfo, setProjectInfo] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [freeMessage, setFreeMessage] = useState("");
  const [result, setResult] = useState<QuoteRequestResult | null>(null);

  const selected: Service | undefined = services.find((s) => s.slug === serviceSlug);
  const progress = ((step + 1) / steps.length) * 100;

  function canNext() {
    if (step === 0) return Boolean(selected);
    if (step === 1) return projectInfo.trim().length >= 2;
    if (step === 2) return contactName.trim().length >= 2 && contactPhone.trim().length >= 6;
    if (step === 3) return freeMessage.trim().length >= 5;
    return true;
  }

  function submit() {
    startTransition(async () => {
      const res = await createQuoteRequest({
        serviceSlug,
        contactName,
        contactPhone,
        contactEmail: contactEmail || undefined,
        projectInfo,
        freeMessage,
      });
      setResult(res);
    });
  }

  if (result?.success) {
    return (
      <div className="bg-surface">
        <div className="mx-auto max-w-lg px-4 py-20 sm:px-6">
          <div className="surface-card rounded-3xl p-8 text-center animate-fade-up">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success ring-8 ring-success-soft/50">
              <svg aria-hidden className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold text-gray-900">Votre demande a bien été envoyée.</h1>
            <p className="mt-2 leading-relaxed text-gray-600">
              Nous avons bien reçu les informations concernant votre projet. MORA Shawiri pourra
              revenir vers vous avec les prochaines étapes.
            </p>
            {result.reference && (
              <p className="mx-auto mt-5 w-fit rounded-full bg-gray-100 px-4 py-2 font-mono text-sm tabular-nums text-gray-700">
                Référence : <span className="font-semibold text-mora-blue">{result.reference}</span>
              </p>
            )}
            <div className="mt-7">
              <Button href="/services" variant="secondary" size="md">Retour aux services</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface">
      <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
        <div className="mb-8">
          <Badge tone="blue">Devis</Badge>
          <h1 className="mt-3 font-display text-3xl font-bold text-gray-900 sm:text-4xl">Demander un devis</h1>
          <p className="mt-2 max-w-xl leading-relaxed text-gray-600">
            Parlons de votre projet. Répondez à quelques questions pour que MORA Shawiri comprenne
            votre besoin.
          </p>
        </div>

        {/* Progression */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold">
            <span className="rounded-full bg-mora-blue px-3 py-1.5 text-white">Étape {step + 1} sur {steps.length}</span>
            <span className="text-mora-blue">{steps[step]}</span>
          </div>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200"
            role="progressbar"
            aria-label="Progression de la demande de devis"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={step + 1}
          >
            <div
              className="h-full rounded-full bg-mora-gradient transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <ol className="mt-5 hidden flex-wrap items-center gap-2 sm:flex" aria-label="Étapes du devis">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                    i < step
                      ? "bg-mora-blue text-white"
                      : i === step
                        ? "bg-mora-blue-20 text-mora-blue ring-1 ring-mora-blue-40"
                        : "bg-gray-100 text-gray-500",
                  )}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                <span
                  className={cn(
                    "text-sm transition-colors",
                    i === step ? "font-semibold text-mora-blue" : i < step ? "text-gray-700" : "text-gray-500",
                  )}
                >
                  {s}
                </span>
                {i < steps.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-gray-200" />}
              </li>
            ))}
          </ol>
        </div>

        {/* Panneau d'étape */}
        <div key={step} className="surface-card rounded-2xl p-6 animate-fade-in sm:p-8">
          {step === 0 && (
            <div>
              <h2 className="font-display text-lg font-bold text-gray-900">Quel service vous intéresse ?</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {services.map((s) => (
                  <label
                    key={s.id}
                    className={cn(
                      "group flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-all focus-within:border-mora-blue focus-within:ring-2 focus-within:ring-mora-blue-20",
                      serviceSlug === s.slug
                        ? "border-mora-blue bg-mora-blue-10 text-mora-blue shadow-soft"
                        : "border-gray-200 text-gray-700 hover:border-mora-blue-40 hover:bg-gray-50",
                    )}
                  >
                    <input
                      type="radio"
                      name="service"
                      value={s.slug}
                      checked={serviceSlug === s.slug}
                      onChange={() => setServiceSlug(s.slug)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                        serviceSlug === s.slug ? "border-mora-blue bg-mora-blue" : "border-gray-300 bg-white",
                      )}
                    >
                      {serviceSlug === s.slug && <span className="h-2 w-2 rounded-full bg-white" />}
                    </span>
                    <span className={cn("font-medium", serviceSlug === s.slug ? "text-mora-blue" : "text-gray-800")}>
                      {s.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="font-display text-lg font-bold text-gray-900">Parlez-nous de votre projet</h2>
              <Field label="Décrivez votre besoin" className="mt-4">
                <Textarea
                  value={projectInfo}
                  onChange={(e) => setProjectInfo(e.target.value)}
                  rows={5}
                  placeholder="Quel est votre projet, votre objectif, votre activité ?"
                />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="font-display text-lg font-bold text-gray-900">Comment vous contacter ?</h2>
              <div className="mt-4 space-y-4">
                <Field label="Nom">
                  <Input value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="name" placeholder="Votre nom complet" />
                </Field>
                <Field label="Téléphone / WhatsApp">
                  <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} type="tel" autoComplete="tel" placeholder="+269 …" />
                </Field>
                <Field label="Email (facultatif)">
                  <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} autoComplete="email" placeholder="vous@exemple.com" />
                </Field>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="font-display text-lg font-bold text-gray-900">Informations complémentaires</h2>
              <Field label="Message (obligatoire)" className="mt-4">
                <Textarea
                  value={freeMessage}
                  onChange={(e) => setFreeMessage(e.target.value)}
                  rows={5}
                  placeholder="Ajoutez toute information que vous souhaitez nous communiquer concernant votre demande."
                />
              </Field>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="font-display text-lg font-bold text-gray-900">Récapitulatif</h2>
              <dl className="mt-4 space-y-5 rounded-2xl border border-gray-100 bg-gray-50/70 p-5 sm:p-6">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Service</dt>
                  <dd className="mt-1 text-sm font-semibold text-gray-900">{selected?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Besoin</dt>
                  <dd className="mt-1 whitespace-pre-line text-sm text-gray-700">{projectInfo}</dd>
                </div>
                <div className="grid gap-5 border-t border-gray-200 pt-5 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Nom</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-900">{contactName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Téléphone</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-900">{contactPhone}</dd>
                  </div>
                  {contactEmail && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Email</dt>
                      <dd className="mt-1 text-sm font-medium text-gray-900">{contactEmail}</dd>
                    </div>
                  )}
                </div>
                <div className="border-t border-gray-200 pt-5">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Message</dt>
                  <dd className="mt-1 whitespace-pre-line text-sm text-gray-700">{freeMessage}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-gray-500">
                Vérifiez les informations avant d&apos;envoyer. Vous pouvez revenir en arrière.
              </p>
            </div>
          )}

          {result && !result.success && (
            <p role="alert" className="mt-4 rounded-xl border border-error/20 bg-error-soft px-4 py-3 text-sm text-error">
              {result.error}
            </p>
          )}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-gray-100 pt-6">
            <Button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              variant="ghost"
              size="md"
              className={step === 0 ? "pointer-events-none opacity-0" : ""}
            >
              ← Précédent
            </Button>
            {step < steps.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} variant="primary" size="md" disabled={!canNext()}>
                Continuer →
              </Button>
            ) : (
              <Button onClick={submit} variant="primary" size="md" disabled={pending}>
                {pending ? "Envoi..." : "Envoyer ma demande"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
