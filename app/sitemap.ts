import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/config";
import { services } from "@/lib/data/services";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes = [
    "/",
    "/services",
    "/boutique",
    "/qui-sommes-nous",
    "/affiliation",
    "/contact",
    "/faq",
    "/devis",
    "/connexion",
    "/inscription",
  ];

  const entries: MetadataRoute.Sitemap = staticRoutes.map((path) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency: "weekly",
    priority: path === "/" ? 1 : 0.8,
  }));

  // Fiches services (publics, indexables)
  for (const service of services) {
    entries.push({
      url: absoluteUrl(`/services/${service.slug}`),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  // Pages légales (indexables)
  for (const path of [
    "/mentions-legales",
    "/politique-confidentialite",
    "/conditions-utilisation",
    "/conditions-vente",
    "/politique-cookies",
    "/politique-remboursement",
  ]) {
    entries.push({
      url: absoluteUrl(path),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    });
  }

  return entries;
}
