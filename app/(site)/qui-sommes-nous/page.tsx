import type { Metadata } from "next";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { siteConfig, absoluteUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Qui sommes-nous",
  description:
    "MORA Shawiri est une structure digitale indépendante basée à Moroni, Union des Comores. Découvrez notre approche, nos valeurs et notre fondateur Mohamed Rachade.",
  alternates: { canonical: absoluteUrl("/qui-sommes-nous") },
};

const values = [
  { title: "Personnalisation", text: "Nous adaptons chaque prestation à votre besoin réel." },
  { title: "Proximité", text: "Une relation directe et accessible, ici aux Comores." },
  { title: "Efficacité", text: "Des méthodes concrètes, orientées vers des résultats." },
  { title: "Accessibilité", text: "Une offre claire et abordable, pensée pour le marché comorien." },
];

const steps = ["Comprendre", "Conseiller", "Concevoir", "Accompagner"];

export default function QuiSommesNousPage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl font-bold text-gray-900 sm:text-4xl">Qui sommes-nous ?</h1>
          <p className="mt-3 text-gray-600">{siteConfig.description}</p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          {/* Présentation */}
          <div className="rounded-3xl bg-gray-structure p-8">
            <h2 className="font-display text-xl font-bold text-mora-blue">Notre approche</h2>
            <p className="mt-4 text-gray-700">
              MORA Shawiri accompagne ses clients selon une méthode simple et éprouvée :
            </p>
            <ol className="mt-6 space-y-3">
              {steps.map((s, i) => (
                <li key={s} className="flex items-center gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mora-blue text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="font-semibold text-gray-800">{s}</span>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-sm text-gray-600">
              Comprendre votre besoin, vous conseiller la meilleure solution, concevoir et vous
              accompagner jusqu&apos;à la livraison.
            </p>
          </div>

          {/* Valeurs */}
          <div className="rounded-3xl bg-mora-blue p-8">
            <h2 className="font-display text-xl font-bold text-white">Nos valeurs</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {values.map((v) => (
                <div key={v.title} className="rounded-2xl bg-white/10 p-4">
                  <p className="font-semibold text-mora-or">{v.title}</p>
                  <p className="mt-1 text-sm text-blue-100">{v.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Fondateur + image */}
        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          <div className="relative aspect-[4/5] max-w-sm overflow-hidden rounded-3xl bg-gray-structure">
            <Image
              src="/fondateur-mora-shawiri.webp"
              alt="Portrait de Mohamed Rachade, fondateur de MORA Shawiri"
              fill
              priority
              sizes="(max-width: 640px) 100vw, 30vw"
              className="object-cover"
            />
          </div>
          <div className="flex flex-col justify-center">
            <h2 className="font-display text-2xl font-bold text-gray-900">Mohamed Rachade</h2>
            <p className="mt-1 text-sm font-medium text-mora-blue">Fondateur de MORA Shawiri</p>
            <p className="mt-4 text-gray-700">
              La structure est née à <strong>Moroni, Union des Comores</strong>, avec l&apos;ambition
              d&apos;offrir des services numériques, administratifs et de design professionnels et
              accessibles, adaptés au marché local.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button href="/contact" variant="primary" size="md">
                Nous contacter
              </Button>
              <Button href="/services" variant="secondary" size="md">
                Découvrir nos services
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
