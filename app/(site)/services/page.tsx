import type { Metadata } from "next";
import { ServiceCard } from "@/components/ui/ServiceCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { services, serviceCategories } from "@/lib/data/services";
import { absoluteUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Nos services",
  description:
    "Découvrez les services numériques, administratifs et de design proposés par MORA Shawiri aux Comores : création de site web, logo, e-commerce, formation, gestion documentaire et plus encore.",
  alternates: { canonical: absoluteUrl("/services") },
  openGraph: { url: absoluteUrl("/services"), title: "Services — MORA Shawiri" },
};

export default function ServicesPage() {
  return (
    <div className="bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        {/* En-tête */}
        <SectionHeading
          eyebrow="Catalogue complet"
          title="Nos services"
          description="Une offre complète de prestations numériques, administratives et de design. Chaque service est présenté avec ses modalités : prix fixe, tarification à l'unité ou sur devis selon la nature de la prestation."
        />

        {/* Filtres par catégorie */}
        <nav className="mt-10 flex flex-wrap gap-2.5" aria-label="Catégories de services">
          {serviceCategories.map((cat) => (
            <a
              key={cat}
              href={`#${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-soft ring-1 ring-gray-200 transition-all duration-200 hover:-translate-y-0.5 hover:bg-mora-blue hover:text-white hover:shadow-lift focus-visible:outline-mora-blue"
            >
              {cat}
            </a>
          ))}
        </nav>

        {/* Grille par catégorie */}
        <div className="mt-12 space-y-16">
          {serviceCategories.map((cat) => {
            const items = services.filter((s) => s.category === cat);
            return (
              <section
                key={cat}
                id={cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
                className="scroll-mt-28"
              >
                <Reveal>
                  <div className="flex items-center gap-3">
                    <h2 className="font-display text-xl font-bold tracking-tight text-mora-blue sm:text-2xl">
                      {cat}
                    </h2>
                    <span className="inline-flex items-center rounded-full bg-mora-blue-10 px-3 py-1 text-xs font-semibold text-mora-blue ring-1 ring-inset ring-mora-blue-10">
                      {items.length}
                    </span>
                    <span
                      aria-hidden
                      className="h-px flex-1 bg-gradient-to-r from-mora-blue-20 to-transparent"
                    />
                  </div>
                </Reveal>

                <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((service, i) => (
                    <Reveal key={service.id} delay={i * 60}>
                      <ServiceCard service={service} />
                    </Reveal>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Référence pour SEO : les services sont indexables (publics).
export const dynamic = "force-static";
