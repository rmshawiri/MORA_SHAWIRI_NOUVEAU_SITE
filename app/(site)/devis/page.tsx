"use client";

import { Suspense, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
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
      <div className="bg-gray-structure">
        <div className="mx-auto max-w-lg px-4 py-20 sm:px-6">
          <div className="rounded-3xl bg-white p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
              ✓
            </div>
            <h1 className="mt-4 font-display text-2xl font-bold text-gray-900">
              Votre demande a bien été envoyée.
            </h1>
            <p className="mt-2 text-gray-600">
              Nous avons bien reçu les informations concernant votre projet. MORA Shawiri pourra
              revenir vers vous avec les prochaines étapes.
            </p>
            {result.reference && (
              <p className="mt-4 text-sm font-mono text-gray-500">
                Référence : {result.reference}
              </p>
            )}
            <div className="mt-6">
              <Button href="/services" variant="secondary" size="md">
                Retour aux services
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-structure">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-bold text-gray-900">Demander un devis</h1>
        <p className="mt-2 text-gray-600">
          Parlons de votre projet. Répondez à quelques questions pour que MORA Shawiri comprenne
          votre besoin.
        </p>

        {/* Progression */}
        <ol className="mt-6 flex flex-wrap items-center gap-2 text-sm text-gray-500">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                  i < step ? "bg-mora-green text-white" : i === step ? "bg-mora-blue text-white" : "bg-gray-200 text-gray-600",
                )}
              >
                {i + 1}
              </span>
              <span className={cn(i === step ? "font-semibold text-mora-blue" : "")}>{s}</span>
              {i < steps.length - 1 && <span className="text-gray-300">·</span>}
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-3xl bg-white p-6 sm:p-8">
          {step === 0 && (
            <div>
              <h2 className="font-display text-lg font-bold text-gray-900">Quel service vous intéresse ?</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {services.map((s) => (
                  <label
                    key={s.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition-colors",
                      serviceSlug === s.slug ? "border-mora-blue bg-mora-blue-20 text-mora-blue" : "border-gray-200 hover:border-mora-blue",
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
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="font-display text-lg font-bold text-gray-900">Parlez-nous de votre projet</h2>
              <label className="mt-4 block text-sm font-medium text-gray-700">
                Décrivez votre besoin
                <textarea
                  value={projectInfo}
                  onChange={(e) => setProjectInfo(e.target.value)}
                  rows={4}
                  placeholder="Quel est votre projet, votre objectif, votre activité ?"
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none"
                />
              </label>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="font-display text-lg font-bold text-gray-900">Comment vous contacter ?</h2>
              <div className="mt-4 space-y-4">
                <label className="block text-sm font-medium text-gray-700">
                  Nom
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none"
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Téléphone / WhatsApp
                  <input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none"
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Email (facultatif)
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none"
                  />
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="font-display text-lg font-bold text-gray-900">Informations complémentaires</h2>
              <label className="mt-4 block text-sm font-medium text-gray-700">
                Message (obligatoire)
                <textarea
                  value={freeMessage}
                  onChange={(e) => setFreeMessage(e.target.value)}
                  rows={4}
                  placeholder="Ajoutez toute information que vous souhaitez nous communiquer concernant votre demande."
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none"
                />
              </label>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="font-display text-lg font-bold text-gray-900">Récapitulatif</h2>
              <dl className="mt-4 space-y-3 rounded-xl bg-gray-structure p-5 text-sm">
                <div><dt className="font-semibold text-gray-500">Service</dt><dd className="text-gray-800">{selected?.name ?? "—"}</dd></div>
                <div><dt className="font-semibold text-gray-500">Besoin</dt><dd className="text-gray-800">{projectInfo}</dd></div>
                <div><dt className="font-semibold text-gray-500">Nom</dt><dd className="text-gray-800">{contactName}</dd></div>
                <div><dt className="font-semibold text-gray-500">Téléphone</dt><dd className="text-gray-800">{contactPhone}</dd></div>
                {contactEmail && <div><dt className="font-semibold text-gray-500">Email</dt><dd className="text-gray-800">{contactEmail}</dd></div>}
                <div><dt className="font-semibold text-gray-500">Message</dt><dd className="text-gray-800">{freeMessage}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-gray-500">
                Vérifiez les informations avant d&apos;envoyer. Vous pouvez revenir en arrière.
              </p>
            </div>
          )}

          {result && !result.success && (
            <p className="mt-4 rounded-xl bg-error-soft p-3 text-sm text-error">{result.error}</p>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              variant="ghost"
              size="md"
              className={step === 0 ? "pointer-events-none opacity-0" : ""}
            >
              Précédent
            </Button>
            {step < steps.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} variant="primary" size="md" disabled={!canNext()}>
                Continuer
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
