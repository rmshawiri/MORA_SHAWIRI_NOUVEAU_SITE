import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ServiceCard } from "@/components/ui/ServiceCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { AffiliateTracker } from "@/components/AffiliateTracker";
import { featuredServices, services } from "@/lib/data/services";
import { siteConfig } from "@/lib/config";

const values = [
  {
    title: "Personnalisation",
    text: "Des solutions adaptées à votre besoin et à votre activité.",
    mark: "✦",
  },
  {
    title: "Proximité",
    text: "Une relation directe et accessible, ici aux Comores.",
    mark: "●",
  },
  {
    title: "Efficacité",
    text: "Des méthodes concrètes orientées vers des résultats réels.",
    mark: "▲",
  },
  {
    title: "Accessibilité",
    text: "Une offre claire et abordable, pensée pour le marché comorien.",
    mark: "◆",
  },
];

const heroChips = ["Sites web", "Identité visuelle", "E-commerce", "Formation", "Audit", "SaaS", "Applications mobiles"];

export default function HomePage() {
  return (
    <>
      <AffiliateTracker />

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden bg-mora-gradient text-white">
        <div aria-hidden className="absolute inset-0 bg-mora-grid opacity-60" />
        {/* halos décoratifs subtils */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-mora-or/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
        {/*
          Amorcage du curseur : la composition hero du site public.
          CTA principaux clairement identifiés, hiérarchie texte → valeurs → action.
        */}

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Texte */}
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mora-green" />
              {siteConfig.tagline}
            </p>
            <h1 className="mt-6 font-display text-balance text-4xl font-bold leading-[1.04] text-white sm:text-5xl lg:text-6xl">
              {siteConfig.name}
            </h1>
            <p className="mt-4 font-display text-2xl font-semibold text-mora-or sm:text-3xl">
              {siteConfig.slogan}
            </p>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-blue-100/90 sm:text-lg">
              {siteConfig.description}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="/services" variant="primary" size="lg">
                Découvrir nos services
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
              </Button>
              <Button href="/devis" variant="ghost" size="lg" className="border border-white/25 text-white hover:bg-white/10">
                Demander un devis
              </Button>
            </div>

            {/* Chips d'offre (données réelles) */}
            <div className="mt-8 flex flex-wrap gap-2">
              {heroChips.map((chip) => (
                <span key={chip} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-blue-100">
                  {chip}
                </span>
              ))}
            </div>
          </div>

          {/* Showcase : panneau de marque administrable (HOME_HERO_IMAGE) */}
          <div className="animate-fade-up [animation-delay:150ms]">
            <div className="relative mx-auto max-w-md">
              <div aria-hidden className="glass-dark absolute -inset-3 -rotate-3 rounded-[2rem]" />
              <div aria-hidden className="relative -rotate-2 rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
                <div className="rounded-2xl bg-white p-6 text-mora-blue shadow-blue-glow">
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-mora-blue text-mora-or font-display text-lg font-bold">M</span>
                    <div className="leading-tight">
                      <p className="font-display text-base font-bold">{siteConfig.name}</p>
                      <p className="text-xs text-gray-500">{siteConfig.tagline}</p>
                    </div>
                  </div>
                  <div className="mt-5 space-y-2">
                    {["Services & prestations", "Boutique & commandes", "Demande de devis", "Programme d'affiliation"].map((t) => (
                      <div key={t} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mora-green" />
                        {t}
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex items-center justify-between rounded-xl bg-mora-or px-3 py-2 text-sm font-bold text-mora-blue">
                    <span>Votre projet</span>
                    <Link href="/devis" className="hover:underline">Discutons-en →</Link>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-center text-xs text-blue-100/60">
                Espace réservé au visuel d&apos;accueil (HOME_HERO_IMAGE)
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== VALEURS ===== */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            eyebrow="Nos valeurs"
            title="Une approche pensée pour votre réussite"
            description="Un positionnement clair et une relation directe, au service de vos projets numériques."
          />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((v, i) => (
              <Reveal key={v.title} delay={i * 80}>
                <div className="group h-full rounded-2xl border border-gray-100 bg-white p-6 shadow-soft card-lift">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-mora-blue-10 font-display text-xl text-mora-blue transition-colors group-hover:bg-mora-blue group-hover:text-mora-or">
                    {v.mark}
                  </div>
                  <h3 className="mt-4 font-display text-lg font-bold text-gray-900">{v.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{v.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== SERVICES EN AVANT ===== */}
      <section className="bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
            <SectionHeading
              eyebrow="Nos services"
              title="Des prestations pour faire grandir votre activité"
              description="Services numériques, administratifs et de design — avec des modalités claires : prix fixe, à l'unité ou sur devis."
            />
            <Link
              href="/services"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-mora-blue-10 px-4 py-2 text-sm font-semibold text-mora-blue transition-colors hover:bg-mora-blue-20"
            >
              Voir tous les services
              <span aria-hidden>→</span>
            </Link>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featuredServices.map((service, i) => (
              <Reveal key={service.id} delay={i * 80}>
                <ServiceCard service={service} />
              </Reveal>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-gray-500">
              {services.length} prestations disponibles, pour tous types de projets.
            </p>
            <Link href="/services" className="link-accent text-sm">
              Explorer le catalogue complet →
            </Link>
          </div>
        </div>
      </section>

      {/* ===== BANDEAU CTA ===== */}
      <section className="relative overflow-hidden bg-mora-gradient text-white">
        <div aria-hidden className="absolute inset-0 bg-mora-grid opacity-50" />
        <div aria-hidden className="pointer-events-none absolute -top-16 right-10 h-64 w-64 rounded-full bg-mora-or/15 blur-3xl" />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-16 text-center sm:px-6">
          <Badgeish label="Accompagnement sur mesure" />
          <h2 className="font-display text-balance text-3xl font-bold text-white sm:text-4xl">
            Un projet numérique ? Discutons-en.
          </h2>
          <p className="max-w-xl text-blue-100/90">
            Demandez un devis, présentez votre projet ou contactez-nous directement sur WhatsApp —
            nous vous répondons rapidement.
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <Button href="/contact" variant="primary" size="lg">
              Nous contacter
            </Button>
            <Button href="/qui-sommes-nous" variant="ghost" size="lg" className="border border-white/25 text-white hover:bg-white/10">
              Découvrir MORA Shawiri
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

function Badgeish({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-mora-or backdrop-blur-sm">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mora-or" />
      {label}
    </span>
  );
}
