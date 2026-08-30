import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ServiceCard } from "@/components/ui/ServiceCard";
import { Reveal } from "@/components/ui/Reveal";
import { services, getServiceBySlug, priceLabel, type Service } from "@/lib/data/services";
import { siteConfig, absoluteUrl } from "@/lib/config";

export function generateStaticParams() {
  return services.map((s) => ({ slug: s.slug }));
}

export function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  return params.then(({ slug }) => {
    const service = getServiceBySlug(slug);
    if (!service) return {};
    return {
      title: service.name,
      description: service.summary,
      alternates: { canonical: absoluteUrl(`/services/${service.slug}`) },
      openGraph: {
        title: `${service.name} — ${siteConfig.name}`,
        description: service.summary,
        url: absoluteUrl(`/services/${service.slug}`),
        images: [{ url: absoluteUrl(service.image), alt: service.name }],
      },
    };
  });
}

function CtaTarget(service: Service) {
  if (service.directPurchase) return `/commander?service=${service.slug}`;
  return `/devis?service=${service.slug}`;
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) notFound();

  const related = services.filter((s) => s.id !== service.id && s.category === service.category).slice(0, 3);

  return (
    <div className="bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Service",
            name: service.name,
            description: service.summary,
            url: absoluteUrl(`/services/${service.slug}`),
            image: absoluteUrl(service.image),
            provider: { "@type": "Organization", name: siteConfig.name },
            areaServed: "KM",
          }),
        }}
      />

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Fil d'Ariane */}
        <nav
          aria-label="Fil d'Ariane"
          className="mb-8 flex flex-wrap items-center gap-1.5 text-sm text-gray-500"
        >
          <Link
            href="/"
            className="rounded-md px-1.5 py-0.5 transition-colors hover:text-mora-blue"
          >
            Accueil
          </Link>
          <span aria-hidden className="text-gray-300">/</span>
          <Link
            href="/services"
            className="rounded-md px-1.5 py-0.5 transition-colors hover:text-mora-blue"
          >
            Services
          </Link>
          <span aria-hidden className="text-gray-300">/</span>
          <span className="font-medium text-gray-700">{service.name}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-2">
          {/* Visuel */}
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-mora-gradient shadow-lift">
              <div aria-hidden className="absolute inset-0 bg-mora-grid opacity-40" />
              <div aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-mora-or/20 blur-3xl" />
              <div className="relative aspect-[4/3]">
                <Image
                  src={service.image}
                  alt={`Image du service ${service.name} de MORA Shawiri`}
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover"
                />
              </div>
            </div>
          </Reveal>

          {/* Contenu */}
          <Reveal delay={80}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{service.category}</Badge>
              {service.directPurchase && <Badge tone="green" dot>Disponible</Badge>}
            </div>
            <h1 className="mt-4 font-display text-balance tracking-tight text-3xl font-bold text-gray-900 sm:text-4xl">
              {service.name}
            </h1>

            <div className="mt-5 flex flex-wrap items-baseline gap-3">
              <span className="font-display text-3xl font-bold tracking-tight text-mora-blue tabular-nums sm:text-4xl">
                {priceLabel(service)}
              </span>
              {service.unit && (
                <span className="text-sm text-gray-500">à l&apos;unité — calcul selon quantité</span>
              )}
            </div>

            <p className="mt-5 text-lg leading-relaxed text-gray-700">{service.summary}</p>
            <p className="mt-3 leading-relaxed text-gray-600">{service.description}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href={CtaTarget(service)} variant="primary" size="lg">
                {service.ctaPrimary}
              </Button>
              <Button href={siteConfig.contact.whatsappUrl} variant="secondary" size="lg">
                {service.ctaSecondary}
              </Button>
            </div>

            {/* Informations clés */}
            <div className="mt-8 grid gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-soft sm:grid-cols-3">
              <InfoCell label="Tarification" value={service.priceType === "quote" ? "Sur devis" : service.priceType === "unit" ? "À l'unité" : "Prix fixe"} />
              <InfoCell label="Commande" value={service.directPurchase ? "Directe" : "Sur devis / conversationnel"} />
              <InfoCell label="Rendez-vous" value={service.appointmentAvailable ? "Possible" : "Non requis"} />
            </div>
          </Reveal>
        </div>

        {/* Services liés */}
        {related.length > 0 && (
          <div className="mt-16 sm:mt-20">
            <Reveal>
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-display text-2xl font-bold tracking-tight text-gray-900">
                  Dans la même catégorie
                </h2>
                <Link href="/services" className="link-accent text-sm whitespace-nowrap">
                  Tous les services →
                </Link>
              </div>
            </Reveal>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((s, i) => (
                <Reveal key={s.id} delay={i * 60}>
                  <ServiceCard service={s} />
                </Reveal>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-mora-blue-10/60 p-3.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="font-semibold text-gray-800">{value}</p>
    </div>
  );
}
