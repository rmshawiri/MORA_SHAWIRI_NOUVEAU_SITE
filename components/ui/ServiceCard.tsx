import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { priceLabel, type Service } from "@/lib/data/services";
import { cn } from "@/lib/utils";

export function ServiceCard({
  service,
  className,
}: {
  service: Service;
  className?: string;
}) {
  const ctaHref = service.directPurchase ? `/commander?service=${service.slug}` : `/devis?service=${service.slug}`;

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-soft card-lift",
        className,
      )}
    >
      <Link
        href={`/services/${service.slug}`}
        className="relative block aspect-[4/3] overflow-hidden bg-gray-structure"
        aria-label={`Voir le service ${service.name}`}
      >
        <Image
          src={service.image}
          alt={`Image du service ${service.name} de MORA Shawiri`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-transparent" />
        {/* Prix affiché sur le visuel */}
        <span
          className={cn(
            "absolute bottom-3 left-3 rounded-full px-3 py-1 text-xs font-bold backdrop-blur-sm",
            service.priceType === "quote"
              ? "bg-white/95 text-gray-700"
              : "bg-mora-or text-mora-blue shadow-gold",
          )}
        >
          {priceLabel(service)}
        </span>
        <span
          aria-hidden
          className="absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-center gap-1.5 rounded-xl bg-white/95 py-2 text-sm font-semibold text-mora-blue opacity-0 backdrop-blur-sm transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
        >
          Voir le service
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-mora-blue-10 px-3 py-1 text-xs font-semibold text-mora-blue">
            {service.category}
          </span>
        </div>

        <h3 className="font-display text-lg font-bold leading-snug text-gray-900 transition-colors group-hover:text-mora-blue">
          <Link href={`/services/${service.slug}`}>{service.name}</Link>
        </h3>

        <p className="flex-1 text-sm leading-relaxed text-gray-600">{service.summary}</p>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Button href={ctaHref} variant={service.directPurchase ? "primary" : "secondary"} size="sm">
            {service.ctaPrimary}
          </Button>
          <Link
            href={`/services/${service.slug}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-mora-blue transition-colors hover:text-mora-blue-60"
            aria-label={`En savoir plus sur ${service.name}`}
          >
            Menu
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
