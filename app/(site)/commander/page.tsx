"use client";

import { Suspense, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { services, priceLabel, type Service } from "@/lib/data/services";
import { paymentMethods, type PaymentMethodId } from "@/lib/data/payments";
import { createOrder, type CreateOrderResult } from "@/app/actions/order";
import { cn } from "@/lib/utils";

export default function CommanderPage() {
  return (
    <Suspense fallback={<p className="px-6 py-20 text-center text-gray-500">Chargement…</p>}>
      <CommanderForm />
    </Suspense>
  );
}

function StepCard({ step, title, subtitle, className, children }: { step: string; title: string; subtitle?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("surface-card rounded-2xl p-6 sm:p-7", className)}>
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-mora-blue font-display text-sm font-bold text-mora-or">
          {step}
        </span>
        <div>
          <h2 className="font-display text-lg font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm leading-relaxed text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function CommanderForm() {
  const searchParams = useSearchParams();
  const preselected = searchParams.get("service") ?? "";

  const [pending, startTransition] = useTransition();
  const [serviceSlug, setServiceSlug] = useState(preselected);
  const [quantity, setQuantity] = useState(1);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>("mvola");
  const [result, setResult] = useState<CreateOrderResult | null>(null);

  const service: Service | undefined = services.find((s) => s.slug === serviceSlug);
  const isUnit = service?.priceType === "unit";
  const total = service ? (service.price ?? 0) * quantity : 0;

  function submit() {
    startTransition(async () => {
      const res = await createOrder({
        serviceSlug,
        quantity,
        contactName,
        contactPhone,
        contactEmail: contactEmail || undefined,
        paymentMethod,
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
            <h1 className="mt-5 font-display text-2xl font-bold text-gray-900">Commande enregistrée</h1>
            <p className="mt-3 leading-relaxed text-gray-600">
              Votre commande a bien été enregistrée. Le paiement est en attente de vérification par
              MORA Shawiri.
            </p>
            {result.orderNumber && (
              <p className="mx-auto mt-5 w-fit rounded-full bg-gray-100 px-4 py-2 font-mono text-sm tabular-nums text-gray-700">
                Référence : <span className="font-semibold text-mora-blue">{result.orderNumber}</span>
              </p>
            )}
            <div className="mt-6 rounded-2xl border border-warning/25 bg-warning-soft p-4 text-left text-sm leading-relaxed text-gray-700">
              <p>
                <strong className="text-warning">Important :</strong> votre déclaration de paiement
                n&apos;est pas encore confirmée. Vous serez informé après vérification. Conservez
                cette référence.
              </p>
            </div>
            <div className="mt-7">
              <Button href="/boutique" variant="secondary" size="md">Retour à la boutique</Button>
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
          <Badge tone="blue">Commande</Badge>
          <h1 className="mt-3 font-display text-3xl font-bold text-gray-900 sm:text-4xl">Commander</h1>
          <p className="mt-2 max-w-xl leading-relaxed text-gray-600">Finalisez votre commande en quelques étapes.</p>
        </div>

        {/* Choix du service */}
        <StepCard step="1" title="Service" subtitle="Choisissez la prestation à commander">
          <div className="grid gap-2 sm:grid-cols-2">
            {services.filter((s) => s.directPurchase).map((s) => (
              <label
                key={s.id}
                className={cn(
                  "group flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-all focus-within:border-mora-blue focus-within:ring-2 focus-within:ring-mora-blue-20",
                  serviceSlug === s.slug
                    ? "border-mora-blue bg-mora-blue-10 text-mora-blue shadow-soft"
                    : "border-gray-200 text-gray-700 hover:border-mora-blue-40 hover:bg-gray-50",
                )}
              >
                <input type="radio" name="service" value={s.slug} checked={serviceSlug === s.slug} onChange={() => setServiceSlug(s.slug)} className="sr-only" />
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                    serviceSlug === s.slug ? "border-mora-blue bg-mora-blue" : "border-gray-300 bg-white",
                  )}
                >
                  {serviceSlug === s.slug && <span className="h-2 w-2 rounded-full bg-white" />}
                </span>
                <span className={cn("font-medium", serviceSlug === s.slug ? "text-mora-blue" : "text-gray-800")}>{s.name}</span>
              </label>
            ))}
          </div>

          {service && (
            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{service.name}</p>
                  <p className="text-sm text-gray-500">{priceLabel(service)}</p>
                </div>
                {isUnit && (
                  <Field label="Quantité" className="w-28 shrink-0">
                    <Input
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </Field>
                )}
              </div>
              {isUnit && service.price != null && (
                <p className="mt-3 text-right text-sm text-gray-500">
                  Total partiel :{" "}
                  <span className="font-display font-bold text-mora-blue tabular-nums">
                    {(quantity * service.price).toLocaleString("fr-FR")} KMF
                  </span>
                </p>
              )}
            </div>
          )}
        </StepCard>

        {/* Coordonnées */}
        <StepCard step="2" title="Coordonnées" subtitle="Pour vous recontacter au sujet de cette commande" className="mt-6">
          <div className="space-y-4">
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
        </StepCard>

        {/* Moyen de paiement */}
        <StepCard step="3" title="Moyen de paiement" subtitle="Vous déclarerez votre paiement ; il sera vérifié avant confirmation" className="mt-6">
          <div className="grid gap-2 sm:grid-cols-2">
            {paymentMethods.map((m) => (
              <label
                key={m.id}
                className={cn(
                  "group flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-all focus-within:border-mora-blue focus-within:ring-2 focus-within:ring-mora-blue-20",
                  paymentMethod === m.id
                    ? "border-mora-blue bg-mora-blue-10 text-mora-blue shadow-soft"
                    : "border-gray-200 text-gray-700 hover:border-mora-blue-40 hover:bg-gray-50",
                )}
              >
                <input type="radio" name="payment" value={m.id} checked={paymentMethod === m.id} onChange={() => setPaymentMethod(m.id)} className="sr-only" />
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                    paymentMethod === m.id ? "border-mora-blue bg-mora-blue" : "border-gray-300 bg-white",
                  )}
                >
                  {paymentMethod === m.id && <span className="h-2 w-2 rounded-full bg-white" />}
                </span>
                <span className={cn("font-medium", paymentMethod === m.id ? "text-mora-blue" : "text-gray-800")}>{m.label}</span>
              </label>
            ))}
          </div>
        </StepCard>

        {/* Récapitulatif */}
        <section className="mt-6 rounded-2xl border border-mora-blue-40/40 bg-white p-6 shadow-soft sm:p-7">
          <div className="flex items-center gap-2">
            <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-xl bg-mora-blue font-display text-sm font-bold text-mora-or">✓</span>
            <span className="font-display text-lg font-bold text-gray-900">Votre commande</span>
          </div>

          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500">Prestation</dt>
              <dd className="text-right font-medium text-gray-900">{service?.name ?? "—"}</dd>
            </div>
            {service && service.price != null && !isUnit && (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-gray-500">Prix</dt>
                <dd className="text-right font-medium text-gray-900 tabular-nums">{priceLabel(service)}</dd>
              </div>
            )}
            {service && isUnit && (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-gray-500">Quantité</dt>
                <dd className="text-right font-medium text-gray-900 tabular-nums">{quantity}</dd>
              </div>
            )}
            {service && isUnit && service.price != null && (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-gray-500">Prix unitaire</dt>
                <dd className="text-right font-medium text-gray-900 tabular-nums">{priceLabel(service)}</dd>
              </div>
            )}
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500">Moyen de paiement</dt>
              <dd className="text-right font-medium text-gray-900">{paymentMethods.find((m) => m.id === paymentMethod)?.label}</dd>
            </div>
          </dl>

          <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-5">
            <span className="font-semibold text-gray-800">Total</span>
            <span className="font-display text-2xl font-bold text-mora-blue tabular-nums">{total.toLocaleString("fr-FR")} KMF</span>
          </div>

          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-500">
            Le montant est calculé côté serveur. Votre paiement est <strong className="font-semibold text-gray-700">déclaré</strong> —
            il sera vérifié par MORA Shawiri avant confirmation.
          </p>

          {result && !result.success && (
            <p role="alert" className="mt-4 rounded-xl border border-error/20 bg-error-soft px-4 py-3 text-sm text-error">{result.error}</p>
          )}

          <div className="mt-5">
            <Button onClick={submit} variant="primary" size="lg" className="w-full" disabled={!service || pending}>
              {pending ? "Traitement..." : "Valider ma commande"}
            </Button>
          </div>
          <p className="mt-3 text-center text-xs leading-relaxed text-gray-500">
            En validant, vous acceptez nos{" "}
            <Link href="/conditions-vente" className="text-mora-blue hover:underline">CGV</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}
