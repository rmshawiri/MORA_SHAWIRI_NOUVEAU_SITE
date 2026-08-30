import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
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
  if (service.directPurchase) {
    return `/commander?service=${service.slug}`;
  }
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
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* Fil d'Ariane */}
        <nav aria-label="Fil d'Ariane" className="mb-6 text-sm text-gray-500">
          <Link href="/" className="hover:text-mora-blue">Accueil</Link>
          <span className="mx-2">/</span>
          <Link href="/services" className="hover:text-mora-blue">Services</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-700">{service.name}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-2">
          {/* Visuel */}
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-gray-structure">
            <Image
              src={service.image}
              alt={`Image du service ${service.name} de MORA Shawiri`}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>

          {/* Contenu */}
          <div>
            <span className="rounded-full bg-mora-blue-20 px-3 py-1 text-xs font-medium text-mora-blue">
              {service.category}
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold text-gray-900">{service.name}</h1>

            <div className="mt-4 flex items-baseline gap-3">
              <span className="font-display text-3xl font-bold text-mora-blue">
                {priceLabel(service)}
              </span>
              {service.unit && (
                <span className="text-sm text-gray-500">à l&apos;unité — calcul selon quantité</span>
              )}
            </div>

            <p className="mt-5 leading-relaxed text-gray-700">{service.summary}</p>
            <p className="mt-3 leading-relaxed text-gray-600">{service.description}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href={CtaTarget(service)} variant="primary" size="lg">
                {service.ctaPrimary}
              </Button>
              <Button href={siteConfig.contact.whatsappUrl} variant="secondary" size="lg">
                {service.ctaSecondary}
              </Button>
            </div>

            <div className="mt-8 grid gap-4 rounded-2xl border border-gray-100 bg-gray-structure p-5 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Tarification</p>
                <p className="mt-1 font-semibold text-gray-800">
                  {service.priceType === "quote" ? "Sur devis" : service.priceType === "unit" ? "À l'unité" : "Prix fixe"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Commande</p>
                <p className="mt-1 font-semibold text-gray-800">
                  {service.directPurchase ? "Directe" : "Sur devis / conversationnel"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Rendez-vous</p>
                <p className="mt-1 font-semibold text-gray-800">
                  {service.appointmentAvailable ? "Possible" : "Non requis"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
