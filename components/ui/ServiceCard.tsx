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
  return (
    <article
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md",
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
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-mora-blue-20 px-3 py-1 text-xs font-medium text-mora-blue">
            {service.category}
          </span>
          <span
            className={cn(
              "text-sm font-bold",
              service.priceType === "quote" ? "text-gray-500" : "text-mora-blue",
            )}
          >
            {priceLabel(service)}
          </span>
        </div>

        <h3 className="font-display text-lg font-bold leading-snug text-gray-900">
          <Link href={`/services/${service.slug}`} className="hover:text-mora-blue">
            {service.name}
          </Link>
        </h3>

        <p className="flex-1 text-sm leading-relaxed text-gray-600">{service.summary}</p>

        <div className="mt-2">
          <Button
            href={service.directPurchase ? `/services/${service.slug}` : `/devis?service=${service.slug}`}
            variant={service.directPurchase ? "primary" : "secondary"}
            size="sm"
          >
            {service.ctaPrimary}
          </Button>
        </div>
      </div>
    </article>
  );
}
