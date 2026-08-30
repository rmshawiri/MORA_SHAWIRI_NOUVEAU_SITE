"use client";

import { Suspense, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
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
      <div className="bg-gray-structure">
        <div className="mx-auto max-w-lg px-4 py-20 sm:px-6">
          <div className="rounded-3xl bg-white p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">✓</div>
            <h1 className="mt-4 font-display text-2xl font-bold text-gray-900">Commande enregistrée</h1>
            <p className="mt-3 text-gray-600">
              Votre commande a bien été enregistrée. Le paiement est en attente de vérification par
              MORA Shawiri.
            </p>
            {result.orderNumber && (
              <p className="mt-4 text-sm font-mono text-gray-500">Référence : {result.orderNumber}</p>
            )}
            <p className="mt-4 text-left text-sm text-gray-600">
              <strong>Important :</strong> votre déclaration de paiement n&apos;est pas encore
              confirmée. Vous serez informé après vérification. Conservez cette référence.
            </p>
            <div className="mt-6">
              <Button href="/boutique" variant="secondary" size="md">Retour à la boutique</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-structure">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-bold text-gray-900">Commander</h1>
        <p className="mt-2 text-gray-600">Finalisez votre commande en quelques étapes.</p>

        {/* Choix du service */}
        <div className="mt-8 rounded-3xl bg-white p-6">
          <h2 className="font-display text-lg font-bold text-gray-900">Service</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {services.filter((s) => s.directPurchase).map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition-colors",
                  serviceSlug === s.slug ? "border-mora-blue bg-mora-blue-20 text-mora-blue" : "border-gray-200 hover:border-mora-blue",
                )}
              >
                <input type="radio" name="service" value={s.slug} checked={serviceSlug === s.slug} onChange={() => setServiceSlug(s.slug)} className="sr-only" />
                {s.name}
              </label>
            ))}
          </div>

          {service && (
            <div className="mt-5 flex items-center justify-between rounded-xl bg-gray-structure p-4">
              <div>
                <p className="font-semibold text-gray-800">{service.name}</p>
                <p className="text-sm text-gray-500">{priceLabel(service)}</p>
              </div>
              {isUnit && (
                <label className="flex items-center gap-2 text-sm">
                  Qté :
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-center"
                  />
                </label>
              )}
            </div>
          )}
        </div>

        {/* Coordonnées */}
        <div className="mt-6 rounded-3xl bg-white p-6">
          <h2 className="font-display text-lg font-bold text-gray-900">Coordonnées</h2>
          <div className="mt-4 space-y-4">
            <label className="block text-sm font-medium text-gray-700">Nom
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
            </label>
            <label className="block text-sm font-medium text-gray-700">Téléphone / WhatsApp
              <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
            </label>
            <label className="block text-sm font-medium text-gray-700">Email (facultatif)
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
            </label>
          </div>
        </div>

        {/* Moyen de paiement */}
        <div className="mt-6 rounded-3xl bg-white p-6">
          <h2 className="font-display text-lg font-bold text-gray-900">Moyen de paiement</h2>
          <p className="mt-1 text-sm text-gray-500">
            Vous déclarerez votre paiement ; il sera vérifié par MORA Shawiri avant confirmation.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {paymentMethods.map((m) => (
              <label
                key={m.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition-colors",
                  paymentMethod === m.id ? "border-mora-blue bg-mora-blue-20 text-mora-blue" : "border-gray-200 hover:border-mora-blue",
                )}
              >
                <input type="radio" name="payment" value={m.id} checked={paymentMethod === m.id} onChange={() => setPaymentMethod(m.id)} className="sr-only" />
                {m.label}
              </label>
            ))}
          </div>
        </div>

        {/* Récapitulatif */}
        <div className="mt-6 rounded-3xl bg-white p-6">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-gray-800">Total</span>
            <span className="font-display text-xl font-bold text-mora-blue">{total.toLocaleString("fr-FR")} KMF</span>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Le montant est calculé côté serveur. Moyen de paiement sélectionné :{" "}
            {paymentMethods.find((m) => m.id === paymentMethod)?.label}.
          </p>
          {result && !result.success && (
            <p className="mt-4 rounded-xl bg-error-soft p-3 text-sm text-error">{result.error}</p>
          )}
          <div className="mt-5">
            <Button onClick={submit} variant="primary" size="lg" className="w-full" disabled={!service || pending}>
              {pending ? "Traitement..." : "Valider ma commande"}
            </Button>
          </div>
          <p className="mt-3 text-center text-xs text-gray-500">
            En validant, vous acceptez nos{" "}
            <Link href="/conditions-vente" className="text-mora-blue hover:underline">CGV</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
