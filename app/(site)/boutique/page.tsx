import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { absoluteUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Boutique",
  description:
    "Découvrez les services MORA Shawiri disponibles dès maintenant. Les produits arrivent bientôt.",
  alternates: { canonical: absoluteUrl("/boutique") },
};

export default function BoutiquePage() {
  return (
    <div className="bg-gray-structure">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-bold text-gray-900 sm:text-4xl">Boutique MORA Shawiri</h1>
        <p className="mt-3 max-w-2xl text-gray-600">
          L&apos;espace commercial de MORA Shawiri regroupe nos services disponibles et, prochainement,
          nos produits.
        </p>

        {/* Services disponibles */}
        <section className="mt-10">
          <h2 className="font-display text-xl font-bold text-mora-blue">Services disponibles</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/services/audit-strategique-global"
              className="rounded-2xl border border-gray-100 bg-white p-6 transition-shadow hover:shadow-md"
            >
              <p className="font-semibold text-gray-900">Audit Stratégique Global</p>
              <p className="mt-1 text-sm text-gray-600">30 000 KMF — commander directement.</p>
            </Link>
            <Link
              href="/services/creation-de-logo"
              className="rounded-2xl border border-gray-100 bg-white p-6 transition-shadow hover:shadow-md"
            >
              <p className="font-semibold text-gray-900">Création de Logo</p>
              <p className="mt-1 text-sm text-gray-600">15 000 KMF — commander directement.</p>
            </Link>
            <Link
              href="/services/formation-prospection-relation-client"
              className="rounded-2xl border border-gray-100 bg-white p-6 transition-shadow hover:shadow-md"
            >
              <p className="font-semibold text-gray-900">Formation Prospection &amp; Relation Client</p>
              <p className="mt-1 text-sm text-gray-600">5 000 KMF — s&apos;inscrire.</p>
            </Link>
          </div>
          <div className="mt-6">
            <Button href="/services" variant="secondary" size="md">
              Voir tous nos services
            </Button>
          </div>
        </section>

        {/* Produits : état vide honnête */}
        <section className="mt-12 rounded-3xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <div className="mx-auto max-w-lg">
            <p className="font-display text-xl font-bold text-gray-900">Nos produits arrivent bientôt</p>
            <p className="mt-2 text-gray-600">
              MORA Shawiri prépare actuellement de nouvelles ressources et offres à découvrir
              prochainement. En attendant, découvrez nos services disponibles dès maintenant.
            </p>
            <div className="mt-6">
              <Button href="/services" variant="primary" size="md">
                Découvrir nos services
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
