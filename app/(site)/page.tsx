import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ServiceCard } from "@/components/ui/ServiceCard";
import { AffiliateTracker } from "@/components/AffiliateTracker";
import { featuredServices } from "@/lib/data/services";
import { siteConfig } from "@/lib/config";

const values = [
  { title: "Personnalisation", text: "Des solutions adaptées à votre besoin et à votre activité." },
  { title: "Proximité", text: "Une relation directe et accessible, ici aux Comores." },
  { title: "Efficacité", text: "Des méthodes concrètes orientées vers des résultats réels." },
  { title: "Accessibilité", text: "Une offre claire et abordable, pensée pour le marché comorien." },
];

export default function HomePage() {
  return (
    <>
      <AffiliateTracker />
      {/* Hero */}
      <section className="bg-mora-blue">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white">
              {siteConfig.tagline}
            </p>
            <h1 className="mt-5 font-display text-4xl font-bold leading-tight text-white sm:text-5xl">
              {siteConfig.name}
            </h1>
            <p className="mt-3 font-display text-2xl font-semibold text-mora-or">
              {siteConfig.slogan}
            </p>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-blue-100">
              {siteConfig.description}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="/services" variant="primary" size="lg">
                Découvrir nos services
              </Button>
              <Button href="/devis" variant="secondary" size="lg">
                Demander un devis
              </Button>
            </div>
          </div>
          <div className="hidden justify-center lg:flex">
            {/* Image administrable : HOME_HERO_IMAGE (placeholder tant que l'image définitive n'est pas téléversée) */}
            <div className="relative aspect-[4/3] w-full max-w-md overflow-hidden rounded-3xl border-4 border-white/20 bg-white/10"></div>
          </div>
        </div>
      </section>

      {/* Valeurs */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {values.map((v) => (
            <div key={v.title} className="rounded-2xl border border-gray-100 p-6">
              <h2 className="font-display text-lg font-bold text-mora-blue">{v.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{v.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Services en avant */}
      <section className="bg-gray-structure">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-display text-2xl font-bold text-gray-900">Nos services</h2>
              <p className="mt-1 text-gray-600">
                Des prestations numériques, administratives et de design pour votre performance.
              </p>
            </div>
            <Link href="/services" className="text-sm font-semibold text-mora-blue hover:underline">
              Voir tous les services →
            </Link>
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featuredServices.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </div>
        </div>
      </section>

      {/* Bandeau CTA */}
      <section className="bg-mora-blue">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-14 text-center sm:px-6">
          <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">
            Un projet numérique ? Discutons-en.
          </h2>
          <p className="max-w-xl text-blue-100">
            Demandez un devis, présentez votre projet ou contactez-nous directement sur WhatsApp.
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <Button href="/contact" variant="secondary" size="md">
              Nous contacter
            </Button>
            <Button href={siteConfig.contact.whatsappUrl} variant="whatsapp" size="md">
              Discuter sur WhatsApp
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
