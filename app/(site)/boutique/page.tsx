import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Boutique",
  description:
    "Découvrez les services MORA Shawiri disponibles dès maintenant. Les produits arrivent bientôt.",
  alternates: { canonical: absoluteUrl("/boutique") },
};

export default async function BoutiquePage() {
  // Produits publiés depuis la base (gérés par l'admin) ; repli sur l'état vide sinon.
  let products: { id: string; name: string; price: number | null; image: string | null; slug: string }[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("products")
      .select("id, name, price, image_url, slug")
      .in("status", ["published", "available"])
      .order("created_at", { ascending: false })
      .limit(30);
    products = (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      image: p.image_url,
      slug: p.slug,
    }));
  } catch {
    // Conserver l'état vide si la base n'est pas disponible.
  }

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

        {/* Produits */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-bold text-mora-blue">Produits</h2>
          {products.length > 0 ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((p) => (
                <div key={p.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <div className="relative aspect-[4/3] bg-gray-structure">
                    {p.image ? <Image src={p.image} alt={p.name} fill sizes="(max-width: 640px) 100vw, 30vw" className="object-cover" /> : (
                      <span className="flex h-full items-center justify-center text-sm text-gray-400">Visuel à venir</span>
                    )}
                  </div>
                  <div className="p-5">
                    <p className="font-semibold text-gray-900">{p.name}</p>
                    <p className="mt-1 text-sm font-semibold text-mora-blue">{p.price != null ? `${p.price.toLocaleString("fr-FR")} KMF` : "Sur devis"}</p>
                    <div className="mt-3">
                      <Button href="/contact" variant="secondary" size="sm">Poser une question</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-3xl border border-dashed border-gray-300 bg-white p-10 text-center">
              <div className="mx-auto max-w-lg">
                <p className="font-display text-xl font-bold text-gray-900">Nos produits arrivent bientôt</p>
                <p className="mt-2 text-gray-600">
                  MORA Shawiri prépare actuellement de nouvelles ressources et offres à découvrir
                  prochainement. En attendant, découvrez nos services disponibles dès maintenant.
                </p>
                <div className="mt-6">
                  <Button href="/services" variant="primary" size="md">Découvrir nos services</Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
