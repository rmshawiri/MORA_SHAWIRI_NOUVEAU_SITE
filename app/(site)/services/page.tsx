import type { Metadata } from "next";
import { ServiceCard } from "@/components/ui/ServiceCard";
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
    <div className="bg-gray-structure">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        {/* En-tête */}
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl font-bold text-gray-900 sm:text-4xl">
            Nos services
          </h1>
          <p className="mt-3 text-gray-600">
            Une offre complète de prestations numériques, administratives et de design. Chaque
            service est présenté avec ses modalités : prix fixe, tarification à l&apos;unité ou sur
            devis selon la nature de la prestation.
          </p>
        </div>

        {/* Filtres par catégorie */}
        <nav className="mt-8 flex flex-wrap gap-2" aria-label="Catégories de services">
          {serviceCategories.map((cat) => (
            <a
              key={cat}
              href={`#${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-mora-blue-20 hover:text-mora-blue"
            >
              {cat}
            </a>
          ))}
        </nav>

        {/* Grille par catégorie */}
        <div className="mt-10 space-y-12">
          {serviceCategories.map((cat) => {
            const items = services.filter((s) => s.category === cat);
            return (
              <section
                key={cat}
                id={cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
                className="scroll-mt-24"
              >
                <h2 className="font-display text-xl font-bold text-mora-blue">{cat}</h2>
                <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((service) => (
                    <ServiceCard key={service.id} service={service} />
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
