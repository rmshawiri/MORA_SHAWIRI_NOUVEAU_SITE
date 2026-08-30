import type { Metadata } from "next";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { siteConfig, absoluteUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Qui sommes-nous",
  description:
    "MORA Shawiri est une structure digitale indépendante basée à Moroni, Union des Comores. Découvrez notre approche, nos valeurs et notre fondateur Mohamed Rachade.",
  alternates: { canonical: absoluteUrl("/qui-sommes-nous") },
};

const values = [
  { title: "Personnalisation", text: "Nous adaptons chaque prestation à votre besoin réel.", mark: "✦" },
  { title: "Proximité", text: "Une relation directe et accessible, ici aux Comores.", mark: "●" },
  { title: "Efficacité", text: "Des méthodes concrètes, orientées vers des résultats.", mark: "▲" },
  { title: "Accessibilité", text: "Une offre claire et abordable, pensée pour le marché comorien.", mark: "◆" },
];

const steps = ["Comprendre", "Conseiller", "Concevoir", "Accompagner"];

export default function QuiSommesNousPage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="MORA Shawiri"
          title="Qui sommes-nous ?"
          description={siteConfig.description}
        />

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          {/* Approche */}
          <Reveal>
            <div className="h-full rounded-3xl border border-gray-100 bg-white p-8 shadow-soft card-lift">
              <h2 className="font-display text-xl font-bold tracking-tight text-mora-blue">
                Notre approche
              </h2>
              <p className="mt-4 text-gray-700">
                MORA Shawiri accompagne ses clients selon une méthode simple et éprouvée :
              </p>
              <ol className="mt-6 space-y-3">
                {steps.map((s, i) => (
                  <li key={s} className="flex items-center gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mora-gradient font-display text-sm font-bold text-mora-or shadow-soft">
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
          </Reveal>

          {/* Valeurs */}
          <Reveal delay={100}>
            <div className="relative h-full overflow-hidden rounded-3xl bg-mora-gradient p-8 text-white shadow-lift">
              <div aria-hidden className="absolute inset-0 bg-mora-grid opacity-40" />
              <div aria-hidden className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-mora-or/15 blur-3xl" />
              <div className="relative">
                <h2 className="font-display text-xl font-bold tracking-tight text-white">
                  Nos valeurs
                </h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {values.map((v) => (
                    <div key={v.title} className="glass rounded-2xl p-4">
                      <p className="flex items-center gap-2 font-semibold text-mora-or">
                        <span aria-hidden>{v.mark}</span>
                        {v.title}
                      </p>
                      <p className="mt-1 text-sm text-blue-100/90">{v.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        {/* Fondateur */}
        <div className="mt-16 grid gap-10 lg:grid-cols-2">
          <Reveal>
            <div className="relative aspect-[4/5] max-w-sm overflow-hidden rounded-3xl bg-gray-structure shadow-lift">
              <Image
                src="/fondateur-mora-shawiri.webp"
                alt="Portrait de Mohamed Rachade, fondateur de MORA Shawiri"
                fill
                priority
                sizes="(max-width: 640px) 100vw, 30vw"
                className="object-cover"
              />
            </div>
          </Reveal>
          <Reveal delay={100} className="flex flex-col justify-center">
            <div>
              <h2 className="font-display text-3xl font-bold tracking-tight text-gray-900">
                Mohamed Rachade
              </h2>
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-mora-blue-10 px-3 py-1 text-sm font-semibold text-mora-blue">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mora-green" />
                Fondateur de MORA Shawiri
              </p>
              <p className="mt-5 leading-relaxed text-gray-700">
                La structure est née à <strong>Moroni, Union des Comores</strong>, avec l&apos;ambition
                d&apos;offrir des services numériques, administratifs et de design professionnels et
                accessibles, adaptés au marché local.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button href="/contact" variant="primary" size="md">Nous contacter</Button>
              <Button href="/services" variant="secondary" size="md">Découvrir nos services</Button>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
