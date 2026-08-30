import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { createClient } from "@/lib/supabase/server";
import { services, priceLabel } from "@/lib/data/services";
import { absoluteUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Boutique",
  description:
    "Découvrez les services MORA Shawiri disponibles dès maintenant. Les produits arrivent bientôt.",
  alternates: { canonical: absoluteUrl("/boutique") },
};

// Services à achat direct (source : données réelles) présentés comme disponibles.
const availableServices = services
  .filter((s) => s.directPurchase)
  .map((s) => ({
    name: s.name,
    href: `/services/${s.slug}`,
    label: `${priceLabel(s)} — commander directement`,
  }));

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
    <div className="bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="Espace commercial"
          title="Boutique MORA Shawiri"
          description="L'espace commercial de MORA Shawiri regroupe nos services disponibles et, prochainement, nos produits."
        />

        {/* Bandeau "disponibilité" */}
        <Reveal>
          <div className="mt-10 flex flex-wrap items-center gap-2 rounded-2xl border border-mora-green-soft bg-mora-green-soft/50 px-4 py-3 text-sm text-mora-green">
            <span aria-hidden className="h-2 w-2 rounded-full bg-mora-green" />
            Les prestations ci-dessous sont disponibles à la commande immédiate.
          </div>
        </Reveal>

        {/* Services disponibles */}
        <section className="mt-12">
          <Reveal>
            <div className="flex items-center gap-3">
              <h2 className="font-display text-xl font-bold tracking-tight text-mora-blue sm:text-2xl">
                Services disponibles
              </h2>
              <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-mora-blue-20 to-transparent" />
            </div>
          </Reveal>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {availableServices.map((s, i) => (
              <Reveal key={s.href} delay={i * 60}>
                <Link
                  href={s.href}
                  className="group surface-card card-lift relative flex h-full flex-col justify-between overflow-hidden rounded-2xl p-6"
                >
                  <div>
                    <Badge tone="green" dot>Disponible</Badge>
                    <p className="mt-4 font-display text-lg font-bold text-gray-900 transition-colors group-hover:text-mora-blue">
                      {s.name}
                    </p>
                  </div>
                  <div className="mt-6 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-mora-blue">{s.label}</p>
                    <span
                      aria-hidden
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mora-blue-10 text-mora-blue transition-all duration-300 group-hover:bg-mora-blue group-hover:text-mora-or"
                    >
                      →
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
          <div className="mt-8">
            <Button href="/services" variant="secondary" size="md">
              Voir tous nos services
            </Button>
          </div>
        </section>

        {/* Produits */}
        <section className="mt-16">
          <Reveal>
            <div className="flex items-center gap-3">
              <h2 className="font-display text-xl font-bold tracking-tight text-mora-blue sm:text-2xl">
                Produits
              </h2>
              <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-mora-blue-20 to-transparent" />
            </div>
          </Reveal>

          {products.length > 0 ? (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((p, i) => (
                <Reveal key={p.id} delay={i * 60}>
                  <article className="group surface-card card-lift flex h-full flex-col overflow-hidden rounded-2xl">
                    <div className="relative aspect-[4/3] bg-gray-structure">
                      {p.image ? (
                        <Image
                          src={p.image}
                          alt={p.name}
                          fill
                          sizes="(max-width: 640px) 100vw, 30vw"
                          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                        />
                      ) : (
                        <span className="flex h-full items-center justify-center text-sm text-gray-400">
                          Visuel à venir
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <p className="font-display font-bold text-gray-900">{p.name}</p>
                      <p className="mt-1 text-sm font-semibold text-mora-blue tabular-nums">
                        {p.price != null ? `${p.price.toLocaleString("fr-FR")} KMF` : "Sur devis"}
                      </p>
                      <div className="mt-4 flex-1" />
                      <div>
                        <Button href="/contact" variant="secondary" size="sm">
                          Poser une question
                        </Button>
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          ) : (
            <Reveal>
              <div className="mt-6">
                <EmptyState
                  icon={<span aria-hidden className="text-2xl">🛍️</span>}
                  title="Nos produits arrivent bientôt"
                  description="MORA Shawiri prépare actuellement de nouvelles ressources et offres à découvrir prochainement. En attendant, découvrez nos services disponibles dès maintenant."
                  action={<Button href="/services" variant="primary" size="md">Découvrir nos services</Button>}
                />
              </div>
            </Reveal>
          )}
        </section>
      </div>
    </div>
  );
}
