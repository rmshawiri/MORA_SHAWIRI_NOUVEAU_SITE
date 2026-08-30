import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Administration et espaces privés jamais indexés.
      disallow: ["/admin", "/espace-client", "/espace-affilie"],
    },
    sitemap: `${absoluteUrl("/sitemap.xml")}`,
  };
}
